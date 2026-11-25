import type { Attendance, AttendanceDay, Employee } from '@saha-textile/contracts';
import { WEST_BENGAL_LEAVE, type LeaveType } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { AttendanceDaysController, AttendanceDaysService } from '../src/payroll/attendance-days';

/**
 * Brief 26 AT1-AT3: marking one's own day at the server's time, asking for leave, a store's month for those in charge
 * of it, changes made at once or asked for, and approvals nobody gives themselves.
 */
const status = (error: unknown) => (error as { status?: number }).status;
const code = (error: unknown) => (error as { response?: { message?: string } }).response?.message;

const person = (id: string, over: Partial<Employee> = {}) =>
	({
		id,
		name: id,
		userId: `adm_${id}`,
		locationId: 'loc_gariahat',
		joinedOn: '2025-01-01',
		leftOn: null,
		...over,
	}) as Employee;
const CL_RULE = (WEST_BENGAL_LEAVE[1] as LeaveType).rules[0] as LeaveType['rules'][number];
/** A compensatory off: whole days, two days' notice, weekly offs counted, and it may go below nothing. */
const CO: LeaveType = {
	key: 'CO',
	name: 'Compensatory off',
	paid: 'full',
	active: true,
	rules: [
		{
			...CL_RULE,
			taking: { halfDays: false, noticeDays: 2, countOffsBetween: true, canGoNegative: true },
		},
	],
};
/** A type whose only rule is for someone else, and one switched off. */
const NOBODY: LeaveType = { ...CO, key: 'NR', rules: [{ ...CL_RULE, when: { designation: 'Nobody' } }] };
const OFF: LeaveType = { ...CO, key: 'OF', active: false };
const PEOPLE = [
	person('priya'),
	person('amit'),
	person('gone', { leftOn: '2026-01-01' }),
	person('far', { locationId: 'loc_far' }),
];

function build(
	options: {
		access?: { worksAt?: string[]; maySeeAll?: boolean } | null;
		saveFails?: Error;
		month?: Attendance;
		run?: { status: string };
		monthSaveFails?: Error;
	} = {},
) {
	const store = new Map<string, AttendanceDay>();
	const days = {
		get: vi.fn(async (employeeId: string, day: string) => store.get(`${employeeId}_${day}`) ?? null),
		month: vi.fn(async (_month: string, f: { employeeIds?: readonly string[]; locationId?: string }) =>
			[...store.values()].filter(
				(d) =>
					(!f.employeeIds || f.employeeIds.includes(d.employeeId)) &&
					(!f.locationId || d.locationId === f.locationId),
			),
		),
		range: vi.fn(async (employeeId: string, from: string, to: string) =>
			[...store.values()]
				.filter((d) => d.employeeId === employeeId && d.day >= from && d.day <= to)
				.sort((a, b) => a.day.localeCompare(b.day)),
		),
		pending: vi.fn(async (stores: readonly string[] | null) =>
			[...store.values()].filter((d) => d.pending && (!stores || stores.includes(d.locationId))),
		),
		save: vi.fn(async (d: AttendanceDay, expected: number | null) => {
			if (options.saveFails) throw options.saveFails;
			const saved = { ...d, version: expected === null ? 0 : expected + 1 };
			store.set(d.id, saved);
			return saved;
		}),
	};
	const rules = {
		forMonth: async () => ({
			states: [
				{
					stateCode: '19',
					leaveTypes: [...WEST_BENGAL_LEAVE, CO, NOBODY, OFF],
					holidays: [
						{ day: '2026-11-08', name: 'Kali Puja', locationId: null },
						{ day: '2026-12-25', name: 'Christmas', locationId: null },
					],
				},
				{ stateCode: '27' },
			],
			// The far store opens at 11:00 with ten minutes' grace and closes on Tuesdays.
			shifts: [
				{
					locationId: 'loc_far',
					start: '11:00',
					end: '20:00',
					fullDayHours: 8,
					graceMinutes: 10,
					weeklyOff: [2],
				},
			],
		}),
	};
	const access = options.access === undefined ? { worksAt: ['loc_gariahat'] } : options.access;
	const months = new Map<string, Attendance>(options.month ? [[options.month.month, options.month]] : []);
	const monthStore = {
		get: vi.fn(async (month: string) => months.get(month) ?? null),
		save: vi.fn(async (a: Attendance, expected: number | null) => {
			if (options.monthSaveFails) throw options.monthSaveFails;
			const saved = { ...a, version: expected === null ? 0 : expected + 1 };
			months.set(a.month, saved);
			return saved;
		}),
	};
	const service = new AttendanceDaysService(
		days as never,
		{ list: async () => PEOPLE } as never,
		{
			adminUserLocations: async () => access,
			list: async () => [
				{ id: 'loc_gariahat', stateCode: '19', name: 'Gariahat store' },
				{ id: 'loc_far', stateCode: '27', name: 'Far store' },
			],
		} as never,
		rules as never,
		monthStore as never,
		{ get: async () => options.run ?? null } as never,
	);
	return { service, days, store, months, monthStore };
}
const staff = (id: string) => ({ userId: `adm_${id}`, permissions: ['attendance.use'] }) as never;
const manager = { userId: 'adm_manager', permissions: ['attendance.index'] } as never;
const accountant = {
	userId: 'adm_accountant',
	permissions: ['attendance.index', 'attendance.edit', 'attendance.approve'],
} as never;
const at = (ist: string) => new Date(Date.parse(`2026-11-25T${ist}:00+05:30`));

describe('marking one’s own day (AT1)', () => {
	it('marks in once at the server’s time, late minutes kept, then out with the day’s status', async () => {
		const { service } = build();
		const day = await service.markIn(staff('priya'), at('10:02'));
		expect(day).toMatchObject({
			id: 'priya_2026-11-25',
			status: 'incomplete',
			lateMinutes: 2,
			markedBy: 'adm_priya',
		});
		await expect(service.markIn(staff('priya'), at('10:05'))).rejects.toSatisfy(
			(e) => code(e) === 'attendance_already_in',
		);
		expect(await service.markOut(staff('priya'), at('19:00'))).toMatchObject({ status: 'present', version: 1 });
		expect(await service.mine(staff('priya'), '2026-11')).toHaveLength(1);
	});

	it('refuses marking out before in, and a login with no current employee', async () => {
		const { service } = build();
		await expect(service.markOut(staff('amit'), at('19:00'))).rejects.toSatisfy(
			(e) => code(e) === 'attendance_not_in',
		);
		await expect(service.markIn(staff('gone'))).rejects.toSatisfy((e) => status(e) === 404);
		await expect(service.markIn(undefined)).rejects.toSatisfy((e) => status(e) === 404);
	});

	it('marks in on a day a manager already set, over its version', async () => {
		const { service } = build();
		await service.change(accountant, 'amit', '2026-11-25', {
			status: 'absent',
			leaveKey: null,
			inAt: null,
			outAt: null,
			reason: 'set early',
		});
		expect(await service.markIn(staff('amit'), at('09:50'))).toMatchObject({ lateMinutes: 0, version: 1 });
	});

	it('asks for leave day by day, each waiting for approval, a half day for one day', async () => {
		const { service } = build();
		const asked = await service.askLeave(
			staff('priya'),
			{ leaveKey: 'CL', from: '2026-12-03', to: '2026-12-04', half: false, reason: '' },
			at('09:00'),
		);
		expect(asked.map((d) => [d.day, d.pending?.status, d.pending?.reason])).toEqual([
			['2026-12-03', 'leave', 'Leave asked for'],
			['2026-12-04', 'leave', 'Leave asked for'],
		]);
		const half = await service.askLeave(staff('priya'), {
			leaveKey: 'SL',
			from: '2026-12-03',
			to: '2026-12-03',
			half: true,
			reason: 'Doctor',
		});
		expect(half[0]).toMatchObject({ version: 1, pending: { status: 'half', leaveKey: 'SL', reason: 'Doctor' } });
	});
});

describe('a store’s month and changes to it (AT2, AT3)', () => {
	it('counts each person’s month, leave paid as its type says, late marks, for a store in the user’s charge', async () => {
		const { service } = build();
		await service.markIn(staff('priya'), at('10:10'));
		await service.markOut(staff('priya'), at('19:00'));
		const change = (day: string, leaveKey: string) =>
			service.change(accountant, 'amit', day, {
				status: 'leave',
				leaveKey,
				inAt: null,
				outAt: null,
				reason: 'Unwell',
			});
		await change('2026-11-10', 'SL');
		await change('2026-11-11', 'XX');
		const grid = await service.grid(manager, '2026-11', 'loc_gariahat');
		// Five Sundays paid (the 8th a holiday too), the days nobody marked counted absent; whoever left is not shown.
		expect(
			grid.people.map((p) => [p.employeeId, p.paidDays, p.leaveByType, p.withoutPay, p.lateMarks, p.unmarked]),
		).toEqual([
			['priya', 6, {}, 24, 1, 24],
			['amit', 5.5, { SL: 1, XX: 1 }, 24.5, 0, 23],
		]);
		expect(grid.offDays).toEqual(['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29']);
		expect(grid.holidays).toEqual([{ day: '2026-11-08', name: 'Kali Puja' }]);
		expect(grid.lockedAt).toBeNull();
		await expect(service.grid(manager, '2026-11', 'loc_far')).rejects.toSatisfy((e) => status(e) === 403);
		await expect(service.grid(undefined, '2026-11', 'loc_gariahat')).rejects.toSatisfy((e) => status(e) === 403);
	});

	it('changes a day at once for an accountant, as a request for a manager, and refuses an unknown person', async () => {
		const { service } = build({ access: { maySeeAll: true } });
		const direct = await service.change(accountant, 'amit', '2026-11-07', {
			status: 'present',
			leaveKey: null,
			inAt: null,
			outAt: null,
			reason: 'CCTV checked',
		});
		expect(direct).toMatchObject({ status: 'present', changedBy: 'adm_accountant', pending: null });
		const asked = await service.change(
			manager,
			'amit',
			'2026-11-08',
			{
				status: 'present',
				leaveKey: null,
				inAt: null,
				outAt: null,
				reason: 'Forgot to mark out',
			},
			at('18:40'),
		);
		expect(asked).toMatchObject({ status: 'absent', pending: { status: 'present', askedBy: 'adm_manager' } });
		await expect(
			service.change(undefined, 'far', '2026-11-08', {
				status: 'present',
				leaveKey: null,
				inAt: null,
				outAt: null,
				reason: 'no one',
			}),
		).rejects.toSatisfy((e) => status(e) === 403);
		await expect(
			service.change(accountant, 'nobody', '2026-11-08', {
				status: 'present',
				leaveKey: null,
				inAt: null,
				outAt: null,
				reason: 'x x x',
			}),
		).rejects.toSatisfy((e) => status(e) === 404);
	});

	it('lists what waits, approves or turns it down, never by the one who asked', async () => {
		const { service } = build({ access: { worksAt: ['loc_gariahat'] } });
		const change = {
			status: 'present' as const,
			leaveKey: null,
			inAt: null,
			outAt: null,
			reason: 'Forgot to mark out',
		};
		await service.change(manager, 'amit', '2026-11-08', change);
		await service.change(manager, 'priya', '2026-11-09', change);
		expect((await service.pending(accountant)).map((d) => d.id)).toEqual(['amit_2026-11-08', 'priya_2026-11-09']);
		await expect(service.decide(manager, 'amit', '2026-11-08', true)).rejects.toSatisfy((e) => status(e) === 403);
		expect(await service.decide(accountant, 'amit', '2026-11-08', true)).toMatchObject({
			status: 'present',
			reason: 'Forgot to mark out',
			changedBy: 'adm_accountant',
			pending: null,
		});
		expect(await service.decide(accountant, 'priya', '2026-11-09', false)).toMatchObject({
			status: 'absent',
			pending: null,
		});
		await expect(service.decide(accountant, 'priya', '2026-11-09', true)).rejects.toSatisfy(
			(e) => status(e) === 404,
		);
		await expect(service.decide(undefined, 'amit', '2026-11-30', true)).rejects.toSatisfy((e) => status(e) === 404);
	});
});

describe('a user with no stores, and a day changed twice', () => {
	it('refuses a store month to a login with no stores set, and changes an existing day over its version', async () => {
		const none = build({ access: null }).service;
		await expect(none.grid(manager, '2026-11', 'loc_gariahat')).rejects.toSatisfy((e) => status(e) === 403);
		const { service } = build();
		const change = { status: 'present' as const, leaveKey: null, inAt: null, outAt: null, reason: 'First check' };
		await service.change(accountant, 'amit', '2026-11-12', change);
		expect(await service.change(accountant, 'amit', '2026-11-12', { ...change, status: 'half' })).toMatchObject({
			status: 'half',
			version: 1,
		});
	});
});

describe('saving over another’s change', () => {
	it('answers 409 for a day changed meanwhile, and passes any other failure on', async () => {
		const conflict = build({ saveFails: new Error('attendance_day_changed') }).service;
		await expect(conflict.markIn(staff('priya'))).rejects.toSatisfy((e) => status(e) === 409);
		const broken = build({ saveFails: new Error('disk full') }).service;
		await expect(broken.markIn(staff('priya'))).rejects.toThrow('disk full');
	});
});

describe('the attendance routes', () => {
	it('hand each request to the service with the signed-in person', async () => {
		const service = {
			markIn: vi.fn(),
			markOut: vi.fn(),
			mine: vi.fn(),
			askLeave: vi.fn(),
			grid: vi.fn(),
			change: vi.fn(),
			pending: vi.fn(),
			decide: vi.fn(),
			lock: vi.fn(),
			summary: vi.fn(),
		};
		const c = new AttendanceDaysController(service as never);
		const p = { employeeId: 'amit', day: '2026-11-08' };
		c.markIn(manager);
		c.markOut(manager);
		c.mine('2026-11', manager);
		c.askLeave({ leaveKey: 'CL' } as never, manager);
		c.grid({ month: '2026-11', locationId: 'loc_gariahat' }, manager);
		c.change(p, { status: 'present' } as never, manager);
		c.pending(manager);
		c.approve(p, manager);
		c.reject(p, manager);
		c.lock('2026-11', manager);
		c.summary(manager);
		expect(service.summary).toHaveBeenCalledWith(manager);
		expect(service.lock).toHaveBeenCalledWith(manager, '2026-11');
		expect(service.markIn).toHaveBeenCalledWith(manager);
		expect(service.grid).toHaveBeenCalledWith(manager, '2026-11', 'loc_gariahat');
		expect(service.decide.mock.calls).toEqual([
			[manager, 'amit', '2026-11-08', true],
			[manager, 'amit', '2026-11-08', false],
		]);
	});
});

const NOV = (over: Partial<Attendance> = {}): Attendance => ({
	month: '2026-11',
	daysInMonth: 30,
	rows: [{ employeeId: 'priya', paidDays: 30, leaveTaken: 0, note: '' }],
	lockedAt: '2026-12-01T05:00:00.000Z',
	lockedBy: 'adm_accountant',
	version: 2,
	...over,
});
const present = { status: 'present' as const, leaveKey: null, inAt: null, outAt: null, reason: 'CCTV checked' };

describe('a store’s own shift', () => {
	it('marks late against the store’s start and grace', async () => {
		const { service } = build();
		const far = { userId: 'adm_far', permissions: ['attendance.use'] } as never;
		expect(await service.markIn(far, at('11:15'))).toMatchObject({ lateMinutes: 5 });
		// Eight hours from 11:15 is a full day by the far store's shift.
		expect(await service.markOut(far, at('19:20'))).toMatchObject({ status: 'present' });
	});

	it('reads a store whose location is unknown as having no State: no holidays, every leave unpaid', async () => {
		const { service } = build({ access: { maySeeAll: true } });
		PEOPLE.push(person('lost', { locationId: 'loc_lost' }));
		try {
			await service.change(accountant, 'lost', '2026-11-10', { ...present, status: 'leave', leaveKey: 'CL' });
			const grid = await service.grid(accountant, '2026-11', 'loc_lost');
			expect(grid.holidays).toEqual([]);
			expect(grid.people[0]).toMatchObject({ leaveByType: { CL: 1 }, paidDays: 5 });
		} finally {
			PEOPLE.pop();
		}
	});
});

describe('locking the month from the days (AT2)', () => {
	it('counts everyone on the roll, leave by type in the note, for the payroll run', async () => {
		const { service, months } = build({ access: { maySeeAll: true } });
		await service.markIn(staff('priya'), at('10:00'));
		await service.markOut(staff('priya'), at('19:00'));
		await service.change(accountant, 'amit', '2026-11-10', { ...present, status: 'leave', leaveKey: 'SL' });
		await service.change(accountant, 'amit', '2026-11-11', { ...present, status: 'leave', leaveKey: 'CL' });
		// A request turned down leaves a record nobody set: the day falls back to the calendar.
		await service.change(manager, 'amit', '2026-11-12', present);
		await service.decide(accountant, 'amit', '2026-11-12', false);
		const locked = await service.lock(accountant, '2026-11', new Date('2026-12-01T05:00:00Z'));
		expect(locked).toMatchObject({ daysInMonth: 30, lockedBy: 'adm_accountant', version: 0 });
		expect(locked.rows).toEqual([
			{ employeeId: 'priya', paidDays: 6, leaveTaken: 0, note: '' },
			{ employeeId: 'amit', paidDays: 6.5, leaveTaken: 2, note: 'SL 1 · CL 1' },
			// The far store closes on Tuesdays and has no holidays.
			{ employeeId: 'far', paidDays: 4, leaveTaken: 0, note: '' },
		]);
		expect(months.get('2026-11')?.lockedAt).toBe('2026-12-01T05:00:00.000Z');
		expect((await service.grid(accountant, '2026-11', 'loc_gariahat')).lockedAt).toBe('2026-12-01T05:00:00.000Z');
		await expect(service.lock(accountant, '2026-11')).rejects.toSatisfy((e) => code(e) === 'attendance_locked');
	});

	it('locks over a month saved by hand, and refuses while a change waits or a day is incomplete', async () => {
		const open = NOV({ lockedAt: null, lockedBy: null });
		const waiting = build({ month: open });
		await waiting.service.change(manager, 'amit', '2026-11-12', present);
		await expect(waiting.service.lock(accountant, '2026-11')).rejects.toSatisfy(
			(e) => code(e) === 'attendance_requests_waiting',
		);
		const half = build({ month: open });
		await half.service.markIn(staff('priya'), at('10:00'));
		await expect(half.service.lock(accountant, '2026-11')).rejects.toSatisfy(
			(e) => code(e) === 'attendance_days_incomplete',
		);
		const ok = build({ month: open });
		expect(await ok.service.lock(undefined, '2026-11')).toMatchObject({ version: 3, lockedBy: null });
	});

	it('answers 409 when the month was saved meanwhile, and passes any other failure on', async () => {
		const conflict = build({ monthSaveFails: new Error('attendance_changed') }).service;
		await expect(conflict.lock(accountant, '2026-11')).rejects.toSatisfy((e) => status(e) === 409);
		const broken = build({ monthSaveFails: new Error('disk full') }).service;
		await expect(broken.lock(accountant, '2026-11')).rejects.toThrow('disk full');
	});
});

describe('a locked month (AT-D2)', () => {
	it('takes no marks and no leave asked for', async () => {
		const { service } = build({ month: NOV() });
		await expect(service.markIn(staff('priya'), at('10:00'))).rejects.toSatisfy(
			(e) => code(e) === 'attendance_locked',
		);
		await expect(service.markOut(staff('priya'), at('19:00'))).rejects.toSatisfy(
			(e) => code(e) === 'attendance_locked',
		);
		const ask = { leaveKey: 'CL', half: false, reason: '' };
		await expect(
			service.askLeave(staff('priya'), { ...ask, from: '2026-11-30', to: '2026-12-01' }),
		).rejects.toSatisfy((e) => code(e) === 'attendance_locked');
		await expect(
			service.askLeave(staff('priya'), { ...ask, from: '2026-10-31', to: '2026-11-01' }),
		).rejects.toSatisfy((e) => code(e) === 'attendance_locked');
	});

	it('changes only by someone who may edit, while the run is a draft, counting the person again', async () => {
		const { service, months } = build({ month: NOV(), run: { status: 'draft' } });
		await expect(service.change(manager, 'priya', '2026-11-10', present)).rejects.toSatisfy(
			(e) => code(e) === 'attendance_locked',
		);
		await service.change(accountant, 'priya', '2026-11-10', present);
		expect(months.get('2026-11')?.rows).toEqual([{ employeeId: 'priya', paidDays: 6, leaveTaken: 0, note: '' }]);
		await service.change(accountant, 'amit', '2026-11-10', { ...present, status: 'leave', leaveKey: 'CL' });
		await service.change(accountant, 'priya', '2026-11-11', present);
		expect(months.get('2026-11')?.rows.map((r) => [r.employeeId, r.paidDays, r.note])).toEqual([
			['priya', 7, ''],
			['amit', 6, 'CL 1'],
		]);
		const posted = build({ month: NOV(), run: { status: 'posted' } });
		await expect(posted.service.change(accountant, 'priya', '2026-11-10', present)).rejects.toSatisfy(
			(e) => code(e) === 'attendance_run_not_draft',
		);
		const noRun = build({ month: NOV() });
		expect(await noRun.service.change(accountant, 'priya', '2026-11-10', present)).toMatchObject({
			status: 'present',
		});
	});

	it('approves a waiting change only by someone who may edit, counting again; a refusal or a gone person counts nothing', async () => {
		const { service, store, months, monthStore } = build({ month: NOV({ lockedAt: null }) });
		await service.change(manager, 'priya', '2026-11-10', present);
		await service.change(manager, 'amit', '2026-11-11', present);
		months.set('2026-11', NOV());
		const approver = { userId: 'adm_approver', permissions: ['attendance.approve'] } as never;
		await expect(service.decide(approver, 'priya', '2026-11-10', true)).rejects.toSatisfy(
			(e) => code(e) === 'attendance_locked',
		);
		await service.decide(accountant, 'priya', '2026-11-10', true);
		expect(monthStore.save).toHaveBeenCalledTimes(1);
		await service.decide(accountant, 'amit', '2026-11-11', false);
		expect(monthStore.save).toHaveBeenCalledTimes(1);
		store.set('ghost_2026-11-12', {
			...(store.get('priya_2026-11-10') as AttendanceDay),
			id: 'ghost_2026-11-12',
			employeeId: 'ghost',
			day: '2026-11-12',
			pending: { ...present, askedBy: 'adm_manager', askedAt: '2026-11-12T10:00:00.000Z' },
		});
		expect(await service.decide(accountant, 'ghost', '2026-11-12', true)).toMatchObject({ pending: null });
		expect(monthStore.save).toHaveBeenCalledTimes(1);
	});

	it('counts a day as set when only its marker is kept', async () => {
		const { service, store } = build({ access: { maySeeAll: true } });
		store.set('priya_2026-11-03', {
			...(await service.change(accountant, 'priya', '2026-11-02', present)),
			id: 'priya_2026-11-03',
			day: '2026-11-03',
			changedBy: null,
			markedBy: 'adm_priya',
		});
		const grid = await service.grid(accountant, '2026-11', 'loc_gariahat');
		expect(grid.people[0]?.days.map((d) => d.day)).toEqual(['2026-11-02', '2026-11-03']);
	});
});

describe('My attendance and asking for leave (AT1)', () => {
	const leave = (over: Partial<{ leaveKey: string; from: string; to: string; half: boolean }> = {}) => ({
		leaveKey: 'CL',
		from: '2026-12-01',
		to: '2026-12-01',
		half: false,
		reason: '',
		...over,
	});

	it('shows today, the month so far and each type’s leave left by its rules', async () => {
		const { service } = build();
		await service.change(accountant, 'priya', '2026-11-02', present);
		await service.change(accountant, 'priya', '2026-11-03', { ...present, status: 'present', leaveKey: 'CL' });
		await service.change(accountant, 'priya', '2026-11-10', { ...present, status: 'leave', leaveKey: 'CL' });
		await service.change(accountant, 'priya', '2026-11-11', { ...present, status: 'half', leaveKey: 'SL' });
		await service.change(accountant, 'priya', '2026-11-12', { ...present, status: 'leave', leaveKey: 'CL' });
		await service.markIn(staff('priya'), at('10:02'));
		const me = await service.summary(staff('priya'), at('12:00'));
		expect(me).toMatchObject({
			name: 'priya',
			locationName: 'Gariahat store',
			today: '2026-11-25',
			shift: { start: '10:00', end: '19:00' },
			day: { status: 'incomplete', lateMinutes: 2 },
			present: 2.5,
			leaveByType: { CL: 2, SL: 0.5 },
		});
		// EL: 15.5 carried from 2025-26 and 10.5 worked this year; CL: 10 less 2; SL: 3.5 + 14 carried, 14 less a half.
		expect(Object.fromEntries(me.leave.map((l) => [l.key, l.left]))).toEqual({
			EL: 26,
			CL: 8,
			SL: 31,
			ML: null,
			LOP: null,
			CO: 10,
		});
		expect(me.leave.find((l) => l.key === 'CO')).toMatchObject({ halfDays: false, noticeDays: 2 });
	});

	it('starts a type from the leave the person had when added', async () => {
		const { service } = build();
		const opening = { asOf: '2026-10-01', carried: 5, credited: 14, creditedWorkedOut: 14, taken: 2 };
		PEOPLE.push(
			person('opened', {
				openingLeave: [
					{ typeKey: 'CL', ...opening, carried: null },
					{ typeKey: 'SL', ...opening },
				],
			}),
		);
		try {
			const me = await service.summary(staff('opened'), at('12:00'));
			expect(me.leave.find((l) => l.key === 'SL')?.left).toBe(17);
		} finally {
			PEOPLE.pop();
		}
	});

	it('names the store by its id when the store is unknown, and starts the month empty', async () => {
		const { service } = build({ access: { maySeeAll: true } });
		PEOPLE.push(person('lost', { locationId: 'loc_lost' }));
		try {
			expect(await service.summary(staff('lost'), at('12:00'))).toMatchObject({
				locationName: 'loc_lost',
				day: null,
				present: 0,
				leave: [],
			});
		} finally {
			PEOPLE.pop();
		}
	});

	it('refuses a type not in force, half days or short notice where the rules forbid them, and days with none to take', async () => {
		const { service } = build();
		const ask = (over: Parameters<typeof leave>[0]) => service.askLeave(staff('priya'), leave(over), at('09:00'));
		for (const key of ['XX', 'NR', 'OF'])
			await expect(ask({ leaveKey: key })).rejects.toSatisfy((e) => code(e) === 'leave_type_unknown');
		await expect(ask({ leaveKey: 'CO', half: true })).rejects.toSatisfy((e) => code(e) === 'leave_no_half_days');
		await expect(ask({ leaveKey: 'CO', from: '2026-11-26', to: '2026-11-26' })).rejects.toSatisfy(
			(e) => code(e) === 'leave_notice',
		);
		// A Sunday alone, for a type that does not count weekly offs.
		await expect(ask({ from: '2026-11-29', to: '2026-11-29' })).rejects.toSatisfy(
			(e) => code(e) === 'leave_no_working_days',
		);
	});

	it('leaves out weekly offs and holidays unless the type counts them, across months', async () => {
		const { service } = build();
		const days = async (over: Parameters<typeof leave>[0]) =>
			(await service.askLeave(staff('priya'), leave(over), at('09:00'))).map((d) => d.day);
		expect(await days({ from: '2026-11-28', to: '2026-12-01' })).toEqual([
			'2026-11-28',
			'2026-11-30',
			'2026-12-01',
		]);
		expect(await days({ from: '2026-12-24', to: '2026-12-26' })).toEqual(['2026-12-24', '2026-12-26']);
		expect(await days({ leaveKey: 'CO', from: '2026-12-05', to: '2026-12-06' })).toEqual([
			'2026-12-05',
			'2026-12-06',
		]);
	});

	it('refuses more than is left, counting leave already waiting; unpaid leave and a type that may go below nothing have no limit', async () => {
		const { service } = build();
		const ask = (over: Parameters<typeof leave>[0]) => service.askLeave(staff('priya'), leave(over), at('09:00'));
		// December 1-12 holds eleven working days; casual leave has ten.
		await expect(ask({ to: '2026-12-12' })).rejects.toSatisfy((e) => code(e) === 'leave_not_enough');
		await ask({ from: '2026-12-01', to: '2026-12-05' });
		await expect(ask({ from: '2026-12-07', to: '2026-12-12' })).rejects.toSatisfy(
			(e) => code(e) === 'leave_not_enough',
		);
		expect(await ask({ from: '2026-12-07', to: '2026-12-11' })).toHaveLength(5);
		expect(await ask({ leaveKey: 'LOP', from: '2027-01-04', to: '2027-01-30' })).toHaveLength(24);
		expect(await ask({ leaveKey: 'CO', from: '2027-02-01', to: '2027-02-28' })).toHaveLength(28);
	});

	it('gives leave on request up to its days, less what already waits', async () => {
		const { service } = build();
		const ask = (from: string, to: string) =>
			service.askLeave(staff('priya'), leave({ leaveKey: 'ML', from, to }), at('09:00'));
		await expect(ask('2027-01-01', '2027-08-31')).rejects.toSatisfy((e) => code(e) === 'leave_not_enough');
		expect(await ask('2027-01-01', '2027-06-30')).toHaveLength(155);
		await expect(ask('2027-07-01', '2027-08-31')).rejects.toSatisfy((e) => code(e) === 'leave_not_enough');
	});
});
