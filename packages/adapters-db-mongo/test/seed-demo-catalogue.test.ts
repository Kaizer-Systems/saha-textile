import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo, getMongoose } from '../src/connection';
import { CategoryModel, CategoryPlacementModel, ProductModel, SeoRedirectModel } from '../src/models/index';
import * as legacy from '../src/seed/legacy-addresses';
import * as catalogue from '../src/seed/map-demo-catalogue';
import { assertLocalDatabase, sameDocument, seedDemoCatalogue } from '../src/seed/seed-demo-catalogue';

/**
 * The seed only runs on a database with `local` in its name, so this suite makes one of its own
 * and drops it at the end. It never runs unless the configured database is named for tests, and
 * the name is checked again immediately before the drop.
 */
const TEST_DATABASE = /_(it|e2e|test)$/;
const allowed = process.env.RUN_DB_IT === '1' && TEST_DATABASE.test(process.env.MONGODB_DB_NAME ?? '');
const ownDatabase = (process.env.MONGODB_DB_NAME ?? '').replace(TEST_DATABASE, '_seed_local_$1');

describe('assertLocalDatabase', () => {
	it('allows a local database and refuses anything else', () => {
		expect(assertLocalDatabase('saha_textile_local')).toBe('saha_textile_local');
		expect(assertLocalDatabase('saha_textile_e2e')).toBe('saha_textile_e2e');
		expect(() => assertLocalDatabase('saha_textile_prod')).toThrow('must contain "local"');
		expect(() => assertLocalDatabase(undefined)).toThrow('must contain "local"');
	});
});

describe('sameDocument', () => {
	const at = new Date('2026-11-06T00:00:00.000Z');

	it('ignores fields the seed does not write, and fields it leaves undefined', () => {
		expect(sameDocument({ a: 1, extra: 2, _id: 'x' }, { a: 1, b: undefined, updatedAt: 'y' })).toBe(true);
		expect(sameDocument({ a: 1 }, { a: 2 })).toBe(false);
	});

	it('compares dates by their instant, whichever form they are in', () => {
		expect(sameDocument({ when: at }, { when: '2026-11-06T00:00:00.000Z' })).toBe(true);
		expect(sameDocument({ when: '2026-11-06T05:30:00.000+05:30' }, { when: '2026-11-06T00:00:00.000Z' })).toBe(
			true,
		);
		expect(sameDocument({ when: at }, { when: at })).toBe(false);
		expect(sameDocument({ when: '2026-13-99T00:00:00.000Z' }, { when: '2026-13-99T00:00:00.000Z' })).toBe(true);
	});

	it('walks lists and nested objects', () => {
		expect(sameDocument({ list: [{ a: 1 }] }, { list: [{ a: 1 }] })).toBe(true);
		expect(sameDocument({ list: 'not a list' }, { list: [{ a: 1, b: undefined, createdAt: 'x' }] })).toBe(false);
		expect(sameDocument({ nested: 'text' }, { nested: { a: 1 } })).toBe(false);
		expect(sameDocument({ nested: null }, { nested: { a: 1 } })).toBe(false);
		expect(sameDocument({ nested: { a: 1 } }, { nested: { a: 1 } })).toBe(true);
	});
});

describe.runIf(allowed)('seedDemoCatalogue (own database)', () => {
	beforeAll(async () => {
		await connectMongo(buildMongoConfig({ ...process.env, MONGODB_DB_NAME: ownDatabase }));
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterAll(async () => {
		const db = getMongoose().connection.db;
		if (db?.databaseName === ownDatabase && ownDatabase.includes('_seed_local_')) await db.dropDatabase();
		await disconnectMongo();
		vi.restoreAllMocks();
	});

	it('imports everything, then writes nothing the second time', { timeout: 60_000 }, async () => {
		const first = await seedDemoCatalogue(ownDatabase);
		expect(first).toMatchObject({ products: 390 });
		expect(first.written).toBeGreaterThan(390);
		expect((await seedDemoCatalogue(ownDatabase)).written).toBe(0);
	});

	it('moves an old row out of the way of a slug it needs', { timeout: 60_000 }, async () => {
		const taken = await CategoryModel.findOne().lean<{ _id: string; slug: string }>();
		await CategoryModel.updateOne({ _id: taken?._id }, { $set: { slug: 'parked' } });
		await CategoryModel.collection.insertOne({ _id: 'cat_stranger', slug: taken?.slug } as never);
		await seedDemoCatalogue(ownDatabase);
		expect((await CategoryModel.findById('cat_stranger').lean<{ slug: string }>())?.slug).toContain(
			'-retired-cat_stranger',
		);
	});

	it('rewrites a row that has drifted', { timeout: 60_000 }, async () => {
		const product = await ProductModel.findOne().lean<{ _id: string }>();
		await ProductModel.updateOne({ _id: product?._id }, { $set: { title: { en: 'Changed by hand' } } });
		expect((await seedDemoCatalogue(ownDatabase)).written).toBe(1);
	});

	it('skips drafts, empty lists, and a placement with no path', { timeout: 60_000 }, async () => {
		const empty = catalogue.mapDemoCatalogue({ products: [] });
		const small = catalogue.mapDemoCatalogue({
			products: [
				{ id: 900_001, status: 0, categories: [{ id: 900_002, slug: 'draft-only', status: 0 }] },
				{ id: 900_003, name: 'No description' },
			],
		});
		const map = vi
			.spyOn(catalogue, 'mapDemoCatalogue')
			.mockReturnValue({ ...small, addonTemplates: empty.addonTemplates });
		const live = vi.spyOn(legacy, 'legacyTargetIsLive').mockReturnValue(true);
		await CategoryPlacementModel.collection.insertOne({ _id: 'plc_pathless', status: 'live' } as never);
		const result = await seedDemoCatalogue(ownDatabase);
		expect(result).toMatchObject({ products: 2, addonTemplates: 0 });
		map.mockRestore();
		live.mockRestore();
	});

	it('refuses a redirect to a page that is not live', { timeout: 60_000 }, async () => {
		const spy = vi.spyOn(legacy, 'legacyTargetIsLive').mockReturnValue(false);
		await expect(seedDemoCatalogue(ownDatabase)).rejects.toThrow('Legacy target is not a live page');
		spy.mockRestore();
		expect(await SeoRedirectModel.countDocuments()).toBeGreaterThan(0);
	});
});
