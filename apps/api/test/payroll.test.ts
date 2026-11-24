import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Attendance, Employee, PayrollRun } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { PayrollService } from '../src/payroll/payroll.service';

/** Payroll (accounts brief S): employees, attendance, and the monthly run approved, posted and paid. */

const at = '2026-12-01T06:00:00.000Z';
const now = new Date(at);
const refusal = (code: string) => ({ response: { message: code } });
const clerk = { userId: 'adm_clerk', permissions: ['accounts.edit'] } as never;
const ca = { userId: 'adm_ca', permissions: ['accounts.post', 'accounts.lock'] } as never;

const employee = (id: string, name: string, each: number, over: Partial<Employee> = {}): Employee => ({
	name,
	code: '',
	userId: null,
	locationId: 'loc_bar',
	joinedOn: '2025-04-01',
	leftOn: null,
	pan: '',
	aadhaar: '',
	uan: '',
	esiNumber: '',
	ptState: '19',
	taxRegime: 'new',
	bankAccount: '',
	ifsc: '',
	pfOn: true,
	esiOn: true,
	structure: { basic: each, da: 0, hra: 0, special: each, conveyance: 0, other: 0 },
	advanceDueINR: 0,
	advancePerMonthINR: 0,
	id,
	createdAt: at,
	updatedAt: at,
	version: 0,
	...over,
});
/** The approved S5 picture: four people, half basic and half special allowance. */
const S5 = [
	employee('emp_meera', 'Meera', 16_000, { aadhaar: '123456789012', bankAccount: '50100012345678' }),
	employee('emp_priya', 'Priya', 9_000, { advanceDueINR: 5_000, advancePerMonthINR: 1_000 }),
	employee('emp_rahul', 'Rahul', 8_000, { locationId: 'loc_shop' }),
	employee('emp_sudip', 'Sudip', 27_500),
];

const lockedAttendance = (rows: Attendance['rows'], month = '2026-11'): Attendance => ({
	month,
	daysInMonth: 30,
	rows,
	lockedAt: at,
	lockedBy: 'adm_clerk',
	version: 1,
});
const S5_ATTENDANCE = lockedAttendance([
	{ employeeId: 'emp_meera', paidDays: 30, leaveTaken: 0, note: '' },
	{ employeeId: 'emp_priya', paidDays: 29, leaveTaken: 1, note: 'One day unpaid' },
	{ employeeId: 'emp_rahul', paidDays: 30, leaveTaken: 0, note: '' },
	{ employeeId: 'emp_sudip', paidDays: 30, leaveTaken: 0, note: '' },
	// Someone removed from the roll since: no pay for them.
	{ employeeId: 'emp_gone', paidDays: 30, leaveTaken: 0, note: '' },
]);

interface Options {
	employees?: Employee[];
	attendance?: Attendance[];
	runs?: PayrollRun[];
	chart?: { groups: { id: string; systemKey: string }[]; ledgers: Record<string, unknown>[] };
	employeeFails?: unknown;
	attendanceFails?: unknown;
	runFails?: unknown;
}

function build(options: Options = {}) {
	const people = new Map((options.employees ?? S5).map((e) => [e.id, e]));
	const employees = {
		list: async () => [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
		get: vi.fn(async (id: string) => people.get(id) ?? null),
		insert: vi.fn(async (e: Employee) => {
			if (options.employeeFails !== undefined) throw options.employeeFails;
			people.set(e.id, e);
		}),
		save: vi.fn(async (e: Employee, expectedVersion: number, _context?: unknown) => {
			if (options.employeeFails !== undefined) throw options.employeeFails;
			if (people.get(e.id)?.version !== expectedVersion) throw new Error('employee_changed');
			const saved = { ...e, version: expectedVersion + 1 };
			people.set(e.id, saved);
			return saved;
		}),
	};
	const months = new Map((options.attendance ?? []).map((a) => [a.month, a]));
	const attendance = {
		get: async (month: string) => months.get(month) ?? null,
		save: vi.fn(async (a: Attendance, expectedVersion: number | null) => {
			if (options.attendanceFails !== undefined) throw options.attendanceFails;
			const saved = { ...a, version: expectedVersion === null ? 0 : expectedVersion + 1 };
			months.set(a.month, saved);
			return saved;
		}),
	};
	const runStore = new Map((options.runs ?? []).map((r) => [r.month, r]));
	const runs = {
		list: async () => [...runStore.values()],
		get: async (month: string) => runStore.get(month) ?? null,
		save: vi.fn(async (r: PayrollRun, expectedVersion: number | null, _context?: unknown) => {
			if (options.runFails !== undefined) throw options.runFails;
			const saved = { ...r, version: expectedVersion === null ? 0 : expectedVersion + 1 };
			runStore.set(r.month, saved);
			return saved;
		}),
	};
	const chart = options.chart ?? {
		groups: [
			{ id: 'g_ind', systemKey: 'indirect_expenses' },
			{ id: 'g_cl', systemKey: 'current_liabilities' },
		],
		ledgers: [
			{ id: 'led_salaries', groupId: 'g_ind', name: 'Salaries and wages', roles: [] },
			{ id: 'led_tds', groupId: 'g_cl', name: 'TDS payable', roles: ['tds_payable'] },
			{ id: 'led_advance', groupId: 'g_ca', name: 'Staff advances', roles: ['staff_advance'] },
		],
	};
	let posted = 0;
	const ledger = {
		chart: async () => chart,
		addLedger: vi.fn(async (write: { name: string; groupId: string }, _by: string | null) => {
			const made = {
				id: `led_${write.name.toLowerCase().replace(/\W+/g, '_')}`,
				groupId: write.groupId,
				name: write.name,
				roles: [],
			};
			chart.ledgers.push(made);
			return made;
		}),
		post: vi.fn(async (_request: unknown, _context: unknown, _by: string | null) => ({ id: `jv_${++posted}` })),
	};
	const audit = { append: vi.fn(async () => undefined) };
	const service = new PayrollService(
		employees as never,
		attendance as never,
		runs as never,
		ledger as never,
		{ withTransaction: async <T>(work: (context: unknown) => Promise<T>) => work({ session: 'tx' }) } as never,
		audit as never,
	);
	return { service, employees, attendance, runs, ledger, audit, people, runStore, chart };
}

describe('employees (S3): personal numbers shown masked unless the person may lock the books', () => {
	it('masks Aadhaar and bank numbers to their last four, an empty one staying empty', async () => {
		const { service, audit } = build();
		for (const who of [clerk, undefined]) {
			const list = await service.listEmployees(who);
			expect(list.find((e) => e.id === 'emp_meera')).toMatchObject({
				aadhaar: '••••9012',
				bankAccount: '••••5678',
				masked: true,
			});
			expect(list.find((e) => e.id === 'emp_priya')).toMatchObject({
				aadhaar: '',
				bankAccount: '',
				masked: true,
			});
		}
		expect(audit.append).not.toHaveBeenCalled();
	});

	it('shows them whole to someone who may lock the books, and logs each full view', async () => {
		const { service, audit } = build();
		const list = await service.listEmployees(ca);
		expect(list.find((e) => e.id === 'emp_meera')).toMatchObject({ aadhaar: '123456789012', masked: false });
		expect(audit.append).toHaveBeenCalledWith(
			expect.objectContaining({
				actorUserId: 'adm_ca',
				action: 'payroll.employee.view_full',
				entityType: 'employee',
				entityId: null,
				retentionTier: 'financial_security',
				metadata: { count: 4 },
			}),
		);
		const one = build({ employees: [S5[0] as Employee] });
		await one.service.listEmployees(ca);
		expect(one.audit.append).toHaveBeenCalledWith(
			expect.objectContaining({ entityId: 'emp_meera', metadata: { count: 1 } }),
		);
		// Nothing to see whole: nothing logged.
		const plain = build({ employees: [S5[1] as Employee] });
		expect((await plain.service.listEmployees(ca))[0]?.masked).toBe(false);
		expect(plain.audit.append).not.toHaveBeenCalled();
	});

	it('adds an employee, refusing personal numbers when the sealing key isn’t set', async () => {
		const { service, employees } = build({ employees: [] });
		const { id: _id, createdAt: _c, updatedAt: _u, version: _v, ...write } = S5[0] as Employee;
		const added = await service.createEmployee(write, now);
		expect(added).toMatchObject({ name: 'Meera', createdAt: at, updatedAt: at, version: 0 });
		expect(added.id).toMatch(/^emp_/);
		expect(employees.insert).toHaveBeenCalledWith(added);
		expect((await service.createEmployee(write)).name).toBe('Meera');
		const refused = build({ employeeFails: new Error('payroll_pii_key_missing') }).service.createEmployee(write);
		await expect(refused).rejects.toBeInstanceOf(BadRequestException);
		await expect(refused).rejects.toMatchObject(refusal('payroll_pii_key_missing'));
	});

	it('keeps the stored number when its masked form comes back, and takes a new one', async () => {
		const { service } = build();
		const { id: _id, createdAt: _c, updatedAt: _u, ...edit } = S5[0] as Employee;
		const kept = await service.updateEmployee(
			'emp_meera',
			{ ...edit, aadhaar: '••••9012', bankAccount: '••••5678', name: 'Meera Das' },
			now,
		);
		expect(kept).toMatchObject({
			name: 'Meera Das',
			aadhaar: '123456789012',
			bankAccount: '50100012345678',
			updatedAt: at,
			version: 1,
		});
		const changed = await service.updateEmployee('emp_meera', { ...edit, aadhaar: '999988887777', version: 1 });
		expect(changed.aadhaar).toBe('999988887777');
	});

	it('refuses an employee who isn’t there and a stale change, and passes on other failures', async () => {
		const { id: _id, createdAt: _c, updatedAt: _u, ...edit } = S5[1] as Employee;
		const { service } = build();
		await expect(service.updateEmployee('emp_gone', edit)).rejects.toBeInstanceOf(NotFoundException);
		await expect(service.updateEmployee('emp_gone', edit)).rejects.toMatchObject(refusal('employee_not_found'));
		const stale = service.updateEmployee('emp_priya', { ...edit, version: 7 });
		await expect(stale).rejects.toBeInstanceOf(ConflictException);
		await expect(stale).rejects.toMatchObject(refusal('employee_changed'));
		await expect(
			build({ employeeFails: new Error('payroll_pii_key_missing') }).service.updateEmployee('emp_priya', edit),
		).rejects.toMatchObject(refusal('payroll_pii_key_missing'));
		const diskFull = new Error('disk full');
		await expect(build({ employeeFails: diskFull }).service.updateEmployee('emp_priya', edit)).rejects.toBe(
			diskFull,
		);
		const odd = { code: 'not an error' };
		await expect(build({ employeeFails: odd }).service.updateEmployee('emp_priya', edit)).rejects.toBe(odd);
	});
});

describe('attendance (S8)', () => {
	it('gives full days for everyone on the roll in the month until it is saved', async () => {
		const { service } = build({
			employees: [
				...S5.slice(0, 2),
				employee('emp_new', 'Joined in December', 9_000, { joinedOn: '2026-12-01' }),
				employee('emp_left', 'Left in October', 9_000, { leftOn: '2026-10-31' }),
				employee('emp_leaving', 'Leaving in November', 9_000, { leftOn: '2026-11-15' }),
			],
		});
		expect(await service.getAttendance('2026-11')).toEqual({
			month: '2026-11',
			daysInMonth: 30,
			rows: [
				{ employeeId: 'emp_leaving', paidDays: 30, leaveTaken: 0, note: '' },
				{ employeeId: 'emp_meera', paidDays: 30, leaveTaken: 0, note: '' },
				{ employeeId: 'emp_priya', paidDays: 30, leaveTaken: 0, note: '' },
			],
			lockedAt: null,
			lockedBy: null,
			version: 0,
		});
		const saved = build({ attendance: [S5_ATTENDANCE] });
		expect(await saved.service.getAttendance('2026-11')).toBe(S5_ATTENDANCE);
	});

	it('saves it first, then over its version, and locks it with who and when', async () => {
		const { service, attendance } = build();
		const rows = [{ employeeId: 'emp_meera', paidDays: 30, leaveTaken: 0, note: '' }];
		const first = await service.saveAttendance('2026-11', { rows, lock: false, version: 0 }, clerk, now);
		expect(attendance.save).toHaveBeenLastCalledWith(
			expect.objectContaining({ lockedAt: null, lockedBy: null, version: 0 }),
			null,
		);
		expect(first.version).toBe(0);
		const locked = await service.saveAttendance('2026-11', { rows, lock: true, version: 0 }, clerk, now);
		expect(attendance.save).toHaveBeenLastCalledWith(expect.anything(), 0);
		expect(locked).toMatchObject({ lockedAt: at, lockedBy: 'adm_clerk', daysInMonth: 30, version: 1 });
		const nobody = await build().service.saveAttendance('2026-11', { rows, lock: true, version: 0 }, undefined);
		expect(nobody.lockedBy).toBeNull();
	});

	it('refuses a locked month, a stale version and more days than the month has', async () => {
		await expect(
			build({ attendance: [S5_ATTENDANCE] }).service.saveAttendance(
				'2026-11',
				{ rows: [], lock: false, version: 1 },
				clerk,
			),
		).rejects.toMatchObject(refusal('attendance_locked'));
		const open = { ...S5_ATTENDANCE, lockedAt: null, lockedBy: null };
		const stale = build({ attendance: [open] }).service.saveAttendance(
			'2026-11',
			{ rows: [], lock: false, version: 0 },
			clerk,
		);
		await expect(stale).rejects.toBeInstanceOf(ConflictException);
		await expect(stale).rejects.toMatchObject(refusal('attendance_changed'));
		await expect(
			build().service.saveAttendance(
				'2026-11',
				{ rows: [{ employeeId: 'emp_meera', paidDays: 31, leaveTaken: 0, note: '' }], lock: false, version: 0 },
				clerk,
			),
		).rejects.toMatchObject(refusal('attendance_days_over'));
	});

	it('says someone saved first when the store says so, and passes on other failures', async () => {
		const write = { rows: [], lock: false, version: 0 };
		await expect(
			build({ attendanceFails: new Error('attendance_changed') }).service.saveAttendance('2026-11', write, clerk),
		).rejects.toBeInstanceOf(ConflictException);
		const diskFull = new Error('disk full');
		await expect(build({ attendanceFails: diskFull }).service.saveAttendance('2026-11', write, clerk)).rejects.toBe(
			diskFull,
		);
		const odd = { code: 'not an error' };
		await expect(build({ attendanceFails: odd }).service.saveAttendance('2026-11', write, clerk)).rejects.toBe(odd);
	});
});

describe('the monthly run (S5)', () => {
	const netOf = (run: PayrollRun) => Object.fromEntries(run.rows.map((r) => [r.name, r.netPaise]));

	it('pays the approved picture from the locked attendance: Meera ₹30,050, Priya ₹15,095, Rahul ₹14,790, Sudip ₹53,000', async () => {
		const { service } = build({ attendance: [S5_ATTENDANCE] });
		const run = await service.prepare('2026-11', now);
		expect(netOf(run)).toEqual({ Meera: 3_005_000, Priya: 1_509_500, Rahul: 1_479_000, Sudip: 5_300_000 });
		expect(run.rows.find((r) => r.name === 'Priya')).toMatchObject({
			paidDays: 29,
			grossPaise: 1_740_000,
			advancePaise: 100_000,
		});
		expect(run).toMatchObject({
			month: '2026-11',
			status: 'draft',
			rulesFrom: '2026-04-01',
			createdAt: at,
			version: 0,
		});
		expect(run.id).toMatch(/^pay_/);
		expect((await service.listRuns()).map((r) => r.id)).toEqual([run.id]);
		expect(await service.getRun('2026-11')).toMatchObject({ id: run.id });
		expect(await service.getRun('2026-10')).toBeNull();
	});

	it('takes TDS each month under the new regime only, and recovers no more advance than is still due', async () => {
		const big = { basic: 150_000, da: 0, hra: 0, special: 50_000, conveyance: 0, other: 0 };
		const { service } = build({
			employees: [
				employee('emp_new', 'New regime', 0, { structure: big }),
				employee('emp_old', 'Old regime', 0, { structure: big, taxRegime: 'old' }),
				employee('emp_owing', 'Owing a little', 9_000, { advanceDueINR: 300, advancePerMonthINR: 1_000 }),
			],
			attendance: [
				lockedAttendance([
					{ employeeId: 'emp_new', paidDays: 30, leaveTaken: 0, note: '' },
					{ employeeId: 'emp_old', paidDays: 30, leaveTaken: 0, note: '' },
					{ employeeId: 'emp_owing', paidDays: 30, leaveTaken: 0, note: '' },
				]),
			],
		});
		const run = await service.prepare('2026-11');
		const of = (name: string) => run.rows.find((r) => r.name === name);
		expect(of('New regime')?.tdsPaise).toBeGreaterThan(0);
		expect(of('Old regime')?.tdsPaise).toBe(0);
		expect(of('Owing a little')?.advancePaise).toBe(30_000);
	});

	it('works a draft out again keeping its id and day, and refuses an approved run or unlocked attendance', async () => {
		const draft = {
			id: 'pay_nov',
			month: '2026-11',
			status: 'draft',
			rows: [],
			rulesFrom: '2026-04-01',
			voucherId: null,
			payVoucherId: null,
			approvedBy: null,
			approvedAt: null,
			createdAt: '2026-11-30T06:00:00.000Z',
			updatedAt: '2026-11-30T06:00:00.000Z',
			version: 2,
		} as PayrollRun;
		const { service, runs } = build({ attendance: [S5_ATTENDANCE], runs: [draft] });
		const again = await service.prepare('2026-11', now);
		expect(runs.save).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'pay_nov', createdAt: '2026-11-30T06:00:00.000Z', updatedAt: at }),
			2,
			undefined,
		);
		expect(again.version).toBe(3);
		await expect(
			build({ attendance: [S5_ATTENDANCE], runs: [{ ...draft, status: 'approved' }] }).service.prepare('2026-11'),
		).rejects.toMatchObject(refusal('payroll_run_approved'));
		await expect(build().service.prepare('2026-11')).rejects.toMatchObject(
			refusal('payroll_attendance_not_locked'),
		);
		await expect(
			build({ attendance: [{ ...S5_ATTENDANCE, lockedAt: null }] }).service.prepare('2026-11'),
		).rejects.toMatchObject(refusal('payroll_attendance_not_locked'));
	});

	it('says someone saved first when the run store says so, and passes on other failures', async () => {
		const conflict = build({ attendance: [S5_ATTENDANCE], runFails: new Error('payroll_run_changed') });
		await expect(conflict.service.prepare('2026-11')).rejects.toBeInstanceOf(ConflictException);
		const diskFull = new Error('disk full');
		await expect(
			build({ attendance: [S5_ATTENDANCE], runFails: diskFull }).service.prepare('2026-11'),
		).rejects.toBe(diskFull);
		const odd = { code: 'not an error' };
		await expect(build({ attendance: [S5_ATTENDANCE], runFails: odd }).service.prepare('2026-11')).rejects.toBe(
			odd,
		);
	});
});

describe('approving, posting and paying the run (S5)', () => {
	const prepared = async (options: Options = {}) => {
		const built = build({ attendance: [S5_ATTENDANCE], ...options });
		const run = await built.service.prepare('2026-11', now);
		return { ...built, run };
	};

	it('approves a draft only by someone who may lock the books, over the version read', async () => {
		const { service } = await prepared();
		await expect(
			service.step('2026-11', { to: 'approved', version: 0, bankLedgerId: null, paidOn: null }, clerk),
		).rejects.toMatchObject(refusal('payroll_approver_only'));
		await expect(
			service.step('2026-11', { to: 'approved', version: 0, bankLedgerId: null, paidOn: null }, undefined),
		).rejects.toMatchObject(refusal('payroll_approver_only'));
		const stale = service.step('2026-11', { to: 'approved', version: 9, bankLedgerId: null, paidOn: null }, ca);
		await expect(stale).rejects.toBeInstanceOf(ConflictException);
		const approved = await service.step(
			'2026-11',
			{ to: 'approved', version: 0, bankLedgerId: null, paidOn: null },
			ca,
			now,
		);
		expect(approved).toMatchObject({ status: 'approved', approvedBy: 'adm_ca', approvedAt: at, version: 1 });
		await expect(
			service.step('2026-11', { to: 'approved', version: 1, bankLedgerId: null, paidOn: null }, ca),
		).rejects.toMatchObject(refusal('payroll_wrong_step'));
		const missing = service.step('2026-10', { to: 'approved', version: 0, bankLedgerId: null, paidOn: null }, ca);
		await expect(missing).rejects.toBeInstanceOf(NotFoundException);
		await expect(missing).rejects.toMatchObject(refusal('payroll_run_not_found'));
	});

	it('posts one journal per location, making the payroll ledgers it lacks, and takes recovered advances off what is due', async () => {
		const { service, ledger, people, run } = await prepared();
		await expect(
			service.step('2026-11', { to: 'posted', version: 0, bankLedgerId: null, paidOn: null }, ca),
		).rejects.toMatchObject(refusal('payroll_wrong_step'));
		await service.step('2026-11', { to: 'approved', version: 0, bankLedgerId: null, paidOn: null }, ca, now);
		const posted = await service.step(
			'2026-11',
			{ to: 'posted', version: 1, bankLedgerId: null, paidOn: null },
			ca,
			now,
		);
		expect(ledger.addLedger.mock.calls.map(([write]) => write.name)).toEqual([
			'Employer PF contribution',
			'Employer ESI contribution',
			'Salary payable',
			'PF payable',
			'ESI payable',
			'Professional tax payable',
		]);
		const request = ledger.post.mock.calls[0]?.[0] as {
			lines: { ledger: { id: string }; locationId: string; debitPaise?: number; creditPaise?: number }[];
		};
		expect(ledger.post.mock.calls[0]?.[0]).toMatchObject({
			kind: 'journal',
			date: '2026-11-30',
			narration: 'Payroll for 2026-11',
			source: { type: 'payroll', id: run.id, number: null },
			idempotencyKey: 'payroll:2026-11',
		});
		const at = (place: string) => request.lines.filter((l) => l.locationId === place);
		const sum = (place: string, pick: (r: PayrollRun['rows'][number]) => number) =>
			run.rows.filter((r) => r.locationId === place).reduce((s, r) => s + pick(r), 0);
		// Rahul at the shop: no TDS and no advance, so those lines are left out.
		expect(at('loc_shop')).toEqual([
			{ ledger: { id: 'led_salaries' }, debitPaise: 1_600_000, locationId: 'loc_shop' },
			{
				ledger: { id: 'led_employer_pf_contribution' },
				debitPaise: sum('loc_shop', (r) => r.pfEmployerPaise),
				locationId: 'loc_shop',
			},
			{ ledger: { id: 'led_employer_esi_contribution' }, debitPaise: 52_000, locationId: 'loc_shop' },
			{ ledger: { id: 'led_salary_payable' }, creditPaise: 1_479_000, locationId: 'loc_shop' },
			{
				ledger: { id: 'led_pf_payable' },
				creditPaise: sum('loc_shop', (r) => r.pfEmployeePaise + r.pfEmployerPaise),
				locationId: 'loc_shop',
			},
			{ ledger: { id: 'led_esi_payable' }, creditPaise: 12_000 + 52_000, locationId: 'loc_shop' },
			{ ledger: { id: 'led_professional_tax_payable' }, creditPaise: 13_000, locationId: 'loc_shop' },
		]);
		expect(at('loc_bar').map((l) => l.ledger.id)).toContain('led_advance');
		expect(at('loc_bar').map((l) => l.ledger.id)).not.toContain('led_tds');
		const total = (side: 'debitPaise' | 'creditPaise') => request.lines.reduce((s, l) => s + (l[side] ?? 0), 0);
		expect(total('debitPaise')).toBe(total('creditPaise'));
		expect(people.get('emp_priya')?.advanceDueINR).toBe(4_000);
		expect(posted).toMatchObject({ status: 'posted', voucherId: 'jv_1', version: 2 });
	});

	it('never leaves an advance below nothing, posting by nobody when no one is signed in', async () => {
		const { service, people, employees, ledger } = await prepared();
		// Her advance was cut to ₹400 after the run recovered ₹1,000 of it.
		people.set('emp_priya', { ...(people.get('emp_priya') as Employee), advanceDueINR: 400 });
		await service.step('2026-11', { to: 'approved', version: 0, bankLedgerId: null, paidOn: null }, ca);
		await service.step('2026-11', { to: 'posted', version: 1, bankLedgerId: null, paidOn: null }, undefined);
		expect(ledger.post.mock.calls[0]?.[2]).toBeNull();
		expect(people.get('emp_priya')?.advanceDueINR).toBe(0);
		expect(employees.save).toHaveBeenCalledTimes(1);
	});

	it('skips an employee recovering an advance who was removed since the run was made', async () => {
		const { service, people, employees } = await prepared();
		await service.step('2026-11', { to: 'approved', version: 0, bankLedgerId: null, paidOn: null }, ca);
		people.delete('emp_priya');
		await service.step('2026-11', { to: 'posted', version: 1, bankLedgerId: null, paidOn: null }, ca);
		expect(employees.save).not.toHaveBeenCalled();
	});

	it('refuses to post when a payroll group or the TDS or advance ledger isn’t in the books', async () => {
		const noGroup = await prepared({
			chart: { groups: [{ id: 'g_ind', systemKey: 'indirect_expenses' }], ledgers: [] },
		});
		await noGroup.service.step('2026-11', { to: 'approved', version: 0, bankLedgerId: null, paidOn: null }, ca);
		await expect(
			noGroup.service.step('2026-11', { to: 'posted', version: 1, bankLedgerId: null, paidOn: null }, ca),
		).rejects.toMatchObject(refusal('books_not_set_up'));
		const noRoles = await prepared({
			chart: {
				groups: [
					{ id: 'g_ind', systemKey: 'indirect_expenses' },
					{ id: 'g_cl', systemKey: 'current_liabilities' },
				],
				ledgers: [],
			},
		});
		await noRoles.service.step('2026-11', { to: 'approved', version: 0, bankLedgerId: null, paidOn: null }, ca);
		await expect(
			noRoles.service.step('2026-11', { to: 'posted', version: 1, bankLedgerId: null, paidOn: null }, ca),
		).rejects.toMatchObject(refusal('books_not_set_up'));
	});

	it('pays the net from the bank once posted, and needs the bank and the day', async () => {
		const { service, ledger, run } = await prepared();
		await service.step('2026-11', { to: 'approved', version: 0, bankLedgerId: null, paidOn: null }, ca);
		await expect(
			service.step('2026-11', { to: 'paid', version: 1, bankLedgerId: 'led_hdfc', paidOn: '2026-12-01' }, ca),
		).rejects.toMatchObject(refusal('payroll_wrong_step'));
		await service.step('2026-11', { to: 'posted', version: 1, bankLedgerId: null, paidOn: null }, ca);
		for (const missing of [
			{ bankLedgerId: null, paidOn: '2026-12-01' },
			{ bankLedgerId: 'led_hdfc', paidOn: null },
		])
			await expect(service.step('2026-11', { to: 'paid', version: 2, ...missing }, ca)).rejects.toMatchObject(
				refusal('payroll_bank_needed'),
			);
		const paid = await service.step(
			'2026-11',
			{ to: 'paid', version: 2, bankLedgerId: 'led_hdfc', paidOn: '2026-12-01' },
			ca,
			now,
		);
		const total = 3_005_000 + 1_509_500 + 1_479_000 + 5_300_000;
		expect(ledger.post).toHaveBeenLastCalledWith(
			{
				kind: 'payment',
				date: '2026-12-01',
				narration: 'Salaries paid for 2026-11',
				source: { type: 'payrollPay', id: run.id, number: null },
				idempotencyKey: 'payrollPay:2026-11',
				lines: [
					{ ledger: { id: 'led_salary_payable' }, locationId: run.rows[0]?.locationId, debitPaise: total },
					{ ledger: { id: 'led_hdfc' }, locationId: run.rows[0]?.locationId, creditPaise: total },
				],
			},
			{ session: 'tx' },
			'adm_ca',
		);
		expect(paid).toMatchObject({ status: 'paid', payVoucherId: 'jv_2', version: 3 });
	});

	it('refuses to pay a run with nobody on it', async () => {
		const empty = {
			id: 'pay_empty',
			month: '2026-11',
			status: 'posted',
			rows: [],
			rulesFrom: '2026-04-01',
			voucherId: 'jv_1',
			payVoucherId: null,
			approvedBy: 'adm_ca',
			approvedAt: at,
			createdAt: at,
			updatedAt: at,
			version: 2,
		} as PayrollRun;
		await expect(
			build({ runs: [empty] }).service.step(
				'2026-11',
				{ to: 'paid', version: 2, bankLedgerId: 'led_hdfc', paidOn: '2026-12-01' },
				ca,
			),
		).rejects.toMatchObject(refusal('payroll_wrong_step'));
	});
});
