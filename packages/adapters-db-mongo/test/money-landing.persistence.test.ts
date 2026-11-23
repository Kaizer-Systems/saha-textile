import { MoneyLanding } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { LedgerSettingModel } from '../src/models/ledger.model';
import { MongoMoneyLandingRepository } from '../src/repositories/ledger.repository';

import { hasMongoEnv } from './mongo-test-env';

/**
 * Where money lands (Postings and Convert brief AP-D1) against a real replica set:
 *   node scripts/secrets/test-login.mjs run saha_textile_templates_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/money-landing.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('money landing persistence (integration, rs0)', () => {
	beforeAll(async () => {
		await connectMongo();
		await LedgerSettingModel.deleteMany({});
	});
	afterAll(async () => {
		await LedgerSettingModel.deleteMany({});
		await disconnectMongo();
	});

	it('reads the defaults, saves once, and refuses a save over a newer one', async () => {
		const repo = new MongoMoneyLandingRepository();
		expect(await repo.get()).toEqual(MoneyLanding.parse({}));
		const first = MoneyLanding.parse({ receivedByBank: 'led_hdfc', updatedAt: '2026-11-24T10:00:00.000Z' });
		await repo.save(first, null);
		await expect(repo.save(first, null)).rejects.toThrow('money_landing_changed');
		await repo.save({ ...first, paidByBank: 'led_hdfc', updatedAt: '2026-11-24T11:00:00.000Z' }, first.updatedAt);
		await expect(repo.save(first, first.updatedAt)).rejects.toThrow('money_landing_changed');
		expect(await repo.get()).toMatchObject({ receivedByBank: 'led_hdfc', paidByBank: 'led_hdfc' });
		const broken = new MongoMoneyLandingRepository();
		await expect(broken.save({ ...first, updatedAt: { bad: true } as never }, 'x' as never)).rejects.toThrow();
	});
});
