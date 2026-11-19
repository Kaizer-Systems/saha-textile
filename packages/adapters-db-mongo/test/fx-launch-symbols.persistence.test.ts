import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { writeLaunchCurrencySymbols } from '../src/migrations/fx-launch-symbols';
import { CurrencyModel, type CurrencyDoc } from '../src/models/index';
import { hasMongoEnv } from './mongo-test-env';

/**
 * Migration 0009 against the replica set: the theme's bare "$" becomes the brief's symbol; a symbol
 * staff chose stays. The rows it touches are put back as they were.
 *
 *   MONGODB_PORT=27018 MONGODB_DB_NAME=saha_textile_test RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
describe.runIf(hasMongoEnv())('launch currency symbols (rs0)', () => {
	const before = new Map<string, CurrencyDoc | null>();

	beforeAll(async () => {
		await connectMongo();
		for (const code of ['USD', 'CAD']) before.set(code, await CurrencyModel.findById(code).lean<CurrencyDoc>());
	});

	afterAll(async () => {
		for (const [code, doc] of before) {
			if (doc) await CurrencyModel.replaceOne({ _id: code }, doc, { upsert: true });
			else await CurrencyModel.deleteOne({ _id: code });
		}
		await disconnectMongo();
	});

	it('writes US$ over a bare "$" and keeps a symbol staff chose', async () => {
		const row = (code: string, symbol: string) => ({ _id: code, symbol, enabled: true, rateFromINR: 0.012 });
		await CurrencyModel.replaceOne({ _id: 'USD' }, row('USD', '$'), { upsert: true });
		await CurrencyModel.replaceOne({ _id: 'CAD' }, row('CAD', 'CA$'), { upsert: true });
		expect(await writeLaunchCurrencySymbols()).toMatch(/^wrote [1-9]\d* launch currency symbols?$/);
		expect((await CurrencyModel.findById('USD').lean<CurrencyDoc>())?.symbol).toBe('US$');
		expect((await CurrencyModel.findById('CAD').lean<CurrencyDoc>())?.symbol).toBe('CA$');
		expect(await writeLaunchCurrencySymbols()).toBe('wrote 0 launch currency symbols');
	});
});
