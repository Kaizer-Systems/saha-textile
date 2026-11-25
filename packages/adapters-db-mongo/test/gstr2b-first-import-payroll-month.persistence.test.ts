import { Gstr2bImport, PayrollRun } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { Gstr2bImportModel, PayrollRunModel } from '../src/models/bank.model';
import { MongoGstr2bRepository } from '../src/repositories/gst-draft.repository';
import { MongoPayrollRunRepository } from '../src/repositories/payroll.repository';

import { hasMongoEnv } from './mongo-test-env';

/**
 * Two fixes from the full accounts run: a first GSTR-2B import (no decisions yet) reads back, and two people preparing
 * the same payroll month at once make one run, not two:
 *   node scripts/secrets/test-login.mjs run saha_textile_gst_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/gstr2b-first-import-payroll-month.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('a first 2B import and one payroll run a month (integration, rs0)', () => {
	const at = '2026-12-14T06:00:00.000Z';
	/** A registration, ids and a month no other suite uses, so only this file's rows are cleared. */
	const REG = 'reg_gstr2b_first';
	const MONTH = '2098-07';
	const wipe = () =>
		Promise.all([
			Gstr2bImportModel.deleteMany({ gstRegistrationId: REG }),
			PayrollRunModel.deleteMany({ _id: { $regex: /^pay_dbmonth_/ } }),
		]);

	beforeAll(async () => {
		await connectMongo();
		await Promise.all([Gstr2bImportModel.createIndexes(), PayrollRunModel.createIndexes()]);
		await wipe();
	});
	afterAll(async () => {
		await wipe();
		await disconnectMongo();
	});

	it('reads back a first GSTR-2B import whose decisions are still empty', async () => {
		const repo = new MongoGstr2bRepository();
		const first = Gstr2bImport.parse({
			id: 'g2b_first',
			gstRegistrationId: REG,
			gstin: '19AABCG1234A1Z5',
			month: '2026-11',
			generatedOn: '2026-12-14',
			lines: [],
			notRead: [],
			decisions: {},
			importedBy: 'adm_1',
			importedByName: 'Sudip Ghosh',
			importedAt: at,
			version: 0,
		});
		await repo.save(first, null);
		expect(await Gstr2bImportModel.findById('g2b_first').lean().exec()).toMatchObject({ decisions: {} });
		expect(await repo.find(REG, '2026-11')).toEqual(first);
	});

	describe('payroll runs', () => {
		const repo = new MongoPayrollRunRepository();
		const run = (id: string): PayrollRun =>
			PayrollRun.parse({
				id: `pay_dbmonth_${id}`,
				month: MONTH,
				status: 'draft',
				rows: [],
				rulesFrom: '2026-04-01',
				createdAt: at,
				updatedAt: at,
				version: 0,
			});

		it('keeps one run when two are prepared for the same month at once, refusing the other as changed', async () => {
			const both = await Promise.allSettled([repo.save(run('a'), null), repo.save(run('b'), null)]);
			expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			const [refused] = both.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
			expect(refused?.reason).toMatchObject({
				message: 'payroll_run_changed',
				cause: { code: 11000, keyPattern: { month: 1 } },
			});
			expect(await PayrollRunModel.countDocuments({ month: MONTH })).toBe(1);
			// Later, a third with its own id is refused the same way.
			await expect(repo.save(run('c'), null)).rejects.toThrow('payroll_run_changed');
			expect((await repo.get(MONTH))?.id).toMatch(/^pay_dbmonth_[ab]$/);
		});
	});
});
