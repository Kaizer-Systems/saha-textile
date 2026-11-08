import type { DailyProductClicks } from '../ports/search-analytics.repository';

/** How far back Trending looks. */
export const TRENDING_WINDOW_DAYS = 14;
/** A click this many days old counts half as much as one today. */
export const TRENDING_HALF_LIFE_DAYS = 7;
/** Fewer ranked products than this and the box shows bestsellers as Popular instead. */
export const TRENDING_MIN_PRODUCTS = 4;
/** Long enough to keep the reports, short enough that nothing piles up. */
export const SEARCH_ANALYTICS_RETENTION_DAYS = 180;

const MAX_QUERY_LENGTH = 100;
const DAY_MS = 86_400_000;
/** India has no daylight saving, so a fixed offset gives the shop's calendar day. */
const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * One spelling per search, so "Red  Silk " and "red silk" add up. NFKC folds look-alike
 * characters; Bengali letters keep their own case-free form.
 */
export function normalizeSearchQuery(q: string): string {
	return q.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH).trim();
}

/** The shop's calendar day (`YYYY-MM-DD`) for an instant. */
export function indiaDay(at: Date): string {
	return new Date(at.getTime() + INDIA_OFFSET_MS).toISOString().slice(0, 10);
}

/** The first and last day Trending reads, ending today. */
export function trendingRange(now: Date): { fromDate: string; toDate: string } {
	return {
		fromDate: indiaDay(new Date(now.getTime() - (TRENDING_WINDOW_DAYS - 1) * DAY_MS)),
		toDate: indiaDay(now),
	};
}

export interface TrendingScore {
	productId: string;
	score: number;
}

/**
 * Products by search-result clicks, newer days weighted higher so last month's favourite gives
 * way to this week's. Ties go to the lower product id, so the order never flickers.
 */
export function rankTrending(rows: readonly DailyProductClicks[], now: Date): TrendingScore[] {
	const today = Date.parse(`${indiaDay(now)}T00:00:00Z`);
	const scores = new Map<string, number>();
	for (const row of rows) {
		if (row.clicks <= 0) continue;
		const age = Math.max(0, Math.round((today - Date.parse(`${row.date}T00:00:00Z`)) / DAY_MS));
		if (age >= TRENDING_WINDOW_DAYS) continue;
		const weight = 0.5 ** (age / TRENDING_HALF_LIFE_DAYS);
		scores.set(row.productId, (scores.get(row.productId) ?? 0) + row.clicks * weight);
	}
	return [...scores]
		.map(([productId, score]) => ({ productId, score }))
		.sort((a, b) => b.score - a.score || (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
}
