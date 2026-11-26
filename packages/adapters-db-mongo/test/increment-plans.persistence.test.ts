import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { IncrementPlanModel } from '../src/models/bank.model';
import { MongoIncrementPlanRepository } from '../src/repositories/payroll.repository';

import { hasMongoEnv, runPrefix } from './mongo-test-env';

/**
 * Brief 26 SR3: increment plans saved by name, saved again over themselves, and removed:
 *   node scripts/secrets/test-login.mjs run saha_textile_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/increment-plans.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('increment plans store (integration, rs0)', () => {
	const P = runPrefix('inc_plan');
	const repo = new MongoIncrementPlanRepository();
	const plan = (id: string, name: string) => ({
		id: `${P}${id}`,
		name,
		kind: 'rating' as const,
		bands: [
			{ rating: 'A+', pct: 12 },
			{ rating: 'A', pct: 8 },
		],
		pct: 0,
		amountMonthINR: 0,
		updatedAt: '2026-11-26T06:00:00.000Z',
	});
	const mine = async () => (await repo.list()).filter((p) => p.id.startsWith(P));

	beforeAll(async () => {
		await connectMongo();
	});
	afterAll(async () => {
		await IncrementPlanModel.deleteMany({ _id: { $regex: `^${P}` } }).exec();
		await disconnectMongo();
	});

	it('saves plans by name, lists them in name order, saves one again over itself, and removes one', async () => {
		await repo.save(plan('b', 'Store staff 2027'));
		await repo.save(plan('a', 'Managers 2027'));
		expect((await mine()).map((p) => p.name)).toEqual(['Managers 2027', 'Store staff 2027']);
		await repo.save({ ...plan('a', 'Managers 2027'), bands: [{ rating: 'A', pct: 10 }] });
		expect((await mine()).find((p) => p.id === `${P}a`)?.bands).toEqual([{ rating: 'A', pct: 10 }]);
		await repo.delete(`${P}b`);
		expect((await mine()).map((p) => p.name)).toEqual(['Managers 2027']);
	});
});
