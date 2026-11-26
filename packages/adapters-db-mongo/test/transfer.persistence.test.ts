import type { StockTransfer } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { StockTransferModel } from '../src/models/transfer.model';
import { MongoTransferRepository } from '../src/repositories/transfer.repository';
import { MongoTransactionManager } from '../src/transaction-manager';

import { hasMongoEnv } from './mongo-test-env';

/**
 * Stock transfers (accounts brief N) in MongoDB:
 *   node scripts/secrets/test-login.mjs run saha_textile_transfer_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/transfer.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('stock transfers (integration, rs0)', () => {
	const repo = new MongoTransferRepository();
	const tx = new MongoTransactionManager();
	const transfer = (id: string, over: Partial<StockTransfer> = {}): StockTransfer =>
		({
			id,
			number: `TR/26-27/${id}`,
			status: 'requested',
			fromLocationId: 'loc_bar',
			toLocationId: 'loc_sl',
			lines: [
				{
					lineId: `${id}_l1`,
					variantId: 'v_kan',
					productId: 'p_kan',
					sku: 'KAN-PB',
					title: 'Kanchipuram Saree',
					hsn: '5007',
					soldBy: 'piece',
					quantity: 2,
					packed: 2,
					arrived: null,
					damaged: null,
					note: '',
					drawn: [],
					valueINR: null,
					holdId: null,
				},
			],
			neededBy: null,
			forOrderId: null,
			forOrderNumber: null,
			note: '',
			crossGstin: false,
			sealNumber: '',
			boxes: null,
			photoAssetIds: [],
			vehicle: '',
			ewayBillNumber: null,
			challanNumber: null,
			branchInvoice: null,
			valueINR: 0,
			short: null,
			rejectReason: null,
			voucherIds: [],
			timeline: [],
			requestedBy: null,
			version: 0,
			createdAt: '2026-11-21T05:00:00.000Z',
			updatedAt: '2026-11-21T05:00:00.000Z',
			...over,
		}) as StockTransfer;

	beforeAll(async () => {
		await connectMongo();
		await StockTransferModel.syncIndexes();
		await StockTransferModel.deleteMany({});
	});
	afterAll(async () => {
		await StockTransferModel.deleteMany({});
		await disconnectMongo();
	});

	it('keeps numbers unique, saves only over the version read, and reads back in a transaction', async () => {
		await repo.insert(transfer('t1'));
		await expect(repo.insert(transfer('t1b', { number: 'TR/26-27/t1' }))).rejects.toMatchObject({ code: 11000 });
		const saved = await tx.withTransaction(async (context) => {
			const first = (await repo.get('t1', context)) as StockTransfer;
			return repo.save({ ...first, status: 'packing' }, 0, context);
		});
		expect(saved.version).toBe(1);
		await expect(repo.save({ ...saved, status: 'cancelled' }, 0)).rejects.toThrow('transfer_changed');
		expect((await repo.get('t1'))?.status).toBe('packing');
		expect(await repo.get('none')).toBeNull();
	});

	it('lists by India day, chip, search and location, with every chip counted', async () => {
		await repo.insert(transfer('t2', { status: 'in_transit', challanNumber: 'DC/26-27/000031' }));
		await repo.insert(
			transfer('t3', { status: 'received_short', fromLocationId: 'loc_gar', toLocationId: 'loc_bar' }),
		);
		// 23:30 on 22 Nov in India is the 22nd, not the 23rd.
		await repo.insert(
			transfer('t4', { createdAt: '2026-11-22T18:00:00.000Z', fromLocationId: 'loc_gar', toLocationId: 'loc_x' }),
		);
		const all = await repo.list({
			from: '2026-11-21',
			to: '2026-11-22',
			chip: 'all',
			search: '',
			locationIds: null,
			page: 1,
			pageSize: 10,
		});
		expect(all.total).toBe(4);
		expect(all.counts).toEqual({ all: 4, requested: 1, packing: 1, in_transit: 1, received_short: 1 });
		const byChallan = await repo.list({
			from: '2026-11-21',
			to: '2026-11-21',
			chip: 'in_transit',
			search: 'DC/26-27/000031',
			locationIds: ['loc_sl'],
			page: 1,
			pageSize: 10,
		});
		expect(byChallan.items.map((t) => t.id)).toEqual(['t2']);
		const gar = await repo.list({
			from: '2026-11-21',
			to: '2026-11-23',
			chip: 'all',
			search: 'kanchi',
			locationIds: ['loc_gar'],
			page: 1,
			pageSize: 1,
		});
		expect([gar.total, gar.items.length]).toEqual([2, 1]);
	});

	it('adds up the pieces in transit per variant, and finds what left in a month and is still on the way', async () => {
		expect(await repo.inTransit([])).toEqual({});
		expect(await repo.inTransit(['v_kan', 'v_none'])).toEqual({ v_kan: 2 });
		await repo.insert(
			transfer('t5', {
				status: 'in_transit',
				timeline: [{ status: 'in_transit', at: '2026-12-31T19:00:00.000Z', by: null, byName: null }],
			}),
		);
		await repo.insert(
			transfer('t6', {
				status: 'in_transit',
				timeline: [{ status: 'in_transit', at: '2026-11-30T10:00:00.000Z', by: null, byName: null }],
			}),
		);
		expect((await repo.inTransitFrom('2026-11')).map((t) => t.id)).toEqual(['t6']);
		expect((await repo.inTransitFrom('2026-12')).map((t) => t.id)).toEqual([]);
		expect((await repo.inTransitFrom('2027-01')).map((t) => t.id)).toEqual(['t5']);
	});
});
