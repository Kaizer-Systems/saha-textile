import { randomUUID } from 'node:crypto';

import { Location } from '@saha-textile/contracts';
import { StaleVersionError } from '@saha-textile/core-domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo } from '../src/connection';
import { LocationModel, UserLocationsModel } from '../src/models/locations.model';
import { MongoLocationRepository } from '../src/repositories/location.repository';

/** Locations (accounts brief K, L) against a real replica set, on a _test database only. */
function hasMongoEnv(): boolean {
	if (process.env.RUN_DB_IT !== '1') return false;
	try {
		return buildMongoConfig().dbName.endsWith('_test');
	} catch {
		return false;
	}
}

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
		await UserLocationsModel.deleteMany({});
	});
	afterAll(async () => {
		await LocationModel.deleteMany({});
		await UserLocationsModel.deleteMany({});
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
		await repo.saveUserLocations({
			userId: 'usr_1',
			worksAt: ['loc_1'],
			homeLocationId: 'loc_1',
			maySwitch: false,
			maySeeAll: false,
			currentLocationId: null,
			updatedAt: at(),
		});
		expect(await repo.userLocations('usr_1')).toMatchObject({ worksAt: ['loc_1'], homeLocationId: 'loc_1' });
		expect(await repo.allUserLocations()).toHaveLength(1);
	});
});
