import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { CommunicationSwitchModel } from '../src/models/index';
import { MongoCommunicationSwitchRepository } from '../src/repositories/communication-switch.repository';
import { hasMongoEnv, runPrefix } from './mongo-test-env';

/**
 * Settings › Communications switches against the replica set: one row per cell, saved again in place.
 *
 *   MONGODB_PORT=27018 MONGODB_DB_NAME=saha_textile_test RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
describe.runIf(hasMongoEnv())('communication switch persistence (rs0)', () => {
	const switches = new MongoCommunicationSwitchRepository();
	const use = `${runPrefix('comm')}use`.replace(/[^a-z0-9_]/g, '_');

	beforeAll(async () => {
		await connectMongo();
	});

	afterAll(async () => {
		await CommunicationSwitchModel.deleteMany({ use }).exec();
		await disconnectMongo();
	});

	it('reads nothing for a cell never changed, then keeps one row per cell', async () => {
		expect(await switches.find(use, 'sms')).toBeNull();
		await switches.save({ use, channel: 'sms', on: true, updatedBy: 'admin_1', updatedAt: null });
		const saved = await switches.save({ use, channel: 'sms', on: false, updatedBy: 'admin_2', updatedAt: null });
		expect(saved).toMatchObject({ use, channel: 'sms', on: false, updatedBy: 'admin_2' });
		expect(saved.updatedAt).toEqual(expect.any(String));
		expect(await CommunicationSwitchModel.countDocuments({ use }).exec()).toBe(1);
		expect((await switches.list()).filter((row) => row.use === use)).toHaveLength(1);
	});
});
