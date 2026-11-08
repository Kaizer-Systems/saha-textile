import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { WishlistItemModel } from '../src/models/index';
import { MongoWishlistRepository } from '../src/repositories/index';
import { hasMongoEnv, runPrefix } from './mongo-test-env';

const P = runPrefix('wishlist');

describe.skipIf(!hasMongoEnv())('MongoWishlistRepository (integration)', () => {
	const repo = new MongoWishlistRepository();
	const customer = `${P}c1`;

	beforeAll(async () => {
		await connectMongo();
		await WishlistItemModel.syncIndexes();
	});

	afterAll(async () => {
		await WishlistItemModel.deleteMany({ customerId: { $regex: `^${P}` } });
		await disconnectMongo();
	});

	it('saves once per product and lists newest first', async () => {
		await repo.add({ customerId: customer, productId: 'p1', at: '2026-11-08T10:00:00.000Z' });
		await repo.add({ customerId: customer, productId: 'p2', at: '2026-11-08T11:00:00.000Z' });
		await repo.add({ customerId: customer, productId: 'p1', at: '2026-11-08T12:00:00.000Z' });
		expect(await repo.listProductIds(customer)).toEqual(['p2', 'p1']);
		expect(await repo.listProductIds(`${P}nobody`)).toEqual([]);
	});

	it('adds a guest list in its order behind newer saves, skipping what is saved', async () => {
		await repo.addMany({ customerId: customer, productIds: [], at: '2026-11-08T13:00:00.000Z' });
		await repo.addMany({ customerId: customer, productIds: ['g1', 'p1', 'g2'], at: '2026-11-08T13:00:00.000Z' });
		expect(await repo.listProductIds(customer)).toEqual(['g1', 'g2', 'p2', 'p1']);
	});

	it('removes one, then everything for the customer only', async () => {
		await repo.add({ customerId: `${P}c2`, productId: 'p1', at: '2026-11-08T10:00:00.000Z' });
		await repo.remove({ customerId: customer, productId: 'g1' });
		expect(await repo.listProductIds(customer)).toEqual(['g2', 'p2', 'p1']);
		await repo.removeAllForCustomer(customer);
		expect(await repo.listProductIds(customer)).toEqual([]);
		expect(await repo.listProductIds(`${P}c2`)).toEqual(['p1']);
	});
});
