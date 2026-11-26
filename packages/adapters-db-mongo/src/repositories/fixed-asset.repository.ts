import { FixedAsset, RecurringEntry } from '@saha-textile/contracts';
import type { FixedAssetRepository, RecurringEntryRepository, TransactionContext } from '@saha-textile/core-domain';

import { FixedAssetModel, RecurringEntryModel } from '../models/bank.model';
import type { AggregateDoc } from '../models/purchasing.model';
import { sessionFrom } from '../transaction-manager';

const assetOf = (doc: AggregateDoc): FixedAsset => {
	const { _id, ...rest } = doc;
	return FixedAsset.parse({ ...rest, id: _id });
};

/** The fixed asset register in MongoDB (`fixedAssets`). */
export class MongoFixedAssetRepository implements FixedAssetRepository {
	async list(): Promise<FixedAsset[]> {
		const docs = await FixedAssetModel.find({}).sort({ tag: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map(assetOf);
	}

	async get(id: string): Promise<FixedAsset | null> {
		const doc = await FixedAssetModel.findById(id).lean<AggregateDoc>().exec();
		return doc ? assetOf(doc) : null;
	}

	count(): Promise<number> {
		return FixedAssetModel.countDocuments({}).exec();
	}

	async insert(asset: FixedAsset, context?: TransactionContext): Promise<void> {
		const { id, ...rest } = asset;
		await FixedAssetModel.create([{ _id: id, ...rest }], { session: sessionFrom(context) ?? null }).catch(
			(error: { code?: number }) => {
				throw error.code === 11000 ? new Error('fixed_asset_tag_taken', { cause: error }) : error;
			},
		);
	}

	async save(asset: FixedAsset, expectedVersion: number, context?: TransactionContext): Promise<FixedAsset> {
		const { id, ...rest } = asset;
		const result = await FixedAssetModel.updateOne(
			{ _id: id, version: expectedVersion },
			{ $set: { ...rest, version: expectedVersion + 1 } },
		)
			.session(sessionFrom(context) ?? null)
			.exec();
		if (!result.matchedCount) throw new Error('fixed_asset_changed');
		return { ...asset, version: expectedVersion + 1 };
	}
}

const entryOf = (doc: AggregateDoc): RecurringEntry => {
	const { _id, ...rest } = doc;
	return RecurringEntry.parse({ ...rest, id: _id });
};

/** Rent and recurring entries in MongoDB (`recurringEntries`). */
export class MongoRecurringEntryRepository implements RecurringEntryRepository {
	async list(): Promise<RecurringEntry[]> {
		const docs = await RecurringEntryModel.find({}).sort({ nextOn: 1, what: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map(entryOf);
	}

	async get(id: string): Promise<RecurringEntry | null> {
		const doc = await RecurringEntryModel.findById(id).lean<AggregateDoc>().exec();
		return doc ? entryOf(doc) : null;
	}

	async insert(entry: RecurringEntry): Promise<void> {
		const { id, ...rest } = entry;
		await RecurringEntryModel.create({ _id: id, ...rest });
	}

	async save(entry: RecurringEntry, expectedVersion: number): Promise<RecurringEntry> {
		const { id, ...rest } = entry;
		const result = await RecurringEntryModel.updateOne(
			{ _id: id, version: expectedVersion },
			{ $set: { ...rest, version: expectedVersion + 1 } },
		).exec();
		if (!result.matchedCount) throw new Error('recurring_entry_changed');
		return { ...entry, version: expectedVersion + 1 };
	}

	async remove(id: string): Promise<boolean> {
		return (await RecurringEntryModel.deleteOne({ _id: id }).exec()).deletedCount > 0;
	}
}
