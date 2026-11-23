import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';
import type { AggregateDoc } from './purchasing.model';

const loose = { strict: false, versionKey: false, timestamps: false } as const;

/** One document, `_id: 'company'`: Settings › Company. */
const CompanyProfileSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true }, updatedAt: { type: String, default: null } },
	{ ...loose, collection: COLLECTION_NAMES.CompanyProfile },
);
export const CompanyProfileModel: Model<AggregateDoc> =
	(models.CompanyProfile as Model<AggregateDoc>) ?? model<AggregateDoc>('CompanyProfile', CompanyProfileSchema);

/** One per GSTIN; `_id` is the registration id. */
const GstRegistrationSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		gstin: { type: String, required: true, unique: true },
		updatedAt: { type: String, default: null },
	},
	{ ...loose, collection: COLLECTION_NAMES.GstRegistration },
);
export const GstRegistrationModel: Model<AggregateDoc> =
	(models.GstRegistration as Model<AggregateDoc>) ?? model<AggregateDoc>('GstRegistration', GstRegistrationSchema);

/** One document, `_id: 'features'`: Settings › Features. */
const FeatureSwitchesSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true }, updatedAt: { type: String, default: null } },
	{ ...loose, collection: COLLECTION_NAMES.FeatureSwitches },
);
export const FeatureSwitchesModel: Model<AggregateDoc> =
	(models.FeatureSwitches as Model<AggregateDoc>) ?? model<AggregateDoc>('FeatureSwitches', FeatureSwitchesSchema);
