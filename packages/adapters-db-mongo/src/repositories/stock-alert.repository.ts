import type { ProductInsightSet, StockAlert } from '@saha-textile/contracts';
import type { ProductInsightSetRepository, StockAlertCursor, StockAlertRepository } from '@saha-textile/core-domain';

import { ProductInsightSetModel, StockAlertModel, type StockAlertDoc } from '../models/index';

const toAlert = (doc: StockAlertDoc): StockAlert => ({
	id: doc._id,
	customerId: doc.customerId,
	productId: doc.productId,
	variantId: doc.variantId,
	createdAt: doc.createdAt.toISOString(),
	notifiedAt: doc.notifiedAt ? doc.notifiedAt.toISOString() : null,
	lastError: doc.lastError ?? null,
});

export class MongoStockAlertRepository implements StockAlertRepository {
	async save(input: { customerId: string; productId: string; variantId: string; now: string }): Promise<void> {
		const { customerId, productId, variantId, now } = input;
		await StockAlertModel.updateOne(
			{ customerId, variantId },
			{ $setOnInsert: { _id: `ntf_${customerId}_${variantId}`, productId, createdAt: new Date(now) } },
			{ upsert: true },
		).exec();
	}

	async listPending(limit: number, cursor?: StockAlertCursor): Promise<StockAlert[]> {
		const after = cursor
			? {
					$or: [
						{ createdAt: { $gt: new Date(cursor.createdAt) } },
						{ createdAt: new Date(cursor.createdAt), _id: { $gt: cursor.id } },
					],
				}
			: {};
		const docs = await StockAlertModel.find({ notifiedAt: null, ...after })
			.sort({ createdAt: 1, _id: 1 })
			.limit(limit)
			.lean<StockAlertDoc[]>()
			.exec();
		return docs.map(toAlert);
	}

	async markNotified(alertId: string, at: string): Promise<void> {
		await StockAlertModel.updateOne(
			{ _id: alertId },
			{ $set: { notifiedAt: new Date(at), lastError: null } },
		).exec();
	}

	async markFailed(alertId: string, error: string): Promise<void> {
		await StockAlertModel.updateOne({ _id: alertId }, { $set: { lastError: error } }).exec();
	}
}

export class MongoProductInsightSetRepository implements ProductInsightSetRepository {
	async save(set: ProductInsightSet): Promise<ProductInsightSet> {
		const { id, generatedAt, ...rest } = set;
		await ProductInsightSetModel.updateOne(
			{ _id: id },
			{ $set: { ...rest, generatedAt: new Date(generatedAt) } },
			{ upsert: true },
		).exec();
		return set;
	}
}
