import {
	AccountGroup,
	type ChartOfAccounts,
	DocumentLock,
	JournalVoucher,
	Ledger,
	PeriodLock,
	VoucherDraft,
	type VoucherKind,
} from '@saha-textile/contracts';
import {
	type DocumentLockRepository,
	type GeneralLedgerRepository,
	type PeriodLockRepository,
	StaleRevisionError,
	type StatementLine,
	type TransactionContext,
} from '@saha-textile/core-domain';

import {
	AccountGroupModel,
	DocumentLockModel,
	JournalLineModel,
	JournalVoucherModel,
	LedgerModel,
	PeriodLockModel,
	VoucherDraftModel,
} from '../models/ledger.model';
import type { AggregateDoc } from '../models/purchasing.model';
import { sessionFrom } from '../transaction-manager';

const strip = (doc: AggregateDoc): Record<string, unknown> => {
	const { _id, ...rest } = doc;
	void _id;
	return rest;
};
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const voucherOf = (doc: AggregateDoc): JournalVoucher => JournalVoucher.parse({ ...strip(doc), id: doc._id });
const locationFilter = (ids: readonly string[]) => (ids.length ? { locationId: { $in: [...ids] } } : {});

/**
 * The general ledger in Mongo (accounts brief Q, T). A voucher and its line rows are written in the caller's
 * session, so a document and its posting commit together; posted rows are never updated except the reversal link.
 */
export class MongoGeneralLedgerRepository implements GeneralLedgerRepository {
	async chart(): Promise<ChartOfAccounts> {
		const [groups, ledgers] = await Promise.all([
			AccountGroupModel.find({}).sort({ order: 1, name: 1 }).lean<AggregateDoc[]>().exec(),
			LedgerModel.find({}).sort({ name: 1 }).lean<AggregateDoc[]>().exec(),
		]);
		return {
			groups: groups.map((doc) => AccountGroup.parse({ ...strip(doc), id: doc._id })),
			ledgers: ledgers.map((doc) => Ledger.parse({ ...strip(doc), id: doc._id })),
		};
	}

	async seedChart(chart: ChartOfAccounts): Promise<boolean> {
		if (await AccountGroupModel.exists({}).exec()) return false;
		try {
			await AccountGroupModel.insertMany(
				chart.groups.map(({ id, ...rest }) => ({ _id: id, ...rest })),
				{ ordered: true },
			);
			await LedgerModel.insertMany(
				chart.ledgers.map(({ id, ...rest }) => ({ _id: id, ...rest })),
				{ ordered: true },
			);
			return true;
		} catch (error) {
			// Another request seeded first (unique system keys): theirs stands.
			if ((error as { code?: number }).code === 11000) return false;
			throw error;
		}
	}

	async saveGroup(group: AccountGroup): Promise<void> {
		const { id, ...rest } = group;
		await AccountGroupModel.replaceOne({ _id: id }, rest, { upsert: true }).exec();
	}

	async saveLedger(ledger: Ledger, expectedUpdatedAt: string | null): Promise<void> {
		const { id, ...rest } = ledger;
		if (expectedUpdatedAt === null) {
			try {
				await LedgerModel.create({ _id: id, ...rest });
				return;
			} catch (error) {
				if ((error as { code?: number }).code === 11000) throw new StaleRevisionError('ledger', id);
				throw error;
			}
		}
		const result = await LedgerModel.replaceOne({ _id: id, updatedAt: expectedUpdatedAt }, rest).exec();
		if (result.matchedCount !== 1) {
			const now = await LedgerModel.findById(id).lean<AggregateDoc>().exec();
			throw new StaleRevisionError(
				'ledger',
				id,
				(now?.['updatedBy'] as string | null | undefined) ?? null,
				(now?.['updatedAt'] as string | null | undefined) ?? null,
			);
		}
	}

	async findVoucherByKey(idempotencyKey: string, context?: TransactionContext): Promise<JournalVoucher | null> {
		const doc = await JournalVoucherModel.findOne({ idempotencyKey })
			.session(sessionFrom(context) ?? null)
			.lean<AggregateDoc>()
			.exec();
		return doc ? voucherOf(doc) : null;
	}

	async insertVoucher(voucher: JournalVoucher, context?: TransactionContext): Promise<void> {
		const session = sessionFrom(context);
		const { id, ...rest } = voucher;
		try {
			await JournalVoucherModel.create([{ _id: id, ...rest }], { session });
		} catch (error) {
			if ((error as { code?: number }).code === 11000) throw new Error('duplicate_voucher_key', { cause: error });
			throw error;
		}
		await JournalLineModel.insertMany(
			voucher.lines.map((line, index) => ({
				_id: `${id}:${index}`,
				voucherId: id,
				number: voucher.number,
				kind: voucher.kind,
				date: voucher.date,
				voucherNarration: voucher.narration,
				...line,
			})),
			{ session, ordered: true },
		);
	}

	async markReversed(voucherId: string, reversedById: string, context?: TransactionContext): Promise<void> {
		const result = await JournalVoucherModel.updateOne(
			{ _id: voucherId, reversedById: null },
			{ $set: { reversedById } },
			{ session: sessionFrom(context) },
		).exec();
		if (result.matchedCount !== 1) throw new Error('already_reversed');
	}

	async getVoucher(id: string): Promise<JournalVoucher | null> {
		const doc = await JournalVoucherModel.findById(id).lean<AggregateDoc>().exec();
		return doc ? voucherOf(doc) : null;
	}

	async listVouchers(query: {
		from: string;
		to: string;
		kinds: readonly VoucherKind[];
		search: string;
		page: number;
		pageSize: number;
	}): Promise<{ items: JournalVoucher[]; total: number }> {
		const filter: Record<string, unknown> = { date: { $gte: query.from, $lte: query.to } };
		if (query.kinds.length) filter['kind'] = { $in: [...query.kinds] };
		if (query.search.trim()) {
			const re = new RegExp(escapeRegex(query.search.trim()), 'i');
			filter['$or'] = [{ number: re }, { narration: re }, { 'source.number': re }];
		}
		const [docs, total] = await Promise.all([
			JournalVoucherModel.find(filter)
				.sort({ date: -1, number: -1 })
				.skip((query.page - 1) * query.pageSize)
				.limit(query.pageSize)
				.lean<AggregateDoc[]>()
				.exec(),
			JournalVoucherModel.countDocuments(filter).exec(),
		]);
		return { items: docs.map(voucherOf), total };
	}

	async balanceBefore(ledgerId: string, day: string, locationIds: readonly string[]): Promise<number> {
		const [row] = await JournalLineModel.aggregate<{ debit: number; credit: number }>([
			{ $match: { ledgerId, date: { $lt: day }, ...locationFilter(locationIds) } },
			{ $group: { _id: null, debit: { $sum: '$debitPaise' }, credit: { $sum: '$creditPaise' } } },
		]).exec();
		return row ? row.debit - row.credit : 0;
	}

	async statementLines(
		ledgerId: string,
		from: string,
		to: string,
		locationIds: readonly string[],
	): Promise<StatementLine[]> {
		const docs = await JournalLineModel.find({
			ledgerId,
			date: { $gte: from, $lte: to },
			...locationFilter(locationIds),
		})
			.sort({ date: 1, number: 1 })
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map((doc) => ({
			voucherId: String(doc['voucherId']),
			number: String(doc['number']),
			kind: doc['kind'] as VoucherKind,
			date: String(doc['date']),
			narration: String(doc['narration'] || doc['voucherNarration'] || ''),
			locationId: String(doc['locationId']),
			debitPaise: Number(doc['debitPaise'] ?? 0),
			creditPaise: Number(doc['creditPaise'] ?? 0),
		}));
	}

	async balancesAt(day: string, locationIds: readonly string[]): Promise<Record<string, number>> {
		const rows = await JournalLineModel.aggregate<{ _id: string; debit: number; credit: number }>([
			{ $match: { date: { $lte: day }, ...locationFilter(locationIds) } },
			{ $group: { _id: '$ledgerId', debit: { $sum: '$debitPaise' }, credit: { $sum: '$creditPaise' } } },
		]).exec();
		return Object.fromEntries(rows.map((row) => [row._id, row.debit - row.credit]));
	}

	async dueReversals(day: string): Promise<JournalVoucher[]> {
		const docs = await JournalVoucherModel.find({ reverseOn: { $type: 'string', $lte: day }, reversedById: null })
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map(voucherOf);
	}

	async ledgerInUse(ledgerId: string): Promise<boolean> {
		return !!(await JournalLineModel.exists({ ledgerId }).exec());
	}

	async listDrafts(): Promise<VoucherDraft[]> {
		const docs = await VoucherDraftModel.find({}).sort({ updatedAt: -1 }).limit(500).lean<AggregateDoc[]>().exec();
		return docs.map((doc) => VoucherDraft.parse({ ...strip(doc), id: doc._id }));
	}

	async getDraft(id: string): Promise<VoucherDraft | null> {
		const doc = await VoucherDraftModel.findById(id).lean<AggregateDoc>().exec();
		return doc ? VoucherDraft.parse({ ...strip(doc), id: doc._id }) : null;
	}

	async saveDraft(draft: VoucherDraft, expectedUpdatedAt: string | null): Promise<void> {
		const { id, ...rest } = draft;
		if (expectedUpdatedAt === null) {
			await VoucherDraftModel.create({ _id: id, ...rest });
			return;
		}
		const result = await VoucherDraftModel.replaceOne({ _id: id, updatedAt: expectedUpdatedAt }, rest).exec();
		if (result.matchedCount !== 1) throw new StaleRevisionError('voucherDraft', id);
	}

	async deleteDraft(id: string, context?: TransactionContext): Promise<void> {
		await VoucherDraftModel.deleteOne({ _id: id }, { session: sessionFrom(context) }).exec();
	}
}

/** Month locks per part of the books (T1, T2). */
export class MongoPeriodLockRepository implements PeriodLockRepository {
	async list(): Promise<PeriodLock[]> {
		const docs = await PeriodLockModel.find({}).sort({ month: 1, part: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map((doc) => PeriodLock.parse(strip(doc)));
	}

	async save(locks: readonly PeriodLock[]): Promise<void> {
		if (!locks.length) return;
		await PeriodLockModel.bulkWrite(
			locks.map((lock) => ({
				replaceOne: {
					filter: { _id: `${lock.month}:${lock.part}` },
					replacement: { _id: `${lock.month}:${lock.part}`, ...lock },
					upsert: true,
				},
			})),
		);
	}
}

/** Who is editing a document (D10). */
export class MongoDocumentLockRepository implements DocumentLockRepository {
	private key = (type: string, id: string) => `${type}:${id}`;

	async get(documentType: string, documentId: string): Promise<DocumentLock | null> {
		const doc = await DocumentLockModel.findById(this.key(documentType, documentId)).lean<AggregateDoc>().exec();
		return doc ? DocumentLock.parse(strip(doc)) : null;
	}

	async acquire(lock: DocumentLock, staleBefore: string): Promise<DocumentLock> {
		const _id = this.key(lock.documentType, lock.documentId);
		try {
			const doc = await DocumentLockModel.findOneAndUpdate(
				{ _id, $or: [{ holderId: lock.holderId }, { lastActiveAt: { $lt: staleBefore } }] },
				{ $set: lock },
				{ upsert: true, new: true },
			)
				.lean<AggregateDoc>()
				.exec();
			if (doc) return DocumentLock.parse(strip(doc));
		} catch (error) {
			// The upsert lost to a live lock held by someone else.
			if ((error as { code?: number }).code !== 11000) throw error;
		}
		const current = await this.get(lock.documentType, lock.documentId);
		if (!current) throw new Error('document_lock_unavailable');
		return current;
	}

	async takeOver(lock: DocumentLock): Promise<DocumentLock> {
		const _id = this.key(lock.documentType, lock.documentId);
		await DocumentLockModel.replaceOne({ _id }, { _id, ...lock }, { upsert: true }).exec();
		return lock;
	}

	async touch(documentType: string, documentId: string, holderId: string, at: string): Promise<boolean> {
		const result = await DocumentLockModel.updateOne(
			{ _id: this.key(documentType, documentId), holderId },
			{ $set: { lastActiveAt: at } },
		).exec();
		return result.matchedCount === 1;
	}

	async release(documentType: string, documentId: string, holderId: string): Promise<void> {
		await DocumentLockModel.deleteOne({ _id: this.key(documentType, documentId), holderId }).exec();
	}
}
