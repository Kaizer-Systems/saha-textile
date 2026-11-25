import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';
import type { AggregateDoc } from './purchasing.model';

/**
 * Stored in the contract's shape. `strictQuery: false` because the connection sets strict queries on: without it a
 * filter on a field the schema doesn't name (validUntil, documentNumber, irn, ewbNumber, ackNo) is dropped and matches
 * every record.
 */
const loose = { strict: false, strictQuery: false, versionKey: false, timestamps: false } as const;

/** One per GSTIN (`_id` = GSTIN): Settings › E-invoice and e-way bill. */
const EDocSettingsSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true }, updatedAt: { type: String, default: null } },
	{ ...loose, collection: COLLECTION_NAMES.EDocSettings },
);
export const EDocSettingsModel: Model<AggregateDoc> =
	(models.EDocSettings as Model<AggregateDoc>) ?? model<AggregateDoc>('EDocSettings', EDocSettingsSchema);

/** One per IRN or e-way bill. At most one active of each kind per document (partial unique index). */
const EDocumentSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		kind: { type: String, required: true },
		documentId: { type: String, required: true },
		status: { type: String, required: true },
		gstin: { type: String, required: true },
		documentDate: { type: String, required: true },
	},
	{ ...loose, collection: COLLECTION_NAMES.EDocument },
);
EDocumentSchema.index({ kind: 1, documentId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
EDocumentSchema.index({ kind: 1, gstin: 1, documentDate: -1 });
export const EDocumentModel: Model<AggregateDoc> =
	(models.EDocument as Model<AggregateDoc>) ?? model<AggregateDoc>('EDocument', EDocumentSchema);

/** The activity log (EI14): never keys, passwords or payloads. */
const EDocCallSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		at: { type: String, required: true },
		gstin: { type: String, required: true },
	},
	{ ...loose, collection: COLLECTION_NAMES.EDocCall },
);
EDocCallSchema.index({ gstin: 1, at: -1 });
export const EDocCallModel: Model<AggregateDoc> =
	(models.EDocCall as Model<AggregateDoc>) ?? model<AggregateDoc>('EDocCall', EDocCallSchema);

/** Encrypted secrets of the automatic paths (`_id` = `${gstin}:${path}`), AES-256-GCM with EDOC_KEYS_KEY. */
const EDocKeysSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true } },
	{ ...loose, collection: COLLECTION_NAMES.EDocKeys },
);
export const EDocKeysModel: Model<AggregateDoc> =
	(models.EDocKeys as Model<AggregateDoc>) ?? model<AggregateDoc>('EDocKeys', EDocKeysSchema);
