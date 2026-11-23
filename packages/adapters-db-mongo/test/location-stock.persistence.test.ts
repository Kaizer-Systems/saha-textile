import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { InventoryCostLayerModel, InventoryLedgerModel } from '../src/models/inventory.model';
import { LocationStockModel } from '../src/models/location-stock.model';
import { ProductVariantModel } from '../src/models/index';
import { MongoStockMovement } from '../src/repositories/purchasing.repository';

import { hasMongoEnv } from './mongo-test-env';

/**
 * Stock by location (accounts brief F4) against a real replica set:
 *   node scripts/secrets/test-login.mjs run saha_textile_location_stock_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/location-stock.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('stock by location (integration, rs0)', () => {
	const stock = new MongoStockMovement();
	const wipe = () =>
		Promise.all([
			LocationStockModel.deleteMany({}),
			InventoryLedgerModel.deleteMany({ productId: 'prd_loc_test' }),
			InventoryCostLayerModel.deleteMany({ variantId: { $in: ['var_loc_a', 'var_loc_b'] } }),
			ProductVariantModel.collection.deleteMany({ _id: { $in: ['var_loc_a', 'var_loc_b'] } } as never),
		]);
	beforeAll(async () => {
		await connectMongo();
		await wipe();
		await ProductVariantModel.collection.insertMany([
			{
				_id: 'var_loc_a',
				productId: 'prd_loc_test',
				stock: { tracked: true, quantity: 5, held: 1, reserved: 0 },
			},
			{
				_id: 'var_loc_b',
				productId: 'prd_loc_test',
				stock: { tracked: true, quantity: 0, held: 0, reserved: 0 },
			},
		] as never);
	});
	afterAll(async () => {
		await wipe();
		await disconnectMongo();
	});

	it('places stock that has no location once, then each move updates its location with the variant', async () => {
		expect(await stock.placeUnlocatedStock('loc_bar')).toMatchObject({ variants: 1 });
		expect((await stock.placeUnlocatedStock('loc_bar')).variants).toBe(0);
		await stock.move({
			variantId: 'var_loc_a',
			productId: 'prd_loc_test',
			quantityDelta: -2,
			heldDelta: 0,
			reservedDelta: 0,
			source: 'order_placed',
			reasonCode: null,
			note: null,
			referenceType: 'order',
			referenceId: 'ord_1',
			referenceNumber: null,
			actorUserId: null,
			approverUserId: null,
			at: '2026-11-23T10:00:00.000Z',
			locationId: 'loc_bar',
		});
		await stock.move({
			variantId: 'var_loc_b',
			productId: 'prd_loc_test',
			quantityDelta: 3,
			heldDelta: 0,
			source: 'purchase_invoice',
			reasonCode: null,
			note: null,
			referenceType: 'purchase',
			referenceId: 'pe_1',
			referenceNumber: null,
			actorUserId: null,
			approverUserId: null,
			at: '2026-11-23T10:05:00.000Z',
			locationId: 'loc_aga',
		});
		const rows = await stock.locationStock(['var_loc_a', 'var_loc_b']);
		expect(rows.map((r) => [r.variantId, r.locationId, r.onHand, r.held]).sort()).toEqual([
			['var_loc_a', 'loc_bar', 3, 1],
			['var_loc_b', 'loc_aga', 3, 0],
		]);
		const ledger = await InventoryLedgerModel.find({ productId: 'prd_loc_test' }).lean().exec();
		expect(ledger.map((row) => (row as { locationId?: string }).locationId).sort()).toEqual(['loc_aga', 'loc_bar']);
	});
});
