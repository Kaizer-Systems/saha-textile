import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo } from '../src/connection';
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

	it('lists published products filtered by category', async () => {
		const products = new MongoProductRepository();
		const page = await products.list({ categoryId: 'cat_unstitched', status: 'published' });
		expect(page.total).toBeGreaterThanOrEqual(1);
		expect(page.items.every((p) => p.categoryIds.includes('cat_unstitched'))).toBe(true);
	});
});
