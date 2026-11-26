import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';

/** One of the four legal pages (Legal Pages brief): its words per language, keyed by its fixed address. */
export interface LegalPageDoc {
	_id: string;
	title: Record<string, string>;
	content: Record<string, string>;
	metaTitle: Record<string, string>;
	metaDescription: Record<string, string>;
	metaImageAssetId: string | null;
	metaImageVersionId?: string | null;
	version: number;
	updatedAt: Date;
	updatedBy: string | null;
}

/** An earlier version of a legal page, kept with no screen (choice 3); `_id` is `{slug}:{version}`. */
export interface LegalPageRevisionDoc extends Omit<LegalPageDoc, '_id'> {
	_id: string;
	slug: string;
}

const fields = {
	title: { type: Schema.Types.Mixed, default: {} },
	content: { type: Schema.Types.Mixed, default: {} },
	metaTitle: { type: Schema.Types.Mixed, default: {} },
	metaDescription: { type: Schema.Types.Mixed, default: {} },
	metaImageAssetId: { type: String, default: null },
	metaImageVersionId: { type: String, default: null },
	version: { type: Number, required: true },
	updatedAt: { type: Date, required: true },
	updatedBy: { type: String, default: null },
};

const LegalPageSchema = new Schema<LegalPageDoc>(
	{ _id: { type: String, required: true }, ...fields },
	{ collection: COLLECTION_NAMES.LegalPage, timestamps: false },
);
LegalPageSchema.index({ metaImageAssetId: 1 }, { sparse: true });

const LegalPageRevisionSchema = new Schema<LegalPageRevisionDoc>(
	{ _id: { type: String, required: true }, slug: { type: String, required: true }, ...fields },
	{ collection: COLLECTION_NAMES.LegalPageRevision, timestamps: false },
);
LegalPageRevisionSchema.index({ slug: 1, version: -1 });

export const LegalPageModel: Model<LegalPageDoc> =
	(models.LegalPage as Model<LegalPageDoc>) ?? model<LegalPageDoc>('LegalPage', LegalPageSchema);
export const LegalPageRevisionModel: Model<LegalPageRevisionDoc> =
	(models.LegalPageRevision as Model<LegalPageRevisionDoc>) ??
	model<LegalPageRevisionDoc>('LegalPageRevision', LegalPageRevisionSchema);
