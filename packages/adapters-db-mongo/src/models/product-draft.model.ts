import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';

/** A product draft (product bulk actions brief § 7): the product form as it was, unchecked. */
export interface ProductDraftDoc {
	_id: string;
	kind: 'new' | 'edit';
	productId: string | null;
	title: string;
	imageAssetId: string | null;
	form: Record<string, unknown>;
	changes: { path: string; from: unknown }[];
	toFix: number;
	baseSavedAt: Date | null;
	createdBy: string | null;
	updatedBy: string | null;
	createdAt: Date;
	updatedAt: Date;
}

const ProductDraftSchema = new Schema<ProductDraftDoc>(
	{
		_id: { type: String, required: true },
		kind: { type: String, enum: ['new', 'edit'], required: true },
		productId: { type: String, default: null },
		title: { type: String, default: '' },
		imageAssetId: { type: String, default: null },
		form: { type: Schema.Types.Mixed, default: {} },
		changes: { type: Schema.Types.Mixed, default: [] },
		toFix: { type: Number, default: 0 },
		baseSavedAt: { type: Date, default: null },
		createdBy: { type: String, default: null },
		updatedBy: { type: String, default: null },
		createdAt: { type: Date, required: true },
		updatedAt: { type: Date, required: true },
	},
	{ collection: COLLECTION_NAMES.ProductDraft, timestamps: false, minimize: false },
);
// One draft of changes per product per person.
ProductDraftSchema.index(
	{ productId: 1, createdBy: 1 },
	{ unique: true, partialFilterExpression: { kind: 'edit' }, name: 'one_edit_draft_per_person' },
);
ProductDraftSchema.index({ createdBy: 1, updatedAt: -1 });
ProductDraftSchema.index({ updatedAt: -1 });

export const ProductDraftModel: Model<ProductDraftDoc> =
	(models.ProductDraft as Model<ProductDraftDoc>) ?? model<ProductDraftDoc>('ProductDraft', ProductDraftSchema);
