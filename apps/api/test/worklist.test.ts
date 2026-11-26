import { WEST_BENGAL_LEAVE } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { WorklistController, WorklistService } from '../src/payroll/worklist';

/** Brief 26 WL1, WL2, PE5: every item waiting on a person, from its own place, and ✓ ✕ for yes-or-no ones. */
const code = (error: unknown) => (error as { response?: { message?: string } }).response?.message;
const pending = (employeeId: string, day: string, over: Record<string, unknown>) => ({
	id: `${employeeId}_${day}`,
	employeeId,
	day,
	locationId: 'loc_gariahat',
	status: 'absent',
	pending: { status: 'present', leaveKey: null, askedBy: 'adm_manager', askedAt: `${day}T10:00:00.000Z`, ...over },
});
const person = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	name: id,
	locationId: 'loc_gariahat',
	ptState: '19',
	designation: '',
	department: '',
	leftOn: null,
	skillLevel: null,
	structure: { basic: 10_000, da: 0, hra: 0, special: 5_000, conveyance: 0, other: 0 },
	openingLeave: [],
	createdAt: '2026-11-01T00:00:00.000Z',
	updatedAt: '2026-11-02T00:00:00.000Z',
	...over,
});
const PEOPLE = [
	person('priya'),
	person('rina', { skillLevel: 'skilled' }),
	person('suresh', {
		locationId: 'loc_unknown',
		openingLeave: [
			{ typeKey: 'EL', carried: 34 },
			{ typeKey: 'CL', carried: 0 },
			{ typeKey: 'SL', carried: null },
			{ typeKey: 'ML', carried: 500 },
			{ typeKey: 'XX', carried: 9 },
		],
	}),
	person('gone', { leftOn: '2026-01-01', skillLevel: 'skilled' }),
	person('plain', { openingLeave: undefined }),
];
const run = (month: string, status: string, rows: unknown[]) => ({
	month,
	status,
	rows,
	updatedAt: `${month}-28T00:00:00.000Z`,
});

function build() {
	const attendance = {
		pending: vi.fn(async () => [
			pending('amit', '2026-11-07', {}),
			pending('priya', '2026-12-03', { status: 'leave', leaveKey: 'CL' }),
			pending('priya', '2026-12-04', { status: 'half', leaveKey: 'SL', askedAt: '2026-11-20T10:00:00.000Z' }),
			pending('rina', '2026-11-08', { status: 'present', leaveKey: 'CL', askedAt: '2026-11-08T09:00:00.000Z' }),
		]),
		decide: vi.fn(async () => ({})),
	};
	const saved: unknown[] = [];
	const employees = {
		list: async () => PEOPLE,
		get: async (id: string) => PEOPLE.find((p) => p.id === id) ?? null,
		save: vi.fn(async (e: unknown) => {
			saved.push(e);
			return e;
		}),
	};
	const audit = { append: vi.fn(async () => undefined) };
	const service = new WorklistService(
		attendance as never,
		{
			list: async () => [
				run('2026-11', 'draft', [
					{ employeeId: 'priya', name: 'priya', checks: [{ code: 'pf_below_law', blocking: true }] },
					{ employeeId: 'rina', name: 'rina', checks: [{ code: 'reason_needed', blocking: false }] },
					{ employeeId: 'amit', name: 'amit' },
				]),
				run('2026-10', 'posted', [
					{ employeeId: 'priya', name: 'priya', checks: [{ code: 'x', blocking: true }] },
				]),
			],
		} as never,
		employees as never,
		{ list: async () => [{ id: 'loc_gariahat', stateCode: '19' }] } as never,
		{
			forMonth: async () => ({
				states: [
					{
						stateCode: '19',
						leaveTypes: [...WEST_BENGAL_LEAVE],
						minimumWages: [{ from: '2026-07-01', levels: { skilled: 1_600_000 } }],
					},
				],
			}),
		} as never,
		{
			list: async () => ({
				items: [
					{
						id: 'adj_1',
						title: 'Jamdani saree',
						quantity: -2,
						kind: 'adjustment',
						requestedBy: 'adm_mgr',
						requestedByName: null,
						requestedAt: '2026-11-25T08:00:00.000Z',
					},
				],
			}),
		} as never,
		audit as never,
	);
	return { service, attendance, saved, audit };
}
const everyone = {
	userId: 'adm_owner',
	permissions: ['attendance.approve', 'accounts.edit', 'stock.approve'],
} as never;

describe('the worklist (WL1, WL2)', () => {
	it('gathers each kind from its place for someone who may act on it, the newest first', async () => {
		const rows = await build().service.rows(everyone, new Date('2026-11-26T06:00:00Z'));
		expect(rows.map((r) => [r.kind, r.since.slice(0, 10)])).toEqual([
			['leave_asked', '2026-12-03'],
			['payslip_blocking', '2026-11-28'],
			['stock_approval', '2026-11-25'],
			// A half day of leave is leave asked for; a leave type on a present day is a change.
			['leave_asked', '2026-11-20'],
			['attendance_change', '2026-11-08'],
			['attendance_change', '2026-11-07'],
			['salary_below_minimum', '2026-11-02'],
			['opening_leave_over_cap', '2026-11-01'],
		]);
		expect(rows.find((r) => r.id === 'attendance_change:amit_2026-11-07')).toMatchObject({
			id: 'attendance_change:amit_2026-11-07',
			params: { name: 'amit', day: '2026-11-07', from: 'absent', to: 'present', leave: '' },
			open: { path: ['/payroll/attendance'], query: { month: '2026-11', employeeId: 'amit', day: '2026-11-07' } },
		});
		expect(rows.find((r) => r.kind === 'payslip_blocking')?.open.path).toEqual([
			'/payroll/runs',
			'2026-11',
			'payslips',
			'priya',
			'edit',
		]);
		expect(rows.find((r) => r.kind === 'salary_below_minimum')).toMatchObject({
			params: { name: 'rina', short: 6_000 },
		});
		expect(rows.find((r) => r.kind === 'opening_leave_over_cap')).toMatchObject({
			params: { name: 'suresh', leave: 'EL', carried: 34, cap: 30 },
		});
		expect(rows.find((r) => r.kind === 'stock_approval')).toMatchObject({
			askedBy: 'adm_mgr',
			open: { query: { id: 'adj_1' } },
		});
	});

	it('shows nothing to someone with none of the permissions, and counts for the bell', async () => {
		const { service } = build();
		expect(await service.rows({ userId: 'adm_staff', permissions: ['attendance.use'] } as never)).toEqual([]);
		expect(await service.rows(undefined)).toEqual([]);
		expect(await service.count({ userId: 'adm_mgr', permissions: ['attendance.approve'] } as never)).toEqual({
			count: 4,
		});
	});

	it('answers attendance and leave in the row, and nothing else', async () => {
		const { service, attendance } = build();
		await service.answer(everyone, 'attendance_change:amit_2026-11-07', true);
		await service.answer(everyone, 'leave_asked:priya_2026-12-03', false);
		expect(attendance.decide.mock.calls.map((c) => c.slice(1))).toEqual([
			['amit', '2026-11-07', true],
			['priya', '2026-12-03', false],
		]);
		for (const id of ['stock_approval:adj_1', 'leave_asked', 'leave_asked:_2026', 'leave_asked:nodate'])
			await expect(service.answer(everyone, id, true)).rejects.toSatisfy(
				(e) => code(e) === 'worklist_not_answerable',
			);
	});

	it('hands each route to the service', () => {
		const svc = { rows: vi.fn(), count: vi.fn(), answer: vi.fn() };
		const c = new WorklistController(svc as never);
		c.rows(everyone);
		c.count(everyone);
		c.approve('attendance_change:amit_2026-11-07', everyone);
		c.reject('attendance_change:amit_2026-11-07', { reason: 'No' }, everyone);
		expect(svc.answer.mock.calls).toEqual([
			[everyone, 'attendance_change:amit_2026-11-07', true],
			[everyone, 'attendance_change:amit_2026-11-07', false],
		]);
		expect([svc.rows, svc.count].map((f) => f.mock.calls.length)).toEqual([1, 1]);
	});
});

describe('opening leave above a cap (WL2)', () => {
	const status = (e: unknown) => (e as { status?: number }).status;

	it('accepts it in the row, kept on the person and in the audit log; a cross is put right on the form', async () => {
		const { service, saved, audit } = build();
		await service.answer(everyone, 'opening_leave_over_cap:suresh_EL', true);
		expect(saved[0]).toMatchObject({ id: 'suresh', openingLeaveAccepted: ['EL'] });
		expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'payroll.opening_leave.accept' }));
		await expect(service.answer(everyone, 'opening_leave_over_cap:suresh_EL', false)).rejects.toSatisfy(
			(e) => code(e) === 'worklist_correct_on_page',
		);
		const manager = { userId: 'adm_mgr', permissions: ['attendance.approve'] } as never;
		await expect(service.answer(manager, 'opening_leave_over_cap:suresh_EL', true)).rejects.toSatisfy(
			(e) => status(e) === 403,
		);
		await expect(service.answer(undefined, 'opening_leave_over_cap:suresh_EL', true)).rejects.toSatisfy(
			(e) => status(e) === 403,
		);
		await expect(service.answer(everyone, 'opening_leave_over_cap:nobody_EL', true)).rejects.toSatisfy(
			(e) => status(e) === 404,
		);
	});

	it('leaves out a type already accepted, and adds to what was accepted before', async () => {
		const { service, saved } = build();
		PEOPLE.push(
			person('accepted', { openingLeave: [{ typeKey: 'EL', carried: 40 }], openingLeaveAccepted: ['CL'] }),
		);
		try {
			await service.answer(everyone, 'opening_leave_over_cap:accepted_EL', true);
			expect(saved[0]).toMatchObject({ openingLeaveAccepted: ['CL', 'EL'] });
			PEOPLE[PEOPLE.length - 1] = person('accepted', {
				openingLeave: [{ typeKey: 'EL', carried: 40 }],
				openingLeaveAccepted: ['EL'],
			});
			const rows = await service.rows(everyone, new Date('2026-11-26T06:00:00Z'));
			expect(rows.filter((r) => r.kind === 'opening_leave_over_cap').map((r) => r.params['name'])).toEqual([
				'suresh',
			]);
		} finally {
			PEOPLE.pop();
		}
	});
});
