import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';
import type { AggregateDoc } from './purchasing.model';

const loose = { strict: false, strictQuery: false, versionKey: false, timestamps: false } as const;

/** Returns (accounts brief B2, B3); `_id` is the return id. */
const OrderReturnSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true }, orderId: { type: String, required: true } },
	{ ...loose, collection: COLLECTION_NAMES.OrderReturn },
);
OrderReturnSchema.index({ orderId: 1 });
OrderReturnSchema.index({ number: 1 }, { unique: true });
export const OrderReturnModel: Model<AggregateDoc> =
	(models.OrderReturn as Model<AggregateDoc>) ?? model<AggregateDoc>('OrderReturn', OrderReturnSchema);

/** Credit notes (B4–B11): a number is unique within its GSTIN once issued; drafts have none. */
const CreditNoteSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true }, gstin: { type: String, required: true } },
	{ ...loose, collection: COLLECTION_NAMES.CreditNote },
);
CreditNoteSchema.index(
	{ gstin: 1, number: 1 },
	{ unique: true, partialFilterExpression: { number: { $type: 'string' } } },
);
CreditNoteSchema.index({ orderId: 1 });
CreditNoteSchema.index({ invoiceId: 1 });
CreditNoteSchema.index({ date: -1 });
export const CreditNoteModel: Model<AggregateDoc> =
	(models.CreditNote as Model<AggregateDoc>) ?? model<AggregateDoc>('CreditNote', CreditNoteSchema);

/** Debit notes (B5, B9). */
const DebitNoteSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true }, gstin: { type: String, required: true } },
	{ ...loose, collection: COLLECTION_NAMES.DebitNote },
);
DebitNoteSchema.index({ gstin: 1, number: 1 }, { unique: true });
DebitNoteSchema.index({ orderId: 1 });
export const DebitNoteModel: Model<AggregateDoc> =
	(models.DebitNote as Model<AggregateDoc>) ?? model<AggregateDoc>('DebitNote', DebitNoteSchema);

/** Refund vouchers (C, Rule 51): one per refunded payment; RF numbers are unique. */
const RefundVoucherSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true }, paymentId: { type: String, required: true } },
	{ ...loose, collection: COLLECTION_NAMES.RefundVoucher },
);
RefundVoucherSchema.index({ number: 1 }, { unique: true });
RefundVoucherSchema.index({ paymentId: 1 }, { unique: true });
RefundVoucherSchema.index({ orderId: 1 });
RefundVoucherSchema.index({ date: -1 });
export const RefundVoucherModel: Model<AggregateDoc> =
	(models.RefundVoucher as Model<AggregateDoc>) ?? model<AggregateDoc>('RefundVoucher', RefundVoucherSchema);
