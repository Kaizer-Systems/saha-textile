import { z } from 'zod';

import { Id, IsoDateTime, PriceINR } from './common';
import { Gstin, GstStateCode, HsnCode, Pan } from './gst';
import { ShopOnDocument } from './shop-details';

/**
 * Purchases: suppliers, purchase orders, purchase entries (a supplier's bill taken into stock),
 * payments and purchase returns (debit notes). Brief: purchases and stock revision 2, accepted
 * 2026-11-15 with P1–P13 (owner log).
 *
 * Quantities are whole numbers of the product's unit: pieces, or tenths of a metre for a product
 * sold by the metre (P11). Money is rupees with two decimals; the server works it out.
 */

/** A calendar date with no time, `YYYY-MM-DD` (bill dates, due dates, books-closed date). */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'date_shape' });
export type IsoDate = z.infer<typeof IsoDate>;

/** A stock quantity in the product's unit (pieces, or tenths of a metre). */
export const StockUnits = z.number().int();
export const PositiveUnits = z.number().int().positive();
export const NonNegativeUnits = z.number().int().nonnegative();

const OptionalText = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.transform((value) => (value.length ? value : null))
		.nullable()
		.default(null);

/* ------------------------------------------------------------------ suppliers */

/** Regular suppliers charge GST we can claim; composition and unregistered suppliers charge none. */
export const SupplierKind = z.enum(['regular', 'composition', 'unregistered']);
export type SupplierKind = z.infer<typeof SupplierKind>;

/** How GST sits on a supplier's bills, worked out from the supplier (never typed). */
export const PurchaseTaxType = z.enum(['intra_state', 'inter_state', 'none']);
export type PurchaseTaxType = z.infer<typeof PurchaseTaxType>;

export const SupplierAddress = z.object({
	line: z.string().trim().min(1).max(300),
	city: z.string().trim().max(80).default(''),
	pin: z.string().regex(/^\d{6}$/, { message: 'pin_shape' }),
});
export type SupplierAddress = z.infer<typeof SupplierAddress>;

export const Supplier = z.object({
	id: Id,
	legalName: z.string(),
	shortName: z.string(),
	kind: SupplierKind,
	gstin: z.string().nullable(),
	pan: z.string().nullable(),
	stateCode: z.string(),
	/** The State's name, from its code (shown in lists and on the supplier page). */
	stateName: z.string(),
	address: SupplierAddress,
	contactName: z.string().nullable(),
	phone: z.string().nullable(),
	email: z.string().nullable(),
	paymentTermsDays: z.number().int().nonnegative(),
	usesItemCodes: z.boolean(),
	notes: z.string().nullable(),
	active: z.boolean(),
	taxType: PurchaseTaxType,
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
});
export type Supplier = z.infer<typeof Supplier>;

/** The supplier form. A regular supplier needs a GSTIN; its State and PAN then come from it. */
export const SupplierWrite = z
	.object({
		legalName: z.string().trim().min(1).max(200),
		shortName: z.string().trim().max(80).default(''),
		kind: SupplierKind,
		gstin: Gstin.nullable().default(null),
		pan: Pan.nullable().default(null),
		stateCode: GstStateCode,
		address: SupplierAddress,
		contactName: OptionalText(120),
		phone: OptionalText(30),
		email: z
			.string()
			.trim()
			.max(200)
			.transform((value) => (value.length ? value : null))
			.pipe(z.string().email().nullable())
			.nullable()
			.default(null),
		paymentTermsDays: z.number().int().min(0).max(365),
		usesItemCodes: z.boolean().default(false),
		notes: OptionalText(1000),
		active: z.boolean().default(true),
	})
	.superRefine((value, ctx) => {
		if (value.kind !== 'unregistered' && !value.gstin) {
			ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'gstin_required' });
		}
		if (value.gstin && value.gstin.slice(0, 2) !== value.stateCode) {
			ctx.addIssue({ code: 'custom', path: ['stateCode'], message: 'state_differs_from_gstin' });
		}
	});
export type SupplierWrite = z.infer<typeof SupplierWrite>;

export const SupplierListQuery = z.object({
	q: z.string().trim().max(100).optional(),
	filter: z.enum(['all', 'owed', 'inactive']).default('all'),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(15),
});
export type SupplierListQuery = z.infer<typeof SupplierListQuery>;

export const SupplierListRow = Supplier.extend({
	owedINR: PriceINR,
	purchaseCount: z.number().int().nonnegative(),
	lastPurchaseOn: IsoDate.nullable(),
});
export type SupplierListRow = z.infer<typeof SupplierListRow>;

export const SupplierListResponse = z.object({
	items: z.array(SupplierListRow),
	total: z.number().int(),
	counts: z.object({ all: z.number().int(), owed: z.number().int(), inactive: z.number().int() }),
});
export type SupplierListResponse = z.infer<typeof SupplierListResponse>;

/** What the GSTIN check on the form says before saving (s02, s02b). */
export const SupplierGstinCheck = z.object({
	problem: z.enum(['shape', 'state', 'check_digit']).nullable(),
	expectedLastCharacter: z.string().nullable(),
	stateCode: z.string().nullable(),
	pan: z.string().nullable(),
	taxType: PurchaseTaxType.nullable(),
	/** Another supplier with this exact GSTIN: saving is refused. */
	sameGstin: z.object({ id: Id, name: z.string() }).nullable(),
	/** Another supplier with the same PAN under a different GSTIN: allowed, shown. */
	samePan: z.array(z.object({ id: Id, name: z.string(), gstin: z.string() })),
});
export type SupplierGstinCheck = z.infer<typeof SupplierGstinCheck>;

export const SupplierGstinCheckQuery = z.object({
	gstin: z.string().trim().min(1).max(20),
	excludeId: Id.optional(),
});
export type SupplierGstinCheckQuery = z.infer<typeof SupplierGstinCheckQuery>;

/** Links one of the supplier's own item codes to one of our variants. */
export const SupplierItemCodeWrite = z.object({ code: z.string().trim().min(1).max(60), variantId: Id });
export type SupplierItemCodeWrite = z.infer<typeof SupplierItemCodeWrite>;

/** One row of a supplier's statement: bills, debit notes and payments with a running balance. */
export const SupplierStatementRow = z.object({
	date: IsoDate,
	kind: z.enum([
		'bill',
		'debit_note',
		'credit_note',
		'payment',
		'payment_reversed',
		/** The supplier paid a debit note back in money. */
		'refund_received',
		/** The supplier refused a debit note and it was written off. */
		'claim_written_off',
		/** Reverse charge (accounts brief D): a self-invoice we made for their supply, and its payment vouchers. */
		'self_invoice',
		'self_invoice_cancelled',
		'self_invoice_payment',
		'self_invoice_payment_cancelled',
	]),
	documentId: Id,
	documentNumber: z.string(),
	details: z.string(),
	billINR: PriceINR,
	paidOrCreditedINR: PriceINR,
	balanceINR: z.number(),
});
export type SupplierStatementRow = z.infer<typeof SupplierStatementRow>;

export const SupplierSummary = z.object({
	supplier: Supplier,
	owedINR: z.number(),
	owedBills: z.number().int(),
	nextDueOn: IsoDate.nullable(),
	boughtThisYearINR: PriceINR,
	entriesThisYear: z.number().int(),
	returnedThisYearINR: PriceINR,
	debitNotesThisYear: z.number().int(),
	oldestUnpaidDays: z.number().int().nullable(),
	statement: z.array(SupplierStatementRow),
});
export type SupplierSummary = z.infer<typeof SupplierSummary>;

/* --------------------------------------------------------- lines shared by documents */

/** A product or variant as a purchase line picks it (search results, scanner, their code). */
export const PurchaseItemOption = z.object({
	productId: Id,
	variantId: Id,
	sku: z.string(),
	title: z.string(),
	optionsLabel: z.string(),
	imageUrl: z.string().nullable(),
	soldBy: z.enum(['piece', 'metre']),
	status: z.string(),
	/** True when the product cannot take stock: discontinued, or a bundle. */
	blocked: z.enum(['discontinued', 'bundle']).nullable(),
	/** Shown greyed with a warning: disabled products can still take stock. */
	disabled: z.boolean(),
	hsnCode: z.string().nullable(),
	sellingPriceINR: PriceINR,
	mrpINR: PriceINR.nullable(),
	onHand: StockUnits,
	lastCostINR: PriceINR.nullable(),
	lastEntryNumber: z.string().nullable(),
	supplierItemCode: z.string().nullable(),
	/** Variants of the same product, for the variant grid (p04). */
	variantCount: z.number().int(),
});
export type PurchaseItemOption = z.infer<typeof PurchaseItemOption>;

export const PurchaseItemSearchQuery = z.object({
	q: z.string().trim().min(1).max(100),
	supplierId: Id.optional(),
	limit: z.coerce.number().int().min(1).max(20).default(8),
});
export type PurchaseItemSearchQuery = z.infer<typeof PurchaseItemSearchQuery>;

export const VariantGridQuery = z.object({ supplierId: Id.optional() });

/** Item details for lines that arrive as variant ids (an order's receive draft, a copied entry). */
export const PurchaseItemsByVariantQuery = z.object({
	ids: z
		.string()
		.trim()
		.min(1)
		.transform((value) => [
			...new Set(
				value
					.split(',')
					.map((id) => id.trim())
					.filter(Boolean),
			),
		])
		.pipe(z.array(Id).min(1).max(200)),
	supplierId: Id.optional(),
});
export type PurchaseItemsByVariantQuery = z.infer<typeof PurchaseItemsByVariantQuery>;
export type VariantGridQuery = z.infer<typeof VariantGridQuery>;

export const DraftProductDefaultsQuery = z.object({ categoryId: Id });
export type DraftProductDefaultsQuery = z.infer<typeof DraftProductDefaultsQuery>;

/* ------------------------------------------------------------------ purchase orders */

export const PurchaseOrderStatus = z.enum(['draft', 'sent', 'part_received', 'received', 'closed_short', 'cancelled']);
export type PurchaseOrderStatus = z.infer<typeof PurchaseOrderStatus>;

export const PurchaseOrderLine = z.object({
	lineId: Id,
	productId: Id,
	variantId: Id,
	sku: z.string(),
	title: z.string(),
	optionsLabel: z.string(),
	soldBy: z.enum(['piece', 'metre']),
	supplierItemCode: z.string().nullable(),
	quantity: PositiveUnits,
	agreedPriceINR: PriceINR,
	/** For the order's GST estimate only; the supplier's bill sets the real tax. */
	gstRatePct: z.number().min(0).max(28),
	lastCostINR: PriceINR.nullable(),
	receivedQuantity: NonNegativeUnits,
	/** The entries that brought this line's goods (po04 "Received on"). */
	receivedOn: z
		.array(z.object({ entryId: Id, number: z.string().nullable(), quantity: z.number().int() }))
		.default([]),
	/**
	 * Customer backorder lines this order line covers (owner decision OD2, 2026-11-17). Kept from
	 * the start so the Backorders screen and picker (their own brief) need no migration; empty
	 * until they are built.
	 */
	backorderLineIds: z.array(Id).default([]),
});
export type PurchaseOrderLine = z.infer<typeof PurchaseOrderLine>;

export const PurchaseOrder = z.object({
	id: Id,
	number: z.string(),
	status: PurchaseOrderStatus,
	supplierId: Id,
	supplierName: z.string(),
	expectedBy: IsoDate,
	deliverTo: z.string(),
	noteToSupplier: z.string().nullable(),
	internalNote: z.string().nullable(),
	lines: z.array(PurchaseOrderLine),
	orderedValueINR: PriceINR,
	estimatedGstINR: PriceINR,
	sentAt: IsoDateTime.nullable(),
	sentVia: z.enum(['email', 'pdf']).nullable(),
	sentBy: Id.nullable(),
	/** The shop details printed when it was sent (R3-1): its PDF always shows these. */
	shopSnapshot: ShopOnDocument.nullable().default(null),
	closedAt: IsoDateTime.nullable(),
	closedReason: z.string().nullable(),
	linkedEntryIds: z.array(Id),
	late: z.boolean(),
	createdBy: Id.nullable(),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	/** Who saved last: named when a stale save is refused. */
	updatedBy: Id.nullable().default(null),
	version: z.number().int(),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrder>;

export const PurchaseOrderLineWrite = z.object({
	lineId: Id.optional(),
	variantId: Id,
	quantity: PositiveUnits,
	agreedPriceINR: PriceINR,
	/** For the estimate only (example rate until the CA's table, round 2 B2.4). */
	gstRatePct: z.number().min(0).max(28).default(5),
	supplierItemCode: OptionalText(60),
	/** Backorder lines this line covers (OD2); the Backorders screen fills it. */
	backorderLineIds: z.array(Id).max(500).default([]),
});
export type PurchaseOrderLineWrite = z.infer<typeof PurchaseOrderLineWrite>;

export const PurchaseOrderWrite = z.object({
	supplierId: Id,
	expectedBy: IsoDate,
	deliverTo: z.string().trim().min(1).max(300),
	noteToSupplier: OptionalText(1000),
	internalNote: OptionalText(1000),
	lines: z.array(PurchaseOrderLineWrite).max(500),
	/** The version the form loaded; a stale save is refused (two people on one draft). */
	version: z.number().int().optional(),
});
export type PurchaseOrderWrite = z.infer<typeof PurchaseOrderWrite>;

export const PurchaseOrderSend = z.object({
	via: z.enum(['email', 'pdf']),
	mailboxId: Id.optional(),
	/** One of the mailbox's send-as addresses. */
	from: z.string().trim().email().optional(),
	to: z.array(z.string().trim().email()).max(10).default([]),
	subject: z.string().trim().max(200).default(''),
	message: z.string().trim().max(5000).default(''),
});
export type PurchaseOrderSend = z.infer<typeof PurchaseOrderSend>;

export const PurchaseOrderListQuery = z.object({
	q: z.string().trim().max(100).optional(),
	filter: z.enum(['all', 'draft', 'sent', 'part_received', 'late', 'closed']).default('all'),
	/** The purchase entry's order picker: one supplier's orders (p02, po04b). */
	supplierId: Id.optional(),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(15),
});
export type PurchaseOrderListQuery = z.infer<typeof PurchaseOrderListQuery>;

export const PurchaseOrderClose = z.object({ reason: z.string().trim().min(3).max(500) });
export type PurchaseOrderClose = z.infer<typeof PurchaseOrderClose>;

export const PurchaseOrderListResponse = z.object({
	items: z.array(PurchaseOrder),
	total: z.number().int(),
	counts: z.record(z.string(), z.number().int()),
});
export type PurchaseOrderListResponse = z.infer<typeof PurchaseOrderListResponse>;

/* ------------------------------------------------------------------ purchase entries */

/** Draft → Goods checked → Posted (stock in) → Void (only while nothing from it has moved on). */
export const PurchaseEntryStatus = z.enum(['draft', 'checked', 'posted', 'void']);
export type PurchaseEntryStatus = z.infer<typeof PurchaseEntryStatus>;

export const PaymentStatus = z.enum(['unpaid', 'part_paid', 'paid']);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

export const DamageReason = z.enum(['damaged_on_arrival', 'wrong_item', 'other']);
export type DamageReason = z.infer<typeof DamageReason>;

/** A warning the screen shows while typing; posting records the ones accepted (p06, p10b). */
export const PurchaseWarning = z.object({
	code: z.enum([
		'price_jump',
		'margin_floor',
		'hsn_mismatch',
		'disabled_product',
		'not_ordered',
		'date_order',
		'bill_in_future',
		/** P07: same supplier, same total and date, a different bill number. */
		'lookalike_bill',
	]),
	lineId: Id.nullable(),
	detail: z.string(),
	values: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).default({}),
});
export type PurchaseWarning = z.infer<typeof PurchaseWarning>;

export const PurchaseEntryLine = z.object({
	lineId: Id,
	productId: Id,
	variantId: Id,
	sku: z.string(),
	title: z.string(),
	optionsLabel: z.string(),
	soldBy: z.enum(['piece', 'metre']),
	imageUrl: z.string().nullable(),
	supplierItemCode: z.string().nullable(),
	/** HSN as printed on the supplier's bill; the product keeps its own. */
	hsnOnBill: z.string().nullable(),
	productHsn: z.string().nullable(),
	gstRatePct: z.number().min(0).max(28),
	quantity: PositiveUnits,
	/** As on the bill: before GST, or including GST when the entry says so. */
	unitPriceINR: PriceINR,
	freeOnBill: z.boolean(),
	purchaseOrderLineId: Id.nullable(),
	notOrdered: z.boolean(),
	/** Goods check (p08): good + damaged + missing = quantity. */
	accepted: NonNegativeUnits.nullable(),
	damaged: NonNegativeUnits,
	missing: NonNegativeUnits,
	damageReason: DamageReason.nullable(),
	damageNote: z.string().nullable(),
	damagePhotoAssetIds: z.array(Id),
	/** Worked out by the server. */
	taxableINR: PriceINR,
	taxINR: PriceINR,
	lineTotalINR: PriceINR,
	freightShareINR: PriceINR,
	/** Cost into stock per piece or metre; null for anyone without `stock.cost` (P8). */
	unitCostINR: z.number().nullable(),
	sellingPriceINR: PriceINR,
	marginPct: z.number().nullable(),
	lastCostINR: PriceINR.nullable(),
	costLayerId: Id.nullable(),
});
export type PurchaseEntryLine = z.infer<typeof PurchaseEntryLine>;

export const PurchaseEntryTotals = z.object({
	linesINR: PriceINR,
	freightINR: PriceINR,
	taxableINR: PriceINR,
	cgstINR: PriceINR,
	sgstINR: PriceINR,
	igstINR: PriceINR,
	roundOffINR: z.number(),
	totalINR: PriceINR,
	/** The total typed from the paper, and whether it matches within ₹1. */
	printedTotalINR: PriceINR.nullable(),
	matchesPrinted: z.boolean(),
	differenceINR: z.number(),
	pieces: z.number().int(),
	/** Null for anyone without `stock.cost` (P8). */
	costIntoStockINR: z.number().nullable(),
});
export type PurchaseEntryTotals = z.infer<typeof PurchaseEntryTotals>;

export const PurchaseEntry = z.object({
	id: Id,
	number: z.string().nullable(),
	status: PurchaseEntryStatus,
	paymentStatus: PaymentStatus,
	supplierId: Id,
	supplierName: z.string(),
	supplierGstin: z.string().nullable(),
	supplierStateCode: z.string(),
	supplierKind: SupplierKind,
	taxType: PurchaseTaxType,
	purchaseOrderId: Id.nullable(),
	purchaseOrderNumber: z.string().nullable(),
	billNumber: z.string(),
	billDate: IsoDate,
	goodsReceivedOn: IsoDate,
	pricesIncludeGst: z.boolean(),
	freightINR: PriceINR,
	freightGstRatePct: z.number().min(0).max(28),
	roundOffINR: z.number(),
	billAttachment: z.object({ assetId: Id, name: z.string(), url: z.string().nullable() }).nullable(),
	lines: z.array(PurchaseEntryLine),
	totals: PurchaseEntryTotals,
	warnings: z.array(PurchaseWarning),
	acceptedWarnings: z.array(PurchaseWarning),
	/** ITC claimable: cost goes into stock before GST (P5). */
	itcClaimable: z.boolean(),
	dueOn: IsoDate,
	paidINR: PriceINR,
	/**
	 * Net credit from debit notes on this entry: sent debit notes, less refunds the supplier paid
	 * back and claims written off. Left to pay = total − paid − credited.
	 */
	creditedINR: z.number().default(0),
	createdBy: Id.nullable(),
	checkedBy: Id.nullable(),
	checkedAt: IsoDateTime.nullable(),
	postedBy: Id.nullable(),
	postedAt: IsoDateTime.nullable(),
	voidedBy: Id.nullable(),
	voidedAt: IsoDateTime.nullable(),
	voidReason: z.string().nullable(),
	returnDraftIds: z.array(Id),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	updatedBy: Id.nullable().default(null),
	version: z.number().int(),
});
export type PurchaseEntry = z.infer<typeof PurchaseEntry>;

export const PurchaseEntryLineWrite = z.object({
	lineId: Id.optional(),
	variantId: Id,
	quantity: PositiveUnits,
	unitPriceINR: PriceINR,
	freeOnBill: z.boolean().default(false),
	hsnOnBill: z
		.string()
		.trim()
		.transform((value) => (value.length ? value : null))
		.pipe(HsnCode.nullable())
		.nullable()
		.default(null),
	gstRatePct: z.number().min(0).max(28),
	supplierItemCode: OptionalText(60),
	purchaseOrderLineId: Id.nullable().default(null),
});
export type PurchaseEntryLineWrite = z.infer<typeof PurchaseEntryLineWrite>;

export const PurchaseEntryWrite = z.object({
	supplierId: Id,
	purchaseOrderId: Id.nullable().default(null),
	billNumber: z.string().trim().min(1).max(40),
	billDate: IsoDate,
	goodsReceivedOn: IsoDate,
	pricesIncludeGst: z.boolean().default(false),
	freightINR: PriceINR.default(0),
	freightGstRatePct: z.number().min(0).max(28).default(0),
	roundOffINR: z.number().min(-10).max(10).default(0),
	printedTotalINR: PriceINR.nullable().default(null),
	billAttachmentAssetId: Id.nullable().default(null),
	lines: z.array(PurchaseEntryLineWrite).max(500),
	version: z.number().int().optional(),
});
export type PurchaseEntryWrite = z.infer<typeof PurchaseEntryWrite>;

/** The goods check (p08, g01): per line, good / damaged / missing, with a reason when not good. */
export const PurchaseGoodsCheck = z.object({
	lines: z.array(
		z.object({
			lineId: Id,
			accepted: NonNegativeUnits,
			damaged: NonNegativeUnits,
			missing: NonNegativeUnits,
			damageReason: DamageReason.nullable().default(null),
			damageNote: OptionalText(500),
			damagePhotoAssetIds: z.array(Id).max(6).default([]),
		}),
	),
	version: z.number().int().optional(),
});
export type PurchaseGoodsCheck = z.infer<typeof PurchaseGoodsCheck>;

export const PurchasePost = z.object({
	/** The warnings the poster saw and accepted; the server checks they are the current ones. */
	acceptWarningCodes: z.array(z.string()).default([]),
	requestKey: z.string().min(8).max(80),
	version: z.number().int().optional(),
});
export type PurchasePost = z.infer<typeof PurchasePost>;

export const PurchaseVoid = z.object({ reason: z.string().trim().min(3).max(500) });
export type PurchaseVoid = z.infer<typeof PurchaseVoid>;

/** Why a void is refused: which pieces have moved on, and where to (p12). */
export const VoidBlocker = z.object({
	sku: z.string(),
	soldUnits: z.number().int(),
	reservedUnits: z.number().int(),
	returnedUnits: z.number().int(),
	documents: z.array(z.string()),
});
export type VoidBlocker = z.infer<typeof VoidBlocker>;

export const PurchaseEntryListQuery = z.object({
	q: z.string().trim().max(100).optional(),
	filter: z.enum(['all', 'draft', 'checked', 'unpaid', 'void']).default('all'),
	supplierId: Id.optional(),
	from: IsoDate.optional(),
	to: IsoDate.optional(),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(15),
});
export type PurchaseEntryListQuery = z.infer<typeof PurchaseEntryListQuery>;

export const PurchaseEntryListRow = PurchaseEntry.pick({
	id: true,
	number: true,
	status: true,
	paymentStatus: true,
	supplierId: true,
	supplierName: true,
	billNumber: true,
	billDate: true,
	dueOn: true,
	paidINR: true,
	createdAt: true,
}).extend({
	pieces: z.number().int(),
	totalINR: PriceINR,
	/** Still to pay after payments and settled debit notes (0 for drafts and void entries). */
	leftINR: z.number(),
});
export type PurchaseEntryListRow = z.infer<typeof PurchaseEntryListRow>;

export const PurchaseEntryListResponse = z.object({
	items: z.array(PurchaseEntryListRow),
	total: z.number().int(),
	counts: z.record(z.string(), z.number().int()),
	tiles: z.object({
		boughtThisMonthINR: PriceINR,
		postedThisMonth: z.number().int(),
		piecesThisMonth: z.number().int(),
		owedINR: PriceINR,
		owedBills: z.number().int(),
		dueIn7DaysINR: PriceINR,
		dueIn7DaysNext: z.object({ supplierName: z.string(), dueOn: IsoDate }).nullable(),
		drafts: z.number().int(),
	}),
});
export type PurchaseEntryListResponse = z.infer<typeof PurchaseEntryListResponse>;

/** A spreadsheet of lines from a supplier (p13), read in the browser and sent as rows. */
export const PurchaseImportRow = z.object({
	row: z.number().int().positive(),
	code: z.string().trim().max(80),
	quantity: z.number(),
	unitPriceINR: z.number(),
	hsn: z.string().trim().max(10).default(''),
	gstRatePct: z.number().nullable().default(null),
});
export type PurchaseImportRow = z.infer<typeof PurchaseImportRow>;
export const PurchaseImportRequest = z.object({ supplierId: Id, rows: z.array(PurchaseImportRow).max(2000) });
export type PurchaseImportRequest = z.infer<typeof PurchaseImportRequest>;

export const PurchaseImportResult = z.object({
	rows: z.array(
		z.object({
			row: z.number().int(),
			code: z.string(),
			result: z.enum(['ready', 'needs_product', 'problem']),
			problem: z
				.enum(['repeated_at_other_price', 'quantity_below_one', 'price_invalid', 'blocked_product'])
				.nullable(),
			match: PurchaseItemOption.nullable(),
			quantity: z.number(),
			unitPriceINR: z.number(),
			hsn: z.string(),
			gstRatePct: z.number().nullable(),
		}),
	),
	counts: z.object({ ready: z.number().int(), needsProduct: z.number().int(), problems: z.number().int() }),
});
export type PurchaseImportResult = z.infer<typeof PurchaseImportResult>;

/** A draft product made from a purchase line (p05): the minimum the bill needs. */
export const DraftProductFromLine = z.object({
	name: z.string().trim().min(1).max(200),
	categoryId: Id,
	sellingPriceINR: z.number().int().positive(),
	mrpINR: z.number().int().positive().nullable().default(null),
	supplierId: Id.optional(),
	supplierItemCode: OptionalText(60),
	soldBy: z.enum(['piece', 'metre']).default('piece'),
	/** Typed only when the category has no numbered SKUs yet; otherwise its own prefix is used. */
	skuPrefix: z
		.string()
		.trim()
		.max(20)
		.regex(/^[A-Za-z0-9-]*$/, { message: 'sku_prefix_shape' })
		.nullable()
		.default(null),
});
export type DraftProductFromLine = z.infer<typeof DraftProductFromLine>;

/* ------------------------------------------------------------------ payments */

export const PaymentMode = z.enum(['bank_transfer', 'upi', 'cheque', 'cash']);
export type PaymentMode = z.infer<typeof PaymentMode>;

export const SupplierPayment = z.object({
	id: Id,
	supplierId: Id,
	purchaseEntryId: Id,
	amountINR: PriceINR,
	paidOn: IsoDate,
	mode: PaymentMode,
	reference: z.string().nullable(),
	proofAssetId: Id.nullable(),
	createdBy: Id.nullable(),
	createdAt: IsoDateTime,
	reversedAt: IsoDateTime.nullable(),
	reversedBy: Id.nullable(),
	reverseReason: z.string().nullable(),
});
export type SupplierPayment = z.infer<typeof SupplierPayment>;

export const SupplierPaymentWrite = z.object({
	amountINR: PriceINR.refine((value) => value > 0, { message: 'amount_positive' }),
	paidOn: IsoDate,
	mode: PaymentMode,
	reference: OptionalText(80),
	proofAssetId: Id.nullable().default(null),
});
export type SupplierPaymentWrite = z.infer<typeof SupplierPaymentWrite>;

export const SupplierPaymentReverse = z.object({ reason: z.string().trim().min(3).max(500) });
export type SupplierPaymentReverse = z.infer<typeof SupplierPaymentReverse>;

/* ------------------------------------------------------------------ purchase returns */

export const PurchaseReturnReason = z.enum([
	'damaged_on_arrival',
	'wrong_item',
	'short_supplied',
	'quality_after_accepting',
	'extra_sent',
	'other',
]);
export type PurchaseReturnReason = z.infer<typeof PurchaseReturnReason>;

/** Return goods (stock leaves when sent), or a claim for goods that never came (no stock). */
export const PurchaseReturnKind = z.enum(['return_goods', 'short_supply']);
export type PurchaseReturnKind = z.infer<typeof PurchaseReturnKind>;

export const PurchaseReturnStatus = z.enum(['draft', 'sent', 'settled']);
export type PurchaseReturnStatus = z.infer<typeof PurchaseReturnStatus>;

export const SettlementHow = z.enum(['credit_note', 'refund', 'later_bill', 'written_off']);
export type SettlementHow = z.infer<typeof SettlementHow>;

export const PurchaseReturnLine = z.object({
	lineId: Id,
	entryLineId: Id,
	productId: Id,
	variantId: Id,
	sku: z.string(),
	title: z.string(),
	optionsLabel: z.string(),
	soldBy: z.enum(['piece', 'metre']),
	imageUrl: z.string().nullable(),
	quantity: PositiveUnits,
	unitCostINR: z.number(),
	gstRatePct: z.number(),
	taxableINR: PriceINR,
	taxINR: PriceINR,
	totalINR: PriceINR,
});
export type PurchaseReturnLine = z.infer<typeof PurchaseReturnLine>;

export const PurchaseReturn = z.object({
	id: Id,
	number: z.string().nullable(),
	kind: PurchaseReturnKind,
	status: PurchaseReturnStatus,
	origin: z.enum(['goods_check', 'manual', 'held', 'ageing']),
	purchaseEntryId: Id,
	purchaseEntryNumber: z.string().nullable(),
	supplierId: Id,
	supplierName: z.string(),
	taxType: PurchaseTaxType,
	reason: PurchaseReturnReason,
	noteToSupplier: z.string().nullable(),
	photoAssetIds: z.array(Id),
	lines: z.array(PurchaseReturnLine),
	taxableINR: PriceINR,
	cgstINR: PriceINR,
	sgstINR: PriceINR,
	igstINR: PriceINR,
	totalINR: PriceINR,
	challanNumber: z.string().nullable(),
	courier: z.string().nullable(),
	docket: z.string().nullable(),
	sentAt: IsoDateTime.nullable(),
	sentBy: Id.nullable(),
	/** Each settlement in order: a part settlement leaves the rest open (r04). */
	settlements: z.array(
		z.object({
			id: Id,
			how: SettlementHow,
			reference: z.string().nullable(),
			date: IsoDate,
			amountINR: PriceINR,
			attachmentAssetId: Id.nullable(),
			by: Id.nullable(),
			at: IsoDateTime,
		}),
	),
	settledINR: PriceINR,
	settledAt: IsoDateTime.nullable(),
	settledBy: Id.nullable(),
	holdId: Id.nullable(),
	createdBy: Id.nullable(),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	updatedBy: Id.nullable().default(null),
	version: z.number().int(),
});
export type PurchaseReturn = z.infer<typeof PurchaseReturn>;

export const PurchaseReturnWrite = z.object({
	purchaseEntryId: Id,
	kind: PurchaseReturnKind.default('return_goods'),
	reason: PurchaseReturnReason,
	noteToSupplier: OptionalText(1000),
	photoAssetIds: z.array(Id).max(10).default([]),
	lines: z
		.array(z.object({ entryLineId: Id, quantity: PositiveUnits }))
		.min(1)
		.max(500),
	holdId: Id.nullable().default(null),
	version: z.number().int().optional(),
});
export type PurchaseReturnWrite = z.infer<typeof PurchaseReturnWrite>;

export const PurchaseReturnSend = z.object({
	courier: OptionalText(80),
	docket: OptionalText(80),
	requestKey: z.string().min(8).max(80),
});
export type PurchaseReturnSend = z.infer<typeof PurchaseReturnSend>;

export const PurchaseReturnSettle = z.object({
	how: SettlementHow,
	reference: OptionalText(80),
	date: IsoDate,
	amountINR: PriceINR,
	attachmentAssetId: Id.nullable().default(null),
});
export type PurchaseReturnSettle = z.infer<typeof PurchaseReturnSettle>;

export const ReturnableQuery = z.object({
	entryId: Id,
	kind: PurchaseReturnKind.default('return_goods'),
	holdId: Id.optional(),
	excludeReturnId: Id.optional(),
});
export type ReturnableQuery = z.infer<typeof ReturnableQuery>;

/** What a return may take per entry line (r02, r03): received, already returned, free now. */
export const ReturnableLine = z.object({
	entryLineId: Id,
	variantId: Id,
	sku: z.string(),
	title: z.string(),
	optionsLabel: z.string(),
	soldBy: z.enum(['piece', 'metre']),
	imageUrl: z.string().nullable(),
	received: z.number().int(),
	returnedBefore: z.number().int(),
	onHand: z.number().int(),
	held: z.number().int(),
	inOrders: z.number().int(),
	freeToReturn: z.number().int(),
	unitCostINR: z.number(),
	gstRatePct: z.number(),
	/** Why the most that can go back is smaller than received less returned (r03), or null. */
	capReason: z.string().nullable(),
});
export type ReturnableLine = z.infer<typeof ReturnableLine>;

export const PurchaseReturnListQuery = z.object({
	q: z.string().trim().max(100).optional(),
	filter: z.enum(['all', 'draft', 'sent', 'waiting', 'settled']).default('all'),
	/** The supplier page's Returns tab (s03). */
	supplierId: Id.optional(),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(15),
});
export type PurchaseReturnListQuery = z.infer<typeof PurchaseReturnListQuery>;

export const PurchaseReturnListResponse = z.object({
	items: z.array(PurchaseReturn),
	total: z.number().int(),
	counts: z.record(z.string(), z.number().int()),
});
export type PurchaseReturnListResponse = z.infer<typeof PurchaseReturnListResponse>;

/* ------------------------------------------------------------------ barcode labels (l01) */

/** A4 label sheets (P10): 65, 40, 24 or 21 labels; a label printer can be added later. */
export const LabelSheetKind = z.enum(['a4_65', 'a4_40', 'a4_24', 'a4_21']);
export type LabelSheetKind = z.infer<typeof LabelSheetKind>;

export const LabelField = z.enum(['name', 'sku', 'barcode', 'price', 'mrp']);
export type LabelField = z.infer<typeof LabelField>;

/** Labels to print: many items on one sheet, starting after labels already used on a part-used sheet. */
export const LabelSheetRequest = z
	.object({
		sheet: LabelSheetKind,
		/** The first free label on the first sheet, counted across then down from 1. */
		startAt: z.number().int().min(1).max(65),
		fields: z.array(LabelField).min(1).max(5),
		items: z
			.array(z.object({ variantId: Id, count: z.number().int().min(1).max(1000) }))
			.min(1)
			.max(200),
		/** Where the labels came from, for the activity line (a posted entry). */
		purchaseEntryId: Id.optional(),
	})
	.superRefine((value, ctx) => {
		const total = value.items.reduce((sum, item) => sum + item.count, 0);
		if (total > 2000) ctx.addIssue({ code: 'custom', path: ['items'], message: 'too_many_labels' });
	});
export type LabelSheetRequest = z.infer<typeof LabelSheetRequest>;

/* ------------------------------------------------------------------ settings */

/**
 * P1: who may do each purchase-entry step, and which steps need a second person. A role id
 * narrows a step from "anyone with the step's permission" to holders of that one role. All open
 * and off by default (one person may do every step); only the super admin changes them.
 */
export const PurchaseStepRules = z.object({
	draftRoleId: Id.nullable().default(null),
	checkRoleId: Id.nullable().default(null),
	postRoleId: Id.nullable().default(null),
	paymentRoleId: Id.nullable().default(null),
	checkByDifferentPerson: z.boolean().default(false),
	postByDifferentPerson: z.boolean().default(false),
	paymentByDifferentPerson: z.boolean().default(false),
});
export type PurchaseStepRules = z.infer<typeof PurchaseStepRules>;
export type PurchaseStep = 'draft' | 'check' | 'post' | 'payment';

export const NumberFormats = z.object({
	purchaseEntry: z.string().default('PE/{fy}/{seq6}'),
	purchaseOrder: z.string().default('PO/{fy}/{seq6}'),
	openingStock: z.string().default('OS/{fy}/{seq6}'),
	stockCount: z.string().default('SC/{fy}/{seq6}'),
	debitNote: z.string().default('DN/{fy}/{seq6}'),
	deliveryChallan: z.string().default('DC/{fy}/{seq6}'),
});
export type NumberFormats = z.infer<typeof NumberFormats>;

export const InventorySettings = z.object({
	stepRules: PurchaseStepRules.default({
		draftRoleId: null,
		checkRoleId: null,
		postRoleId: null,
		paymentRoleId: null,
		checkByDifferentPerson: false,
		postByDifferentPerson: false,
		paymentByDifferentPerson: false,
	}),
	priceChangeWarnPct: z.number().min(0).max(500).default(10),
	marginFloorPct: z.number().min(0).max(100).default(20),
	heldReminderDays: z.number().int().min(1).max(365).default(21),
	booksClosedUpTo: IsoDate.nullable().default(null),
	unpaidAlertDays: z.number().int().min(1).max(365).default(150),
	defaultPaymentTermsDays: z.number().int().min(0).max(365).default(30),
	defaultDeliverTo: z.string().default(''),
	/**
	 * The shop's own identity as printed on purchase orders (and later on GST documents). Empty
	 * until set: the order PDF then prints the Brand Kit's shop name and leaves the GSTIN out.
	 */
	business: z
		.object({
			legalName: z.string().trim().max(200).default(''),
			gstin: z.string().trim().max(15).nullable().default(null),
			addressLines: z.array(z.string().trim().max(200)).max(4).default([]),
		})
		.default({ legalName: '', gstin: null, addressLines: [] }),
	numberFormats: NumberFormats.default({
		purchaseEntry: 'PE/{fy}/{seq6}',
		purchaseOrder: 'PO/{fy}/{seq6}',
		openingStock: 'OS/{fy}/{seq6}',
		stockCount: 'SC/{fy}/{seq6}',
		debitNote: 'DN/{fy}/{seq6}',
		deliveryChallan: 'DC/{fy}/{seq6}',
	}),
	updatedAt: IsoDateTime.nullable().default(null),
	updatedBy: Id.nullable().default(null),
});
export type InventorySettings = z.infer<typeof InventorySettings>;

export const InventorySettingsWrite = InventorySettings.omit({ updatedAt: true, updatedBy: true, numberFormats: true });
export type InventorySettingsWrite = z.infer<typeof InventorySettingsWrite>;

/** x02 as the admin reads it: the settings, the step roles' names, and whether this reader may change the steps. */
export const InventorySettingsView = InventorySettings.extend({
	stepRoleLabels: z.record(z.string(), z.string()).default({}),
	canChangeSteps: z.boolean().default(false),
});
export type InventorySettingsView = z.infer<typeof InventorySettingsView>;
