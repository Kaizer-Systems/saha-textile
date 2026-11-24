import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
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
			blind: body.blind,
			counterIds: body.counterIds,
			counterNames: body.counterIds.map((id) => names.get(id) ?? 'Someone'),
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
					atStart: fact.onHand,
					soldDuring: 0,
					expected: fact.onHand,
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
			this.stock.movedSince(variantIds, count.startedAt, count.id),
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
				missingUnits: 0,
				missingValueINR: null,
				foundUnits: 0,
				foundValueINR: null,
				netUnits: 0,
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
			quantity: count.totals.netUnits,
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
				missing: count.totals.missingUnits,
				found: count.totals.foundUnits,
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
						text: `${name} asked to post count ${count.number} (${count.label}): ${count.totals.skus} SKUs, ${count.totals.differences} differences, net ${count.totals.netUnits >= 0 ? '+' : ''}${count.totals.netUnits}${count.totals.netValueINR !== null ? `, ${formatRupees(count.totals.netValueINR)} at cost` : ''}.`,
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
		const posted = await this.support
			.inTransaction(async (context) => {
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
							referenceNumber: fresh.number,
							actor,
							approver,
							source: 'stock_count',
						},
						context,
					);
				}
				const next: StockCount = {
					...fresh,
					status: 'posted',
					postedAt: now,
					postedBy: approver ?? actor,
					updatedBy: actor,
				};
				const version = await this.counts.save(next, fresh.version, context);
				if (alongside) await alongside(context);
				const units = describeUnits(
					differing.map((line) => ({ units: Math.abs(line.difference), soldBy: line.soldBy })),
				);
				await this.support.record(
					{
						actor: approver ?? actor,
						action: 'stock.count.post',
						entityType: 'stock_count',
						entityId: fresh.id,
						text: `${await this.support.nameOf(approver ?? actor)} posted count ${fresh.number} (${fresh.label}): ${fresh.totals.skus} SKUs, ${fresh.totals.differences} differences (${units || 'none'}), net ${fresh.totals.netUnits >= 0 ? '+' : ''}${fresh.totals.netUnits}, ${formatRupees(fresh.totals.netValueINR ?? 0)} at cost.${notCounted ? ` ${notCounted} not counted stay as they are.` : ''}${selfApproved ? ' Self-approved.' : ''}`,
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
		missingUnits: 0,
		missingValueINR: 0,
		foundUnits: 0,
		foundValueINR: 0,
		netUnits: 0,
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
	return {
		skus: lines.length,
		counted: lines.filter((line) => line.counted !== null).length,
		differences: differing.length,
		missingUnits: missing.reduce((sum, line) => sum - line.difference, 0),
		missingValueINR: value(missing),
		foundUnits: found.reduce((sum, line) => sum + line.difference, 0),
		foundValueINR: value(found),
		netUnits: differing.reduce((sum, line) => sum + line.difference, 0),
		netValueINR: value(differing),
	};
}
