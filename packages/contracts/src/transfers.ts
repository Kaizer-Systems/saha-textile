import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { IsoDate } from './purchasing';

/**
 * Stock transfers between locations (accounts brief N1–N8; owner-approved D15, D19). A location asks another for
 * stock; the sender approves (the pieces are kept for it), packs them on a checklist and dispatches them with a
 * delivery challan, or a branch invoice to another GSTIN; the receiver counts what arrived on a checklist. The cost
 * layers travel with the pieces, so a transfer never changes what they cost.
 */

export const TransferStatus = z.enum([
	'requested',
	'packing',
	'in_transit',
	'received',
	'received_short',
	'rejected',
	'cancelled',
]);
export type TransferStatus = z.infer<typeof TransferStatus>;

/** A cost layer drawn at dispatch: what the pieces cost and since when. */
export const TransferDrawnLayer = z.object({
	layerId: Id,
	quantity: z.number().int().positive(),
	unitCostINR: z.number().nonnegative(),
	receivedAt: IsoDateTime,
});
export type TransferDrawnLayer = z.infer<typeof TransferDrawnLayer>;

export const TransferLine = z.object({
	lineId: Id,
	variantId: Id,
	productId: Id,
	sku: z.string(),
	title: z.string(),
	hsn: z.string().nullable().default(null),
	soldBy: z.enum(['piece', 'metre']).default('piece'),
	/** Asked for (tenths of a metre for fabric). */
	quantity: z.number().int().positive(),
	/** Ticked or scanned on the stock-out checklist (N5). */
	packed: z.number().int().nonnegative().default(0),
	/** Counted on the stock-in checklist (N6): what arrived, and of it what is damaged. */
	arrived: z.number().int().nonnegative().nullable().default(null),
	damaged: z.number().int().nonnegative().nullable().default(null),
	note: z.string().default(''),
	drawn: z.array(TransferDrawnLayer).default([]),
	/** At cost, once dispatched. */
	valueINR: z.number().nonnegative().nullable().default(null),
	/** The hold the damaged pieces went into at the receiver. */
	holdId: Id.nullable().default(null),
});
export type TransferLine = z.infer<typeof TransferLine>;

export const TransferStep = z.object({
	status: TransferStatus,
	at: IsoDateTime,
	by: Id.nullable(),
	byName: z.string().nullable().default(null),
});
export type TransferStep = z.infer<typeof TransferStep>;

/** A transfer to another GSTIN is a supply at cost with IGST (N8). */
export const BranchInvoice = z.object({
	number: z.string(),
	date: IsoDate,
	fromGstin: z.string(),
	toGstin: z.string(),
	taxableINR: z.number(),
	igstINR: z.number(),
	totalINR: z.number(),
});
export type BranchInvoice = z.infer<typeof BranchInvoice>;

export const StockTransfer = z.object({
	id: Id,
	number: z.string(),
	status: TransferStatus,
	fromLocationId: Id,
	toLocationId: Id,
	lines: z.array(TransferLine).min(1),
	neededBy: IsoDate.nullable().default(null),
	forOrderId: Id.nullable().default(null),
	forOrderNumber: z.string().nullable().default(null),
	note: z.string().default(''),
	/** Two GSTINs are two persons under GST (N8). */
	crossGstin: z.boolean().default(false),
	sealNumber: z.string().default(''),
	boxes: z.number().int().nonnegative().nullable().default(null),
	photoAssetIds: z.array(Id).default([]),
	vehicle: z.string().default(''),
	ewayBillNumber: z.string().nullable().default(null),
	challanNumber: z.string().nullable().default(null),
	branchInvoice: BranchInvoice.nullable().default(null),
	valueINR: z.number().nonnegative().default(0),
	short: z.enum(['carrier_claim', 'transit_loss']).nullable().default(null),
	rejectReason: z.string().nullable().default(null),
	voucherIds: z.array(Id).default([]),
	timeline: z.array(TransferStep).default([]),
	requestedBy: Id.nullable().default(null),
	version: z.number().int().nonnegative().default(0),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
});
export type StockTransfer = z.infer<typeof StockTransfer>;

/** N2: from which location, how many, by when, for which order. */
export const TransferRequestWrite = z.object({
	fromLocationId: Id,
	toLocationId: Id,
	lines: z
		.array(z.object({ variantId: Id, quantity: z.number().int().positive().max(100_000) }))
		.min(1)
		.max(100),
	neededBy: IsoDate.nullable().default(null),
	forOrderId: Id.nullable().default(null),
	note: z.string().trim().max(500).default(''),
});
export type TransferRequestWrite = z.infer<typeof TransferRequestWrite>;

export const TransferDecisionWrite = z.object({
	approve: z.boolean(),
	reason: z.string().trim().max(300).default(''),
	version: z.number().int().nonnegative(),
});
export type TransferDecisionWrite = z.infer<typeof TransferDecisionWrite>;

/** N5: the checklist as packed so far, and what goes with it. */
export const TransferPackWrite = z.object({
	lines: z.array(z.object({ lineId: Id, packed: z.number().int().nonnegative() })),
	sealNumber: z.string().trim().max(40).default(''),
	boxes: z.number().int().nonnegative().max(999).nullable().default(null),
	photoAssetIds: z.array(Id).max(10).default([]),
	vehicle: z.string().trim().max(80).default(''),
	ewayBillNumber: z
		.string()
		.trim()
		.regex(/^(\d{12}|\d{14})?$/, { message: 'eway_bill_shape' })
		.default(''),
	version: z.number().int().nonnegative(),
	/** Save the checklist and dispatch in one go. */
	dispatch: z.boolean().default(false),
});
export type TransferPackWrite = z.infer<typeof TransferPackWrite>;

/** N6: what arrived of each line and how much of it is damaged; what is short becomes a claim or a loss. */
export const TransferReceiveWrite = z.object({
	lines: z.array(
		z.object({
			lineId: Id,
			arrived: z.number().int().nonnegative(),
			damaged: z.number().int().nonnegative().default(0),
			note: z.string().trim().max(200).default(''),
		}),
	),
	short: z.enum(['carrier_claim', 'transit_loss']).default('carrier_claim'),
	version: z.number().int().nonnegative(),
});
export type TransferReceiveWrite = z.infer<typeof TransferReceiveWrite>;

export const TransferCancelWrite = z.object({
	reason: z.string().trim().min(3).max(300),
	version: z.number().int().nonnegative(),
});
export type TransferCancelWrite = z.infer<typeof TransferCancelWrite>;

export const TRANSFER_CHIPS = ['all', 'requested', 'packing', 'in_transit', 'received_short'] as const;
export const TransferChip = z.enum(TRANSFER_CHIPS);
export type TransferChip = z.infer<typeof TransferChip>;

export const TransferListQuery = z.object({
	from: IsoDate,
	to: IsoDate,
	chip: TransferChip.default('all'),
	search: z.string().trim().max(80).default(''),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type TransferListQuery = z.infer<typeof TransferListQuery>;

/** N3: a transfer as the list shows it. */
export const TransferRow = StockTransfer.extend({
	fromName: z.string(),
	toName: z.string(),
	pieces: z.number().int().nonnegative(),
});
export type TransferRow = z.infer<typeof TransferRow>;

export const TransferList = z.object({
	items: z.array(TransferRow),
	total: z.number().int().nonnegative(),
	counts: z.record(TransferChip, z.number().int().nonnegative()),
});
export type TransferList = z.infer<typeof TransferList>;

/** N4–N6: a transfer with what the person may do with it now. */
export const TransferView = TransferRow.extend({
	may: z.object({
		decide: z.boolean(),
		pack: z.boolean(),
		receive: z.boolean(),
		cancel: z.boolean(),
	}),
	/** N5: the e-way bill is needed at this value (Settings › E-invoice and e-way bill). */
	ewayBillFromINR: z.number(),
	/** What the pieces would cost if dispatched now, from the sender's cost layers. */
	estimatedValueINR: z.number(),
});
export type TransferView = z.infer<typeof TransferView>;

export const LocationStockQuery = z.object({
	search: z.string().trim().max(80).default(''),
	/** The stock list's own filters: low or out of stock across the business. */
	chip: z.enum(['all', 'low', 'out']).default('all'),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type LocationStockQuery = z.infer<typeof LocationStockQuery>;

/** N1: each item's stock at each location, what is in transit, and the total. */
export const LocationStockView = z.object({
	here: Id.nullable(),
	locations: z.array(z.object({ id: Id, name: z.string() })),
	items: z.array(
		z.object({
			variantId: Id,
			productId: Id,
			sku: z.string(),
			title: z.string(),
			soldBy: z.enum(['piece', 'metre']),
			/** On hand and free to sell (on hand less held and kept for orders) at each location. */
			byLocation: z.record(z.string(), z.object({ onHand: z.number(), free: z.number() })),
			inTransit: z.number(),
			total: z.number(),
		}),
	),
	total: z.number().int().nonnegative(),
});
export type LocationStockView = z.infer<typeof LocationStockView>;
