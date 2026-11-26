import { SearchTermStatus } from '@saha-textile/contracts';
import { type Model, Schema, model, models } from 'mongoose';

/**
 * The admin's search words (`searchDictionary`, catalog plan §7.16; owner log § search words,
 * 2026-11-08): a name per language, spellings per language, and one shared set of tagged
 * categories and products. `searchText` is the names and spellings in lower case, written on every
 * save, so the admin list can search them.
 */
export interface SearchTermDoc {
	_id: string;
	name: Record<string, string>;
	spellings: Record<string, string[]>;
	categoryIds: string[];
	productIds: string[];
	status: string;
	searchText: string;
	createdAt?: Date;
	updatedAt?: Date;
}

const SearchTermSchema = new Schema<SearchTermDoc>(
	{
		_id: { type: String, required: true },
		name: { type: Schema.Types.Mixed, default: {} },
		spellings: { type: Schema.Types.Mixed, default: {} },
		categoryIds: { type: [String], default: [] },
		productIds: { type: [String], default: [] },
		status: { type: String, enum: SearchTermStatus.options, default: 'draft' },
		searchText: { type: String, default: '' },
	},
	{ collection: 'searchDictionary', timestamps: true, minimize: false },
);

/** The index reads every live word; the list sorts by last change. */
SearchTermSchema.index({ status: 1 });
SearchTermSchema.index({ updatedAt: -1 });

export const SearchTermModel: Model<SearchTermDoc> =
	(models.SearchTerm as Model<SearchTermDoc>) ?? model<SearchTermDoc>('SearchTerm', SearchTermSchema);
