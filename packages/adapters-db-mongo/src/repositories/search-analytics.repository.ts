import {
	SEARCH_ANALYTICS_RETENTION_DAYS,
	indiaDay,
	type DailyProductClicks,
	type SearchAnalyticsRepository,
	type SearchClickRecord,
	type SearchQueryRecord,
} from '@saha-textile/core-domain';

import {
	AnalyticsDailyAggregateModel,
	SearchQueryAggregateModel,
	type AnalyticsDailyAggregateDoc,
} from '../models/index';

const DAY_MS = 86_400_000;

const queryId = (locale: string, normalizedQuery: string) => `${locale}:${normalizedQuery}`;

/** Only totals: every write is one atomic upsert, so two shoppers never lose each other's count. */
export class MongoSearchAnalyticsRepository implements SearchAnalyticsRepository {
	async recordQuery({ normalizedQuery, locale, resultCount, at }: SearchQueryRecord): Promise<void> {
		const count = { $ifNull: ['$count', 0] };
		const average = { $ifNull: ['$resultCountAvg', 0] };
		// A pipeline update keeps the running average exact in one round trip.
		await SearchQueryAggregateModel.updateOne(
			{ _id: queryId(locale, normalizedQuery) },
			[
				{
					$set: {
						normalizedQuery,
						locale,
						count: { $add: [count, 1] },
						noResultCount: { $add: [{ $ifNull: ['$noResultCount', 0] }, resultCount === 0 ? 1 : 0] },
						clickCount: { $ifNull: ['$clickCount', 0] },
						resultCountAvg: {
							$divide: [{ $add: [{ $multiply: [average, count] }, resultCount] }, { $add: [count, 1] }],
						},
						lastSeenAt: at,
					},
				},
			],
			{ upsert: true, updatePipeline: true },
		).exec();
	}

	async recordResultClick({ normalizedQuery, locale, productId, at }: SearchClickRecord): Promise<void> {
		const date = indiaDay(at);
		await Promise.all([
			AnalyticsDailyAggregateModel.updateOne(
				{ _id: `${date}:product:${productId}` },
				{
					$inc: { 'metrics.searchClicks': 1 },
					$set: {
						updatedAt: at,
						expiresAt: new Date(Date.parse(`${date}T00:00:00Z`) + SEARCH_ANALYTICS_RETENTION_DAYS * DAY_MS),
					},
					$setOnInsert: { date, grain: 'product', key: productId },
				},
				{ upsert: true },
			).exec(),
			// A click on a search nobody committed (typed in the box) still teaches which words work.
			SearchQueryAggregateModel.updateOne(
				{ _id: queryId(locale, normalizedQuery) },
				{
					$inc: { clickCount: 1 },
					$set: { lastSeenAt: at },
					$setOnInsert: { normalizedQuery, locale, count: 0, noResultCount: 0, resultCountAvg: 0 },
				},
				{ upsert: true },
			).exec(),
		]);
	}

	async listProductClicks({ fromDate, toDate }: { fromDate: string; toDate: string }): Promise<DailyProductClicks[]> {
		const rows = await AnalyticsDailyAggregateModel.find(
			{ grain: 'product', date: { $gte: fromDate, $lte: toDate }, 'metrics.searchClicks': { $gt: 0 } },
			{ key: 1, date: 1, metrics: 1 },
		)
			.lean<Array<Pick<AnalyticsDailyAggregateDoc, 'key' | 'date' | 'metrics'>>>()
			.exec();
		// The query keeps only rows with clicks, so the count is always there.
		return rows.map((row) => ({ productId: row.key, date: row.date, clicks: Number(row.metrics['searchClicks']) }));
	}
}
