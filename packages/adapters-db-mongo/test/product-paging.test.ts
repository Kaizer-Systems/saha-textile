import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo } from '../src/connection';
import { ProductModel } from '../src/models/index';
import { MongoProductRepository } from '../src/repositories/product.repository';

function hasMongoEnv(): boolean {
	if (process.env.RUN_DB_IT !== '1') return false;
	try {
		buildMongoConfig();
		return true;
	} catch {
		return false;
	}
}

describe.skipIf(!hasMongoEnv())('product paging (integration)', () => {
	const products = new MongoProductRepository();
	const tag = `paging-${randomUUID()}`;
	const sameDate = new Date('2026-01-01T00:00:00.000Z');

	beforeAll(async () => {
		await connectMongo();
		await ProductModel.collection.insertMany(
			Array.from({ length: 30 }, (_, index) => ({
				_id: `prd_paging_${tag}_${String(index).padStart(2, '0')}` as never,
				type: 'simple',
				sku: `${tag}-${index}`,
				slug: `${tag}-${index}`,
				title: { en: `Paging ${index}` },
				basePriceINR: 1000,
				status: 'live',
				tags: [tag],
				createdAt: sameDate,
				updatedAt: sameDate,
			})),
		);
	});

	afterAll(async () => {
		await ProductModel.deleteMany({ tags: tag }).exec();
		await disconnectMongo();
	});

	it('returns every product once when they share a date', async () => {
		const seen: string[] = [];
		for (let page = 1; page <= 3; page += 1) {
			const { items } = await products.list({ audience: 'admin', tag, page, pageSize: 10 });
			seen.push(...items.map((product) => product.id));
		}

		expect(seen).toHaveLength(30);
		expect(new Set(seen).size).toBe(30);
	});
});
