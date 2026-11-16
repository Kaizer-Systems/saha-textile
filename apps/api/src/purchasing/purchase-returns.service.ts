import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
	PurchaseEntry,
	PurchaseReturn,
	PurchaseReturnListQuery,
	PurchaseReturnListResponse,
	PurchaseReturnSend,
	PurchaseReturnSettle,
	PurchaseReturnWrite,
	ReturnableLine,
} from '@saha-textile/contracts';
import {
	type NumberAllocatorPort,
	type PurchaseEntryRepository,
	type PurchaseReturnRepository,
	type SearchOutboxRepository,
	type StockHoldRepository,
	type StockMovementPort,
	StockMovementRefusedError,
	type StockReadRepository,
	booksClosedProblem,
	computeReturnTotals,
	describeUnits,
	entryPaymentStatus,
	fiscalYearOf,
	formatDocumentNumber,
	formatQuantity,
	formatRupees,
	freeToReturn,
	returnsCredit,
	settlementOpen,
} from '@saha-textile/core-domain';

import {
	NUMBER_ALLOCATOR,
	PURCHASE_ENTRY_REPOSITORY,
	PURCHASE_RETURN_REPOSITORY,
	SEARCH_OUTBOX,
	STOCK_HOLD_REPOSITORY,
	STOCK_MOVEMENT,
	STOCK_READ_REPOSITORY,
} from '../infra/tokens';
import { PurchasingSupport, missing, refuse } from './purchasing-support';

const REASON_WORDS: Record<PurchaseReturn['reason'], string> = {
	damaged_on_arrival: 'damaged on arrival',
	wrong_item: 'wrong item',
	short_supplied: 'short supplied',
	quality_after_accepting: 'quality problem found after accepting',
	extra_sent: 'extra pieces sent',
	other: 'other',
};

const SETTLED_WORDS: Record<PurchaseReturnSettle['how'], string> = {
	credit_note: 'their credit note',
	refund: 'a refund',
	later_bill: 'taken off a later bill',
	written_off: 'written off (they refused)',
};

/** What one stock unit of an entry line cost (per piece, or per tenth of a metre). */
const lineUnitCost = (line: PurchaseEntry['lines'][number]): number =>
	line.soldBy === 'metre' ? (line.unitCostINR ?? 0) / 10 : (line.unitCostINR ?? 0);

/** Whether sending moves stock: goods that were in stock, not pieces kept out at the goods check. */
const movesStock = (doc: Pick<PurchaseReturn, 'kind' | 'origin'>): boolean =>
	doc.kind === 'return_goods' && doc.origin !== 'goods_check';

/**
 * Purchase returns and debit notes (r01–r04). A return always starts from a posted entry, so the
 * cost that comes off is that entry's own cost. Stock leaves when the return is SENT; a short-
 * supply claim and pieces kept out at the goods check never move stock.
 */
@Injectable()
export class PurchaseReturnsService {
	constructor(
		@Inject(PURCHASE_RETURN_REPOSITORY) private readonly returns: PurchaseReturnRepository,
		@Inject(PURCHASE_ENTRY_REPOSITORY) private readonly entries: PurchaseEntryRepository,
		@Inject(STOCK_READ_REPOSITORY) private readonly stock: StockReadRepository,
		@Inject(STOCK_HOLD_REPOSITORY) private readonly holds: StockHoldRepository,
		@Inject(STOCK_MOVEMENT) private readonly movement: StockMovementPort,
		@Inject(NUMBER_ALLOCATOR) private readonly numbers: NumberAllocatorPort,
		private readonly support: PurchasingSupport,
		@Optional() @Inject(SEARCH_OUTBOX) private readonly searchOutbox: SearchOutboxRepository | null = null,
	) {}

	private async load(id: string): Promise<PurchaseReturn> {
		const doc = await this.returns.findById(id);
		if (!doc) throw missing('Purchase return');
		return doc;
	}

	private async postedEntry(id: string): Promise<PurchaseEntry> {
		const entry = await this.entries.findById(id);
		if (!entry) throw missing('Purchase entry');
		if (entry.status !== 'posted')
			throw refuse('entry_not_posted', 'A return starts from a posted purchase entry.', 'purchaseEntryId');
		return entry;
	}

	list(query: PurchaseReturnListQuery): Promise<PurchaseReturnListResponse> {
		return this.returns.list({ ...query, today: this.support.today() });
	}

	get(id: string): Promise<PurchaseReturn> {
		return this.load(id);
	}

	/**
	 * r02/r03: per entry line, what was received, already returned, on hand, held and in orders,
	 * and the most that can go back now, with the reason when it is capped.
	 */
	async returnable(
		entryId: string,
		kind: PurchaseReturn['kind'],
		holdId: string | null,
		excludeReturnId: string | null,
	): Promise<Array<ReturnableLine & { capReason: string | null }>> {
		const entry = await this.postedEntry(entryId);
		const [others, layers, facts, hold] = await Promise.all([
			this.returns.forEntry(entryId),
			this.stock.layersForEntry(entryId),
			this.stock.items(entry.lines.map((line) => line.variantId)),
			holdId ? this.holds.findById(holdId) : Promise.resolve(null),
		]);
		if (holdId && (!hold || hold.status !== 'open'))
			throw refuse('hold_closed', 'That hold is no longer open.', 'holdId');
		return entry.lines
			.filter((line) => !hold || line.variantId === hold.variantId)
			.map((line) => {
				const fromStock = others.filter((doc) => doc.id !== excludeReturnId && movesStock(doc));
				const shortClaims = others.filter((doc) => doc.id !== excludeReturnId && doc.kind === 'short_supply');
				const sum = (docs: PurchaseReturn[]) =>
					docs
						.flatMap((doc) => doc.lines)
						.filter((row) => row.entryLineId === line.lineId)
						.reduce((total, row) => total + row.quantity, 0);
				const fact = facts.get(line.variantId);
				const layer = layers.find((row) => row.sourceLineId === line.lineId);
				const verdict = freeToReturn(
					{
						entryLineId: line.lineId,
						accepted: line.accepted ?? 0,
						missing: line.missing,
						returnedBefore: sum(fromStock),
						claimedShortBefore: sum(shortClaims),
						onHand: fact?.onHand ?? 0,
						held: fact?.held ?? 0,
						reserved: 0,
						layerRemaining: layer?.quantityRemaining ?? 0,
						soldBy: line.soldBy,
					},
					kind,
					hold ? { quantity: hold.quantity } : null,
				);
				return {
					entryLineId: line.lineId,
					variantId: line.variantId,
					sku: line.sku,
					title: line.title,
					optionsLabel: line.optionsLabel,
					soldBy: line.soldBy,
					imageUrl: line.imageUrl,
					received: line.accepted ?? 0,
					returnedBefore: kind === 'short_supply' ? sum(shortClaims) : sum(fromStock),
					onHand: fact?.onHand ?? 0,
					held: fact?.held ?? 0,
					inOrders: 0,
					freeToReturn: verdict.max,
					unitCostINR: lineUnitCost(line),
					gstRatePct: line.gstRatePct,
					capReason: verdict.capReason,
				};
			});
	}

	private async build(
		write: PurchaseReturnWrite,
		existing: PurchaseReturn | null,
		actor: string | null,
	): Promise<PurchaseReturn> {
		const entry = await this.postedEntry(write.purchaseEntryId);
		if (write.kind === 'short_supply' && write.holdId) {
			throw refuse(
				'hold_not_for_claim',
				'A short-supply claim has no goods, so it cannot take held pieces.',
				'holdId',
			);
		}
		const capped = await this.returnable(entry.id, write.kind, write.holdId, existing?.id ?? null);
		const byLine = new Map(capped.map((row) => [row.entryLineId, row]));
		const entryLines = new Map(entry.lines.map((line) => [line.lineId, line]));
		const picked = write.lines.map((row) => {
			const line = entryLines.get(row.entryLineId);
			const cap = byLine.get(row.entryLineId);
			if (!line || !cap)
				throw refuse('line_not_on_entry', 'That line is not on the purchase entry.', row.entryLineId);
			if (row.quantity > cap.freeToReturn) {
				// r03: name why, and offer the smaller number.
				throw refuse(
					'return_capped',
					`Only ${formatQuantity(cap.freeToReturn, line.soldBy)} of ${line.sku} can go back. ${cap.capReason ?? ''}`.trim(),
					`${row.entryLineId}:${cap.freeToReturn}`,
				);
			}
			return { row, line };
		});
		const totals = computeReturnTotals(
			entry.taxType,
			picked.map(({ row, line }) => ({
				quantity: row.quantity,
				unitCostPerStockUnitINR: lineUnitCost(line),
				gstRatePct: line.gstRatePct,
			})),
		);
		const now = new Date().toISOString();
		return {
			id: existing?.id ?? `pr_${randomUUID()}`,
			number: null,
			kind: write.kind,
			status: 'draft',
			origin: existing?.origin ?? (write.holdId ? 'held' : 'manual'),
			purchaseEntryId: entry.id,
			purchaseEntryNumber: entry.number,
			supplierId: entry.supplierId,
			supplierName: entry.supplierName,
			taxType: entry.taxType,
			reason: write.kind === 'short_supply' ? 'short_supplied' : write.reason,
			noteToSupplier: write.noteToSupplier,
			photoAssetIds: write.photoAssetIds,
			lines: picked.map(({ row, line }, index) => ({
				lineId: existing?.lines.find((old) => old.entryLineId === line.lineId)?.lineId ?? `prl_${randomUUID()}`,
				entryLineId: line.lineId,
				productId: line.productId,
				variantId: line.variantId,
				sku: line.sku,
				title: line.title,
				optionsLabel: line.optionsLabel,
				soldBy: line.soldBy,
				imageUrl: line.imageUrl,
				quantity: row.quantity,
				unitCostINR: lineUnitCost(line),
				gstRatePct: line.gstRatePct,
				taxableINR: totals.lines[index]?.taxableINR ?? 0,
				taxINR: totals.lines[index]?.taxINR ?? 0,
				totalINR: totals.lines[index]?.totalINR ?? 0,
			})),
			taxableINR: totals.taxableINR,
			cgstINR: totals.cgstINR,
			sgstINR: totals.sgstINR,
			igstINR: totals.igstINR,
			totalINR: totals.totalINR,
			challanNumber: null,
			courier: null,
			docket: null,
			sentAt: null,
			sentBy: null,
			settlements: [],
			settledINR: 0,
			settledAt: null,
			settledBy: null,
			holdId: write.holdId,
			createdBy: existing?.createdBy ?? actor,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
			updatedBy: actor,
			version: existing?.version ?? 1,
		};
	}

	async create(write: PurchaseReturnWrite, actor: string | null): Promise<PurchaseReturn> {
		const doc = await this.build(write, null, actor);
		const version = await this.returns.save(doc, null);
		await this.support.record({
			actor,
			action: 'purchase.return.create',
			entityType: 'purchase_return',
			entityId: doc.id,
			text: `${await this.support.nameOf(actor)} made a ${doc.kind === 'short_supply' ? 'short-supply claim' : 'return'} draft for ${doc.supplierName} from ${doc.purchaseEntryNumber}: ${doc.lines.map((line) => `${formatQuantity(line.quantity, line.soldBy)} × ${line.sku}`).join(', ')}, ${formatRupees(doc.totalINR)}, reason ${REASON_WORDS[doc.reason]}.`,
		});
		return { ...doc, version };
	}

	async update(id: string, write: PurchaseReturnWrite, actor: string | null): Promise<PurchaseReturn> {
		const existing = await this.load(id);
		if (existing.status !== 'draft') throw refuse('wrong_status', 'Only a draft return can change.');
		if (existing.purchaseEntryId !== write.purchaseEntryId) {
			throw refuse('entry_fixed', 'A return stays on the entry it was made from.', 'purchaseEntryId');
		}
		const doc = await this.build(write, existing, actor);
		const version = await this.support.guardStale(() => this.returns.save(doc, write.version ?? existing.version));
		return { ...doc, version };
	}

	async remove(id: string, actor: string | null): Promise<void> {
		const doc = await this.load(id);
		if (doc.status !== 'draft') throw refuse('wrong_status', 'A sent return stays for the books.');
		await this.returns.remove(id);
		await this.support.record({
			actor,
			action: 'purchase.return.delete',
			entityType: 'purchase_return',
			entityId: id,
			text: `${await this.support.nameOf(actor)} deleted a return draft for ${doc.supplierName} (${formatRupees(doc.totalINR)}).`,
		});
	}

	/**
	 * r04: sending gives the debit note its number (and a delivery challan when goods travel),
	 * takes the goods out of stock from the entry's own cost layer, and lowers what is owed on the
	 * bill. Idempotent per request key.
	 */
	async send(id: string, body: PurchaseReturnSend, actor: string | null): Promise<PurchaseReturn> {
		const doc = await this.load(id);
		const claimed = (doc as PurchaseReturn & { sendRequestKey?: string | null }).sendRequestKey ?? null;
		if (doc.status !== 'draft') {
			if (claimed === body.requestKey) return doc;
			throw refuse('wrong_status', 'This return is already sent.');
		}
		// The caps are checked again: stock may have sold since the draft was made.
		const entry = await this.postedEntry(doc.purchaseEntryId);
		// Pieces kept out at the goods check were never in stock, so stock does not cap them.
		const fresh =
			doc.origin === 'goods_check'
				? doc
				: await this.build(
						{
							purchaseEntryId: doc.purchaseEntryId,
							kind: doc.kind,
							reason: doc.reason,
							noteToSupplier: doc.noteToSupplier,
							photoAssetIds: doc.photoAssetIds,
							lines: doc.lines.map((line) => ({
								entryLineId: line.entryLineId,
								quantity: line.quantity,
							})),
							holdId: doc.holdId,
						},
						doc,
						actor,
					);
		const settings = await this.support.settings();
		const today = this.support.today();
		const closed = booksClosedProblem([today], settings.booksClosedUpTo);
		if (closed) throw refuse(closed.code, closed.detail);
		const fiscalYear = fiscalYearOf(today);
		const hold = doc.holdId ? await this.holds.findById(doc.holdId) : null;
		const layers = movesStock(doc) ? await this.stock.layersForEntry(doc.purchaseEntryId) : [];
		const now = new Date().toISOString();

		const sent = await this.support
			.guardStale(() =>
				this.support.inTransaction(async (context) => {
					if ((await this.returns.claimSendKey(body.requestKey, doc.id, context)) === 'seen') {
						throw refuse('send_in_progress', 'This return is being sent already. Reload in a moment.');
					}
					const number = formatDocumentNumber(
						settings.numberFormats.debitNote,
						fiscalYear,
						await this.numbers.next('DN', fiscalYear, context),
					);
					const challanNumber =
						doc.kind === 'return_goods'
							? formatDocumentNumber(
									settings.numberFormats.deliveryChallan,
									fiscalYear,
									await this.numbers.next('DC', fiscalYear, context),
								)
							: null;
					if (movesStock(doc)) {
						for (const line of fresh.lines) {
							const layer = layers.find((row) => row.sourceLineId === line.entryLineId);
							if (!layer) throw new StockMovementRefusedError(line.variantId);
							await this.movement.consumeLayer(layer.id, line.quantity, context);
							const fromHold =
								hold && hold.variantId === line.variantId ? Math.min(hold.quantity, line.quantity) : 0;
							await this.movement.move(
								{
									variantId: line.variantId,
									productId: line.productId,
									quantityDelta: -line.quantity,
									heldDelta: -fromHold,
									source: 'purchase_return',
									reasonCode: null,
									note: doc.noteToSupplier,
									referenceType: 'purchase_return',
									referenceId: doc.id,
									referenceNumber: number,
									actorUserId: actor,
									approverUserId: null,
									at: now,
								},
								context,
							);
						}
						if (hold) {
							const left =
								hold.quantity -
								fresh.lines
									.filter((line) => line.variantId === hold.variantId)
									.reduce((sum, line) => sum + line.quantity, 0);
							await this.holds.save(
								left > 0
									? { ...hold, quantity: left }
									: { ...hold, status: 'returned', closedAt: now, closedBy: actor },
								context,
							);
						}
					}
					const next: PurchaseReturn = {
						...fresh,
						status: 'sent',
						number,
						challanNumber,
						courier: body.courier,
						docket: body.docket,
						sentAt: now,
						sentBy: actor,
						updatedAt: now,
						updatedBy: actor,
					};
					const version = await this.returns.save(next, doc.version, context);
					await this.creditEntry(entry.id, [next], context);
					const units = describeUnits(
						next.lines.map((line) => ({ units: line.quantity, soldBy: line.soldBy })),
					);
					await this.support.record(
						{
							actor,
							action: 'purchase.return.send',
							entityType: 'purchase_return',
							entityId: doc.id,
							text: `${await this.support.nameOf(actor)} sent ${number} to ${doc.supplierName}: ${next.lines.map((line) => `${formatQuantity(line.quantity, line.soldBy)} × ${line.sku}`).join(', ')}, ${formatRupees(next.totalINR)}, reason ${REASON_WORDS[next.reason]}.${movesStock(next) ? ` Stock −${units}.` : ' No stock moved.'}${challanNumber ? ` Delivery challan ${challanNumber}.` : ''}`,
							facts: { number, challanNumber },
						},
						context,
					);
					return { ...next, version };
				}),
			)
			.catch((error: unknown) => {
				if (error instanceof StockMovementRefusedError) {
					throw refuse(
						'stock_moved_meanwhile',
						'Those pieces are no longer free to return. Reload to see what can go back now.',
					);
				}
				throw error;
			});
		if (movesStock(doc)) {
			await this.searchOutbox
				?.request([...new Set(doc.lines.map((line) => line.productId))], new Date())
				.catch(() => undefined);
		}
		return sent;
	}

	/** Recomputes an entry's credit from its returns and saves its payment status. */
	private async creditEntry(
		entryId: string,
		changed: readonly PurchaseReturn[],
		context: Parameters<PurchaseEntryRepository['save']>[2],
	): Promise<void> {
		const entry = await this.entries.findById(entryId, context);
		if (!entry) return;
		const all = (await this.returns.forEntry(entryId)).map(
			(doc) => changed.find((row) => row.id === doc.id) ?? doc,
		);
		const next: PurchaseEntry = { ...entry, creditedINR: returnsCredit(all), updatedAt: new Date().toISOString() };
		next.paymentStatus = entryPaymentStatus(next);
		await this.entries.save(next, entry.version, context);
	}

	/** r04: their credit note, a refund, a later bill, or written off; a part settlement leaves the rest open. */
	async settle(id: string, body: PurchaseReturnSettle, actor: string | null): Promise<PurchaseReturn> {
		const doc = await this.load(id);
		if (doc.status !== 'sent')
			throw refuse(
				'wrong_status',
				doc.status === 'draft' ? 'Send the return first.' : 'This return is already settled.',
			);
		const open = settlementOpen(doc.totalINR, doc.settledINR);
		if (body.amountINR > open + 0.005) {
			throw refuse(
				'settle_too_much',
				`Only ${formatRupees(open)} is still open on this debit note.`,
				'amountINR',
			);
		}
		if (body.amountINR <= 0) throw refuse('amount_positive', 'The amount must be more than ₹0.', 'amountINR');
		if (body.date > this.support.today())
			throw refuse('date_in_future', 'A settlement cannot be dated in the future.', 'date');
		if (doc.sentAt && body.date < doc.sentAt.slice(0, 10)) {
			throw refuse('settled_before_sent', 'A settlement cannot come before the debit note was sent.', 'date');
		}
		const settings = await this.support.settings();
		const closed = booksClosedProblem([body.date], settings.booksClosedUpTo);
		if (closed) throw refuse(closed.code, closed.detail, 'date');
		const now = new Date().toISOString();
		const settledINR = Math.round((doc.settledINR + body.amountINR) * 100) / 100;
		const done = settlementOpen(doc.totalINR, settledINR) <= 0.005;
		const next: PurchaseReturn = {
			...doc,
			settlements: [
				...doc.settlements,
				{
					id: `prs_${randomUUID()}`,
					how: body.how,
					reference: body.reference,
					date: body.date,
					amountINR: body.amountINR,
					attachmentAssetId: body.attachmentAssetId,
					by: actor,
					at: now,
				},
			],
			settledINR,
			status: done ? 'settled' : 'sent',
			settledAt: done ? now : null,
			settledBy: done ? actor : null,
			updatedAt: now,
			updatedBy: actor,
		};
		return this.support.guardStale(() =>
			this.support.inTransaction(async (context) => {
				const version = await this.returns.save(next, doc.version, context);
				await this.creditEntry(doc.purchaseEntryId, [next], context);
				await this.support.record(
					{
						actor,
						action: 'purchase.return.settle',
						entityType: 'purchase_return',
						entityId: doc.id,
						text: `${await this.support.nameOf(actor)} settled ${formatRupees(body.amountINR)} of ${doc.number} with ${SETTLED_WORDS[body.how]}${body.reference ? ` ${body.reference}` : ''}.${done ? '' : ` ${formatRupees(settlementOpen(doc.totalINR, settledINR))} stays open.`}`,
					},
					context,
				);
				return { ...next, version };
			}),
		);
	}

	async activity(id: string) {
		await this.load(id);
		return this.support.activity('purchase_return', [id]);
	}

	forEntry(entryId: string): Promise<PurchaseReturn[]> {
		return this.returns.forEntry(entryId);
	}
}
