import type { AttendanceDay, Employee } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { AttendanceDaysController, AttendanceDaysService } from '../src/payroll/attendance-days';

/**
 * Brief 26 AT1-AT3: marking one's own day at the server's time, asking for leave, a store's month for those in charge
 * of it, changes made at once or asked for, and approvals nobody gives themselves.
 */
const status = (error: unknown) => (error as { status?: number }).status;
const code = (error: unknown) => (error as { response?: { message?: string } }).response?.message;

const person = (id: string, over: Partial<Employee> = {}) =>
	({ id, name: id, userId: `adm_${id}`, locationId: 'loc_gariahat', leftOn: null, ...over }) as Employee;
const PEOPLE = [
	person('priya'),
	person('amit'),
	person('gone', { leftOn: '2026-01-01' }),
	person('far', { locationId: 'loc_far' }),
];

function build(options: { access?: { worksAt?: string[]; maySeeAll?: boolean } | null; saveFails?: Error } = {}) {
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
					leaveTypes: [
						{ key: 'CL', paid: 'full' },
						{ key: 'SL', paid: 'half' },
					],
				},
				{ stateCode: '27' },
			],
		}),
	};
	const access = options.access === undefined ? { worksAt: ['loc_gariahat'] } : options.access;
	const service = new AttendanceDaysService(
		days as never,
		{ list: async () => PEOPLE } as never,
		{ adminUserLocations: async () => access } as never,
		rules as never,
	);
	return { service, days, store };
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
		expect(grid.people.map((p) => [p.employeeId, p.paidDays, p.leaveByType, p.withoutPay, p.lateMarks])).toEqual([
			['priya', 1, {}, 0, 1],
			['amit', 0.5, { SL: 1, XX: 1 }, 1.5, 0],
			['gone', 0, {}, 0, 0],
		]);
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
		expect(service.markIn).toHaveBeenCalledWith(manager);
		expect(service.grid).toHaveBeenCalledWith(manager, '2026-11', 'loc_gariahat');
		expect(service.decide.mock.calls).toEqual([
			[manager, 'amit', '2026-11-08', true],
			[manager, 'amit', '2026-11-08', false],
		]);
	});
});
