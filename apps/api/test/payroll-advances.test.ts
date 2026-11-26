import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Employee, PayrollAdvance } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { PayrollAdvancesService } from '../src/payroll/payroll-advances.service';

/** Advances and loans to employees (accounts brief S9): given from cash or bank, recovered through payroll. */

const at = '2026-12-01T06:00:00.000Z';
const now = new Date(at);
const refusal = (code: string) => ({ response: { message: code } });
const clerk = { userId: 'adm_clerk', permissions: ['accounts.post'] } as never;

const person = (id: string, name: string, over: Partial<Employee> = {}) =>
	({
		id,
		name,
		locationId: 'loc_bar',
		leftOn: null,
		advanceDueINR: 0,
		advancePerMonthINR: 0,
		version: 4,
		...over,
	}) as Employee;
const PRIYA = person('emp_priya', 'Priya', { advanceDueINR: 3_000, advancePerMonthINR: 1_000 });
const GIVEN: PayrollAdvance = {
	id: 'adv_1',
	employeeId: 'emp_priya',
	givenOn: '2026-09-03',
	amountPaise: 500_000,
	ledgerId: 'led_cash',
	voucherId: 'jv_adv',
	note: 'For her sister’s wedding',
	createdBy: 'adm_clerk',
	createdAt: '2026-09-03T06:00:00.000Z',
};
const runOf = (month: string, status: string, advancePaise: number, employeeId = 'emp_priya') =>
	({ month, status, rows: [{ employeeId, advancePaise }] }) as never;
/** October posted and November paid, ₹1,000 each; December's draft doesn't count yet. */
const RUNS = [
	runOf('2026-10', 'posted', 100_000),
	runOf('2026-11', 'paid', 100_000),
	runOf('2026-12', 'draft', 100_000),
	// Someone else's run row, and a posted month with nothing recovered from her.
	runOf('2026-08', 'posted', 0),
];

function build(
	options: {
		employees?: Employee[];
		given?: PayrollAdvance[];
		runs?: unknown[];
		ledgers?: Record<string, unknown>[];
	} = {},
) {
	const people = new Map((options.employees ?? [PRIYA, person('emp_meera', 'Meera')]).map((e) => [e.id, e]));
	const given = [...(options.given ?? [GIVEN])];
	const employees = {
		list: async () => [...people.values()],
		get: async (id: string) => people.get(id) ?? null,
		save: vi.fn(async (e: Employee, _version: number, _context?: unknown) => {
			people.set(e.id, e);
			return e;
		}),
	};
	const advances = {
		list: vi.fn(async (employeeId?: string) => given.filter((g) => !employeeId || g.employeeId === employeeId)),
		insert: vi.fn(async (advance: PayrollAdvance, _context?: unknown) => void given.push(advance)),
	};
	const ledger = {
		chart: async () => ({
			groups: [],
			ledgers: options.ledgers ?? [{ id: 'led_staff_advance', roles: ['staff_advance'] }],
		}),
		post: vi.fn(async (_request: unknown, _context: unknown, _by: string | null) => ({ id: 'jv_new' })),
	};
	const service = new PayrollAdvancesService(
		employees as never,
		advances as never,
		{ list: async () => options.runs ?? RUNS } as never,
		ledger as never,
		{ withTransaction: async <T>(work: (context: unknown) => Promise<T>) => work({ session: 'tx' }) } as never,
	);
	return { service, employees, advances, ledger, people };
}

describe('an advance’s schedule (S9)', () => {
	it('shows what posted payrolls recovered, then the monthly amount planned until nothing is left', async () => {
		const schedule = await build().service.schedule('emp_priya');
		expect(schedule).toMatchObject({
			employeeId: 'emp_priya',
			name: 'Priya',
			perMonthPaise: 100_000,
			leftPaise: 300_000,
			given: [GIVEN],
		});
		expect(schedule.rows.map((r) => [r.month, r.how, r.leftPaise])).toEqual([
			['2026-09', 'none', 500_000],
			['2026-10', 'payroll', 400_000],
			['2026-11', 'payroll', 300_000],
			['2026-12', 'planned', 200_000],
			['2027-01', 'planned', 100_000],
			['2027-02', 'planned', 0],
		]);
	});

	it('plans from the first month when no payroll is posted yet, and refuses someone who isn’t on the books', async () => {
		const unposted = await build({ runs: [runOf('2026-10', 'draft', 100_000)] }).service.schedule('emp_priya');
		expect(unposted.rows[0]).toMatchObject({ month: '2026-09', how: 'planned', recoveredPaise: 100_000 });
		const missing = build().service.schedule('emp_gone');
		await expect(missing).rejects.toBeInstanceOf(NotFoundException);
		await expect(missing).rejects.toMatchObject(refusal('employee_not_found'));
	});

	it('lists only the people who have been given an advance', async () => {
		expect((await build().service.list()).map((s) => s.employeeId)).toEqual(['emp_priya']);
	});
});

describe('giving an advance (S9)', () => {
	const give = (over: Record<string, unknown> = {}) =>
		({
			amountINR: 2_000,
			givenOn: '2026-12-01',
			ledgerId: 'led_cash',
			perMonthINR: 1_500,
			note: '',
			version: 4,
			...over,
		}) as never;

	it('pays it from cash or bank to Staff advance, records it and adds it to what payroll recovers, in one go', async () => {
		const { service, ledger, advances, employees, people } = build();
		const schedule = await service.give('emp_priya', give(), clerk, now);
		const request = ledger.post.mock.calls[0]?.[0] as { source: { id: string }; idempotencyKey: string };
		expect(request).toMatchObject({
			kind: 'payment',
			date: '2026-12-01',
			narration: 'Advance to Priya',
			source: { type: 'payrollAdvance', number: null },
			lines: [
				{ ledger: { id: 'led_staff_advance' }, locationId: 'loc_bar', debitPaise: 200_000 },
				{ ledger: { id: 'led_cash' }, locationId: 'loc_bar', creditPaise: 200_000 },
			],
		});
		expect(request.source.id).toMatch(/^adv_/);
		expect(request.idempotencyKey).toBe(`payrollAdvance:${request.source.id}`);
		expect(ledger.post.mock.calls[0]?.[1]).toEqual({ session: 'tx' });
		expect(ledger.post.mock.calls[0]?.[2]).toBe('adm_clerk');
		expect(advances.insert).toHaveBeenCalledWith(
			{
				id: request.source.id,
				employeeId: 'emp_priya',
				givenOn: '2026-12-01',
				amountPaise: 200_000,
				ledgerId: 'led_cash',
				voucherId: 'jv_new',
				note: '',
				createdBy: 'adm_clerk',
				createdAt: at,
			},
			{ session: 'tx' },
		);
		expect(employees.save).toHaveBeenCalledWith(expect.objectContaining({ updatedAt: at }), 4, { session: 'tx' });
		expect(people.get('emp_priya')).toMatchObject({ advanceDueINR: 5_000, advancePerMonthINR: 1_500 });
		expect(schedule.given).toHaveLength(2);
		expect(schedule.perMonthPaise).toBe(150_000);
		const nobody = build();
		await nobody.service.give('emp_priya', give(), undefined);
		expect(nobody.ledger.post.mock.calls[0]?.[2]).toBeNull();
	});

	it('refuses a stale employee, someone who has left, and books without a staff advance ledger', async () => {
		const stale = build().service.give('emp_priya', give({ version: 3 }), clerk);
		await expect(stale).rejects.toBeInstanceOf(ConflictException);
		await expect(stale).rejects.toMatchObject(refusal('employee_changed'));
		const left = build({ employees: [person('emp_priya', 'Priya', { leftOn: '2026-11-30' })] }).service.give(
			'emp_priya',
			give(),
			clerk,
		);
		await expect(left).rejects.toBeInstanceOf(BadRequestException);
		await expect(left).rejects.toMatchObject(refusal('employee_has_left'));
		await expect(build({ ledgers: [] }).service.give('emp_priya', give(), clerk)).rejects.toMatchObject(
			refusal('books_not_set_up'),
		);
		await expect(build().service.give('emp_gone', give(), clerk)).rejects.toBeInstanceOf(NotFoundException);
	});
});
