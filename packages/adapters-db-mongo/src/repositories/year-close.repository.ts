import type { YearCloseRecord, YearCloseRepository } from '@saha-textile/core-domain';

import { YearCloseModel } from '../models/bank.model';
import type { AggregateDoc } from '../models/purchasing.model';

/** Year closes in MongoDB (`yearCloses`, keyed by the year's label, e.g. `2026-27`). */
export class MongoYearCloseRepository implements YearCloseRepository {
	async get(year: string): Promise<YearCloseRecord | null> {
		const doc = await YearCloseModel.findById(year).lean<AggregateDoc>().exec();
		if (!doc) return null;
		const { _id, ...rest } = doc;
		return { ...(rest as unknown as Omit<YearCloseRecord, 'year'>), year: String(_id) };
	}

	async save(record: YearCloseRecord): Promise<void> {
		const { year, ...rest } = record;
		await YearCloseModel.updateOne({ _id: year }, { $set: rest }, { upsert: true }).exec();
	}
}
