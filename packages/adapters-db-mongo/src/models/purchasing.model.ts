import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';

/**
 * Purchases and stock (purchases and stock brief, revision 2).
 *
 * Each aggregate is one document with its lines inside, stored in the shape of its contract
 * (`@saha-textile/contracts` `purchasing.ts` / `inventory.ts`) with `_id` for `id`. The schemas
 * name the fields queries and indexes use; the rest of the shape is the contract's, validated
 * by zod where it enters the API. Dates are ISO strings: `YYYY-MM-DD` days sort and range-query
 * as text, and instants keep their time zone.
 */

const loose = { strict: false, versionKey: false, timestamps: false } as const;

export interface AggregateDoc {
	_id: string;
	[key: string]: unknown;
}

/* ------------------------------------------------------------------ suppliers */

const SupplierSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		legalName: { type: String, required: true },
		shortName: { type: String, default: '' },
		kind: { type: String, required: true },
		gstin: { type: String, default: null },
		pan: { type: String, default: null },
		stateCode: { type: String, required: true },
		active: { type: Boolean, default: true },
		deletedAt: { type: String, default: null },
	},
	{ ...loose, collection: COLLECTION_NAMES.Supplier },
);
/** One supplier per GSTIN (a branch in another State has its own GSTIN, so is its own supplier). */
SupplierSchema.index(
	{ gstin: 1 },
	{ unique: true, partialFilterExpression: { gstin: { $type: 'string' }, deletedAt: null } },
);
SupplierSchema.index({ pan: 1 });
SupplierSchema.index({ deletedAt: 1, active: 1, legalName: 1 });

export const SupplierModel: Model<AggregateDoc> =
	(models.Supplier as Model<AggregateDoc>) ?? model<AggregateDoc>('Supplier', SupplierSchema);

/** A supplier's own item code for one of our variants, learnt from the lines staff enter. */
export interface SupplierItemCodeDoc {
	_id: string;
	supplierId: string;
	code: string;
	variantId: string;
	updatedAt: string;
}

const SupplierItemCodeSchema = new Schema<SupplierItemCodeDoc>(
	{
		_id: { type: String, required: true },
		supplierId: { type: String, required: true },
		code: { type: String, required: true },
		variantId: { type: String, required: true },
		updatedAt: { type: String, required: true },
	},
	{ collection: COLLECTION_NAMES.SupplierItemCode, versionKey: false, timestamps: false },
);
SupplierItemCodeSchema.index({ supplierId: 1, code: 1 }, { unique: true });
SupplierItemCodeSchema.index({ supplierId: 1, variantId: 1 });

export const SupplierItemCodeModel: Model<SupplierItemCodeDoc> =
	(models.SupplierItemCode as Model<SupplierItemCodeDoc>) ??
	model<SupplierItemCodeDoc>('SupplierItemCode', SupplierItemCodeSchema);

/* ------------------------------------------------------------------ orders and entries */

const PurchaseOrderSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		number: { type: String, required: true },
		status: { type: String, required: true },
		supplierId: { type: String, required: true },
		expectedBy: { type: String, required: true },
		version: { type: Number, required: true },
		createdAt: { type: String, required: true },
	},
	{ ...loose, collection: COLLECTION_NAMES.PurchaseOrder },
);
PurchaseOrderSchema.index({ number: 1 }, { unique: true });
PurchaseOrderSchema.index({ status: 1, createdAt: -1 });
PurchaseOrderSchema.index({ supplierId: 1, status: 1 });

export const PurchaseOrderModel: Model<AggregateDoc> =
	(models.PurchaseOrder as Model<AggregateDoc>) ?? model<AggregateDoc>('PurchaseOrder', PurchaseOrderSchema);

/**
 * A supplier's bill taken into stock (`purchaseInvoices`; staff call it a purchase entry). Its
 * lines live inside it, so the Schema Nebula `purchaseInvoiceLines` node is folded in here.
 */
const PurchaseInvoiceSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		number: { type: String, default: null },
		status: { type: String, required: true },
		paymentStatus: { type: String, required: true },
		supplierId: { type: String, required: true },
		billNumber: { type: String, required: true },
		billNumberKey: { type: String, required: true },
		billDate: { type: String, required: true },
		dueOn: { type: String, required: true },
		postRequestKey: { type: String, default: null },
		version: { type: Number, required: true },
		createdAt: { type: String, required: true },
		postedAt: { type: String, default: null },
	},
	{ ...loose, collection: COLLECTION_NAMES.PurchaseInvoice },
);
PurchaseInvoiceSchema.index({ number: 1 }, { unique: true, partialFilterExpression: { number: { $type: 'string' } } });
/** The duplicate-bill guard holds even under two simultaneous saves. */
PurchaseInvoiceSchema.index(
	{ supplierId: 1, billNumberKey: 1 },
	{ unique: true, partialFilterExpression: { status: { $in: ['draft', 'checked', 'posted'] } } },
);
PurchaseInvoiceSchema.index(
	{ postRequestKey: 1 },
	{ unique: true, partialFilterExpression: { postRequestKey: { $type: 'string' } } },
);
PurchaseInvoiceSchema.index({ status: 1, createdAt: -1 });
PurchaseInvoiceSchema.index({ status: 1, paymentStatus: 1, dueOn: 1 });
PurchaseInvoiceSchema.index({ 'lines.variantId': 1, postedAt: -1 });
PurchaseInvoiceSchema.index({ supplierId: 1, billDate: -1 });

export const PurchaseInvoiceModel: Model<AggregateDoc> =
	(models.PurchaseInvoice as Model<AggregateDoc>) ?? model<AggregateDoc>('PurchaseInvoice', PurchaseInvoiceSchema);

const SupplierPaymentSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		supplierId: { type: String, required: true },
		purchaseEntryId: { type: String, required: true },
		amountINR: { type: Number, required: true },
		paidOn: { type: String, required: true },
		reversedAt: { type: String, default: null },
	},
	{ ...loose, collection: COLLECTION_NAMES.SupplierPayment },
);
SupplierPaymentSchema.index({ purchaseEntryId: 1 });
SupplierPaymentSchema.index({ supplierId: 1, paidOn: 1 });

export const SupplierPaymentModel: Model<AggregateDoc> =
	(models.SupplierPayment as Model<AggregateDoc>) ?? model<AggregateDoc>('SupplierPayment', SupplierPaymentSchema);

const PurchaseReturnSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		number: { type: String, default: null },
		status: { type: String, required: true },
		kind: { type: String, required: true },
		purchaseEntryId: { type: String, required: true },
		supplierId: { type: String, required: true },
		sendRequestKey: { type: String, default: null },
		version: { type: Number, required: true },
		createdAt: { type: String, required: true },
	},
	{ ...loose, collection: COLLECTION_NAMES.PurchaseReturn },
);
PurchaseReturnSchema.index({ number: 1 }, { unique: true, partialFilterExpression: { number: { $type: 'string' } } });
PurchaseReturnSchema.index(
	{ sendRequestKey: 1 },
	{ unique: true, partialFilterExpression: { sendRequestKey: { $type: 'string' } } },
);
PurchaseReturnSchema.index({ purchaseEntryId: 1 });
PurchaseReturnSchema.index({ supplierId: 1, createdAt: -1 });
PurchaseReturnSchema.index({ status: 1, createdAt: -1 });

export const PurchaseReturnModel: Model<AggregateDoc> =
	(models.PurchaseReturn as Model<AggregateDoc>) ?? model<AggregateDoc>('PurchaseReturn', PurchaseReturnSchema);

/* ------------------------------------------------------------------ stock */

const StockHoldSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		variantId: { type: String, required: true },
		productId: { type: String, required: true },
		quantity: { type: Number, required: true },
		reason: { type: String, required: true },
		status: { type: String, required: true },
		since: { type: String, required: true },
	},
	{ ...loose, collection: COLLECTION_NAMES.StockHold },
);
StockHoldSchema.index({ status: 1, reason: 1, since: 1 });
StockHoldSchema.index({ variantId: 1, status: 1 });

export const StockHoldModel: Model<AggregateDoc> =
	(models.StockHold as Model<AggregateDoc>) ?? model<AggregateDoc>('StockHold', StockHoldSchema);

/** Every manual stock change, applied or waiting for approval (P2): the approvals queue and its record. */
const StockAdjustmentSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		kind: { type: String, required: true },
		status: { type: String, required: true },
		variantId: { type: String, default: null },
		requestedBy: { type: String, default: null },
		requestedAt: { type: String, required: true },
		requestKey: { type: String, default: null },
	},
	{ ...loose, collection: COLLECTION_NAMES.StockAdjustment },
);
StockAdjustmentSchema.index({ status: 1, requestedAt: -1 });
StockAdjustmentSchema.index(
	{ requestKey: 1 },
	{ unique: true, partialFilterExpression: { requestKey: { $type: 'string' } } },
);
StockAdjustmentSchema.index({ variantId: 1, requestedAt: -1 });

export const StockAdjustmentModel: Model<AggregateDoc> =
	(models.StockAdjustment as Model<AggregateDoc>) ?? model<AggregateDoc>('StockAdjustment', StockAdjustmentSchema);

const StockCountSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		number: { type: String, required: true },
		status: { type: String, required: true },
		startedAt: { type: String, required: true },
		version: { type: Number, required: true },
	},
	{ ...loose, collection: COLLECTION_NAMES.StockCount },
);
StockCountSchema.index({ number: 1 }, { unique: true });
StockCountSchema.index({ status: 1, startedAt: -1 });

export const StockCountModel: Model<AggregateDoc> =
	(models.StockCount as Model<AggregateDoc>) ?? model<AggregateDoc>('StockCount', StockCountSchema);

/** A posted opening-stock load: its number, rows and who posted it (o01). */
const OpeningStockSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		number: { type: String, required: true },
		postedAt: { type: String, required: true },
		requestKey: { type: String, required: true },
	},
	{ ...loose, collection: COLLECTION_NAMES.OpeningStock },
);
OpeningStockSchema.index({ number: 1 }, { unique: true });
OpeningStockSchema.index({ requestKey: 1 }, { unique: true });

export const OpeningStockModel: Model<AggregateDoc> =
	(models.OpeningStock as Model<AggregateDoc>) ?? model<AggregateDoc>('OpeningStock', OpeningStockSchema);

/** The purchases-and-stock settings: one document, `_id: 'inventory'`. */
const InventorySettingsSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true } },
	{ ...loose, collection: COLLECTION_NAMES.InventorySettings },
);

export const InventorySettingsModel: Model<AggregateDoc> =
	(models.InventorySettings as Model<AggregateDoc>) ??
	model<AggregateDoc>('InventorySettings', InventorySettingsSchema);

/** One document, `_id: 'shop'`: Settings › Shop details. */
const ShopDetailsSchema = new Schema<AggregateDoc>(
	// `updatedAt` is declared so the stale-save filter keeps it (strict queries drop undeclared paths).
	{ _id: { type: String, required: true }, updatedAt: { type: String, default: null } },
	{ ...loose, collection: COLLECTION_NAMES.ShopDetails },
);

export const ShopDetailsModel: Model<AggregateDoc> =
	(models.ShopDetails as Model<AggregateDoc>) ?? model<AggregateDoc>('ShopDetails', ShopDetailsSchema);

/** Document number counters (`sequences`): `_id` is `{series}:{financialYear}`. */
export interface SequenceDoc {
	_id: string;
	seq: number;
}

const SequenceSchema = new Schema<SequenceDoc>(
	{ _id: { type: String, required: true }, seq: { type: Number, required: true } },
	{ collection: COLLECTION_NAMES.Sequence, versionKey: false, timestamps: false },
);

export const SequenceModel: Model<SequenceDoc> =
	(models.Sequence as Model<SequenceDoc>) ?? model<SequenceDoc>('Sequence', SequenceSchema);
