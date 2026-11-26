import { PayrollAdvance, PayrollRulesVersion, SalaryTemplate } from '@saha-textile/contracts';
import { PAYROLL_RULES_2026, PAYROLL_SCHEMES_2026 } from '@saha-textile/core-domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import {
	PayrollAdvanceModel,
	PayrollRulesModel,
	SalaryTemplateModel,
	StatutoryFilingModel,
} from '../src/models/bank.model';
import {
	MongoPayrollAdvanceRepository,
	MongoPayrollRulesRepository,
	MongoSalaryTemplateRepository,
	MongoStatutoryFilingRepository,
} from '../src/repositories/payroll.repository';
import { MongoTransactionManager } from '../src/transaction-manager';

import { hasMongoEnv } from './mongo-test-env';

/**
 * Payroll's rule versions (accounts brief S1), structure templates (S4), returns marked filed (S7) and advances (S9):
 *   MONGODB_DB_NAME=saha_textile_test node scripts/secrets/test-login.mjs run saha_textile_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/payroll-setup.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('payroll setup stores (integration, rs0)', () => {
	const at = '2026-12-01T06:00:00.000Z';
	/** Ids and periods no other suite uses, so only this file's rows are cleared and listed. */
	const PERIODS = ['pf:2099-01', 'pf:2099-02', 'tds:2099-01', 'pt:2098-12:19', 'pt:2098-12:27', 'lwf:2098-12'];
	const wipe = () =>
		Promise.all([
			PayrollRulesModel.deleteMany({ _id: { $regex: /^prs_dbtest_/ } }),
			SalaryTemplateModel.deleteMany({ _id: { $regex: /^sst_dbtest_/ } }),
			StatutoryFilingModel.deleteMany({ _id: { $in: PERIODS } }),
			PayrollAdvanceModel.deleteMany({ _id: { $regex: /^adv_dbtest_/ } }),
		]);

	beforeAll(async () => {
		await connectMongo();
		await wipe();
	});
	afterAll(async () => {
		await wipe();
		await disconnectMongo();
	});

	describe('rule versions', () => {
		const repo = new MongoPayrollRulesRepository();
		const version = (from: string) =>
			PayrollRulesVersion.parse({
				...PAYROLL_RULES_2026,
				...PAYROLL_SCHEMES_2026,
				ptSlabs: [...PAYROLL_RULES_2026.ptSlabs],
				lwfMonths: [...PAYROLL_SCHEMES_2026.lwfMonths],
				from,
				id: `prs_dbtest_${from}`,
				createdAt: at,
			});

		it('keeps one version per starting day and lists them oldest first', async () => {
			await repo.insert(version('2099-10-01'));
			await repo.insert(version('2099-04-01'));
			const mine = (await repo.list()).filter((v) => v.id.startsWith('prs_dbtest_'));
			expect(mine.map((v) => v.from)).toEqual(['2099-04-01', '2099-10-01']);
			expect(mine[0]).toEqual(version('2099-04-01'));
			await expect(repo.insert(version('2099-04-01'))).rejects.toThrow('payroll_rules_from_taken');
		});

		it('passes on any other failure to save', async () => {
			const noId = repo.insert({ ...version('2099-12-01'), id: undefined as never });
			await expect(noId).rejects.toThrow();
			await expect(noId).rejects.not.toThrow('payroll_rules_from_taken');
		});
	});

	describe('structure templates', () => {
		const repo = new MongoSalaryTemplateRepository();
		const template = (id: string, name: string, version = 0) =>
			SalaryTemplate.parse({
				id: `sst_dbtest_${id}`,
				name,
				components: [
					{ head: 'basic', how: 'percent', value: 50 },
					{ head: 'special', how: 'rest' },
				],
				createdAt: at,
				updatedAt: at,
				version,
			});

		it('keeps templates, lists them by name, and saves over the version read', async () => {
			await repo.insert(template('b', 'Shop staff'));
			await repo.insert(template('a', 'Office staff'));
			const mine = (await repo.list()).filter((t) => t.id.startsWith('sst_dbtest_'));
			expect(mine.map((t) => t.name)).toEqual(['Office staff', 'Shop staff']);
			expect(await repo.get('sst_dbtest_b')).toEqual(template('b', 'Shop staff'));
			expect(await repo.get('sst_dbtest_gone')).toBeNull();
			expect((await repo.save(template('b', 'Counter staff'), 0)).version).toBe(1);
			expect(await repo.get('sst_dbtest_b')).toMatchObject({ name: 'Counter staff', version: 1 });
			await expect(repo.save(template('b', 'Too late'), 0)).rejects.toThrow('salary_template_changed');
		});
	});

	describe('returns marked filed', () => {
		const repo = new MongoStatutoryFilingRepository();
		const filing = (kind: 'pf' | 'tds', period: string) => ({
			kind,
			period,
			filedOn: '2099-03-14',
			reference: `TRRN-${period}`,
			filedBy: 'adm_ca',
			filedAt: at,
		});

		it('marks each return filed once, and lists them newest period first without their key', async () => {
			await repo.insert(filing('pf', '2099-01'));
			await repo.insert(filing('pf', '2099-02'));
			await repo.insert(filing('tds', '2099-01'));
			const mine = (await repo.list()).filter((f) => f.period.startsWith('2099-'));
			expect(mine.map((f) => [f.kind, f.period])).toEqual([
				['pf', '2099-02'],
				['pf', '2099-01'],
				['tds', '2099-01'],
			]);
			expect(mine[0]).toEqual(filing('pf', '2099-02'));
			expect(mine[0]).not.toHaveProperty('_id');
			await expect(repo.insert(filing('pf', '2099-01'))).rejects.toThrow('statutory_already_filed');
		});

		it('marks professional tax filed once per State, and a return with no State by its period alone (brief 25 ST2)', async () => {
			const state = (stateCode: string | null) => ({
				...filing('pf', '2098-12'),
				kind: 'pt' as const,
				stateCode,
			});
			await repo.insert(state('19'));
			await repo.insert(state('27'));
			await repo.insert({ ...state(null), kind: 'lwf' });
			const ids = await StatutoryFilingModel.find({ period: '2098-12' }, { _id: 1 })
				.sort({ _id: 1 })
				.lean()
				.exec();
			expect(ids.map((row) => row._id)).toEqual(['lwf:2098-12', 'pt:2098-12:19', 'pt:2098-12:27']);
			expect((await repo.list()).find((f) => f.stateCode === '27')).toEqual(state('27'));
			await expect(repo.insert(state('19'))).rejects.toThrow('statutory_already_filed');
			await expect(repo.insert({ ...state(null), kind: 'lwf' })).rejects.toThrow('statutory_already_filed');
		});
	});

	describe('advances', () => {
		const repo = new MongoPayrollAdvanceRepository();
		const tx = new MongoTransactionManager();
		const advance = (id: string, employeeId: string, givenOn: string) =>
			PayrollAdvance.parse({
				id: `adv_dbtest_${id}`,
				employeeId,
				givenOn,
				amountPaise: 500_000,
				ledgerId: 'led_cash',
				voucherId: `jv_${id}`,
				note: '',
				createdBy: 'adm_clerk',
				createdAt: at,
			});

		it('keeps advances, in a transaction or not, and lists them by the day given, for one person or all', async () => {
			await repo.insert(advance('b', 'emp_dbtest_priya', '2099-11-03'));
			await tx.withTransaction((context) => repo.insert(advance('a', 'emp_dbtest_priya', '2099-09-03'), context));
			await repo.insert(advance('c', 'emp_dbtest_rahul', '2099-10-01'));
			expect((await repo.list('emp_dbtest_priya')).map((a) => a.id)).toEqual(['adv_dbtest_a', 'adv_dbtest_b']);
			const all = (await repo.list()).filter((a) => a.id.startsWith('adv_dbtest_'));
			expect(all.map((a) => a.givenOn)).toEqual(['2099-09-03', '2099-10-01', '2099-11-03']);
			expect(all[0]).toEqual(advance('a', 'emp_dbtest_priya', '2099-09-03'));
		});
	});
});
