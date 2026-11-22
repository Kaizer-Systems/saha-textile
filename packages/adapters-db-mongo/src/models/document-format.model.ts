import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';

/**
 * Settings › Document formats (`documentFormats`; bundle builder brief F, approved 2026-11-22). A format is blocks in
 * order, each naming only fields its document has. A partial unique index keeps exactly one active format per
 * document even if two switches race.
 */
export interface DocumentFormatDoc {
	_id: string;
	doc: string;
	name: string;
	about: string;
	paper: string;
	blocks: unknown[];
	active: boolean;
	seeded: boolean;
	version: number;
	updatedBy: string | null;
	createdAt?: Date;
	updatedAt?: Date;
}

const DocumentFormatSchema = new Schema<DocumentFormatDoc>(
	{
		_id: { type: String, required: true },
		doc: { type: String, required: true },
		name: { type: String, required: true },
		about: { type: String, default: '' },
		paper: { type: String, enum: ['a4', 'a5', 'roll80'], default: 'a4' },
		blocks: { type: [Schema.Types.Mixed], default: [] },
		active: { type: Boolean, default: false },
		seeded: { type: Boolean, default: false },
		version: { type: Number, default: 1 },
		updatedBy: { type: String, default: null },
	},
	{ collection: COLLECTION_NAMES.DocumentFormat, timestamps: true, minimize: false },
);
DocumentFormatSchema.index({ doc: 1 }, { unique: true, partialFilterExpression: { active: true } });
DocumentFormatSchema.index({ doc: 1, name: 1 });

export const DocumentFormatModel: Model<DocumentFormatDoc> =
	(models.DocumentFormat as Model<DocumentFormatDoc>) ??
	model<DocumentFormatDoc>('DocumentFormat', DocumentFormatSchema);
