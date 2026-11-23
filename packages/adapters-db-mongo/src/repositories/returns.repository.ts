import { CreditNote, DebitNote, OrderReturn, RefundVoucher } from '@saha-textile/contracts';
import type {
	CreditNoteListQuery,
	CreditNoteRepository,
	DebitNoteRepository,
	OrderReturnRepository,
	RefundVoucherListQuery,
	RefundVoucherRepository,
	TransactionContext,
} from '@saha-textile/core-domain';

import type { AggregateDoc } from '../models/purchasing.model';
import { CreditNoteModel, DebitNoteModel, OrderReturnModel, RefundVoucherModel } from '../models/returns.model';
import { sessionFrom } from '../transaction-manager';

const strip = (doc: AggregateDoc): Record<string, unknown> => {
	const { _id, ...rest } = doc;
	void _id;
	return rest;
};
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const duplicate = (error: unknown, code: string): never => {
	if ((error as { code?: number }).code === 11000) throw new Error(code, { cause: error });
	throw error;
};

const returnOf = (doc: AggregateDoc): OrderReturn => OrderReturn.parse({ ...strip(doc), id: doc._id });
const creditNoteOf = (doc: AggregateDoc): CreditNote => CreditNote.parse({ ...strip(doc), id: doc._id });
const debitNoteOf = (doc: AggregateDoc): DebitNote => DebitNote.parse({ ...strip(doc), id: doc._id });
const refundVoucherOf = (doc: AggregateDoc): RefundVoucher => RefundVoucher.parse({ ...strip(doc), id: doc._id });

export class MongoOrderReturnRepository implements OrderReturnRepository {
	async insert(entry: OrderReturn, context?: TransactionContext): Promise<void> {
		const { id, ...rest } = entry;
		await OrderReturnModel.create([{ _id: id, ...rest }], { session: sessionFrom(context) }).catch((error) =>
			duplicate(error, 'duplicate_return'),
		);
	}

	async get(id: string, context?: TransactionContext): Promise<OrderReturn | null> {
		const doc = await OrderReturnModel.findById(id)
			.session(sessionFrom(context) ?? null)
			.lean<AggregateDoc>()
			.exec();
		return doc ? returnOf(doc) : null;
	}

	async listForOrder(orderId: string): Promise<OrderReturn[]> {
		const docs = await OrderReturnModel.find({ orderId }).sort({ createdAt: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map(returnOf);
	}

	async save(entry: OrderReturn, expectedUpdatedAt: string, context?: TransactionContext): Promise<void> {
		const { id, ...rest } = entry;
		const result = await OrderReturnModel.replaceOne(
			{ _id: id, updatedAt: expectedUpdatedAt },
			{ _id: id, ...rest },
			{
				session: sessionFrom(context),
			},
		).exec();
		if (result.matchedCount !== 1) throw new Error('return_changed');
	}
}

export class MongoCreditNoteRepository implements CreditNoteRepository {
	async insert(note: CreditNote, context?: TransactionContext): Promise<void> {
		const { id, ...rest } = note;
		await CreditNoteModel.create([{ _id: id, ...rest }], { session: sessionFrom(context) }).catch((error) =>
			duplicate(error, 'duplicate_credit_note'),
		);
	}

	async get(id: string, context?: TransactionContext): Promise<CreditNote | null> {
		const doc = await CreditNoteModel.findById(id)
			.session(sessionFrom(context) ?? null)
			.lean<AggregateDoc>()
			.exec();
		return doc ? creditNoteOf(doc) : null;
	}

	async listForOrder(orderId: string): Promise<CreditNote[]> {
		const docs = await CreditNoteModel.find({ orderId }).sort({ createdAt: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map(creditNoteOf);
	}

	async listForInvoice(invoiceId: string, context?: TransactionContext): Promise<CreditNote[]> {
		const docs = await CreditNoteModel.find({ invoiceId })
			.session(sessionFrom(context) ?? null)
			.sort({ createdAt: 1 })
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map(creditNoteOf);
	}

	async list(query: CreditNoteListQuery): Promise<{ items: CreditNote[]; total: number }> {
		const filter: Record<string, unknown> = { date: { $gte: query.from, $lte: query.to } };
		if (query.status) filter['status'] = query.status;
		if (query.search.trim()) {
			const re = new RegExp(escapeRegex(query.search.trim()), 'i');
			filter['$or'] = [{ number: re }, { invoiceNumber: re }, { orderNumber: re }, { 'buyer.name': re }];
		}
		const [docs, total] = await Promise.all([
			CreditNoteModel.find(filter)
				.sort({ date: -1, createdAt: -1 })
				.skip((query.page - 1) * query.pageSize)
				.limit(query.pageSize)
				.lean<AggregateDoc[]>()
				.exec(),
			CreditNoteModel.countDocuments(filter).exec(),
		]);
		return { items: docs.map(creditNoteOf), total };
	}

	async save(note: CreditNote, expectedVersion: number, context?: TransactionContext): Promise<CreditNote> {
		const next = { ...note, version: expectedVersion + 1 };
		const { id, ...rest } = next;
		try {
			const result = await CreditNoteModel.replaceOne(
				{ _id: id, version: expectedVersion },
				{ _id: id, ...rest },
				{
					session: sessionFrom(context),
				},
			).exec();
			if (result.matchedCount !== 1) throw new Error('credit_note_changed');
		} catch (error) {
			duplicate(error, 'duplicate_credit_note');
		}
		return next;
	}

	async deleteDraft(id: string): Promise<void> {
		const result = await CreditNoteModel.deleteOne({ _id: id, status: 'draft' }).exec();
		if (result.deletedCount !== 1) throw new Error('credit_note_not_draft');
	}
}

export class MongoDebitNoteRepository implements DebitNoteRepository {
	async insert(note: DebitNote, context?: TransactionContext): Promise<void> {
		const { id, ...rest } = note;
		await DebitNoteModel.create([{ _id: id, ...rest }], { session: sessionFrom(context) }).catch((error) =>
			duplicate(error, 'duplicate_debit_note'),
		);
	}

	async get(id: string): Promise<DebitNote | null> {
		const doc = await DebitNoteModel.findById(id).lean<AggregateDoc>().exec();
		return doc ? debitNoteOf(doc) : null;
	}

	async listForOrder(orderId: string): Promise<DebitNote[]> {
		const docs = await DebitNoteModel.find({ orderId }).sort({ createdAt: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map(debitNoteOf);
	}
}

export class MongoRefundVoucherRepository implements RefundVoucherRepository {
	async insert(voucher: RefundVoucher, context?: TransactionContext): Promise<void> {
		const { id, ...rest } = voucher;
		await RefundVoucherModel.create([{ _id: id, ...rest }], { session: sessionFrom(context) }).catch((error) =>
			duplicate(error, 'duplicate_refund_voucher'),
		);
	}

	async get(id: string, context?: TransactionContext): Promise<RefundVoucher | null> {
		const doc = await RefundVoucherModel.findById(id)
			.session(sessionFrom(context) ?? null)
			.lean<AggregateDoc>()
			.exec();
		return doc ? refundVoucherOf(doc) : null;
	}

	async listForOrder(orderId: string): Promise<RefundVoucher[]> {
		const docs = await RefundVoucherModel.find({ orderId }).sort({ createdAt: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map(refundVoucherOf);
	}

	async list(query: RefundVoucherListQuery): Promise<{ items: RefundVoucher[]; total: number }> {
		const filter: Record<string, unknown> = { date: { $gte: query.from, $lte: query.to } };
		if (query.status) filter['status'] = query.status;
		if (query.search.trim()) {
			const re = new RegExp(escapeRegex(query.search.trim()), 'i');
			filter['$or'] = [{ number: re }, { receiptNumber: re }, { orderNumber: re }, { payee: re }];
		}
		const [docs, total] = await Promise.all([
			RefundVoucherModel.find(filter)
				.sort({ date: -1, number: -1 })
				.skip((query.page - 1) * query.pageSize)
				.limit(query.pageSize)
				.lean<AggregateDoc[]>()
				.exec(),
			RefundVoucherModel.countDocuments(filter).exec(),
		]);
		return { items: docs.map(refundVoucherOf), total };
	}

	async save(voucher: RefundVoucher, expectedUpdatedAt: string, context?: TransactionContext): Promise<void> {
		const { id, ...rest } = voucher;
		const result = await RefundVoucherModel.replaceOne(
			{ _id: id, updatedAt: expectedUpdatedAt },
			{ _id: id, ...rest },
			{ session: sessionFrom(context) },
		).exec();
		if (result.matchedCount !== 1) throw new Error('refund_voucher_changed');
	}
}
