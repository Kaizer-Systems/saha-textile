import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { InventoryLedgerModel } from '../src/models/index';
import { MongoStockReadRepository } from '../src/repositories/purchasing.repository';

import { hasMongoEnv, insertRaw, runPrefix } from './mongo-test-env';

/**
 * Stock moved since a count began, at one location or all (brief 25 SC1):
 *   MONGODB_DB_NAME=saha_textile_test node scripts/secrets/test-login.mjs run saha_textile_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/stock-moved-by-location.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('stock moved by location (integration, rs0)', () => {
	const P = runPrefix('moved_loc');
	const id = (name: string) => `${P}${name}`;
	const stock = new MongoStockReadRepository();
	const since = '2027-03-30T00:00:00.000Z';
	const row = (name: string, locationId: string | undefined, quantityDelta: number, at: string, ref = 'sale') =>
		insertRaw(InventoryLedgerModel, {
			_id: id(name),
			variantId: id('v_saree'),
			productId: id('p_saree'),
			...(locationId ? { locationId: id(locationId) } : {}),
			quantityDelta,
			source: 'manual_adjustment',
			referenceId: id(ref),
			createdAt: new Date(at),
		});

	beforeAll(async () => {
		await connectMongo();
		// Before the count began: never counted.
		await row('early', 'loc_kolkata', 9, '2027-03-29T10:00:00.000Z');
		// During the count: Kolkata sells 2 and takes in 5, the warehouse sends 3 away, a row made before locations sells 1,
		// and the count's own correction at Kolkata (+4) is left out when asked.
		await row('k_sold', 'loc_kolkata', -2, '2027-03-30T09:00:00.000Z');
		await row('k_in', 'loc_kolkata', 5, '2027-03-30T11:00:00.000Z');
		await row('w_out', 'loc_warehouse', -3, '2027-03-30T12:00:00.000Z');
		await row('old', undefined, -1, '2027-03-30T13:00:00.000Z');
		await row('k_count', 'loc_kolkata', 4, '2027-03-31T12:00:00.000Z', 'count');
	});
	afterAll(async () => {
		await InventoryLedgerModel.deleteMany({ _id: { $regex: `^${P}` } }).exec();
		await disconnectMongo();
	});

	it('adds up every location’s movement when none is named', async () => {
		const all = await stock.movedSince([id('v_saree')], since, null);
		expect(all.get(id('v_saree'))).toBe(-2 + 5 - 3 - 1 + 4);
		expect((await stock.movedSince([id('v_saree')], since, null, null)).get(id('v_saree'))).toBe(3);
	});

	it('keeps to the named location, leaving out the count’s own rows when asked', async () => {
		const kolkata = await stock.movedSince([id('v_saree')], since, null, id('loc_kolkata'));
		expect(kolkata.get(id('v_saree'))).toBe(-2 + 5 + 4);
		const withoutCount = await stock.movedSince([id('v_saree')], since, id('count'), id('loc_kolkata'));
		expect(withoutCount.get(id('v_saree'))).toBe(3);
		expect((await stock.movedSince([id('v_saree')], since, null, id('loc_warehouse'))).get(id('v_saree'))).toBe(-3);
	});

	it('finds nothing at a location with no movement', async () => {
		expect((await stock.movedSince([id('v_saree')], since, null, id('loc_siliguri'))).size).toBe(0);
	});
});
