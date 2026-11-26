import { type Model, Schema, model, models } from 'mongoose';

/**
 * Search totals (`searchQueryAggregates`, catalog plan §7.18): one row per normalised search and
 * language. Counted only when a shopper commits a search, never per keystroke. No shopper
 * detail is stored, and a search nobody has made for 180 days is removed by TTL.
 */
export interface SearchQueryAggregateDoc {
	/** `<locale>:<normalizedQuery>`. */
	_id: string;
	normalizedQuery: string;
	locale: string;
	count: number;
	noResultCount: number;
	clickCount: number;
	resultCountAvg: number;
	lastSeenAt: Date;
}

const SearchQueryAggregateSchema = new Schema<SearchQueryAggregateDoc>(
	{
		_id: { type: String, required: true },
		normalizedQuery: { type: String, required: true },
		locale: { type: String, required: true },
		count: { type: Number, required: true, default: 0 },
		noResultCount: { type: Number, required: true, default: 0 },
		clickCount: { type: Number, required: true, default: 0 },
		resultCountAvg: { type: Number, required: true, default: 0 },
		lastSeenAt: { type: Date, required: true },
	},
	{ collection: 'searchQueryAggregates', timestamps: false, versionKey: false },
);

/** Popular searches and searches with no results, for the reports. */
SearchQueryAggregateSchema.index({ locale: 1, count: -1 });
SearchQueryAggregateSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

export const SearchQueryAggregateModel: Model<SearchQueryAggregateDoc> =
	(models.SearchQueryAggregate as Model<SearchQueryAggregateDoc>) ??
	model<SearchQueryAggregateDoc>('SearchQueryAggregate', SearchQueryAggregateSchema);

/**
 * Daily figures (`analyticsDailyAggregates`, catalog plan §7.38): one row per day, grain and
 * key, so reports never scan raw events. Today only `product` rows with `searchClicks` are
 * written; a row removes itself at `expiresAt`.
 */
export interface AnalyticsDailyAggregateDoc {
	/** `<date>:<grain>:<key>`. */
	_id: string;
	/** `YYYY-MM-DD`, India time. */
	date: string;
	grain: 'site' | 'product' | 'variant' | 'category' | 'search_query' | 'currency' | 'gateway';
	key: string;
	metrics: Record<string, number>;
	updatedAt: Date;
	expiresAt: Date | null;
}

const AnalyticsDailyAggregateSchema = new Schema<AnalyticsDailyAggregateDoc>(
	{
		_id: { type: String, required: true },
		date: { type: String, required: true },
		grain: {
			type: String,
			enum: ['site', 'product', 'variant', 'category', 'search_query', 'currency', 'gateway'],
			required: true,
		},
		key: { type: String, required: true },
		metrics: { type: Schema.Types.Mixed, required: true, default: {} },
		updatedAt: { type: Date, required: true },
		expiresAt: { type: Date, default: null },
	},
	{ collection: 'analyticsDailyAggregates', timestamps: false, versionKey: false, minimize: false },
);

/** "This grain over these days", which Trending and the reports both read. */
AnalyticsDailyAggregateSchema.index({ grain: 1, date: -1 });
AnalyticsDailyAggregateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AnalyticsDailyAggregateModel: Model<AnalyticsDailyAggregateDoc> =
	(models.AnalyticsDailyAggregate as Model<AnalyticsDailyAggregateDoc>) ??
	model<AnalyticsDailyAggregateDoc>('AnalyticsDailyAggregate', AnalyticsDailyAggregateSchema);
