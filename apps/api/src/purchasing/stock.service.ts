import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type {
	AdjustmentPreview,
	AdjustmentRequest,
	AdjustmentResult,
	InventoryReasonCode,
	StockAdjustmentWrite,
	StockHistoryRow,
	StockHold,
	StockHoldListQuery,
	StockListQuery,
	StockListResponse,
	StockListRow,
	StockVariantDetail,
} from '@saha-textile/contracts';
import {
	type AdjustmentRequestRepository,
	type PurchaseEntryRepository,
	type PurchaseOrderRepository,
	type StockHoldRecord,
	type StockHoldRepository,
	type StockItemFacts,
	type StockLayerRow,
	StockMovementRefusedError,
	type StockReadRepository,
	addDays,
	adjustmentNeedsApproval,
	adjustmentRefusal,
	daysBetween,
	entryOutstanding,
	fifoDraw,
	formatQuantity,
	formatRupees,
	holdOverdue,
	oldestPieceDays,
	onHandValue,
	stockStatus,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	ADJUSTMENT_REQUEST_REPOSITORY,
	PURCHASE_ENTRY_REPOSITORY,
	PURCHASE_ORDER_REPOSITORY,
	STOCK_HOLD_REPOSITORY,
	STOCK_READ_REPOSITORY,
} from '../infra/tokens';
import { PurchasingSupport, actorOf, canSeeCost, holds, missing, refuse } from './purchasing-support';
import { StockWriter } from './stock-writer';

export const REASON_WORDS: Record<InventoryReasonCode, string> = {
	damage: 'Damaged',
	lost_missing: 'Lost or missing',
	manual_recount_correction: 'Recount correction',
	supplier_shortage: 'Supplier shortage',
	return_restocked: 'Customer return restocked',
	return_not_restocked: 'Customer return not restocked',
	internal_use_sample: 'Internal use or sample',
	photoshoot_display_use: 'Photoshoot or display',
	system_migration_correction: 'System correction',
	other: 'Other',
};

export const HOLD_WORDS: Record<StockHoldRecord['reason'], string> = {
	waiting_for_supplier: 'Waiting for supplier',
	photoshoot: 'Photoshoot',
	store_display: 'Store display',
	quality_check: 'Quality check',
};

/** Where a ledger row's document lives, for the history link (i02). */
const DOCUMENT_TYPES: Record<string, string> = {
	purchase_entry: 'purchase_entry',
	purchase_return: 'purchase_return',
	stock_adjustment: 'stock_adjustment',
	stock_count: 'stock_count',
	opening_stock: 'opening_stock',
	order: 'order',
};

const MS_DAY = 86_400_000;

/**
 * Stock screens (i01–i06): All stock, history, cost layers, Adjust with approvals (P2), held
 * stock, and the bell. Cost and value only go to people with `stock.cost` (P8).
 */
@Injectable()
export class StockService {
	constructor(
		@Inject(STOCK_READ_REPOSITORY) private readonly stock: StockReadRepository,
		@Inject(STOCK_HOLD_REPOSITORY) private readonly holdsRepository: StockHoldRepository,
		@Inject(ADJUSTMENT_REQUEST_REPOSITORY) private readonly requests: AdjustmentRequestRepository,
		@Inject(PURCHASE_ENTRY_REPOSITORY) private readonly entries: PurchaseEntryRepository,
		@Inject(PURCHASE_ORDER_REPOSITORY) private readonly orders: PurchaseOrderRepository,
		private readonly writer: StockWriter,
		private readonly support: PurchasingSupport,
	) {}

	/** List rows with value, last received and age, from each item's open layers. */
	private async rows(facts: readonly StockItemFacts[], seeCost: boolean): Promise<StockListRow[]> {
		const today = this.support.today();
		const [layers, images] = await Promise.all([
			this.stock.openLayers(facts.map((fact) => fact.variantId)),
			this.support.thumbnails(facts.map((fact) => fact.galleryAssetId)),
		]);
		const byVariant = new Map<string, StockLayerRow[]>();
		for (const layer of layers) byVariant.set(layer.variantId, [...(byVariant.get(layer.variantId) ?? []), layer]);
		return facts.map((fact) => {
			const own = byVariant.get(fact.variantId) ?? [];
			const free = fact.onHand - fact.held;
			const lastReceived = own.reduce<string | null>(
				(latest, layer) => (!latest || layer.receivedAt > latest ? layer.receivedAt : latest),
				null,
			);
			return {
				productId: fact.productId,
				variantId: fact.variantId,
				sku: fact.sku,
				title: fact.title['en'] ?? fact.sku,
				optionsLabel: fact.optionsLabel,
				imageUrl: fact.galleryAssetId ? (images.get(fact.galleryAssetId) ?? null) : null,
				categoryName: fact.categoryName,
				soldBy: fact.soldBy,
				onHand: fact.onHand,
				held: fact.held,
				inOrders: 0,
				freeToSell: free,
				lowStockLevel: fact.lowStockLevel,
				status: stockStatus({ free, lowLevel: fact.lowStockLevel, madeToOrder: fact.madeToOrder }),
				valueAtCostINR: seeCost ? onHandValue(own, fact.onHand).valueINR : null,
				lastReceivedOn: lastReceived ? lastReceived.slice(0, 10) : null,
				oldestPieceDays: oldestPieceDays(own, today),
			};
		});
	}

	/** i01: All stock with its tiles. */
	async list(query: StockListQuery, principal: AuthenticatedPrincipal | undefined): Promise<StockListResponse> {
		const seeCost = canSeeCost(principal);
		const today = this.support.today();
		const olderThan = new Date(Date.parse(`${today}T00:00:00+05:30`) - 180 * MS_DAY).toISOString();
		const [page, totals, sold, waiting, valuation] = await Promise.all([
			this.stock.list({ ...query, olderThan }),
			this.stock.totals(),
			this.stock.soldSince(null, new Date(Date.now() - 30 * MS_DAY).toISOString()),
			this.holdsRepository.open({ reason: 'waiting_for_supplier', page: 1, pageSize: 1 }),
			seeCost ? this.stock.valuationAsOf(new Date().toISOString()) : Promise.resolve([]),
		]);
		const soldOut = [...(await this.stock.items([...sold.keys()])).values()].filter(
			(fact) => fact.tracked && !fact.madeToOrder && fact.onHand - fact.held <= 0,
		).length;
		return {
			items: await this.rows(page.items, seeCost),
			total: page.total,
			counts: page.counts,
			tiles: {
				valueAtCostINR: seeCost
					? Math.round(valuation.reduce((sum, row) => sum + row.valueINR * 100, 0)) / 100
					: null,
				pieces: totals.pieces,
				metresTenths: totals.metresTenths,
				low: totals.low,
				out: totals.out,
				outSoldLast30Days: soldOut,
				held: totals.held,
				heldWaitingForSupplier: waiting.counts['waiting_for_supplier'] ?? 0,
			},
		};
	}

	/** i02 + i03: one item's movements, linked to their documents, and its cost layers. */
	async detail(
		variantId: string,
		page: { page: number; pageSize: number },
		principal: AuthenticatedPrincipal | undefined,
	): Promise<StockVariantDetail> {
		const seeCost = canSeeCost(principal);
		const fact = (await this.stock.items([variantId])).get(variantId);
		if (!fact) throw missing('Item');
		const [[row], ledger, layers] = await Promise.all([
			this.rows([fact], seeCost),
			this.stock.ledger({ variantId, page: page.page, pageSize: page.pageSize }),
			seeCost ? this.stock.layersOf(variantId) : Promise.resolve([]),
		]);
		if (!row) throw missing('Item');
		const names = await this.support.names(
			ledger.items.flatMap((entry) => [entry.actorUserId, entry.approverUserId]),
		);
		const history: StockHistoryRow[] = ledger.items.map((entry) => ({
			id: entry.id,
			at: entry.createdAt,
			source: entry.source as StockHistoryRow['source'],
			reasonCode: entry.reasonCode as StockHistoryRow['reasonCode'],
			documentType: entry.referenceType ? (DOCUMENT_TYPES[entry.referenceType] ?? entry.referenceType) : null,
			documentId: entry.referenceId,
			documentNumber: entry.referenceNumber,
			actorName: entry.actorUserId ? (names.get(entry.actorUserId) ?? 'Someone') : null,
			approverName: entry.approverUserId ? (names.get(entry.approverUserId) ?? 'Someone') : null,
			quantityDelta: entry.quantityDelta,
			heldDelta: entry.heldDelta,
			onHandAfter: entry.balanceAfter,
			heldAfter: entry.heldAfter,
			note: entry.note,
		}));
		const open = layers
			.filter((layer) => layer.quantityRemaining > 0)
			.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
		return {
			row,
			barcode: fact.barcode,
			history,
			historyTotal: ledger.total,
			layers: seeCost
				? layers
						.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
						.map((layer) => ({
							id: layer.id,
							receivedAt: layer.receivedAt,
							sourceType: layer.sourceType,
							sourceNumber: layer.sourceNumber,
							quantityReceived: layer.quantityReceived,
							quantityRemaining: layer.quantityRemaining,
							unitCostINR:
								fact.soldBy === 'metre'
									? Math.round(layer.unitCostINR * 10 * 10_000) / 10_000
									: layer.unitCostINR,
							valueRemainingINR: Math.round(layer.quantityRemaining * layer.unitCostINR * 100) / 100,
							sellsNext: open[0]?.id === layer.id,
						}))
				: null,
			costBreakdown: seeCost ? fifoDraw(open, fact.onHand, fact.soldBy).breakdown || null : null,
		};
	}

	private async holdFor(write: StockAdjustmentWrite, fact: StockItemFacts): Promise<StockHoldRecord | null> {
		if (!write.holdId) return null;
		const hold = await this.holdsRepository.findById(write.holdId);
		if (!hold || hold.variantId !== fact.variantId)
			throw refuse('hold_not_found', 'That hold is not on this item.', 'holdId');
		return hold;
	}

	/** i04: what the change would do, whether it needs approval, and why it cannot happen, before Save. */
	async preview(
		write: StockAdjustmentWrite,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<AdjustmentPreview> {
		const fact = await this.writer.facts(write.variantId);
		const hold = await this.holdFor(write, fact);
		const refusal = adjustmentRefusal({
			action: write.action,
			quantity: write.quantity,
			facts: { onHand: fact.onHand, held: fact.held, reserved: 0 },
			soldBy: fact.soldBy,
			hold: hold ? { quantity: hold.quantity, status: hold.status } : null,
			tracked: fact.tracked,
		});
		const draw = write.action === 'remove' ? await this.writer.valueOf(fact, write.quantity) : null;
		const onHandAfter =
			fact.onHand + (write.action === 'remove' ? -write.quantity : write.action === 'add' ? write.quantity : 0);
		const heldAfter =
			fact.held +
			(write.action === 'hold'
				? write.quantity
				: write.action === 'release' || (write.action === 'remove' && hold)
					? -write.quantity
					: 0);
		return {
			onHandAfter,
			heldAfter,
			freeAfter: onHandAfter - heldAfter,
			valueAtCostINR: canSeeCost(principal) && draw ? draw.valueINR : null,
			costBreakdown: canSeeCost(principal) && draw ? draw.breakdown || null : null,
			needsApproval: adjustmentNeedsApproval(write.action, holds(principal, 'stock.approve')),
			refusal,
		};
	}

	/** One sentence for a write-off or addition, as the audit row and the approvals queue read it. */
	private describe(
		fact: StockItemFacts,
		write: Pick<StockAdjustmentWrite, 'action' | 'quantity' | 'reasonCode' | 'note' | 'photoAssetIds'>,
		valueINR: number | null,
	): string {
		const what = write.action === 'remove' ? 'write off' : 'add';
		const reason = write.reasonCode ? REASON_WORDS[write.reasonCode] : '';
		const photos = write.photoAssetIds.length
			? ` ${write.photoAssetIds.length} photo${write.photoAssetIds.length === 1 ? '' : 's'}.`
			: '';
		return `${what} ${formatQuantity(write.quantity, fact.soldBy)} × ${fact.sku} (${reason}${valueINR !== null ? `, ${formatRupees(valueINR)} at cost` : ''}): "${write.note}"${photos}`;
	}

	/**
	 * i04/i04B: a write-off or addition by someone with Approve write-offs applies at once and is
	 * logged as self-approved; anyone else raises a request that waits (P2). Holds and releases
	 * never wait. A repeated press of Save (same request key) returns the first result.
	 */
	async adjust(
		write: StockAdjustmentWrite,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<AdjustmentResult> {
		const actor = actorOf(principal);
		const previous = await this.requests.findByRequestKey(write.requestKey);
		if (previous) {
			const fact = await this.writer.facts(previous.variantId ?? write.variantId);
			return {
				outcome: previous.status === 'pending' ? 'requested' : 'applied',
				request: previous,
				onHandAfter: fact.onHand,
				heldAfter: fact.held,
			};
		}
		const fact = await this.writer.facts(write.variantId);
		const hold = await this.holdFor(write, fact);
		const refusal = adjustmentRefusal({
			action: write.action,
			quantity: write.quantity,
			facts: { onHand: fact.onHand, held: fact.held, reserved: 0 },
			soldBy: fact.soldBy,
			hold: hold ? { quantity: hold.quantity, status: hold.status } : null,
			tracked: fact.tracked,
		});
		if (refusal) throw refuse('adjustment_refused', refusal, 'quantity');
		const canApprove = holds(principal, 'stock.approve');
		const name = await this.support.nameOf(actor);
		const now = new Date().toISOString();
		const images = await this.support.thumbnails([fact.galleryAssetId]);
		const draw = write.action === 'remove' ? await this.writer.valueOf(fact, write.quantity) : null;

		const base: AdjustmentRequest = {
			id: `adj_${randomUUID()}`,
			kind: 'adjustment',
			variantId: fact.variantId,
			productId: fact.productId,
			sku: fact.sku,
			title: fact.title['en'] ?? fact.sku,
			imageUrl: fact.galleryAssetId ? (images.get(fact.galleryAssetId) ?? null) : null,
			soldBy: fact.soldBy,
			action: write.action === 'remove' || write.action === 'add' ? write.action : null,
			quantity: write.quantity,
			reasonCode: write.reasonCode,
			holdId: write.holdId,
			note: write.note,
			photoAssetIds: write.photoAssetIds,
			valueAtCostINR: draw?.valueINR ?? null,
			costBreakdown: draw?.breakdown || null,
			countId: null,
			countNumber: null,
			countSummary: null,
			status: 'pending',
			requestedBy: actor,
			requestedByName: name,
			requestedAt: now,
			decidedBy: null,
			decidedByName: null,
			decidedAt: null,
			rejectReason: null,
			selfApproved: false,
		};

		if (adjustmentNeedsApproval(write.action, canApprove)) {
			await this.requests.save(base, write.requestKey);
			await this.support.record({
				actor,
				action: 'stock.adjustment.request',
				entityType: 'stock_adjustment',
				entityId: base.id,
				text: `${name} asked to ${this.describe(fact, write, draw?.valueINR ?? null)}`,
				facts: { variantId: fact.variantId, sku: fact.sku },
			});
			return { outcome: 'requested', request: base, onHandAfter: fact.onHand, heldAfter: fact.held };
		}

		const applied: AdjustmentRequest = {
			...base,
			status: 'applied',
			decidedBy: actor,
			decidedByName: name,
			decidedAt: now,
			selfApproved: write.action === 'remove' || write.action === 'add',
		};
		const result = await this.support
			.inTransaction(async (context) => {
				const done = await this.writer.apply(
					{
						variantId: fact.variantId,
						action: write.action,
						quantity: write.quantity,
						reasonCode: write.reasonCode,
						holdReason: write.holdReason,
						holdId: write.holdId,
						note: write.note,
						referenceType: 'stock_adjustment',
						referenceId: applied.id,
						referenceNumber: null,
						actor,
						approver: write.action === 'remove' || write.action === 'add' ? actor : null,
						source: 'manual_adjustment',
					},
					context,
				);
				const record = {
					...applied,
					holdId: done.holdId,
					valueAtCostINR: write.action === 'remove' ? done.valueINR : applied.valueAtCostINR,
				};
				await this.requests.save(record, write.requestKey, context);
				const freeBefore = done.onHandBefore - done.heldBefore;
				const freeAfter = done.onHandAfter - done.heldAfter;
				const text =
					write.action === 'hold'
						? `${name} moved ${formatQuantity(write.quantity, fact.soldBy)} × ${fact.sku} to held (${HOLD_WORDS[write.holdReason ?? 'quality_check']}): "${write.note}" Free to sell ${formatQuantity(freeBefore, fact.soldBy)} → ${formatQuantity(freeAfter, fact.soldBy)}.`
						: write.action === 'release'
							? `${name} released ${formatQuantity(write.quantity, fact.soldBy)} × ${fact.sku} from held${write.note ? `: "${write.note}"` : '.'} Free to sell ${formatQuantity(freeBefore, fact.soldBy)} → ${formatQuantity(freeAfter, fact.soldBy)}.`
							: `${name} ${write.action === 'remove' ? 'wrote off' : 'added'} ${this.describe(fact, write, write.action === 'remove' ? done.valueINR : null).replace(/^(write off|add) /, '')} Self-approved. Stock ${formatQuantity(done.onHandBefore, fact.soldBy)} → ${formatQuantity(done.onHandAfter, fact.soldBy)}.`;
				await this.support.record(
					{
						actor,
						action: `stock.${write.action}`,
						entityType: 'stock_adjustment',
						entityId: applied.id,
						text,
						facts: { variantId: fact.variantId, sku: fact.sku },
					},
					context,
				);
				return { record, done };
			})
			.catch((error: unknown) => {
				if (error instanceof StockMovementRefusedError) {
					throw refuse('stock_moved_meanwhile', 'Stock changed while saving. Reload and try again.');
				}
				throw error;
			});
		await this.writer.refreshShop([fact.productId]);
		return {
			outcome: 'applied',
			request: result.record,
			onHandAfter: result.done.onHandAfter,
			heldAfter: result.done.heldAfter,
		};
	}

	/** i06: held pieces by reason, with a reminder once they pass the setting (21 days). */
	async heldList(query: StockHoldListQuery) {
		const settings = await this.support.settings();
		const today = this.support.today();
		const variantIds = query.q
			? [...(await this.stock.search(query.q, 50)).map((fact) => fact.variantId)]
			: undefined;
		const page = await this.holdsRepository.open({
			reason: query.reason,
			page: query.page,
			pageSize: query.pageSize,
			variantIds,
		});
		const facts = await this.stock.items(page.items.map((hold) => hold.variantId));
		const [names, images] = await Promise.all([
			this.support.names(page.items.map((hold) => hold.byId)),
			this.support.thumbnails([...facts.values()].map((fact) => fact.galleryAssetId)),
		]);
		const items: StockHold[] = page.items.map((hold) => {
			const fact = facts.get(hold.variantId);
			return {
				id: hold.id,
				variantId: hold.variantId,
				productId: hold.productId,
				sku: fact?.sku ?? hold.variantId,
				title: fact?.title['en'] ?? '',
				optionsLabel: fact?.optionsLabel ?? '',
				imageUrl: fact?.galleryAssetId ? (images.get(fact.galleryAssetId) ?? null) : null,
				soldBy: fact?.soldBy ?? 'piece',
				quantity: hold.quantity,
				reason: hold.reason,
				note: hold.note,
				since: hold.since,
				byName: hold.byId ? (names.get(hold.byId) ?? 'Someone') : null,
				status: hold.status,
				overdue: holdOverdue(hold.since, today, settings.heldReminderDays),
			};
		});
		return { items, total: page.total, counts: page.counts, reminderDays: settings.heldReminderDays };
	}

	/** Open holds on one item (the Adjust window's release list). */
	async holdsOf(variantId: string) {
		return this.holdsRepository.openForVariant(variantId);
	}

	/**
	 * The bell and the Stock menu badge: approvals waiting (for approvers), decisions on my own
	 * requests not opened yet, my late orders, bills near the input-credit limit, held pieces past
	 * the reminder.
	 */
	async alerts(principal: AuthenticatedPrincipal | undefined) {
		const actor = actorOf(principal);
		const settings = await this.support.settings();
		const today = this.support.today();
		const [pending, decisions, late, open, held] = await Promise.all([
			holds(principal, 'stock.approve') ? this.requests.pendingCount() : Promise.resolve(0),
			actor ? this.requests.unseenDecisions(actor) : Promise.resolve([]),
			holds(principal, 'purchase_order.index')
				? this.orders.list({ filter: 'late', page: 1, pageSize: 50, today })
				: Promise.resolve(null),
			holds(principal, 'purchase.index') ? this.entries.openPayables() : Promise.resolve([]),
			holds(principal, 'stock.index')
				? this.holdsRepository.open({ page: 1, pageSize: 200 })
				: Promise.resolve(null),
		]);
		const limit = addDays(today, -settings.unpaidAlertDays);
		const nearLimit = open.filter((entry) => entry.billDate <= limit && entryOutstanding(entry) > 0.005);
		return {
			pendingApprovals: pending,
			decisions: decisions.map((request) => ({
				id: request.id,
				kind: request.kind,
				action: request.action,
				variantId: request.variantId,
				countId: request.countId,
				countNumber: request.countNumber,
				status: request.status,
				sku: request.sku,
				quantity: request.quantity,
				soldBy: request.soldBy,
				decidedByName: request.decidedByName,
				rejectReason: request.rejectReason,
			})),
			lateOrders: (late?.items ?? [])
				.filter((order) => order.createdBy === actor)
				.map((order) => ({
					id: order.id,
					number: order.number,
					supplierName: order.supplierName,
					expectedBy: order.expectedBy,
				})),
			billsNearCreditLimit: nearLimit.map((entry) => ({
				id: entry.id,
				number: entry.number,
				supplierName: entry.supplierName,
				days: daysBetween(entry.billDate, today),
			})),
			heldOverdue: (held?.items ?? []).filter((hold) => holdOverdue(hold.since, today, settings.heldReminderDays))
				.length,
		};
	}

	async markSeen(ids: readonly string[], principal: AuthenticatedPrincipal | undefined): Promise<void> {
		const actor = actorOf(principal);
		if (actor) await this.requests.markSeen(actor, ids);
	}
}
