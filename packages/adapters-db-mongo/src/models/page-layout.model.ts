import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';

/**
 * Page Builder storage (brief PG-4, FX-11). One store for every page type: a page (type + target) holds its
 * schedule; a layout belongs to one page; its content is append-only revisions; saved blocks are sections kept on
 * their own. Sections are stored as the contract validated them (Mixed), with their schema version on each, and
 * `minimize: false` keeps their empty word fields, so a revision reads back exactly as it was written.
 */
export interface BuilderPageDoc {
	/** `{pageType}:{target}`, e.g. `home:page`. */
	_id: string;
	pageType: string;
	target: string;
	schedule: Array<{ revisionId: string; layoutId: string; from: Date; until: Date | null; by: string | null }>;
	updatedAt: Date;
}

export interface PageLayoutDoc {
	_id: string;
	pageType: string;
	target: string;
	name: string;
	template: string | null;
	draftRevisionId: string | null;
	lastLiveRevisionId: string | null;
	/** The draft's revision number, so the next save takes the next one atomically. */
	revisionCount: number;
	createdAt: Date;
	updatedAt: Date;
	updatedBy: string | null;
}

export interface LayoutRevisionDoc {
	_id: string;
	layoutId: string;
	number: number;
	sections: unknown[];
	/** Every photo the sections show, for Media's use count (drafts, scheduled and live all count). */
	assetIds: string[];
	createdAt: Date;
	createdBy: string | null;
	wentLiveAt: Date | null;
}

export interface SavedBlockDoc {
	_id: string;
	name: string;
	section: unknown;
	assetIds: string[];
	createdAt: Date;
	updatedAt: Date;
	updatedBy: string | null;
}

const BuilderPageSchema = new Schema<BuilderPageDoc>(
	{
		_id: { type: String, required: true },
		pageType: { type: String, required: true },
		target: { type: String, required: true },
		schedule: {
			type: [
				{
					_id: false,
					revisionId: { type: String, required: true },
					layoutId: { type: String, required: true },
					from: { type: Date, required: true },
					until: { type: Date, default: null },
					by: { type: String, default: null },
				},
			],
			default: [],
		},
		updatedAt: { type: Date, required: true },
	},
	{ collection: COLLECTION_NAMES.BuilderPage, timestamps: false },
);

const PageLayoutSchema = new Schema<PageLayoutDoc>(
	{
		_id: { type: String, required: true },
		pageType: { type: String, required: true },
		target: { type: String, required: true },
		name: { type: String, required: true },
		template: { type: String, default: null },
		draftRevisionId: { type: String, default: null },
		lastLiveRevisionId: { type: String, default: null },
		revisionCount: { type: Number, default: 0 },
		createdAt: { type: Date, required: true },
		updatedAt: { type: Date, required: true },
		updatedBy: { type: String, default: null },
	},
	{ collection: COLLECTION_NAMES.PageLayout, timestamps: false },
);
PageLayoutSchema.index({ pageType: 1, target: 1, updatedAt: -1 });

const LayoutRevisionSchema = new Schema<LayoutRevisionDoc>(
	{
		_id: { type: String, required: true },
		layoutId: { type: String, required: true },
		number: { type: Number, required: true },
		sections: { type: [Schema.Types.Mixed], default: [] },
		assetIds: { type: [String], default: [] },
		createdAt: { type: Date, required: true },
		createdBy: { type: String, default: null },
		wentLiveAt: { type: Date, default: null },
	},
	{ collection: COLLECTION_NAMES.PageLayoutRevision, timestamps: false, minimize: false },
);
LayoutRevisionSchema.index({ layoutId: 1, number: -1 }, { unique: true });
LayoutRevisionSchema.index({ assetIds: 1 });

const SavedBlockSchema = new Schema<SavedBlockDoc>(
	{
		_id: { type: String, required: true },
		name: { type: String, required: true },
		section: { type: Schema.Types.Mixed, required: true },
		assetIds: { type: [String], default: [] },
		createdAt: { type: Date, required: true },
		updatedAt: { type: Date, required: true },
		updatedBy: { type: String, default: null },
	},
	{ collection: COLLECTION_NAMES.SavedBlock, timestamps: false, minimize: false },
);
SavedBlockSchema.index({ assetIds: 1 });

export const BuilderPageModel: Model<BuilderPageDoc> =
	(models.BuilderPage as Model<BuilderPageDoc>) ?? model<BuilderPageDoc>('BuilderPage', BuilderPageSchema);
export const PageLayoutModel: Model<PageLayoutDoc> =
	(models.PageLayout as Model<PageLayoutDoc>) ?? model<PageLayoutDoc>('PageLayout', PageLayoutSchema);
export const PageLayoutRevisionModel: Model<LayoutRevisionDoc> =
	(models.PageLayoutRevision as Model<LayoutRevisionDoc>) ??
	model<LayoutRevisionDoc>('PageLayoutRevision', LayoutRevisionSchema);
export const SavedBlockModel: Model<SavedBlockDoc> =
	(models.SavedBlock as Model<SavedBlockDoc>) ?? model<SavedBlockDoc>('SavedBlock', SavedBlockSchema);
