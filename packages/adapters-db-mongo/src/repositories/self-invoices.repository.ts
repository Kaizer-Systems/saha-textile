import { PaymentVoucher, SelfInvoice } from '@saha-textile/contracts';
import type { PaymentVoucherRepository, SelfInvoiceRepository, TransactionContext } from '@saha-textile/core-domain';

import type { AggregateDoc } from '../models/purchasing.model';
import { PaymentVoucherModel, SelfInvoiceModel } from '../models/self-invoices.model';
import { sessionFrom } from '../transaction-manager';

const strip = (doc: AggregateDoc): Record<string, unknown> => {
	const { _id, ...rest } = doc;
	void _id;
	return rest;
};
const duplicate = (error: unknown, code: string): never => {
	if ((error as { code?: number }).code === 11000) throw new Error(code, { cause: error });
	throw error;
};
const selfInvoiceOf = (doc: AggregateDoc): SelfInvoice => SelfInvoice.parse({ ...strip(doc), id: doc._id });
const paymentVoucherOf = (doc: AggregateDoc): PaymentVoucher => PaymentVoucher.parse({ ...strip(doc), id: doc._id });

/** Self-invoices (accounts brief D2, D3). */
export class MongoSelfInvoiceRepository implements SelfInvoiceRepository {
	async get(id: string, context?: TransactionContext): Promise<SelfInvoice | null> {
		const doc = await SelfInvoiceModel.findById(id)
			.session(sessionFrom(context) ?? null)
			.lean<AggregateDoc>()
			.exec();
		return doc ? selfInvoiceOf(doc) : null;
	}

	async insert(invoice: SelfInvoice, context?: TransactionContext): Promise<void> {
		const { id, ...rest } = invoice;
		await SelfInvoiceModel.create([{ _id: id, ...rest }], { session: sessionFrom(context) }).catch((error) =>
			duplicate(error, 'duplicate_self_invoice'),
		);
	}

	async save(invoice: SelfInvoice, expectedVersion: number, context?: TransactionContext): Promise<SelfInvoice> {
		const next = { ...invoice, version: expectedVersion + 1 };
		const { id, ...rest } = next;
		const result = await SelfInvoiceModel.replaceOne(
			{ _id: id, version: expectedVersion },
			{ _id: id, ...rest },
			{ session: sessionFrom(context) },
		)
			.exec()
			.catch((error) => duplicate(error, 'duplicate_self_invoice'));
		if (result.matchedCount !== 1) throw new Error('self_invoice_changed');
		return next;
	}

	async removeDraft(id: string): Promise<boolean> {
		const result = await SelfInvoiceModel.deleteOne({ _id: id, status: 'draft' }).exec();
		return result.deletedCount === 1;
	}

	async forSupplier(supplierId: string): Promise<SelfInvoice[]> {
		const docs = await SelfInvoiceModel.find({ supplierId }).sort({ createdAt: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map(selfInvoiceOf);
	}
}

/** Payment vouchers (decision D5). */
export class MongoPaymentVoucherRepository implements PaymentVoucherRepository {
	async get(id: string, context?: TransactionContext): Promise<PaymentVoucher | null> {
		const doc = await PaymentVoucherModel.findById(id)
			.session(sessionFrom(context) ?? null)
			.lean<AggregateDoc>()
			.exec();
		return doc ? paymentVoucherOf(doc) : null;
	}

	async insert(voucher: PaymentVoucher, context?: TransactionContext): Promise<void> {
		const { id, ...rest } = voucher;
		await PaymentVoucherModel.create([{ _id: id, ...rest }], { session: sessionFrom(context) }).catch((error) =>
			duplicate(error, 'duplicate_payment_voucher'),
		);
	}

	async forDocument(kind: PaymentVoucher['against']['kind'], id: string): Promise<PaymentVoucher[]> {
		const docs = await PaymentVoucherModel.find({ 'against.kind': kind, 'against.id': id })
			.sort({ createdAt: 1 })
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map(paymentVoucherOf);
	}
}
