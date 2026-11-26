/**
 * Search counts with no shopper in them: no account, address, cookie or device. Searches are
 * totalled per normalised words and language (`searchQueryAggregates`); result clicks are
 * totalled per product per day (`analyticsDailyAggregates`, grain `product`).
 */
export interface SearchQueryRecord {
	/** Already normalised with `normalizeSearchQuery`. */
	normalizedQuery: string;
	locale: string;
	resultCount: number;
	at: Date;
}

export interface SearchClickRecord {
	normalizedQuery: string;
	locale: string;
	productId: string;
	at: Date;
}

/** One product's search-result clicks on one day in India (`YYYY-MM-DD`). */
export interface DailyProductClicks {
	productId: string;
	date: string;
	clicks: number;
}

export interface SearchAnalyticsRepository {
	recordQuery(record: SearchQueryRecord): Promise<void>;
	recordResultClick(record: SearchClickRecord): Promise<void>;
	/** Rows with at least one click, for days `fromDate` to `toDate` inclusive. */
	listProductClicks(range: { fromDate: string; toDate: string }): Promise<DailyProductClicks[]>;
}
