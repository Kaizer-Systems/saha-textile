import {
	CashBox,
	CashSettings,
	CashSheet,
	CashSheetLine,
	ExpenseClaim,
	PettyExpense,
	type ExpenseClaimStatus,
} from '@saha-textile/contracts';
import {
	payeeKey,
	type CashMatch,
	type CashPage,
	type CashRepository,
	type TransactionContext,
} from '@saha-textile/core-domain';

import {
	CashBoxModel,
	CashSettingModel,
	CashSheetLineModel,
	CashSheetModel,
	ExpenseClaimModel,
	PettyExpenseModel,
} from '../models/cash.model';
import type { AggregateDoc } from '../models/purchasing.model';
import { sessionFrom } from '../transaction-manager';

const strip = (doc: AggregateDoc): Record<string, unknown> => {
	const { _id, ...rest } = doc;
	void _id;
	return rest;
};
const withId = (doc: AggregateDoc) => ({ ...strip(doc), id: doc._id });
const duplicate = (error: unknown, code: string): never => {
	if ((error as { code?: number }).code === 11000) throw new Error(code, { cause: error });
	throw error;
};
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const session = (context?: TransactionContext) => sessionFrom(context) ?? null;
const docOf = <T extends { id: string }>(value: T) => {
	const { id, ...rest } = value;
	return { _id: id, ...rest };
};

const sheetOf = (doc: AggregateDoc): CashSheet => CashSheet.parse(withId(doc));
const lineOf = (doc: AggregateDoc): CashSheetLine => CashSheetLine.parse(withId(doc));
const pettyOf = (doc: AggregateDoc): PettyExpense => PettyExpense.parse(withId(doc));
const claimOf = (doc: AggregateDoc): ExpenseClaim => ExpenseClaim.parse(withId(doc));

/** Counts behind every chip and one page, over the same filter. */
async function paged<C extends string>(
	model: typeof CashSheetModel,
	base: Record<string, unknown>,
	chips: Record<C, Record<string, unknown>>,
	chosen: C,
	paging: { page: number; pageSize: number; sort: Record<string, 1 | -1> },
) {
	const keys = Object.keys(chips) as C[];
	const [docs, total, ...counts] = await Promise.all([
		model
			.find({ ...base, ...chips[chosen] })
			.sort(paging.sort)
			.skip((paging.page - 1) * paging.pageSize)
			.limit(paging.pageSize)
			.lean<AggregateDoc[]>()
			.exec(),
		model.countDocuments({ ...base, ...chips[chosen] }).exec(),
		...keys.map((key) => model.countDocuments({ ...base, ...chips[key] }).exec()),
	]);
	return { docs, total, counts: Object.fromEntries(keys.map((key, at) => [key, counts[at]])) as Record<C, number> };
}

const matchOf = (match: CashMatch | null): Record<string, unknown> =>
	match ? { $or: [{ boxId: { $in: match.boxIds ?? [] } }, { openedBy: { $in: match.people ?? [] } }] } : {};

/** Cash (accounts brief O1–O14) in MongoDB. */
export class MongoCashRepository implements CashRepository {
	async settings(): Promise<CashSettings | null> {
		const doc = await CashSettingModel.findById('cash').lean<AggregateDoc>().exec();
		return doc ? CashSettings.parse(strip(doc)) : null;
	}

	async saveSettings(settings: CashSettings, context?: TransactionContext): Promise<void> {
		await CashSettingModel.replaceOne(
			{ _id: 'cash' },
			{ _id: 'cash', ...settings },
			{ upsert: true, session: sessionFrom(context) },
		).exec();
	}

	async boxes(): Promise<CashBox[]> {
		const docs = await CashBoxModel.find({}).sort({ name: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map((doc) => CashBox.parse(withId(doc)));
	}

	async box(id: string, context?: TransactionContext): Promise<CashBox | null> {
		const doc = await CashBoxModel.findById(id).session(session(context)).lean<AggregateDoc>().exec();
		return doc ? CashBox.parse(withId(doc)) : null;
	}

	async saveBox(box: CashBox, context?: TransactionContext): Promise<void> {
		await CashBoxModel.replaceOne({ _id: box.id }, docOf(box), { upsert: true, session: sessionFrom(context) })
			.exec()
			.catch((error: unknown) => duplicate(error, 'duplicate_cash_box_ledger'));
	}

	async sheet(id: string, context?: TransactionContext): Promise<CashSheet | null> {
		const doc = await CashSheetModel.findById(id).session(session(context)).lean<AggregateDoc>().exec();
		return doc ? sheetOf(doc) : null;
	}

	async openSheet(boxId: string, context?: TransactionContext): Promise<CashSheet | null> {
		const doc = await CashSheetModel.findOne({ boxId, status: 'open' })
			.session(session(context))
			.lean<AggregateDoc>()
			.exec();
		return doc ? sheetOf(doc) : null;
	}

	async sheetOn(boxId: string, date: string, context?: TransactionContext): Promise<CashSheet | null> {
		const doc = await CashSheetModel.findOne({ boxId, date }).session(session(context)).lean<AggregateDoc>().exec();
		return doc ? sheetOf(doc) : null;
	}

	async unsettled(boxId: string, context?: TransactionContext): Promise<CashSheet[]> {
		const docs = await CashSheetModel.find({ boxId, status: 'difference' })
			.sort({ date: 1 })
			.session(session(context))
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map(sheetOf);
	}

	async insertSheet(sheet: CashSheet, context?: TransactionContext): Promise<void> {
		await CashSheetModel.create([docOf(sheet)], { session: sessionFrom(context) }).catch((error: unknown) =>
			duplicate(error, 'cash_sheet_exists'),
		);
	}

	async saveSheet(sheet: CashSheet, expectedVersion: number, context?: TransactionContext): Promise<CashSheet> {
		const next = { ...sheet, version: expectedVersion + 1 };
		const result = await CashSheetModel.replaceOne({ _id: sheet.id, version: expectedVersion }, docOf(next), {
			session: sessionFrom(context),
		}).exec();
		if (result.matchedCount === 0) throw new Error('cash_sheet_changed');
		return next;
	}

	async listSheets(
		query: Parameters<CashRepository['listSheets']>[0],
	): Promise<CashPage<CashSheet, 'all' | 'difference' | 'open'>> {
		const base = {
			date: { $gte: query.from, $lte: query.to },
			...(query.locationIds ? { locationId: { $in: [...query.locationIds] } } : {}),
			...matchOf(query.match),
		};
		const { docs, total, counts } = await paged(
			CashSheetModel,
			base,
			{ all: {}, difference: { status: 'difference' }, open: { status: 'open' } },
			query.chip,
			{ page: query.page, pageSize: query.pageSize, sort: { date: -1, _id: -1 } },
		);
		return { items: docs.map(sheetOf), total, counts };
	}

	async suspenseDue(today: string): Promise<CashSheet[]> {
		const docs = await CashSheetModel.find({
			'settlement.how': 'excess_suspense',
			'settlement.suspenseUntil': { $lte: today },
			'settlement.releaseVoucherId': null,
		})
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map(sheetOf);
	}

	async unfinishedIn(month: string): Promise<CashSheet[]> {
		const docs = await CashSheetModel.find({
			date: { $gte: `${month}-01`, $lte: `${month}-31` },
			status: { $in: ['open', 'difference'] },
		})
			.sort({ date: 1 })
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map(sheetOf);
	}

	async insertLine(line: CashSheetLine, context?: TransactionContext): Promise<void> {
		await CashSheetLineModel.create([docOf(line)], { session: sessionFrom(context) }).catch((error: unknown) =>
			duplicate(error, 'duplicate_cash_line'),
		);
	}

	async linesOf(sheetId: string, context?: TransactionContext): Promise<CashSheetLine[]> {
		const docs = await CashSheetLineModel.find({ sheetId })
			.sort({ at: 1, _id: 1 })
			.session(session(context))
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map(lineOf);
	}

	async adoptLines(boxId: string, sheetId: string, context?: TransactionContext): Promise<number> {
		const result = await CashSheetLineModel.updateMany(
			{ boxId, sheetId: null },
			{ $set: { sheetId } },
			{ session: sessionFrom(context) },
		).exec();
		return result.modifiedCount;
	}

	async sheetTotals(sheetIds: readonly string[]): Promise<Record<string, { inPaise: number; outPaise: number }>> {
		const rows = await CashSheetLineModel.aggregate<{ _id: string; inPaise: number; outPaise: number }>([
			{ $match: { sheetId: { $in: [...sheetIds] } } },
			{ $group: { _id: '$sheetId', inPaise: { $sum: '$inPaise' }, outPaise: { $sum: '$outPaise' } } },
		]).exec();
		return Object.fromEntries(rows.map((row) => [row._id, { inPaise: row.inPaise, outPaise: row.outPaise }]));
	}

	async insertPetty(expense: PettyExpense, context?: TransactionContext): Promise<void> {
		await PettyExpenseModel.create([{ ...docOf(expense), paidToKey: payeeKey(expense.paidTo) }], {
			session: sessionFrom(context),
		}).catch((error: unknown) => duplicate(error, 'duplicate_petty_expense'));
	}

	async pettyPaidOn(date: string, paidTo: string): Promise<number> {
		const [row] = await PettyExpenseModel.aggregate<{ paise: number }>([
			{ $match: { date, paidToKey: payeeKey(paidTo) } },
			{ $group: { _id: null, paise: { $sum: '$amountPaise' } } },
		]).exec();
		return row?.paise ?? 0;
	}

	async pettySinceRefill(boxId: string, context?: TransactionContext): Promise<PettyExpense[]> {
		const docs = await PettyExpenseModel.find({ boxId, refillId: null })
			.sort({ date: 1, number: 1 })
			.session(session(context))
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map(pettyOf);
	}

	async markRefilled(ids: readonly string[], refillId: string, context?: TransactionContext): Promise<void> {
		await PettyExpenseModel.updateMany(
			{ _id: { $in: [...ids] }, refillId: null },
			{ $set: { refillId } },
			{ session: sessionFrom(context) },
		).exec();
	}

	async listPetty(
		query: Parameters<CashRepository['listPetty']>[0],
	): Promise<{ items: PettyExpense[]; total: number; totalPaise: number }> {
		const search = query.search
			? {
					$or: ['number', 'paidTo', 'whatFor', 'headName'].map((field) => ({
						[field]: { $regex: escapeRegex(query.search), $options: 'i' },
					})),
				}
			: {};
		const filter = {
			date: { $gte: query.from, $lte: query.to },
			...(query.boxIds ? { boxId: { $in: [...query.boxIds] } } : {}),
			...search,
		};
		const [docs, total, sums] = await Promise.all([
			PettyExpenseModel.find(filter)
				.sort({ date: -1, number: -1 })
				.skip((query.page - 1) * query.pageSize)
				.limit(query.pageSize)
				.lean<AggregateDoc[]>()
				.exec(),
			PettyExpenseModel.countDocuments(filter).exec(),
			PettyExpenseModel.aggregate<{ paise: number }>([
				{ $match: filter },
				{ $group: { _id: null, paise: { $sum: '$amountPaise' } } },
			]).exec(),
		]);
		return { items: docs.map(pettyOf), total, totalPaise: sums[0]?.paise ?? 0 };
	}

	async insertClaim(claim: ExpenseClaim, context?: TransactionContext): Promise<void> {
		await ExpenseClaimModel.create([docOf(claim)], { session: sessionFrom(context) }).catch((error: unknown) =>
			duplicate(error, 'duplicate_expense_claim'),
		);
	}

	async claim(id: string, context?: TransactionContext): Promise<ExpenseClaim | null> {
		const doc = await ExpenseClaimModel.findById(id).session(session(context)).lean<AggregateDoc>().exec();
		return doc ? claimOf(doc) : null;
	}

	async saveClaim(claim: ExpenseClaim, expectedVersion: number, context?: TransactionContext): Promise<ExpenseClaim> {
		const next = { ...claim, version: expectedVersion + 1 };
		const result = await ExpenseClaimModel.replaceOne({ _id: claim.id, version: expectedVersion }, docOf(next), {
			session: sessionFrom(context),
		}).exec();
		if (result.matchedCount === 0) throw new Error('expense_claim_changed');
		return next;
	}

	async listClaims(
		query: Parameters<CashRepository['listClaims']>[0],
	): Promise<CashPage<ExpenseClaim, 'all' | ExpenseClaimStatus>> {
		const search = query.search
			? {
					$or: ['number', 'staffName', 'whatFor', 'headName'].map((field) => ({
						[field]: { $regex: escapeRegex(query.search), $options: 'i' },
					})),
				}
			: {};
		const base = {
			spentOn: { $gte: query.from, $lte: query.to },
			...(query.locationIds ? { locationId: { $in: [...query.locationIds] } } : {}),
			...search,
		};
		const { docs, total, counts } = await paged(
			ExpenseClaimModel,
			base,
			{
				all: {},
				waiting: { status: 'waiting' },
				approved: { status: 'approved' },
				paid: { status: 'paid' },
				rejected: { status: 'rejected' },
			},
			query.chip,
			{ page: query.page, pageSize: query.pageSize, sort: { spentOn: -1, _id: -1 } },
		);
		return { items: docs.map(claimOf), total, counts };
	}

	async claimsForPayroll(month: string): Promise<ExpenseClaim[]> {
		const docs = await ExpenseClaimModel.find({ status: 'approved', payBack: 'salary', payrollMonth: month })
			.sort({ spentOn: 1 })
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map(claimOf);
	}
}
