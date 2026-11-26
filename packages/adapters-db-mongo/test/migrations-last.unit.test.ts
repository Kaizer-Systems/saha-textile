import { beforeEach, describe, expect, it, vi } from 'vitest';

import { convertBundlesToLevels, showProductsOnShop } from '../src/migrations/bundles-v2';
import { seedProfilesAndNameVersions } from '../src/migrations/media-versions';
import { seedTodaysHomePage } from '../src/migrations/todays-home-page';

/** The models and repositories these migrations use, as in-memory stand-ins: no database. */
const world = vi.hoisted(() => ({
	bundles: [] as unknown[],
	updates: [] as unknown[],
	shown: 0,
	photos: [] as Array<Record<string, unknown>>,
}));
const exec = <T>(value: () => T) => ({ exec: async () => value() });

vi.mock('../src/models/index', () => ({
	BundlePriceMethodModel: {},
	ProductBundleModel: {
		find: () => ({ lean: () => exec(() => world.bundles) }),
		updateOne: (_filter: unknown, update: unknown) => exec(() => void world.updates.push(update)),
	},
	ProductModel: {
		find: () => ({ lean: () => exec(() => [{ _id: 'prd_a', basePriceINR: 1200 }]) }),
		updateMany: () => exec(() => ({ modifiedCount: world.shown })),
	},
	MediaAssetModel: {
		find: () => ({
			lean: () => ({
				cursor: () =>
					(async function* () {
						for (const photo of world.photos) yield photo;
					})(),
			}),
		}),
		bulkWrite: async (ops: unknown[]) => ({ modifiedCount: ops.length }),
	},
	MediaProfileModel: {},
	PageLayoutModel: { exists: () => exec(() => false) },
}));
vi.mock('../src/repositories/media-profile.repository', () => ({
	MongoMediaProfileRepository: class {
		insertMissing = async () => 1;
		list = async () => [{ key: 'product_3x4', version: 2 }];
	},
}));
vi.mock('../src/repositories/content-block.repository', () => ({
	MongoContentBlockRepository: class {
		list = async () => [];
	},
}));
vi.mock('../src/repositories/site-settings.repository', () => ({
	MongoSiteSettingsRepository: class {
		get = async () => ({ heroLayout: 'hero_full' });
	},
}));
vi.mock('../src/repositories/page-layout.repository', () => ({
	MongoPageLayoutRepository: class {
		createLayout = async () => undefined;
		saveDraft = async () => ({ id: 'rev_1' });
		goLive = async () => undefined;
	},
}));
vi.mock('@saha-textile/core-domain', async (original) => ({
	...(await original<object>()),
	todaysHomePage: () => [
		{ type: 'banner_arrangement', pieces: [{ pictures: [{}, {}] }, { pictures: [{}] }] },
		{ type: 'product_row' },
	],
}));

beforeEach(() => {
	world.bundles = [];
	world.updates = [];
	world.shown = 0;
	world.photos = [];
});

describe('migrations: the last cases (no database)', () => {
	it('converts a bundle one of whose groups lists no pieces', async () => {
		world.bundles = [
			{
				_id: 'bnd_1',
				productId: 'prd_set',
				groups: [
					{ code: 'empty', maxSelections: 1 },
					{ code: 'saree', components: [{ productId: 'prd_a', required: true }] },
				],
			},
		];
		expect(await convertBundlesToLevels()).toBe('converted 1 bundle to levels');
		expect(world.updates).toEqual([
			{ $set: expect.objectContaining({ memberIds: ['prd_a'], saleWindow: null, stock: null }) },
		]);
	});

	it('says one product when one product is shown on the shop', async () => {
		world.shown = 1;
		expect(await showProductsOnShop()).toBe('set Show on shop on 1 product');
	});

	it('says one photo when one photo’s versions are named', async () => {
		world.photos = [
			{ _id: 'med_1', derivatives: [{ role: 'card', storageKey: 'media/1/card.webp', width: 400, height: 533 }] },
		];
		expect(await seedProfilesAndNameVersions(() => new Date('2026-11-20T00:00:00Z'))).toBe(
			'added 1 image profile; named the versions of 1 photo',
		);
	});

	it('counts the banner pictures of every section that has pieces', async () => {
		expect(await seedTodaysHomePage(new Date('2026-11-20T00:00:00Z'))).toBe(
			'made Today’s home page: 2 sections, 3 banner pictures',
		);
	});
});
