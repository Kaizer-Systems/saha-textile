import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { AnalyticsDailyAggregateModel, SearchQueryAggregateModel } from '../src/models/index';
import { MongoSearchAnalyticsRepository } from '../src/repositories/search-analytics.repository';
import { hasMongoEnv, runPrefix } from './mongo-test-env';

/**
 * Search totals against the replica set: the running average, the no-result count and the
 * per-day click rows are atomic upserts a fake cannot prove.
 *
 *   RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
describe.runIf(hasMongoEnv())('search analytics persistence (rs0)', () => {
	const repo = new MongoSearchAnalyticsRepository();
	const prefix = runPrefix('search');
	const at = new Date('2026-11-08T06:00:00Z');

	beforeAll(async () => {
		await connectMongo();
		await Promise.all([SearchQueryAggregateModel.syncIndexes(), AnalyticsDailyAggregateModel.syncIndexes()]);
	});

	afterAll(async () => {
		await SearchQueryAggregateModel.deleteMany({ normalizedQuery: new RegExp(`^${prefix}`) }).exec();
		await AnalyticsDailyAggregateModel.deleteMany({ key: new RegExp(`^${prefix}`) }).exec();
		await disconnectMongo();
	});

	it('totals searches per words and language with a running average', async () => {
		const normalizedQuery = `${prefix}red silk`;
		await repo.recordQuery({ normalizedQuery, locale: 'en', resultCount: 10, at });
		await repo.recordQuery({ normalizedQuery, locale: 'en', resultCount: 0, at });
		await repo.recordQuery({ normalizedQuery, locale: 'bn', resultCount: 4, at });
		const en = await SearchQueryAggregateModel.findById(`en:${normalizedQuery}`).lean().exec();
		expect(en).toMatchObject({ count: 2, noResultCount: 1, clickCount: 0, resultCountAvg: 5, locale: 'en' });
		const bn = await SearchQueryAggregateModel.findById(`bn:${normalizedQuery}`).lean().exec();
		expect(bn).toMatchObject({ count: 1, resultCountAvg: 4 });
	});

	it('adds a click to the product day and to the words that found it', async () => {
		const normalizedQuery = `${prefix}jamdani`;
		const productId = `${prefix}prd`;
		await repo.recordResultClick({ normalizedQuery, locale: 'en', productId, at });
		await repo.recordResultClick({ normalizedQuery, locale: 'en', productId, at });
		await repo.recordResultClick({
			normalizedQuery,
			locale: 'en',
			productId,
			at: new Date('2026-11-01T06:00:00Z'),
		});
		const day = await AnalyticsDailyAggregateModel.findById(`2026-11-08:product:${productId}`).lean().exec();
		expect(day).toMatchObject({
			grain: 'product',
			key: productId,
			date: '2026-11-08',
			metrics: { searchClicks: 2 },
		});
		expect(day?.expiresAt?.toISOString()).toBe('2027-05-07T00:00:00.000Z');
		const words = await SearchQueryAggregateModel.findById(`en:${normalizedQuery}`).lean().exec();
		expect(words).toMatchObject({ count: 0, clickCount: 3 });

		const rows = await repo.listProductClicks({ fromDate: '2026-11-02', toDate: '2026-11-08' });
		expect(rows.filter((row) => row.productId === productId)).toEqual([
			{ productId, date: '2026-11-08', clicks: 2 },
		]);
	});
});
