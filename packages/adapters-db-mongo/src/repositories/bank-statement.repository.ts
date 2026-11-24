import { BankLayout, BankLine, type BankImport, type BankLineQuery } from '@saha-textile/contracts';
import type { BankStatementRepository, TransactionContext } from '@saha-textile/core-domain';

import { BankImportModel, BankLayoutModel, BankLineModel } from '../models/bank.model';
import type { AggregateDoc } from '../models/purchasing.model';
import { sessionFrom } from '../transaction-manager';

const withId = (doc: AggregateDoc) => {
	const { _id, ...rest } = doc;
	return { ...rest, id: _id };
};
const docOf = <T extends { id: string }>(value: T) => {
	const { id, ...rest } = value;
	return { _id: id, ...rest };
};
const STATUSES = ['unmatched', 'suggested', 'accepted', 'rejected'] as const;

/** Bank statements in MongoDB (`bankLayouts`, `bankLines`, `bankImports`). */
export class MongoBankStatementRepository implements BankStatementRepository {
	async layouts(): Promise<BankLayout[]> {
		const docs = await BankLayoutModel.find({}).sort({ name: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map((doc) => BankLayout.parse(withId(doc)));
	}

	async saveLayout(layout: BankLayout): Promise<void> {
		await BankLayoutModel.replaceOne({ _id: layout.id }, docOf(layout), { upsert: true }).exec();
	}

	async keysIn(bankAccountId: string, keys: readonly string[]): Promise<Set<string>> {
		const docs = await BankLineModel.find({ bankAccountId, key: { $in: [...keys] } }, { key: 1 })
			.lean<Array<{ key: string }>>()
			.exec();
		return new Set(docs.map((d) => d.key));
	}

	async insertLines(lines: readonly BankLine[], context?: TransactionContext): Promise<void> {
		await BankLineModel.insertMany(lines.map(docOf), { session: sessionFrom(context) ?? null });
	}

	async insertImport(entry: BankImport, context?: TransactionContext): Promise<void> {
		await BankImportModel.create([docOf(entry)], { session: sessionFrom(context) });
	}

	async lines(bankAccountId: string, query: BankLineQuery) {
		const base = { bankAccountId, date: { $gte: query.from, $lte: query.to } };
		const chosen = query.status ? { ...base, status: query.status } : base;
		const [docs, total, ...counts] = await Promise.all([
			BankLineModel.find(chosen)
				.sort({ date: -1, _id: -1 })
				.skip((query.page - 1) * query.pageSize)
				.limit(query.pageSize)
				.lean<AggregateDoc[]>()
				.exec(),
			BankLineModel.countDocuments(chosen).exec(),
			...STATUSES.map((status) => BankLineModel.countDocuments({ ...base, status }).exec()),
		]);
		return {
			items: docs.map((doc) => BankLine.parse(withId(doc))),
			total,
			counts: Object.fromEntries(STATUSES.map((status, i) => [status, counts[i] as number])),
		};
	}

	async summary(): Promise<Record<string, { lastDate: string | null; toMatch: number }>> {
		const rows = await BankLineModel.aggregate<{ _id: string; lastDate: string; toMatch: number }>([
			{
				$group: {
					_id: '$bankAccountId',
					lastDate: { $max: '$date' },
					toMatch: { $sum: { $cond: [{ $in: ['$status', ['unmatched', 'suggested']] }, 1, 0] } },
				},
			},
		]).exec();
		return Object.fromEntries(rows.map((r) => [r._id, { lastDate: r.lastDate, toMatch: r.toMatch }]));
	}
}
