import { randomUUID } from 'node:crypto';

import { Location } from '@saha-textile/contracts';
import { StaleVersionError } from '@saha-textile/core-domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { COLLECTION_NAMES, LEGACY_COLLECTION_NAMES } from '../src/collection-names';
import { connectMongo, disconnectMongo, getMongoose } from '../src/connection';
import { alignCollectionNames } from '../src/migrations/align-collection-names';
import { LocationModel, AdminUserLocationsModel } from '../src/models/locations.model';
import { MongoLocationRepository } from '../src/repositories/location.repository';

import { hasMongoEnv } from './mongo-test-env';

/** Locations (accounts brief K, L) against a real replica set, on a _test database only. */

describe.skipIf(!hasMongoEnv())('locations persistence (integration, rs0)', () => {
	const repo = new MongoLocationRepository();
	const at = () => new Date().toISOString();
	const make = (code: string) =>
		Location.parse({
			id: randomUUID(),
			name: `${code} store`,
			shortCode: code,
			stateCode: '19',
			createdAt: at(),
			updatedAt: at(),
		});
	beforeAll(async () => {
		await connectMongo();
		await LocationModel.syncIndexes();
		await LocationModel.deleteMany({});
		await AdminUserLocationsModel.deleteMany({});
	});
	afterAll(async () => {
		await LocationModel.deleteMany({});
		await AdminUserLocationsModel.deleteMany({});
		await disconnectMongo();
	});

	it('keeps short codes unique and saves only over the copy read', async () => {
		const first = make('BRS');
		await repo.save(first, null);
		await expect(repo.save(make('BRS'), null)).rejects.toThrow('short_code_taken');
		const edited = { ...first, name: 'Barasat store', updatedAt: at() };
		await repo.save(edited, first.updatedAt);
		await expect(repo.save({ ...first, name: 'stale' }, first.updatedAt)).rejects.toBeInstanceOf(StaleVersionError);
		expect((await repo.list()).map((l) => l.name)).toEqual(['Barasat store']);
	});

	it('stores where each user works', async () => {
		await repo.saveAdminUserLocations({
			userId: 'usr_1',
			worksAt: ['loc_1'],
			homeLocationId: 'loc_1',
			maySwitch: false,
			maySeeAll: false,
			currentLocationId: null,
			updatedAt: at(),
		});
		expect(await repo.adminUserLocations('usr_1')).toMatchObject({ worksAt: ['loc_1'], homeLocationId: 'loc_1' });
		expect(await repo.allAdminUserLocations()).toHaveLength(1);
	});

	it('moves existing operator assignments without changing them', async () => {
		const database = `saha_textile_it_location_alignment_${randomUUID().slice(0, 8)}`;
		const parent = getMongoose().connection;
		const connection = parent.useDb(database);
		const db = connection.db;
		if (!db) throw new Error('The migration test requires a database connection');
		try {
			const record = {
				_id: 'adm_existing',
				worksAt: ['loc_1'],
				homeLocationId: 'loc_1',
				currentLocationId: 'loc_1',
			};
			const target = COLLECTION_NAMES.AdminUserLocations;
			const pairs = { userLocations: target };
			expect(LEGACY_COLLECTION_NAMES['userLocations']).toBe(target);
			await db.collection<typeof record>('userLocations').insertOne(record);
			await expect(alignCollectionNames(connection, { pairs })).resolves.toMatchObject({
				renamed: 1,
				conflicts: 0,
			});
			await expect(db.collection<typeof record>(target).findOne({ _id: record._id })).resolves.toEqual(record);
			await expect(alignCollectionNames(connection, { pairs })).resolves.toMatchObject({
				renamed: 0,
				conflicts: 0,
			});
		} finally {
			await connection.dropDatabase();
		}
	});
});
