import { z } from 'zod';

import { Id, IsoDateTime } from './common';

/**
 * Manual stock-adjustment reason codes (owner lock — the list is fixed, not free text).
 *
 * A note is OPTIONAL for the first nine and MANDATORY for `other`, so "other" can never
 * become an unexplained hole in the audit trail. `InventoryAdjustmentRequest` enforces it.
 */
export const InventoryReasonCode = z.enum([
	'damage',
	'lost_missing',
	'manual_recount_correction',
	'supplier_shortage',
	'return_restocked',
	'return_not_restocked',
	'internal_use_sample',
	'photoshoot_display_use',
	'system_migration_correction',
	'other',
]);
export type InventoryReasonCode = z.infer<typeof InventoryReasonCode>;

/** The one reason code that cannot stand without an explanation. */
export const REASON_CODE_REQUIRING_NOTE: InventoryReasonCode = 'other';

/**
 * What caused a stock movement. `manual_adjustment` carries a reason code; the rest are
 * system-generated provenance so every ledger row can be traced to its cause.
 */
export const InventoryMovementSource = z.enum([
	'manual_adjustment',
	/** A posted purchase entry (the supplier's bill taken into stock). */
	'purchase_invoice',
	'order_placed',
	'order_cancelled',
	'return_restocked',
	'reservation',
	'reservation_released',
	'system_migration',
	/** Goods sent back to a supplier on a purchase return (debit note). */
	'purchase_return',
	/** The one-time load of stock already in the shop, with its cost. */
	'opening_stock',
	/** A posted stock count's difference. */
	'stock_count',
	/** Pieces moved to or from held: on-hand does not change, free-to-sell does. */
	'hold',
	'release',
]);
export type InventoryMovementSource = z.infer<typeof InventoryMovementSource>;

/**
 * One append-only stock movement (`inventoryLedger`).
 *
 * Owner locks: stock lives on VARIANTS, movements are typed and audited, and the ledger
 * is the source of truth for how a quantity got where it is. `quantityDelta` is signed —
 * negative removes stock. Corrections are new compensating rows, never edits.
 */
export const InventoryLedgerEntry = z
	.object({
		id: Id,
		variantId: Id,
		productId: Id,
		quantityDelta: z.number().int(),
		/** Running balance AFTER this movement, recorded for audit and fast reads. */
		balanceAfter: z.number().int(),
		/** Change to held pieces (holds and releases; a write-off of held pieces). */
		heldDelta: z.number().int().default(0),
		heldAfter: z.number().int().default(0),
		source: InventoryMovementSource,
		/** Required when `source` is `manual_adjustment`. */
		reasonCode: InventoryReasonCode.nullable().default(null),
		note: z.string().max(1000).nullable().default(null),
		/** Order / purchase-invoice / return id that caused a system movement. */
		referenceType: z.string().min(1).nullable().default(null),
		referenceId: Id.nullable().default(null),
		actorUserId: Id.nullable().default(null),
		createdAt: IsoDateTime,
	})
	.superRefine((entry, ctx) => {
		if (entry.source === 'manual_adjustment' && !entry.reasonCode) {
			ctx.addIssue({
				code: 'custom',
				message: 'a manual adjustment requires a reason code',
				path: ['reasonCode'],
			});
		}
		if (entry.reasonCode === REASON_CODE_REQUIRING_NOTE && !entry.note?.trim()) {
			ctx.addIssue({ code: 'custom', message: 'reason code `other` requires a note', path: ['note'] });
		}
		if (entry.quantityDelta === 0 && entry.heldDelta === 0) {
			ctx.addIssue({ code: 'custom', message: 'a ledger row must move stock', path: ['quantityDelta'] });
		}
	});
export type InventoryLedgerEntry = z.infer<typeof InventoryLedgerEntry>;

/** `POST /admin/inventory/adjust` — the admin-facing manual adjustment. */
export const InventoryAdjustmentRequest = z
	.object({
		variantId: Id,
		quantityDelta: z.number().int(),
		reasonCode: InventoryReasonCode,
		note: z.string().max(1000).optional(),
	})
	.superRefine((request, ctx) => {
		if (request.quantityDelta === 0) {
			ctx.addIssue({
				code: 'custom',
				message: 'an adjustment must change the quantity',
				path: ['quantityDelta'],
			});
		}
		if (request.reasonCode === REASON_CODE_REQUIRING_NOTE && !request.note?.trim()) {
			ctx.addIssue({ code: 'custom', message: 'reason code `other` requires a note', path: ['note'] });
		}
	});
export type InventoryAdjustmentRequest = z.infer<typeof InventoryAdjustmentRequest>;

/**
 * A FIFO cost layer (`inventoryCostLayers`): a quantity bought at a unit cost, consumed
 * oldest-first.
 *
 * Owner lock: valuation is FIFO, and **FIFO/COGS detail is never customer-facing** —
 * this shape belongs to admin/reporting responses only and must never appear in a public
 * DTO.
 */
export const InventoryCostLayer = z
	.object({
		id: Id,
		variantId: Id,
		/** Purchase invoice that created the layer. */
		purchaseInvoiceId: Id.nullable().default(null),
		/** What created the layer; a purchase return draws from its own entry's layer. */
		sourceType: z
			.enum(['purchase_invoice', 'opening_stock', 'return_restock', 'manual_adjustment'])
			.default('purchase_invoice'),
		sourceLineId: Id.nullable().default(null),
		/** The document number shown in Cost layers (PE/…, OS/…). */
		sourceNumber: z.string().nullable().default(null),
		unitCostINR: z.number().finite().nonnegative(),
		quantityReceived: z.number().int().positive(),
		quantityRemaining: z.number().int().nonnegative(),
		receivedAt: IsoDateTime,
		createdAt: IsoDateTime.optional(),
	})
	.superRefine((layer, ctx) => {
		if (layer.quantityRemaining > layer.quantityReceived) {
			ctx.addIssue({
				code: 'custom',
				message: '`quantityRemaining` may not exceed `quantityReceived`',
				path: ['quantityRemaining'],
			});
		}
	});
export type InventoryCostLayer = z.infer<typeof InventoryCostLayer>;

/**
 * Current stock for one variant, as read by admin surfaces.
 *
 * `reserved` is a SEAM for the checkout hold (owner decision round 2026-11-17, orders). Whether
 * `available` may go below zero is now per product: backorders up to a set limit where switched
 * on (OD2, replacing DEC-BACKORDER's "oversell stays off"). The shape is stable; no reservation
 * engine reads it yet.
 */
export const VariantStockSnapshot = z.object({
	variantId: Id,
	onHand: z.number().int(),
	/** Pieces set aside (photoshoot, display, waiting for supplier): on hand but not for sale. */
	held: z.number().int().nonnegative().default(0),
	/** Seam — `DEC-STOCK-RESERVE`. */
	reserved: z.number().int().nonnegative().default(0),
	/** `onHand - held - reserved`; recomputed, never client-supplied. */
	available: z.number().int(),
	lowStockThreshold: z.number().int().nonnegative().nullable().default(null),
	updatedAt: IsoDateTime.optional(),
});
export type VariantStockSnapshot = z.infer<typeof VariantStockSnapshot>;

/* =====================================================================================
 * Stock screens (purchases and stock brief, revision 2). Quantities are whole numbers of the
 * product's unit: pieces, or tenths of a metre for a product sold by the metre (P11).
 * ===================================================================================== */

const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'date_shape' });
const NoteText = z.string().trim().max(1000);

/** One row of All stock (i01). Cost fields are null for anyone without `stock.cost` (P8). */
export const StockListRow = z.object({
	productId: Id,
	variantId: Id,
	sku: z.string(),
	title: z.string(),
	optionsLabel: z.string(),
	imageUrl: z.string().nullable(),
	categoryName: z.string().nullable(),
	soldBy: z.enum(['piece', 'metre']),
	onHand: z.number().int(),
	held: z.number().int(),
	inOrders: z.number().int(),
	freeToSell: z.number().int(),
	lowStockLevel: z.number().int().nullable(),
	status: z.enum(['in_stock', 'low', 'out', 'made_to_order']),
	valueAtCostINR: z.number().nullable(),
	lastReceivedOn: IsoDay.nullable(),
	oldestPieceDays: z.number().int().nullable(),
});
export type StockListRow = z.infer<typeof StockListRow>;

export const StockListQuery = z.object({
	q: z.string().trim().max(100).optional(),
	filter: z.enum(['all', 'low', 'out', 'held', 'older_180']).default('all'),
	categoryId: Id.optional(),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(15),
});
export type StockListQuery = z.infer<typeof StockListQuery>;

export const StockListResponse = z.object({
	items: z.array(StockListRow),
	total: z.number().int(),
	counts: z.object({
		low: z.number().int(),
		out: z.number().int(),
		held: z.number().int(),
		older180: z.number().int(),
	}),
	tiles: z.object({
		valueAtCostINR: z.number().nullable(),
		pieces: z.number().int(),
		metresTenths: z.number().int(),
		low: z.number().int(),
		out: z.number().int(),
		outSoldLast30Days: z.number().int(),
		held: z.number().int(),
		heldWaitingForSupplier: z.number().int(),
	}),
});
export type StockListResponse = z.infer<typeof StockListResponse>;

/** A ledger row as Stock history shows it (i02): the document it came from, linked. */
export const StockHistoryRow = z.object({
	id: Id,
	at: IsoDateTime,
	source: InventoryMovementSource,
	reasonCode: InventoryReasonCode.nullable(),
	documentType: z.string().nullable(),
	documentId: Id.nullable(),
	documentNumber: z.string().nullable(),
	actorName: z.string().nullable(),
	approverName: z.string().nullable(),
	quantityDelta: z.number().int(),
	heldDelta: z.number().int(),
	onHandAfter: z.number().int(),
	heldAfter: z.number().int(),
	note: z.string().nullable(),
});
export type StockHistoryRow = z.infer<typeof StockHistoryRow>;

export const StockVariantDetail = z.object({
	row: StockListRow,
	barcode: z.string().nullable(),
	history: z.array(StockHistoryRow),
	historyTotal: z.number().int(),
	/** Null without `stock.cost`. */
	layers: z
		.array(
			z.object({
				id: Id,
				receivedAt: IsoDateTime,
				sourceType: z.string(),
				sourceNumber: z.string().nullable(),
				quantityReceived: z.number().int(),
				quantityRemaining: z.number().int(),
				unitCostINR: z.number(),
				valueRemainingINR: z.number(),
				sellsNext: z.boolean(),
			}),
		)
		.nullable(),
	costBreakdown: z.string().nullable(),
});
export type StockVariantDetail = z.infer<typeof StockVariantDetail>;

/** The four things the Adjust window does (i04). */
export const AdjustmentAction = z.enum(['remove', 'add', 'hold', 'release']);
export type AdjustmentAction = z.infer<typeof AdjustmentAction>;

export const HoldReason = z.enum(['waiting_for_supplier', 'photoshoot', 'store_display', 'quality_check']);
export type HoldReason = z.infer<typeof HoldReason>;

/** Reasons Adjust offers per action; `photoshoot_display_use` is now a hold (kept for history). */
export const ADJUSTMENT_REASONS: Readonly<Record<'remove' | 'add', readonly InventoryReasonCode[]>> = {
	remove: [
		'damage',
		'lost_missing',
		'manual_recount_correction',
		'supplier_shortage',
		'internal_use_sample',
		'other',
	],
	add: ['manual_recount_correction', 'system_migration_correction', 'other'],
};

export const StockAdjustmentWrite = z
	.object({
		variantId: Id,
		action: AdjustmentAction,
		quantity: z.number().int().positive(),
		reasonCode: InventoryReasonCode.nullable().default(null),
		holdReason: HoldReason.nullable().default(null),
		/** For a release or a held write-off: which hold. */
		holdId: Id.nullable().default(null),
		note: NoteText,
		photoAssetIds: z.array(Id).max(6).default([]),
		requestKey: z.string().min(8).max(80),
	})
	.superRefine((value, ctx) => {
		if (value.action === 'remove' || value.action === 'add') {
			if (!value.reasonCode) ctx.addIssue({ code: 'custom', path: ['reasonCode'], message: 'reason_required' });
			else if (!ADJUSTMENT_REASONS[value.action].includes(value.reasonCode))
				ctx.addIssue({ code: 'custom', path: ['reasonCode'], message: 'reason_not_for_action' });
		}
		if (value.action === 'hold' && !value.holdReason)
			ctx.addIssue({ code: 'custom', path: ['holdReason'], message: 'hold_reason_required' });
		if (value.action === 'release' && !value.holdId)
			ctx.addIssue({ code: 'custom', path: ['holdId'], message: 'hold_required' });
		// P12: every write-off carries a note; "other" always does.
		if ((value.action === 'remove' || value.reasonCode === 'other') && value.note.length < 3)
			ctx.addIssue({ code: 'custom', path: ['note'], message: 'note_required' });
	});
export type StockAdjustmentWrite = z.infer<typeof StockAdjustmentWrite>;

export const AdjustmentRequestStatus = z.enum(['pending', 'approved', 'rejected', 'applied']);
export type AdjustmentRequestStatus = z.infer<typeof AdjustmentRequestStatus>;

/** A write-off or addition waiting for someone with `stock.approve` (P2), or one applied. */
export const AdjustmentRequest = z.object({
	id: Id,
	kind: z.enum(['adjustment', 'count']),
	variantId: Id.nullable(),
	productId: Id.nullable(),
	sku: z.string().nullable(),
	title: z.string(),
	imageUrl: z.string().nullable(),
	soldBy: z.enum(['piece', 'metre']),
	action: z.enum(['remove', 'add']).nullable(),
	quantity: z.number().int(),
	reasonCode: InventoryReasonCode.nullable(),
	holdId: Id.nullable(),
	note: z.string(),
	photoAssetIds: z.array(Id),
	valueAtCostINR: z.number().nullable(),
	costBreakdown: z.string().nullable(),
	countId: Id.nullable(),
	countNumber: z.string().nullable(),
	countSummary: z
		.object({
			skus: z.number().int(),
			differences: z.number().int(),
			missing: z.number().int(),
			found: z.number().int(),
		})
		.nullable(),
	status: AdjustmentRequestStatus,
	requestedBy: Id.nullable(),
	requestedByName: z.string().nullable(),
	requestedAt: IsoDateTime,
	decidedBy: Id.nullable(),
	decidedByName: z.string().nullable(),
	decidedAt: IsoDateTime.nullable(),
	rejectReason: z.string().nullable(),
	selfApproved: z.boolean(),
});
export type AdjustmentRequest = z.infer<typeof AdjustmentRequest>;

export const AdjustmentResult = z.object({
	outcome: z.enum(['applied', 'requested']),
	request: AdjustmentRequest.nullable(),
	onHandAfter: z.number().int(),
	heldAfter: z.number().int(),
});
export type AdjustmentResult = z.infer<typeof AdjustmentResult>;

export const AdjustmentPreview = z.object({
	onHandAfter: z.number().int(),
	heldAfter: z.number().int(),
	freeAfter: z.number().int(),
	valueAtCostINR: z.number().nullable(),
	costBreakdown: z.string().nullable(),
	needsApproval: z.boolean(),
	/** Why it cannot go ahead (free-to-sell below paid orders, not enough held…), or null. */
	refusal: z.string().nullable(),
});
export type AdjustmentPreview = z.infer<typeof AdjustmentPreview>;

export const AdjustmentDecision = z.object({ reason: NoteText.default('') });
export type AdjustmentDecision = z.infer<typeof AdjustmentDecision>;
export const AdjustmentRequestListQuery = z.object({
	status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
	q: z.string().trim().max(100).optional(),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(15),
});
export type AdjustmentRequestListQuery = z.infer<typeof AdjustmentRequestListQuery>;

/** A held set of pieces (i06). */
export const StockHold = z.object({
	id: Id,
	variantId: Id,
	productId: Id,
	sku: z.string(),
	title: z.string(),
	optionsLabel: z.string(),
	imageUrl: z.string().nullable(),
	soldBy: z.enum(['piece', 'metre']),
	quantity: z.number().int().positive(),
	reason: HoldReason,
	note: z.string(),
	since: IsoDateTime,
	byName: z.string().nullable(),
	status: z.enum(['open', 'released', 'written_off', 'returned']),
	overdue: z.boolean(),
});
export type StockHold = z.infer<typeof StockHold>;

export const StockHoldListQuery = z.object({
	reason: HoldReason.optional(),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(15),
	q: z.string().trim().max(100).optional(),
});
export type StockHoldListQuery = z.infer<typeof StockHoldListQuery>;

/* ------------------------------------------------------------------ stock counts */

export const StockCountScope = z.object({
	kind: z.enum(['all', 'categories', 'skus', 'last_differences']),
	categoryIds: z.array(Id).default([]),
	variantIds: z.array(Id).default([]),
});
export type StockCountScope = z.infer<typeof StockCountScope>;

export const StockCountStatus = z.enum(['counting', 'review', 'awaiting_approval', 'posted', 'cancelled']);
export type StockCountStatus = z.infer<typeof StockCountStatus>;

export const StockCountLine = z.object({
	variantId: Id,
	productId: Id,
	sku: z.string(),
	title: z.string(),
	optionsLabel: z.string(),
	imageUrl: z.string().nullable(),
	soldBy: z.enum(['piece', 'metre']),
	/** Hidden from counters on a blind count (null in their view). */
	atStart: z.number().int().nullable(),
	soldDuring: z.number().int().nullable(),
	expected: z.number().int().nullable(),
	counted: z.number().int().nullable(),
	difference: z.number().int().nullable(),
	valueINR: z.number().nullable(),
	note: z.string().nullable(),
	countedBy: Id.nullable(),
	countedAt: IsoDateTime.nullable(),
	recount: z.boolean(),
});
export type StockCountLine = z.infer<typeof StockCountLine>;

export const StockCount = z.object({
	id: Id,
	number: z.string(),
	label: z.string(),
	scope: StockCountScope,
	blind: z.boolean(),
	counterIds: z.array(Id),
	counterNames: z.array(z.string()),
	status: StockCountStatus,
	startedAt: IsoDateTime,
	startedBy: Id.nullable(),
	lines: z.array(StockCountLine),
	totals: z.object({
		skus: z.number().int(),
		counted: z.number().int(),
		differences: z.number().int(),
		missingUnits: z.number().int(),
		missingValueINR: z.number().nullable(),
		foundUnits: z.number().int(),
		foundValueINR: z.number().nullable(),
		netUnits: z.number().int(),
		netValueINR: z.number().nullable(),
	}),
	postedAt: IsoDateTime.nullable(),
	postedBy: Id.nullable(),
	approvalRequestId: Id.nullable(),
	updatedBy: Id.nullable().default(null),
	version: z.number().int(),
});
export type StockCount = z.infer<typeof StockCount>;

export const StockCountStart = z.object({
	scope: StockCountScope,
	blind: z.boolean().default(true),
	counterIds: z.array(Id).max(20).default([]),
	label: z.string().trim().max(120).default(''),
});
export type StockCountStart = z.infer<typeof StockCountStart>;

export const StockCountEntry = z.object({
	lines: z
		.array(
			z.object({
				variantId: Id,
				counted: z.number().int().nonnegative(),
				note: z.string().trim().max(500).nullable().default(null),
			}),
		)
		.min(1)
		.max(500),
});
export type StockCountEntry = z.infer<typeof StockCountEntry>;

export const StockCountListQuery = z.object({
	filter: z.enum(['all', 'counting', 'review', 'posted']).default('all'),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(15),
});
export type StockCountListQuery = z.infer<typeof StockCountListQuery>;

/* ------------------------------------------------------------------ opening stock */

export const OpeningStockRow = z.object({
	row: z.number().int().positive(),
	sku: z.string().trim().max(80),
	quantity: z.number(),
	unitCostINR: z.number().nullable(),
	receivedOn: IsoDay.nullable().default(null),
	note: z.string().trim().max(200).default(''),
});
export type OpeningStockRow = z.infer<typeof OpeningStockRow>;

export const OpeningStockCheck = z.object({ rows: z.array(OpeningStockRow).min(1).max(20000) });
export type OpeningStockCheck = z.infer<typeof OpeningStockCheck>;

export const OpeningStockCheckResult = z.object({
	rows: z.array(
		OpeningStockRow.extend({
			variantId: Id.nullable(),
			title: z.string().nullable(),
			soldBy: z.enum(['piece', 'metre']).nullable(),
			result: z.enum([
				'ready',
				'cost_missing',
				'unknown_sku',
				'already_has_stock',
				'quantity_invalid',
				'date_invalid',
				'repeated',
			]),
		}),
	),
	counts: z.object({
		ready: z.number().int(),
		/** Ready pieces, and ready metres in tenths, kept apart so they are never added together. */
		readyPieces: z.number().int(),
		readyTenths: z.number().int(),
		costMissing: z.number().int(),
		unknownSku: z.number().int(),
		alreadyHasStock: z.number().int(),
		/** Quantity off the step or below 1, a received date after today, or the SKU twice. */
		invalid: z.number().int(),
	}),
	/** The number the load will get if posted now (OS/26-27/000001); a later post may take it first. */
	nextNumber: z.string(),
});
export type OpeningStockCheckResult = z.infer<typeof OpeningStockCheckResult>;

export const OpeningStockPost = OpeningStockCheck.extend({ requestKey: z.string().min(8).max(80) });
export type OpeningStockPost = z.infer<typeof OpeningStockPost>;

/* ------------------------------------------------------------------ reorder and reports */

export const ReorderRow = z.object({
	variantId: Id,
	productId: Id,
	sku: z.string(),
	title: z.string(),
	optionsLabel: z.string(),
	imageUrl: z.string().nullable(),
	soldBy: z.enum(['piece', 'metre']),
	freeToSell: z.number().int(),
	soldLast60Days: z.number().int(),
	daysLeft: z.number().int().nullable(),
	lastSupplierId: Id.nullable(),
	lastSupplierName: z.string().nullable(),
	lastCostINR: z.number().nullable(),
	suggested: z.number().int(),
});
export type ReorderRow = z.infer<typeof ReorderRow>;

export const ReorderToOrders = z.object({
	lines: z
		.array(
			z.object({
				variantId: Id,
				quantity: z.number().int().positive(),
				/** Needed only for items never bought before; otherwise the last supplier. */
				supplierId: Id.optional(),
			}),
		)
		.min(1)
		.max(500),
});
export type ReorderToOrders = z.infer<typeof ReorderToOrders>;

export const StockDetailQuery = z.object({
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type StockDetailQuery = z.infer<typeof StockDetailQuery>;

export const AgeingQuery = z.object({
	band: z.coerce.number().int().min(0).max(3).optional(),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(15),
});
export type AgeingQuery = z.infer<typeof AgeingQuery>;

export const ValuationQuery = z.object({
	asOn: IsoDay,
	groupBy: z.enum(['category', 'supplier', 'product']).default('category'),
});
export type ValuationQuery = z.infer<typeof ValuationQuery>;

export const PurchaseRegisterQuery = z.object({ from: IsoDay, to: IsoDay });
export type PurchaseRegisterQuery = z.infer<typeof PurchaseRegisterQuery>;

/** Marks decisions on my own requests as seen (the bell). */
export const StockAlertsSeen = z.object({ ids: z.array(Id).max(50) });
export type StockAlertsSeen = z.infer<typeof StockAlertsSeen>;

export const StockCountRecount = z.object({ variantIds: z.array(Id).min(1).max(500) });
export type StockCountRecount = z.infer<typeof StockCountRecount>;

export const AgeingRow = z.object({
	variantId: Id,
	productId: Id,
	sku: z.string(),
	title: z.string(),
	optionsLabel: z.string(),
	imageUrl: z.string().nullable(),
	soldBy: z.enum(['piece', 'metre']),
	onHand: z.number().int(),
	oldestPieceDays: z.number().int(),
	lastSoldOn: IsoDay.nullable(),
	valueAtCostINR: z.number().nullable(),
	canReturnToSupplier: z.boolean(),
});
export type AgeingRow = z.infer<typeof AgeingRow>;

export const AgeingReport = z.object({
	bands: z.array(
		z.object({
			label: z.string(),
			fromDays: z.number().int(),
			toDays: z.number().int().nullable(),
			valueINR: z.number().nullable(),
			units: z.number().int(),
		}),
	),
	rows: z.array(AgeingRow),
	total: z.number().int(),
});

export const ValuationReport = z.object({
	asOn: IsoDay,
	groupBy: z.enum(['category', 'supplier', 'product']),
	rows: z.array(
		z.object({
			label: z.string(),
			units: z.number().int(),
			valueAtCostINR: z.number(),
			sellingValueINR: z.number(),
			sharePct: z.number(),
		}),
	),
	totalUnits: z.number().int(),
	totalValueINR: z.number(),
	/** Units on hand with no cost layer behind them (typed in before purchases existed). */
	uncostedUnits: z.number().int().nonnegative(),
});

export const PurchaseRegisterRow = z.object({
	billDate: IsoDay,
	supplierName: z.string(),
	gstin: z.string().nullable(),
	billNumber: z.string(),
	placeOfSupply: z.string(),
	taxableINR: z.number(),
	cgstINR: z.number(),
	sgstINR: z.number(),
	igstINR: z.number(),
	totalINR: z.number(),
	entryNumber: z.string(),
	reverseCharge: z.boolean(),
});
export type PurchaseRegisterRow = z.infer<typeof PurchaseRegisterRow>;

export const MovementReportQuery = z.object({
	source: InventoryMovementSource.optional(),
	from: IsoDay.optional(),
	to: IsoDay.optional(),
	actorId: Id.optional(),
	q: z.string().trim().max(100).optional(),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(200).default(30),
});
export type MovementReportQuery = z.infer<typeof MovementReportQuery>;

/** Label sheets (l01): A4 sizes, many items per sheet, start after used labels (P10). */
export const LabelSheetSize = z.enum(['a4_65', 'a4_40', 'a4_24', 'a4_21']);
export const LABEL_SHEETS: Readonly<
	Record<z.infer<typeof LabelSheetSize>, { columns: number; rows: number; widthMm: number; heightMm: number }>
> = {
	a4_65: { columns: 5, rows: 13, widthMm: 38.1, heightMm: 21.2 },
	a4_40: { columns: 4, rows: 10, widthMm: 48.5, heightMm: 25.4 },
	a4_24: { columns: 3, rows: 8, widthMm: 64, heightMm: 33.9 },
	a4_21: { columns: 3, rows: 7, widthMm: 70, heightMm: 42.3 },
};
