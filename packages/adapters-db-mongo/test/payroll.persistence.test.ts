import { randomBytes } from 'node:crypto';

import { Attendance, Employee, PayrollRun } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { EmployeeModel, PayrollAttendanceModel, PayrollRunModel } from '../src/models/bank.model';
import {
	MongoAttendanceRepository,
	MongoEmployeeRepository,
	MongoPayrollRunRepository,
} from '../src/repositories/payroll.repository';
import { MongoTransactionManager } from '../src/transaction-manager';

import { hasMongoEnv } from './mongo-test-env';

/**
 * Payroll's stores (accounts brief S, D29): employees with Aadhaar and bank numbers sealed, a month's attendance and
 * the monthly run, each saved over the version read:
 *   node scripts/secrets/test-login.mjs run saha_textile_payroll_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/payroll.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('payroll (integration, rs0)', () => {
	const at = '2026-12-01T06:00:00.000Z';
	/** A key made for this run only; never a real one. */
	const key = new Uint8Array(randomBytes(32));
	const sealed = new MongoEmployeeRepository(key);
	const plain = new MongoEmployeeRepository(null);
	const tx = new MongoTransactionManager();
	/** Ids and months no other suite uses, so only this file's rows are cleared and listed. */
	const MONTHS = ['2099-01', '2099-02', '2099-03'];
	const wipe = () =>
		Promise.all([
			EmployeeModel.deleteMany({ _id: { $regex: /^emp_dbtest_/ } }),
			PayrollAttendanceModel.deleteMany({ _id: { $in: MONTHS } }),
			PayrollRunModel.deleteMany({ _id: { $regex: /^pay_dbtest_/ } }),
		]);

	const employee = (id: string, name: string, over: Partial<Employee> = {}): Employee =>
		Employee.parse({
			id: `emp_dbtest_${id}`,
			name,
			locationId: 'loc_bar',
			joinedOn: '2025-04-01',
			structure: { basic: 16_000, special: 16_000 },
			createdAt: at,
			updatedAt: at,
			version: 0,
			...over,
		});

	beforeAll(async () => {
		await connectMongo();
		await wipe();
	});
	afterAll(async () => {
		await wipe();
		await disconnectMongo();
	});

	describe('employees', () => {
		it('needs a key of 32 bytes', () => {
			expect(() => new MongoEmployeeRepository(new Uint8Array(16))).toThrow('PAYROLL_PII_KEY must be 32 bytes');
			expect(() => new MongoEmployeeRepository()).not.toThrow();
		});

		it('seals Aadhaar and the bank account, never storing them plain, and reads them back', async () => {
			const meera = employee('meera', 'Meera', { aadhaar: '123456789012', bankAccount: '50100012345678' });
			await sealed.insert(meera);
			const raw = (await EmployeeModel.findById('emp_dbtest_meera').lean().exec()) as Record<string, unknown>;
			expect(raw).not.toHaveProperty('aadhaar');
			expect(raw).not.toHaveProperty('bankAccount');
			expect(raw['aadhaarSealed']).toMatchObject({
				iv: expect.any(String),
				tag: expect.any(String),
				data: expect.any(String),
			});
			expect(JSON.stringify(raw)).not.toContain('123456789012');
			expect(await sealed.get('emp_dbtest_meera')).toEqual(meera);
			expect(await sealed.get('emp_dbtest_gone')).toBeNull();
		});

		it('keeps someone without personal numbers with or without the key, and refuses numbers without it', async () => {
			await plain.insert(employee('arun', 'Arun'));
			expect(await sealed.get('emp_dbtest_arun')).toMatchObject({ aadhaar: '', bankAccount: '' });
			await expect(plain.insert(employee('x', 'Xavier', { aadhaar: '123456789012' }))).rejects.toThrow(
				'payroll_pii_key_missing',
			);
			await expect(plain.insert(employee('y', 'Yusuf', { bankAccount: '123' }))).rejects.toThrow(
				'payroll_pii_key_missing',
			);
		});

		it('reads sealed numbers as empty without the key, or with a key that doesn’t open them', async () => {
			expect(await plain.get('emp_dbtest_meera')).toMatchObject({ aadhaar: '', bankAccount: '' });
			const other = new MongoEmployeeRepository(new Uint8Array(randomBytes(32)));
			expect(await other.get('emp_dbtest_meera')).toMatchObject({ aadhaar: '', bankAccount: '', name: 'Meera' });
		});

		it('lists employees by name, and saves over the version read, in a transaction or not', async () => {
			const mine = (await sealed.list()).filter((e) => e.id.startsWith('emp_dbtest_'));
			expect(mine.map((e) => e.name)).toEqual(['Arun', 'Meera']);
			const meera = mine[1] as Employee;
			expect((await sealed.save({ ...meera, advanceDueINR: 5_000 }, 0)).version).toBe(1);
			await tx.withTransaction((context) => sealed.save({ ...meera, advanceDueINR: 4_000 }, 1, context));
			expect(await sealed.get('emp_dbtest_meera')).toMatchObject({
				advanceDueINR: 4_000,
				aadhaar: '123456789012',
				version: 2,
			});
			await expect(sealed.save(meera, 1)).rejects.toThrow('employee_changed');
		});
	});

	describe('attendance', () => {
		const month = (m: string, over: Partial<Attendance> = {}): Attendance =>
			Attendance.parse({
				month: m,
				daysInMonth: 31,
				rows: [{ employeeId: 'emp_dbtest_meera', paidDays: 31 }],
				...over,
			});
		const repo = new MongoAttendanceRepository();

		it('keeps one per month, first at version 0, then over the version read', async () => {
			expect(await repo.get('2099-01')).toBeNull();
			expect((await repo.save(month('2099-01', { version: 9 }), null)).version).toBe(0);
			expect(await repo.get('2099-01')).toEqual(month('2099-01'));
			await expect(repo.save(month('2099-01'), null)).rejects.toThrow('attendance_changed');
			const locked = await repo.save(month('2099-01', { lockedAt: at, lockedBy: 'adm_clerk' }), 0);
			expect(locked.version).toBe(1);
			expect(await repo.get('2099-01')).toMatchObject({ lockedAt: at, lockedBy: 'adm_clerk', version: 1 });
			await expect(repo.save(month('2099-01'), 0)).rejects.toThrow('attendance_changed');
		});

		it('passes on any other failure to create', async () => {
			const noMonth = repo.save({ ...month('2099-02'), month: undefined as never }, null);
			await expect(noMonth).rejects.toThrow();
			await expect(noMonth).rejects.not.toThrow('attendance_changed');
		});
	});

	describe('payroll runs', () => {
		const run = (id: string, m: string, over: Partial<PayrollRun> = {}): PayrollRun =>
			PayrollRun.parse({
				id: `pay_dbtest_${id}`,
				month: m,
				status: 'draft',
				rows: [],
				rulesFrom: '2026-04-01',
				createdAt: at,
				updatedAt: at,
				version: 0,
				...over,
			});
		const repo = new MongoPayrollRunRepository();

		it('keeps runs, in a transaction or not, finds one by month and lists the newest month first', async () => {
			await repo.save(run('jan', '2099-01'), null);
			await tx.withTransaction((context) => repo.save(run('feb', '2099-02'), null, context));
			expect(await repo.get('2099-02')).toEqual(run('feb', '2099-02'));
			expect(await repo.get('2099-03')).toBeNull();
			const mine = (await repo.list()).filter((r) => r.id.startsWith('pay_dbtest_'));
			expect(mine.map((r) => r.month)).toEqual(['2099-02', '2099-01']);
			await expect(repo.save(run('jan', '2099-01'), null)).rejects.toThrow('payroll_run_changed');
			const noId = repo.save({ ...run('x', '2099-03'), id: undefined as never }, null);
			await expect(noId).rejects.toThrow();
			await expect(noId).rejects.not.toThrow('payroll_run_changed');
		});

		it('saves a run over the version read, in a transaction or not, and refuses a version someone saved over', async () => {
			expect((await repo.save(run('jan', '2099-01', { status: 'approved' }), 0)).version).toBe(1);
			await tx.withTransaction((context) =>
				repo.save(run('jan', '2099-01', { status: 'posted', voucherId: 'jv_1' }), 1, context),
			);
			expect(await repo.get('2099-01')).toMatchObject({ status: 'posted', voucherId: 'jv_1', version: 2 });
			await expect(repo.save(run('jan', '2099-01'), 1)).rejects.toThrow('payroll_run_changed');
		});
	});
});
