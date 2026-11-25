import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
	AdjustmentRequest,
	StockCount,
	StockCountEntry,
	StockCountLine,
	StockCountStart,
} from '@saha-textile/contracts';
import {
	type AdjustmentRequestRepository,
	type NumberAllocatorPort,
	StaleVersionError,
	type StockCountRepository,
	StockMovementRefusedError,
	type StockReadRepository,
	type TransactionContext,
	countLineDifference,
	describeUnits,
	fifoDraw,
	fiscalYearOf,
	formatDocumentNumber,
	formatQuantity,
	formatRupees,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	ADJUSTMENT_REQUEST_REPOSITORY,
	NUMBER_ALLOCATOR,
	STOCK_COUNT_REPOSITORY,
	STOCK_READ_REPOSITORY,
} from '../infra/tokens';
import { PurchasingSupport, actorOf, canSeeCost, holds, missing, refuse } from './purchasing-support';
import { StockAdjustmentBooks } from './stock-adjustment-books';
import { StockWriter } from './stock-writer';

/** How many times a counter's save is merged and retried when another phone saved first. */
const COUNT_SAVE_ATTEMPTS = 6;

/**
 * Stock counts (c01–c03, g02): counted without closing the shop. Expected = stock at the start +
 * every movement since (sales, purchases, returns), so sales during the count are added back.
 * Posting writes each difference as a count correction; without Approve write-offs the count
 * waits for approval like any write-off (P2).
 */
@Injectable()
export class StockCountsService {
	constructor(
		@Inject(STOCK_COUNT_REPOSITORY) private readonly counts: StockCountRepository,
		@Inject(STOCK_READ_REPOSITORY) private readonly stock: StockReadRepository,
		@Inject(ADJUSTMENT_REQUEST_REPOSITORY) private readonly requests: AdjustmentRequestRepository,
		@Inject(NUMBER_ALLOCATOR) private readonly numbers: NumberAllocatorPort,
		private readonly writer: StockWriter,
		private readonly support: PurchasingSupport,
		/** D5: a count's differences take a stock adjustment number and go to the books like any adjustment. */
		@Optional() @Inject(StockAdjustmentBooks) private readonly adjustmentBooks: StockAdjustmentBooks | null = null,
	) {}

	private async load(id: string, context?: TransactionContext): Promise<StockCount> {
		const count = await this.counts.findById(id, context);
		if (!count) throw missing('Stock count');
		return count;
	}

	list(query: { filter: string; page: number; pageSize: number }) {
		return this.counts.list(query);
	}

	/** c02: whole shop, some categories, chosen SKUs, or what differed last time. */
	async start(body: StockCountStart, actor: string | null): Promise<StockCount> {
		let variantIds: string[];
		if (body.scope.kind === 'skus') variantIds = [...new Set(body.scope.variantIds)];
		else if (body.scope.kind === 'last_differences') variantIds = await this.counts.lastDifferences();
		else
			variantIds = await this.stock.variantIdsInScope({
				kind: body.scope.kind,
				categoryIds: body.scope.categoryIds,
			});
		if (body.scope.kind === 'categories' && body.scope.categoryIds.length === 0) {
			throw refuse('scope_empty', 'Pick at least one category.', 'scope');
		}
		const facts = await this.stock.items(variantIds);
		const tracked = [...facts.values()].filter((fact) => fact.tracked && fact.productType !== 'bundle');
		if (tracked.length === 0) throw refuse('scope_empty', 'Nothing to count in that choice.', 'scope');
		// SC1: a count of one location expects that location's stock; of every location, the total.
		const here = body.locationId
			? await this.writer.onHandAt(
					tracked.map((fact) => fact.variantId),
					body.locationId,
				)
			: null;
		const onHand = (fact: (typeof tracked)[number]) => (here ? (here.get(fact.variantId) ?? 0) : fact.onHand);
		const images = await this.support.thumbnails(tracked.map((fact) => fact.galleryAssetId));
		const fiscalYear = fiscalYearOf(this.support.today());
		const settings = await this.support.settings();
		const number = formatDocumentNumber(
			settings.numberFormats.stockCount,
			fiscalYear,
			await this.numbers.next('SC', fiscalYear),
		);
		const now = new Date().toISOString();
		const names = await this.support.names(body.counterIds);
		const count: StockCount = {
			id: `sc_${randomUUID()}`,
			number,
			label: body.label || (body.scope.kind === 'all' ? 'Whole shop' : (tracked[0]?.categoryName ?? number)),
			scope: body.scope,
			locationId: body.locationId,
			blind: body.blind,
			counterIds: body.counterIds,
			counterNames: body.counterIds.map((id) => names.get(id) ?? 'Someone'),
			posting: null,
			status: 'counting',
			startedAt: now,
			startedBy: actor,
			lines: tracked
				.sort((a, b) => a.sku.localeCompare(b.sku))
				.map((fact) => ({
					variantId: fact.variantId,
					productId: fact.productId,
					sku: fact.sku,
					title: fact.title['en'] ?? fact.sku,
					optionsLabel: fact.optionsLabel,
					imageUrl: fact.galleryAssetId ? (images.get(fact.galleryAssetId) ?? null) : null,
					soldBy: fact.soldBy,
					atStart: onHand(fact),
					soldDuring: 0,
					expected: onHand(fact),
					counted: null,
					difference: null,
					valueINR: null,
					note: null,
					countedBy: null,
					countedAt: null,
					recount: false,
				})),
			totals: emptyTotals(tracked.length),
			postedAt: null,
			postedBy: null,
			approvalRequestId: null,
			updatedBy: actor,
			version: 1,
		};
		await this.counts.save(count, null);
		await this.support.record({
			actor,
			action: 'stock.count.start',
			entityType: 'stock_count',
			entityId: count.id,
			text: `${await this.support.nameOf(actor)} started count ${number} (${count.label}): ${count.lines.length} SKUs, ${body.blind ? 'blind' : 'expected figures shown'}.`,
		});
		return count;
	}

	/** Expected, differences and their value as they stand now (sales during the count added back). */
	private async refreshed(count: StockCount, seeCost: boolean): Promise<StockCount> {
		const variantIds = count.lines.map((line) => line.variantId);
		const [moved, layers] = await Promise.all([
			this.stock.movedSince(variantIds, count.startedAt, count.id, count.locationId ?? null),
			seeCost ? this.stock.openLayers(variantIds) : Promise.resolve([]),
		]);
		const lines: StockCountLine[] = count.lines.map((line) => {
			const movedSince = moved.get(line.variantId) ?? 0;
			const { expected, difference } = countLineDifference({
				atStart: line.atStart ?? 0,
				movedSince,
				counted: line.counted,
			});
			let valueINR: number | null = null;
			if (seeCost && difference) {
				const own = layers.filter((layer) => layer.variantId === line.variantId);
				if (difference < 0) valueINR = -fifoDraw(own, -difference, line.soldBy).valueINR;
				else {
					const latest = [...own].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
					valueINR = Math.round(difference * (latest?.unitCostINR ?? 0) * 100) / 100;
				}
			} else if (seeCost) valueINR = 0;
			return { ...line, soldDuring: -Math.min(0, movedSince), expected, difference, valueINR };
		});
		return { ...count, lines, totals: totalsOf(lines, seeCost) };
	}

	/** A counter on a blind count sees what to count, never what is expected (c02). */
	async get(id: string, principal: AuthenticatedPrincipal | undefined): Promise<StockCount> {
		const seeCost = canSeeCost(principal);
		const count = await this.refreshed(await this.load(id), seeCost);
		const reviewer = holds(principal, 'stock_count.post');
		if (!count.blind || reviewer || count.status === 'posted') return count;
		return {
			...count,
			lines: count.lines.map((line) => ({
				...line,
				atStart: null,
				soldDuring: null,
				expected: null,
				difference: null,
				valueINR: null,
			})),
			totals: {
				...count.totals,
				differences: 0,
				missingPieces: 0,
				missingTenths: 0,
				missingValueINR: null,
				foundPieces: 0,
				foundTenths: 0,
				foundValueINR: null,
				netPieces: 0,
				netTenths: 0,
				netValueINR: null,
			},
		};
	}

	/**
	 * g02: counts from one phone. Several counters save at once on different lines, so a save that
	 * finds the count changed reloads, lays its own lines over the newer copy, and tries again.
	 */
	async enter(id: string, body: StockCountEntry, principal: AuthenticatedPrincipal | undefined): Promise<StockCount> {
		const actor = actorOf(principal);
		for (let attempt = 1; ; attempt += 1) {
			const count = await this.load(id);
			if (count.status !== 'counting') throw refuse('wrong_status', 'This count is no longer open for counting.');
			if (
				count.counterIds.length &&
				actor &&
				!count.counterIds.includes(actor) &&
				!holds(principal, 'stock_count.post')
			) {
				throw refuse('not_a_counter', 'You are not one of the counters on this count.');
			}
			const byVariant = new Map(body.lines.map((row) => [row.variantId, row]));
			for (const row of body.lines) {
				if (!count.lines.some((line) => line.variantId === row.variantId)) {
					throw refuse('not_in_count', 'That item is not part of this count.', row.variantId);
				}
			}
			const now = new Date().toISOString();
			const next: StockCount = {
				...count,
				lines: count.lines.map((line) => {
					const row = byVariant.get(line.variantId);
					return row
						? {
								...line,
								counted: row.counted,
								note: row.note,
								countedBy: actor,
								countedAt: now,
								recount: false,
							}
						: line;
				}),
				updatedBy: actor,
			};
			try {
				const version = await this.counts.save(next, count.version);
				return this.get(id, principal).then((view) => ({ ...view, version }));
			} catch (error) {
				if (error instanceof StaleVersionError && attempt < COUNT_SAVE_ATTEMPTS) continue;
				if (error instanceof StaleVersionError) throw await this.support.staleConflict(error);
				throw error;
			}
		}
	}

	/** Counting is done: the count goes to review. */
	async finish(id: string, actor: string | null): Promise<StockCount> {
		const count = await this.load(id);
		if (count.status !== 'counting') throw refuse('wrong_status', 'This count is not being counted.');
		const version = await this.support.guardStale(() =>
			this.counts.save({ ...count, status: 'review', updatedBy: actor }, count.version),
		);
		await this.support.record({
			actor,
			action: 'stock.count.review',
			entityType: 'stock_count',
			entityId: id,
			text: `${await this.support.nameOf(actor)} finished counting ${count.number}: ${count.lines.filter((line) => line.counted !== null).length} of ${count.lines.length} SKUs counted.`,
		});
		return { ...count, status: 'review', version };
	}

	/** c03 Recount: the differing lines go back to the counters, cleared. */
	async recount(id: string, variantIds: readonly string[], actor: string | null): Promise<StockCount> {
		const count = await this.load(id);
		if (count.status !== 'review') throw refuse('wrong_status', 'Only a count under review can be sent back.');
		const wanted = new Set(variantIds);
		const next: StockCount = {
			...count,
			status: 'counting',
			lines: count.lines.map((line) =>
				wanted.has(line.variantId)
					? { ...line, counted: null, countedBy: null, countedAt: null, recount: true }
					: line,
			),
			updatedBy: actor,
		};
		const version = await this.support.guardStale(() => this.counts.save(next, count.version));
		await this.support.record({
			actor,
			action: 'stock.count.recount',
			entityType: 'stock_count',
			entityId: id,
			text: `${await this.support.nameOf(actor)} sent ${wanted.size} line${wanted.size === 1 ? '' : 's'} of ${count.number} back for a recount.`,
		});
		return { ...next, version };
	}

	/**
	 * c03 Post. With Approve write-offs the differences post at once as count corrections; without
	 * it the count waits in the approvals queue (P2). Uncounted lines stay as they are.
	 */
	async post(id: string, principal: AuthenticatedPrincipal | undefined): Promise<StockCount> {
		const actor = actorOf(principal);
		const count = await this.refreshed(await this.load(id), true);
		if (count.status !== 'review') throw refuse('wrong_status', 'Finish counting before posting.');
		if (holds(principal, 'stock.approve')) return this.apply(count.id, actor, actor, true);

		const name = await this.support.nameOf(actor);
		const request: AdjustmentRequest = {
			id: `adj_${randomUUID()}`,
			kind: 'count',
			variantId: null,
			productId: null,
			sku: null,
			title: `${count.number} · ${count.label}`,
			imageUrl: null,
			soldBy: 'piece',
			action: null,
			// A count's request is decided on its summary; its quantity is the net in pieces only.
			quantity: count.totals.netPieces,
			reasonCode: 'manual_recount_correction',
			holdId: null,
			note: '',
			photoAssetIds: [],
			valueAtCostINR: count.totals.netValueINR,
			costBreakdown: null,
			countId: count.id,
			countNumber: count.number,
			countSummary: {
				skus: count.totals.skus,
				differences: count.totals.differences,
				missing: count.totals.missingPieces,
				found: count.totals.foundPieces,
				missingTenths: count.totals.missingTenths,
				foundTenths: count.totals.foundTenths,
			},
			status: 'pending',
			requestedBy: actor,
			requestedByName: name,
			requestedAt: new Date().toISOString(),
			decidedBy: null,
			decidedByName: null,
			decidedAt: null,
			rejectReason: null,
			selfApproved: false,
		};
		const version = await this.support.guardStale(() =>
			this.support.inTransaction(async (context) => {
				await this.requests.save(request, `count:${count.id}:${count.version}`, context);
				const saved = await this.counts.save(
					{ ...count, status: 'awaiting_approval', approvalRequestId: request.id, updatedBy: actor },
					count.version,
					context,
				);
				await this.support.record(
					{
						actor,
						action: 'stock.count.request',
						entityType: 'stock_count',
						entityId: count.id,
						text: countAuditText({
							who: name,
							verb: 'asked to post',
							count,
							at: new Date().toISOString(),
							notCounted: count.lines.filter((line) => line.counted === null).length,
							approver: null,
							selfApproved: false,
							posting: null,
						}),
					},
					context,
				);
				return saved;
			}),
		);
		return { ...count, status: 'awaiting_approval', approvalRequestId: request.id, version };
	}

	/** Back to review after a rejection (the approver's reason is on the request). */
	async reopen(countId: string, actor: string | null, context: TransactionContext): Promise<void> {
		const count = await this.load(countId, context);
		await this.counts.save(
			{ ...count, status: 'review', approvalRequestId: null, updatedBy: actor },
			count.version,
			context,
		);
	}

	/** Writes each counted difference as a count correction, in one transaction. */
	async apply(
		countId: string,
		actor: string | null,
		approver: string | null,
		selfApproved: boolean,
		alongside?: (context: TransactionContext) => Promise<void>,
	): Promise<StockCount> {
		const fresh = await this.refreshed(await this.load(countId), true);
		if (fresh.status !== 'review' && fresh.status !== 'awaiting_approval') {
			throw refuse(
				'wrong_status',
				`Count ${fresh.number} is ${fresh.status === 'posted' ? 'already posted' : 'still being counted'}.`,
			);
		}
		const differing = fresh.lines.filter(
			(line): line is DifferingLine => line.difference !== null && line.difference !== 0,
		);
		const notCounted = fresh.lines.filter((line) => line.counted === null).length;
		const now = new Date().toISOString();
		const books = differing.length ? this.adjustmentBooks : null;
		const posted = await this.support
			.inTransaction(async (context) => {
				// The stock adjustment number is taken first, so the stock rows and the vouchers carry it.
				const adjustmentNumber = books ? await books.number(context, new Date(now)) : null;
				for (const line of differing) {
					const difference = line.difference;
					await this.writer.apply(
						{
							variantId: line.variantId,
							action: difference < 0 ? 'remove' : 'add',
							quantity: Math.abs(difference),
							reasonCode: 'manual_recount_correction',
							holdReason: null,
							holdId: null,
							note: line.note ?? `Count ${fresh.number}`,
							referenceType: 'stock_count',
							referenceId: fresh.id,
							referenceNumber: adjustmentNumber ?? fresh.number,
							actor,
							approver,
							source: 'stock_count',
							locationId: fresh.locationId ?? null,
						},
						context,
					);
				}
				// Each item that differed is its own voucher: its cost, and on a shortage the input tax taken back.
				let posting: StockCount['posting'] = null;
				if (books && adjustmentNumber) {
					const facts = await this.stock.items(differing.map((line) => line.variantId));
					const journalNumbers: string[] = [];
					let itcPaise = 0;
					for (const line of differing) {
						const done = await books.posted(
							{
								id: `${fresh.id}:${line.variantId}`,
								action: line.difference < 0 ? 'remove' : 'add',
								quantity: Math.abs(line.difference),
								reasonCode: 'manual_recount_correction',
								outcome: line.difference < 0 ? 'writtenOff' : null,
								hsnCode: facts.get(line.variantId)?.hsnCode ?? null,
								valueINR: Math.abs(line.valueINR as number),
							},
							adjustmentNumber,
							context,
							approver ?? actor,
							new Date(now),
						);
						if (done.journalNumber) journalNumbers.push(done.journalNumber);
						itcPaise += Math.round((done.itcReversedINR ?? 0) * 100);
					}
					posting = { adjustmentNumber, journalNumbers, itcReversedINR: itcPaise / 100 };
				}
				const next: StockCount = {
					...fresh,
					status: 'posted',
					postedAt: now,
					postedBy: approver ?? actor,
					posting,
					updatedBy: actor,
				};
				const version = await this.counts.save(next, fresh.version, context);
				if (alongside) await alongside(context);
				await this.support.record(
					{
						actor: approver ?? actor,
						action: 'stock.count.post',
						entityType: 'stock_count',
						entityId: fresh.id,
						text: countAuditText({
							who: await this.support.nameOf(approver ?? actor),
							verb: 'posted',
							count: fresh,
							at: now,
							notCounted,
							approver: approver ? await this.support.nameOf(approver) : null,
							selfApproved,
							posting,
						}),
					},
					context,
				);
				return { ...next, version };
			})
			.catch((error: unknown) => {
				if (error instanceof StockMovementRefusedError) {
					throw refuse(
						'count_below_held',
						'A counted figure is below what is held for that item. Release the held pieces first.',
					);
				}
				throw error;
			});
		await this.writer.refreshShop(differing.map((line) => line.productId));
		return posted;
	}
}

function emptyTotals(skus: number): StockCount['totals'] {
	return {
		skus,
		counted: 0,
		differences: 0,
		missingPieces: 0,
		missingTenths: 0,
		missingValueINR: 0,
		foundPieces: 0,
		foundTenths: 0,
		foundValueINR: 0,
		netPieces: 0,
		netTenths: 0,
		netValueINR: 0,
	};
}

/** A line whose count differs from what was expected. */
type DifferingLine = StockCountLine & { difference: number };

function totalsOf(lines: readonly StockCountLine[], seeCost: boolean): StockCount['totals'] {
	const differing = lines.filter((line): line is DifferingLine => (line.difference ?? 0) !== 0);
	const missing = differing.filter((line) => line.difference < 0);
	const found = differing.filter((line) => line.difference > 0);
	// With cost seen, refreshed() priced every line (0 where nothing differs), so each value is a number.
	const value = (rows: readonly StockCountLine[]) =>
		seeCost ? Math.round(rows.reduce((sum, line) => sum + (line.valueINR as number) * 100, 0)) / 100 : null;
	// Pieces and tenths of a metre are summed apart; short counts come out positive.
	const sum = (rows: readonly DifferingLine[], soldBy: StockCountLine['soldBy'], sign: 1 | -1) =>
		rows.filter((line) => line.soldBy === soldBy).reduce((total, line) => total + sign * line.difference, 0);
	return {
		skus: lines.length,
		counted: lines.filter((line) => line.counted !== null).length,
		differences: differing.length,
		missingPieces: sum(missing, 'piece', -1),
		missingTenths: sum(missing, 'metre', -1),
		missingValueINR: value(missing),
		foundPieces: sum(found, 'piece', 1),
		foundTenths: sum(found, 'metre', 1),
		foundValueINR: value(found),
		netPieces: sum(differing, 'piece', 1),
		netTenths: sum(differing, 'metre', 1),
		netValueINR: value(differing),
	};
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;

/** "24 Nov 2026, 10:40 am IST". */
function istStamp(iso: string): string {
	const date = new Date(iso);
	const day = date.toLocaleDateString('en-IN', {
		timeZone: 'Asia/Kolkata',
		day: 'numeric',
		month: 'short',
		year: 'numeric',
	});
	const time = date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
	return `${day}, ${time.toLowerCase()} IST`;
}

/**
 * The edit log's line for a count asked to post or posted, as an auditor reads it (SA 501 physical verification; the
 * Companies (Accounts) Rules' audit trail): who, when, how many counted, the shortages and the excesses each in pieces
 * and metres kept apart and at cost (a net alone hides differences that cancel out), the net, the stock adjustment and
 * journal numbers that trace it to the ledger, the input tax taken back, what was not counted, and who counted and
 * approved. With nothing different it says so in words.
 */
export function countAuditText(input: {
	who: string;
	verb: 'asked to post' | 'posted';
	count: Pick<StockCount, 'number' | 'label' | 'lines' | 'counterNames'>;
	at: string;
	notCounted: number;
	approver: string | null;
	selfApproved: boolean;
	posting: StockCount['posting'];
}): string {
	const { count } = input;
	// Each item that differs, once: its difference (pieces, or tenths of a metre) and its value at cost when seen.
	const differing = count.lines.flatMap((line) =>
		line.difference ? [{ diff: line.difference, soldBy: line.soldBy, value: line.valueINR }] : [],
	);
	const counted = count.lines.length - input.notCounted;
	const units = (lines: typeof differing) =>
		describeUnits(lines.map((line) => ({ units: Math.abs(line.diff), soldBy: line.soldBy })));
	const priced = differing.every((line) => line.value !== null);
	const valueOf = (lines: typeof differing) =>
		Math.round(lines.reduce((sum, line) => sum + (line.value as number), 0) * 100) / 100;
	const cost = (lines: typeof differing) => (priced ? ` (${formatRupees(Math.abs(valueOf(lines)))} at cost)` : '');
	let text = `${input.who} ${input.verb} count ${count.number} (${count.label}), ${istStamp(input.at)}: ${plural(counted, 'SKU', 'SKUs')} counted`;
	if (!differing.length) text += `, no differences${input.verb === 'posted' ? '; nothing adjusted' : ''}.`;
	else {
		const short = differing.filter((line) => line.diff < 0);
		const over = differing.filter((line) => line.diff > 0);
		const parts = [
			...(short.length ? [`short ${units(short)}${cost(short)}`] : []),
			...(over.length ? [`over ${units(over)}${cost(over)}`] : []),
		];
		const pieces = differing.filter((l) => l.soldBy === 'piece').reduce((sum, l) => sum + l.diff, 0);
		const tenths = differing.filter((l) => l.soldBy === 'metre').reduce((sum, l) => sum + l.diff, 0);
		const net = [
			...(pieces || !tenths ? [`${signed(pieces)} ${Math.abs(pieces) === 1 ? 'piece' : 'pieces'}`] : []),
			...(tenths ? [`${tenths > 0 ? '+' : '−'}${formatQuantity(Math.abs(tenths), 'metre')}`] : []),
		].join(' and ');
		const netValue = valueOf(differing);
		const netCost = priced
			? `, ${netValue > 0 ? '+' : netValue < 0 ? '−' : ''}${formatRupees(Math.abs(netValue))} at cost`
			: '';
		text += `, ${plural(differing.length, 'differs', 'differ')}: ${parts.join(', ')}; net ${net}${netCost}.`;
	}
	if (input.posting)
		text += ` Stock adjustment ${input.posting.adjustmentNumber}${input.posting.journalNumbers.length ? `, ${plural(input.posting.journalNumbers.length, 'journal', 'journals')} ${input.posting.journalNumbers.join(', ')}` : ''}${input.posting.itcReversedINR ? `; input tax reversed ${formatRupees(input.posting.itcReversedINR)} (s.17(5)(h))` : ''}.`;
	if (input.notCounted)
		text += ` ${plural(input.notCounted, 'item', 'items')} not counted ${input.notCounted === 1 ? 'stays as it is' : 'stay as they are'}.`;
	text += ` Counted by ${count.counterNames.join(', ') || 'the person posting'}${input.approver ? `; approved by ${input.approver}` : ''}.`;
	if (input.selfApproved) text += ' Self-approved.';
	return text;
}
