import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';
import type { AggregateDoc } from './purchasing.model';

// strictQuery off: filters name fields these loose schemas don't declare (reverseOn, holderId…), which Mongoose
// would otherwise drop from the query and match every row.
const loose = { strict: false, strictQuery: false, versionKey: false, timestamps: false } as const;

/** The chart's groups (accounts brief Q1); `_id` is the group id. */
const AccountGroupSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true }, systemKey: { type: String, default: null } },
	{ ...loose, collection: COLLECTION_NAMES.AccountGroup },
);
AccountGroupSchema.index(
	{ systemKey: 1 },
	{ unique: true, partialFilterExpression: { systemKey: { $type: 'string' } } },
);
export const AccountGroupModel: Model<AggregateDoc> =
	(models.AccountGroup as Model<AggregateDoc>) ?? model<AggregateDoc>('AccountGroup', AccountGroupSchema);

/** Ledgers; posting rules find system ledgers by `systemKey`. */
const LedgerSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		systemKey: { type: String, default: null },
		groupId: { type: String, required: true },
		updatedAt: { type: String, default: null },
	},
	{ ...loose, collection: COLLECTION_NAMES.Ledger },
);
LedgerSchema.index({ systemKey: 1 }, { unique: true, partialFilterExpression: { systemKey: { $type: 'string' } } });
export const LedgerModel: Model<AggregateDoc> =
	(models.Ledger as Model<AggregateDoc>) ?? model<AggregateDoc>('Ledger', LedgerSchema);

/** Posted vouchers (Q3, Q4 and every document's posting); a repeated idempotency key is refused by the index. */
const JournalVoucherSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		number: { type: String, required: true },
		date: { type: String, required: true },
		kind: { type: String, required: true },
		idempotencyKey: { type: String, default: null },
	},
	{ ...loose, collection: COLLECTION_NAMES.JournalVoucher },
);
JournalVoucherSchema.index(
	{ idempotencyKey: 1 },
	{ unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
JournalVoucherSchema.index({ date: -1, number: -1 });
JournalVoucherSchema.index({ reverseOn: 1, reversedById: 1 });
JournalVoucherSchema.index({ 'source.type': 1, 'source.id': 1 });
export const JournalVoucherModel: Model<AggregateDoc> =
	(models.JournalVoucher as Model<AggregateDoc>) ?? model<AggregateDoc>('JournalVoucher', JournalVoucherSchema);

/** One row per voucher line, so ledgers, locations and GSTINs read fast on a large set of books. */
const JournalLineSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		voucherId: { type: String, required: true },
		ledgerId: { type: String, required: true },
		locationId: { type: String, required: true },
		date: { type: String, required: true },
	},
	{ ...loose, collection: COLLECTION_NAMES.JournalLine },
);
JournalLineSchema.index({ ledgerId: 1, date: 1 });
JournalLineSchema.index({ gstRegistrationId: 1, date: 1 });
JournalLineSchema.index({ locationId: 1, date: 1 });
JournalLineSchema.index({ voucherId: 1 });
export const JournalLineModel: Model<AggregateDoc> =
	(models.JournalLine as Model<AggregateDoc>) ?? model<AggregateDoc>('JournalLine', JournalLineSchema);

/** One row per month and part of the books (T1); `_id` is `<month>:<part>`. */
const PeriodLockSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true } },
	{ ...loose, collection: COLLECTION_NAMES.PeriodLock },
);
export const PeriodLockModel: Model<AggregateDoc> =
	(models.PeriodLock as Model<AggregateDoc>) ?? model<AggregateDoc>('PeriodLock', PeriodLockSchema);

/** Who is editing which document (D10); `_id` is `<type>:<id>`. */
const DocumentLockSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true }, lastActiveAt: { type: String, required: true } },
	{ ...loose, collection: COLLECTION_NAMES.DocumentLock },
);
export const DocumentLockModel: Model<AggregateDoc> =
	(models.DocumentLock as Model<AggregateDoc>) ?? model<AggregateDoc>('DocumentLock', DocumentLockSchema);

/** Q3 drafts: vouchers saved before Post, with no number. */
const VoucherDraftSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true }, updatedAt: { type: String, required: true } },
	{ ...loose, collection: COLLECTION_NAMES.VoucherDraft },
);
VoucherDraftSchema.index({ updatedAt: -1 });
export const VoucherDraftModel: Model<AggregateDoc> =
	(models.VoucherDraft as Model<AggregateDoc>) ?? model<AggregateDoc>('VoucherDraft', VoucherDraftSchema);

/** G8: returns marked filed; `_id` is `<gstRegistrationId>:<returnType>:<month>`. */
const GstReturnSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true } },
	{ ...loose, collection: COLLECTION_NAMES.GstReturn },
);
export const GstReturnModel: Model<AggregateDoc> =
	(models.GstReturn as Model<AggregateDoc>) ?? model<AggregateDoc>('GstReturn', GstReturnSchema);

/** Tax invoices (accounts brief D1); a number is unique within its GSTIN, and a shipment has one invoice. */
const TaxInvoiceSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		number: { type: String, required: true },
		gstin: { type: String, required: true },
	},
	{ ...loose, collection: COLLECTION_NAMES.TaxInvoice },
);
TaxInvoiceSchema.index({ gstin: 1, number: 1 }, { unique: true });
TaxInvoiceSchema.index(
	{ shipmentId: 1 },
	{ unique: true, partialFilterExpression: { shipmentId: { $type: 'string' } } },
);
TaxInvoiceSchema.index({ orderId: 1 });
TaxInvoiceSchema.index({ date: -1, number: -1 });
export const TaxInvoiceModel: Model<AggregateDoc> =
	(models.TaxInvoice as Model<AggregateDoc>) ?? model<AggregateDoc>('TaxInvoice', TaxInvoiceSchema);
