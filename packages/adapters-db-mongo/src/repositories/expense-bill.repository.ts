import { ExpenseBill, type ExpenseBillStatus } from '@saha-textile/contracts';
import type { ExpenseBillRepository, TransactionContext } from '@saha-textile/core-domain';

import { ExpenseBillModel } from '../models/bank.model';
import type { AggregateDoc } from '../models/purchasing.model';
import { sessionFrom } from '../transaction-manager';

/** Expense bills in MongoDB (`expenseBills`, brief 25 EB1), saved over the version read. */
export class MongoExpenseBillRepository implements ExpenseBillRepository {
	async list(query: { supplierId?: string; status?: ExpenseBillStatus }): Promise<ExpenseBill[]> {
		const docs = await ExpenseBillModel.find({
			...(query.supplierId ? { supplierId: query.supplierId } : {}),
			...(query.status ? { status: query.status } : {}),
		})
			.sort({ billDate: -1, createdAt: -1 })
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map(({ _id, ...rest }) => ExpenseBill.parse({ ...rest, id: _id }));
	}

	async get(id: string): Promise<ExpenseBill | null> {
		const doc = await ExpenseBillModel.findById(id).lean<AggregateDoc>().exec();
		if (!doc) return null;
		const { _id, ...rest } = doc;
		return ExpenseBill.parse({ ...rest, id: _id });
	}

	async save(bill: ExpenseBill, expectedVersion: number | null, context?: TransactionContext): Promise<ExpenseBill> {
		const { id, ...rest } = bill;
		const session = sessionFrom(context);
		const next = { ...rest, version: expectedVersion === null ? 0 : expectedVersion + 1 };
		if (expectedVersion === null) {
			await ExpenseBillModel.create([{ _id: id, ...next }], { session: session ?? null });
		} else {
			const done = await ExpenseBillModel.updateOne(
				{ _id: id, version: expectedVersion },
				{ $set: next },
				{ session },
			).exec();
			if (done.matchedCount === 0) throw new Error('expense_bill_changed');
		}
		return { ...bill, version: next.version };
	}
}
