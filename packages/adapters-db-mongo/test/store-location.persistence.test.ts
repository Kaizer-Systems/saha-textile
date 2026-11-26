import { StoreLocation, WEEKDAYS } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { StoreLocationModel } from '../src/models/index';
import { MongoStoreLocationRepository } from '../src/repositories/store-location.repository';
import { hasMongoEnv, runPrefix } from './mongo-test-env';

/**
 * Stores against the replica set: the display order, reordering, the week always read back as seven
 * days, and deletion.
 *
 *   MONGODB_PORT=27018 MONGODB_DB_NAME=saha_textile_test RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
describe.runIf(hasMongoEnv())('store location persistence (rs0)', () => {
	const stores = new MongoStoreLocationRepository();
	const prefix = runPrefix('store');

	const store = (name: string, displayOrder: number) =>
		StoreLocation.parse({
			id: `${prefix}${name}`,
			name: { en: `Store ${name}`, bn: `দোকান ${name}` },
			address: { en: 'Road', bn: 'রাস্তা' },
			pinCode: '700124',
			mapUrl: 'https://maps.google.com/?cid=1',
			geo: { lat: 22.72, lng: 88.48 },
			phone: '+913325521595',
			hours: WEEKDAYS.map((day) => ({ day, open: day !== 'sun', opens: '10:00', closes: '21:00' })),
			photoAssetIds: [`${prefix}photo`],
			imageVersions: { [`${prefix}photo`]: 'store_photo_4x3.blur' },
			displayOrder,
			active: true,
		});

	const mine = async () => (await stores.list()).filter((row) => row.id.startsWith(prefix));

	beforeAll(async () => {
		await connectMongo();
		await StoreLocationModel.syncIndexes();
	});

	afterAll(async () => {
		await StoreLocationModel.deleteMany({ _id: new RegExp(`^${prefix}`) }).exec();
		await disconnectMongo();
	});

	it('saves, reads back seven days and lists in display order', async () => {
		await stores.save(store('b', 2));
		await stores.save(store('a', 1));
		const rows = await mine();
		expect(rows.map((row) => row.id)).toEqual([`${prefix}a`, `${prefix}b`]);
		expect(rows[0]?.hours).toHaveLength(7);
		expect(rows[0]?.hours.at(-1)).toEqual({ day: 'sun', open: false, opens: null, closes: null });
		expect(rows[0]?.geo).toEqual({ lat: 22.72, lng: 88.48 });
		expect(rows[0]?.imageVersions).toEqual({ [`${prefix}photo`]: 'store_photo_4x3.blur' });
		expect(rows[0]?.createdAt).toBeTruthy();
	});

	it('reorders by the ids given', async () => {
		await stores.setOrder([`${prefix}b`, `${prefix}a`]);
		await stores.setOrder([]);
		expect((await mine()).map((row) => row.id)).toEqual([`${prefix}b`, `${prefix}a`]);
	});

	it('fills a short or broken stored week and a missing geo', async () => {
		await StoreLocationModel.updateOne(
			{ _id: `${prefix}a` },
			{ $set: { hours: [{ day: 'mon', open: true, opens: '09:00', closes: '18:00' }], geo: null } },
		).exec();
		const row = await stores.findById(`${prefix}a`);
		expect(row?.hours[0]).toEqual({ day: 'mon', open: true, opens: '09:00', closes: '18:00' });
		expect(row?.hours[1]).toEqual({ day: 'tue', open: false, opens: null, closes: null });
		expect(row?.geo).toBeNull();
	});

	it('reads a bare stored row with every default filled', async () => {
		await StoreLocationModel.collection.insertOne({
			_id: `${prefix}bare`,
			pinCode: '700124',
			mapUrl: 'https://maps.google.com/?cid=1',
		} as never);
		const row = await stores.findById(`${prefix}bare`);
		expect(row).toMatchObject({
			name: {},
			address: {},
			landmark: {},
			phone: null,
			photoAssetIds: [],
			displayOrder: 0,
			active: false,
		});
		expect(row?.hours.every((day) => !day.open)).toBe(true);
	});

	it('deletes, and finds nothing after', async () => {
		await stores.remove(`${prefix}a`);
		expect(await stores.findById(`${prefix}a`)).toBeNull();
	});
});
