import {
	PaymentVoucher,
	type PaymentVoucherList,
	type PaymentVoucherListFilter,
	type PaymentVoucherListQuery,
	SelfInvoice,
	type SelfInvoiceList,
	type SelfInvoiceListFilter,
	type SelfInvoiceListQuery,
} from '@saha-textile/contracts';
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
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One page of a list and the count behind every chip, over the same period and search. */
async function listed<F extends string>(
	model: typeof SelfInvoiceModel,
	base: Record<string, unknown>,
	chips: Record<F, Record<string, unknown>>,
	chosen: F,
	paging: { page: number; pageSize: number; sort: Record<string, 1 | -1> },
) {
	const filter = { ...base, ...chips[chosen] };
	const keys = Object.keys(chips) as F[];
	const [docs, total, ...counts] = await Promise.all([
		model
			.find(filter)
			.sort(paging.sort)
			.skip((paging.page - 1) * paging.pageSize)
			.limit(paging.pageSize)
			.lean<AggregateDoc[]>()
			.exec(),
		model.countDocuments(filter).exec(),
		...keys.map((key) => model.countDocuments({ ...base, ...chips[key] }).exec()),
	]);
	return { docs, total, counts: Object.fromEntries(keys.map((key, at) => [key, counts[at]])) as Record<F, number> };
}

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

	async list(query: SelfInvoiceListQuery & { dueSoonFrom: string }): Promise<SelfInvoiceList> {
		const base: Record<string, unknown> = { receivedOn: { $gte: query.from, $lte: query.to } };
		if (query.search) {
			const re = new RegExp(escapeRegex(query.search), 'i');
			base['$or'] = [{ number: re }, { supplierName: re }, { 'rule.name': re }];
		}
		const unpaid = { status: 'issued', $expr: { $lt: ['$paidINR', '$taxableINR'] } };
		const chips: Record<SelfInvoiceListFilter, Record<string, unknown>> = {
			all: {},
			drafts: { status: 'draft' },
			// Still inside the 30 days, and inside the period (the chip's own day range replaces the period's).
			due_soon: {
				status: 'draft',
				receivedOn: { $gte: query.dueSoonFrom > query.from ? query.dueSoonFrom : query.from, $lte: query.to },
			},
			unpaid,
			paid: { status: 'issued', $expr: { $gte: ['$paidINR', '$taxableINR'] } },
		};
		const { docs, total, counts } = await listed(SelfInvoiceModel, base, chips, query.filter, {
			page: query.page,
			pageSize: query.pageSize,
			sort: { receivedOn: -1, createdAt: -1 },
		});
		return { items: docs.map(selfInvoiceOf), total, counts };
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

	async cancel(voucher: PaymentVoucher, context?: TransactionContext): Promise<void> {
		const { id, ...rest } = voucher;
		const result = await PaymentVoucherModel.replaceOne({ _id: id, status: { $ne: 'cancelled' } }, rest, {
			session: sessionFrom(context),
		}).exec();
		if (result.matchedCount !== 1) throw new Error('payment_voucher_changed');
	}

	async list(query: PaymentVoucherListQuery): Promise<PaymentVoucherList> {
		const base: Record<string, unknown> = { date: { $gte: query.from, $lte: query.to } };
		if (query.search) {
			const re = new RegExp(escapeRegex(query.search), 'i');
			base['$or'] = [{ number: re }, { payeeName: re }, { 'against.number': re }, { reference: re }];
		}
		const chips: Record<PaymentVoucherListFilter, Record<string, unknown>> = {
			all: {},
			reverse_charge: { 'against.kind': 'selfInvoice' },
			supplier_bills: { 'against.kind': 'purchaseEntry' },
			cancelled: { status: 'cancelled' },
		};
		const { docs, total, counts } = await listed(PaymentVoucherModel, base, chips, query.filter, {
			page: query.page,
			pageSize: query.pageSize,
			sort: { date: -1, number: -1 },
		});
		return { items: docs.map(paymentVoucherOf), total, counts };
	}

	async forDocument(kind: PaymentVoucher['against']['kind'], id: string): Promise<PaymentVoucher[]> {
		const docs = await PaymentVoucherModel.find({ 'against.kind': kind, 'against.id': id })
			.sort({ createdAt: 1 })
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map(paymentVoucherOf);
	}
}
