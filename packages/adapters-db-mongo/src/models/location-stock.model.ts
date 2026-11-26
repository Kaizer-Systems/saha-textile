import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';
import type { AggregateDoc } from './purchasing.model';

/** Each variant's stock at each location (accounts brief F4); `_id` is `<variantId>:<locationId>`. */
const LocationStockSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		variantId: { type: String, required: true },
		locationId: { type: String, required: true },
	},
	{
		strict: false,
		strictQuery: false,
		versionKey: false,
		timestamps: false,
		collection: COLLECTION_NAMES.LocationStock,
	},
);
LocationStockSchema.index({ variantId: 1 });
LocationStockSchema.index({ locationId: 1 });
export const LocationStockModel: Model<AggregateDoc> =
	(models.LocationStock as Model<AggregateDoc>) ?? model<AggregateDoc>('LocationStock', LocationStockSchema);
