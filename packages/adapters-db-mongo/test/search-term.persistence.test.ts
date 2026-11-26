import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { SearchTermModel } from '../src/models/index';
import { MongoSearchTermRepository } from '../src/repositories/search-term.repository';
import { hasMongoEnv, runPrefix } from './mongo-test-env';

/**
 * Search words against the replica set: the list search over names and spellings in any
 * language, live-only reads, and the round trip of every field.
 *
 *   RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
describe.runIf(hasMongoEnv())('search word persistence (rs0)', () => {
	const repo = new MongoSearchTermRepository();
	const prefix = runPrefix('sterm');
	const id = (name: string) => `${prefix}${name}`;

	beforeAll(async () => {
		await connectMongo();
		await SearchTermModel.syncIndexes();
	});

	afterAll(async () => {
		await SearchTermModel.deleteMany({ _id: new RegExp(`^${prefix}`) }).exec();
		await disconnectMongo();
	});

	it('round-trips a word, and finds it by any spelling in any script', async () => {
		const saved = await repo.save({
			id: id('puja'),
			name: { en: 'Puja', bn: 'পুজো' },
			spellings: { en: ['pujo', 'durga puja'], bn: ['পূজা'] },
			categoryIds: ['cat_1'],
			productIds: ['prd_1'],
			status: 'live',
		});
		expect(saved).toMatchObject({ id: id('puja'), spellings: { en: ['pujo', 'durga puja'] }, status: 'live' });
		expect(saved.createdAt).toBeTruthy();
		await repo.save({
			id: id('draft'),
			name: { en: 'Draft' },
			spellings: {},
			categoryIds: [],
			productIds: [],
			status: 'draft',
		});

		const byBengali = await repo.list({ search: 'পূজা', page: 1, pageSize: 50 });
		expect(byBengali.items.map((row) => row.id)).toEqual([id('puja')]);
		const byTwoWords = await repo.list({ search: 'DURGA pu', page: 1, pageSize: 50 });
		expect(byTwoWords.items.map((row) => row.id)).toEqual([id('puja')]);
		const drafts = await repo.list({ status: 'draft', search: 'draft', page: 1, pageSize: 50 });
		expect(drafts.items.map((row) => row.id)).toEqual([id('draft')]);
		expect((await repo.list({ search: '(', page: 1, pageSize: 50 })).total).toBe(0);

		expect((await repo.listLive()).map((row) => row.id)).toContain(id('puja'));
		expect((await repo.listLive()).map((row) => row.id)).not.toContain(id('draft'));
		expect((await repo.findManyByIds([id('puja'), id('draft'), 'nope'])).length).toBe(2);
		expect(await repo.findManyByIds([])).toEqual([]);

		await repo.remove(id('draft'));
		expect(await repo.findById(id('draft'))).toBeNull();
	});

	it('reads an old row that lacks its lists and dates, and lists everything with no filter', async () => {
		await SearchTermModel.collection.insertOne({ _id: id('old'), status: 'draft' } as never);
		expect(await repo.findById(id('old'))).toEqual({
			id: id('old'),
			name: {},
			spellings: {},
			categoryIds: [],
			productIds: [],
			status: 'draft',
		});
		const all = await repo.list({ page: 1, pageSize: 500 });
		expect(all.items.map((row) => row.id)).toContain(id('old'));
	});

	it('answers with what it was given if the saved row cannot be read back', async () => {
		const term = {
			id: id('gone'),
			name: { en: 'Gone' },
			spellings: {},
			categoryIds: [],
			productIds: [],
			status: 'draft' as const,
		};
		const read = vi.spyOn(repo, 'findById').mockResolvedValueOnce(null);
		expect(await repo.save(term)).toBe(term);
		read.mockRestore();
	});
});
