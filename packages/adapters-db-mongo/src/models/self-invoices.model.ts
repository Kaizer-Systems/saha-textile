import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';
import type { AggregateDoc } from './purchasing.model';

const loose = { strict: false, strictQuery: false, versionKey: false, timestamps: false } as const;

/** Self-invoices (accounts brief D2, D3): an SI number is unique once issued; drafts have none. */
const SelfInvoiceSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true }, supplierId: { type: String, required: true } },
	{ ...loose, collection: COLLECTION_NAMES.SelfInvoice },
);
SelfInvoiceSchema.index({ number: 1 }, { unique: true, partialFilterExpression: { number: { $type: 'string' } } });
SelfInvoiceSchema.index({ supplierId: 1, createdAt: 1 });
export const SelfInvoiceModel: Model<AggregateDoc> =
	(models.SelfInvoice as Model<AggregateDoc>) ?? model<AggregateDoc>('SelfInvoice', SelfInvoiceSchema);

/** Payment vouchers (decision D5): one per payment, PV numbers unique. */
const PaymentVoucherSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true }, number: { type: String, required: true } },
	{ ...loose, collection: COLLECTION_NAMES.PaymentVoucher },
);
PaymentVoucherSchema.index({ number: 1 }, { unique: true });
PaymentVoucherSchema.index(
	{ supplierPaymentId: 1 },
	{ unique: true, partialFilterExpression: { supplierPaymentId: { $type: 'string' } } },
);
PaymentVoucherSchema.index({ 'against.kind': 1, 'against.id': 1 });
export const PaymentVoucherModel: Model<AggregateDoc> =
	(models.PaymentVoucher as Model<AggregateDoc>) ?? model<AggregateDoc>('PaymentVoucher', PaymentVoucherSchema);
