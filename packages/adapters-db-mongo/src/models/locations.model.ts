import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';
import type { AggregateDoc } from './purchasing.model';

const loose = { strict: false, versionKey: false, timestamps: false } as const;

/** One per location (accounts brief K1–K3); the short code is unique. */
const LocationSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		shortCode: { type: String, required: true, unique: true },
		updatedAt: { type: String, default: null },
	},
	{ ...loose, collection: COLLECTION_NAMES.Location },
);
export const LocationModel: Model<AggregateDoc> =
	(models.Location as Model<AggregateDoc>) ?? model<AggregateDoc>('Location', LocationSchema);

/** One per admin user (`_id` = user id): where they work and the chip's choice (L1–L3). */
const UserLocationsSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true } },
	{ ...loose, collection: COLLECTION_NAMES.UserLocations },
);
export const UserLocationsModel: Model<AggregateDoc> =
	(models.UserLocations as Model<AggregateDoc>) ?? model<AggregateDoc>('UserLocations', UserLocationsSchema);
