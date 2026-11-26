import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';
import type { AggregateDoc } from './purchasing.model';

/** Stock transfers between locations (accounts brief N): one document each, numbers unique. */
const StockTransferSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true }, number: { type: String, required: true } },
	{
		strict: false,
		strictQuery: false,
		versionKey: false,
		timestamps: false,
		collection: COLLECTION_NAMES.StockTransfer,
	},
);
StockTransferSchema.index({ number: 1 }, { unique: true });
StockTransferSchema.index({ status: 1, createdAt: -1 });
StockTransferSchema.index({ fromLocationId: 1, createdAt: -1 });
StockTransferSchema.index({ toLocationId: 1, createdAt: -1 });
StockTransferSchema.index({ 'lines.variantId': 1, status: 1 });
export const StockTransferModel: Model<AggregateDoc> =
	(models['StockTransfer'] as Model<AggregateDoc>) ?? model<AggregateDoc>('StockTransfer', StockTransferSchema);
