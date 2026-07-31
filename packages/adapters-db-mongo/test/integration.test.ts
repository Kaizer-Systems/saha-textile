import type { ProductStatus } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo } from '../src/connection';
import { ProductModel } from '../src/models/index';
import { MongoCategoryRepository, MongoProductRepository } from '../src/repositories/index';
import { seedDatabase } from '../src/seed/index';

/**
 * Live integration tests against a real MongoDB (test M0). GATED: they only run
 * when RUN_DB_IT=1 and Mongo env vars are present, so normal `pnpm test` / CI
 * stays offline. Run locally with:
 *   RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
function hasMongoEnv(): boolean {
	if (process.env.RUN_DB_IT !== '1') return false;
	try {
		buildMongoConfig();
		return true;
	} catch {
		return false;
	}
}

describe.skipIf(!hasMongoEnv())('MongoDB adapters (integration)', () => {
	beforeAll(async () => {
		await connectMongo();
		await seedDatabase();
	});

	afterAll(async () => {
		await disconnectMongo();
	});

	it('returns the seeded category taxonomy', async () => {
		const categories = new MongoCategoryRepository();
		const tree = await categories.tree();
		expect(tree.length).toBeGreaterThanOrEqual(6);
		const sarees = await categories.findBySlug('sarees');
		expect(sarees?.id).toBe('cat_sarees');
	});

	it('returns a seeded variable product with the No-Stitching base variation', async () => {
		const products = new MongoProductRepository();
		const saree = await products.findBySlug('banarasi-pure-silk-saree');
		expect(saree).not.toBeNull();
		expect(saree?.type).toBe('variable');
		const base = saree?.attributes.find((a) => a.code === 'design')?.terms.find((t) => t.isBase);
		expect(base?.code).toBe('no-stitching');
		expect(saree?.variations.length).toBe(6);
	});

	it('lists live products filtered by category', async () => {
		const products = new MongoProductRepository();
		const page = await products.list({ categoryId: 'cat_unstitched' });
		expect(page.total).toBeGreaterThanOrEqual(1);
		expect(page.items.every((p) => p.categoryIds.includes('cat_unstitched'))).toBe(true);
		expect(page.items.every((p) => p.status === 'live')).toBe(true);
	});

	/**
	 * Owner lock: only `live` products are storefront-queryable. This proves the rule
	 * against a real replica set for every public read path, including the case where a
	 * caller tries to widen visibility by passing a hidden status explicitly.
	 */
	describe('public visibility enforcement', () => {
		const products = new MongoProductRepository();
		const hidden: ProductStatus[] = ['draft', 'disabled', 'discontinued'];

		beforeAll(async () => {
			await Promise.all(
				hidden.map((status) =>
					ProductModel.findByIdAndUpdate(
						`prod_visibility_${status}`,
						{
							$set: {
								type: 'simple',
								sku: `VIS-${status.toUpperCase()}`,
								title: { en: `Visibility fixture ${status}` },
								slug: `visibility-fixture-${status}`,
								categoryIds: ['cat_visibility_fixture'],
								basePriceINR: 100,
								status,
							},
						},
						{ upsert: true, setDefaultsOnInsert: true },
					).exec(),
				),
			);
		});

		afterAll(async () => {
			await ProductModel.deleteMany({ _id: { $in: hidden.map((status) => `prod_visibility_${status}`) } }).exec();
		});

		it('hides non-live products from public list reads', async () => {
			const page = await products.list({ categoryId: 'cat_visibility_fixture' });
			expect(page.total).toBe(0);
			expect(page.items).toEqual([]);
		});

		it('refuses to widen visibility when a public caller asks for a hidden status', async () => {
			for (const status of hidden) {
				const page = await products.list({ categoryId: 'cat_visibility_fixture', status });
				expect(page.total).toBe(0);
			}
		});

		it('returns null from public findById/findBySlug for non-live products', async () => {
			for (const status of hidden) {
				expect(await products.findById(`prod_visibility_${status}`)).toBeNull();
				expect(await products.findBySlug(`visibility-fixture-${status}`)).toBeNull();
			}
		});

		it('lets an admin audience see them', async () => {
			const page = await products.list({ categoryId: 'cat_visibility_fixture', audience: 'admin' });
			expect(page.total).toBe(hidden.length);
			expect(await products.findById('prod_visibility_draft', 'admin')).not.toBeNull();
			expect((await products.findBySlug('visibility-fixture-disabled', 'admin'))?.status).toBe('disabled');
		});
	});
});
