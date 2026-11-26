import type { Attendance, Employee, PayrollRow, PayrollRun, StatePayrollRules } from '@saha-textile/contracts';
import { statutoryDue } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { BUILT_IN_PAYROLL_RULES, rulesOf } from '../src/payroll/payroll-rules.service';
import { PayrollReturnsService } from '../src/payroll/payroll-returns.service';
import { PayrollService } from '../src/payroll/payroll.service';

/**
 * Professional tax and the labour welfare fund per State (brief 25 ST1, ST2): each person taxed by their work location's
 * State, a State the rules don't cover yet holding the run back from approval, and one return per State, each due on
 * its own day.
 */

const at = '2026-12-01T06:00:00.000Z';
const now = new Date(at);
const refusal = (code: string) => ({ response: { message: code } });
const ca = { userId: 'adm_ca', permissions: ['accounts.post', 'accounts.lock'] } as never;
const clerk = { userId: 'adm_clerk', permissions: ['accounts.edit'] } as never;

const stateSet = (stateCode: string, over: Partial<StatePayrollRules> = {}): StatePayrollRules => ({
	stateCode,
	ptFrequency: 'monthly',
	ptSlabs: [
		{ upToPaise: 1_000_000, taxPaise: 0 },
		{ upToPaise: null, taxPaise: 20_000 },
	],
	ptMonths: [],
	ptDueDay: 21,
	lwfEmployeePaise: 300,
	lwfEmployerPaise: 1_500,
	lwfMonths: [11],
	lwfDueDay: 15,
	...over,
});
/** West Bengal and Maharashtra have sets; Maharashtra's welfare fund is taken in June and December only. */
const STATES = [
	stateSet('19'),
	stateSet('27', {
		ptSlabs: [
			{ upToPaise: 750_000, taxPaise: 0 },
			{ upToPaise: null, taxPaise: 25_000 },
		],
		lwfEmployeePaise: 1_200,
		lwfEmployerPaise: 3_600,
		lwfMonths: [6, 12],
	}),
];
const RULES = rulesOf({ ...BUILT_IN_PAYROLL_RULES, states: STATES });
const LOCATIONS = [
	{ id: 'loc_bar', stateCode: '19' },
	{ id: 'loc_pune', stateCode: '27' },
	{ id: 'loc_blr', stateCode: '29' },
];

const employee = (id: string, name: string, locationId: string, ptState = '19'): Employee => ({
	id,
	name,
	code: '',
	designation: '',
	department: '',
	userId: null,
	locationId,
	joinedOn: '2025-04-01',
	leftOn: null,
	pan: '',
	aadhaar: '',
	uan: '',
	esiNumber: '',
	ptState,
	taxRegime: 'old',
	dateOfBirth: null,
	taxDeclarations: [],
	bankAccount: '',
	ifsc: '',
	pfOn: false,
	esiOn: false,
	structure: { basic: 10_000, da: 0, hra: 0, special: 6_000, conveyance: 0, other: 0 },
	advanceDueINR: 0,
	advancePerMonthINR: 0,
	createdAt: at,
	updatedAt: at,
	version: 0,
});
/**
 * Arjun's shop is gone from the locations and his saved State is Tamil Nadu; Sudip's is gone too and his is West
 * Bengal; Asha works in Bengaluru. Neither Tamil Nadu nor Karnataka has a set yet.
 */
const PEOPLE = [
	employee('emp_arjun', 'Arjun', 'loc_gone', '33'),
	employee('emp_meera', 'Meera', 'loc_bar'),
	employee('emp_rahul', 'Rahul', 'loc_pune', '19'),
	employee('emp_asha', 'Asha', 'loc_blr'),
	employee('emp_sudip', 'Sudip', 'loc_gone'),
];
const ATTENDANCE: Attendance = {
	month: '2026-11',
	daysInMonth: 30,
	rows: PEOPLE.map((p) => ({ employeeId: p.id, paidDays: 30, leaveTaken: 0, note: '' })),
	lockedAt: at,
	lockedBy: 'adm_clerk',
	version: 1,
};

function payroll(locations: unknown[] = LOCATIONS) {
	const runStore = new Map<string, PayrollRun>();
	const runs = {
		list: async () => [...runStore.values()],
		get: async (month: string) => runStore.get(month) ?? null,
		save: vi.fn(async (r: PayrollRun, expectedVersion: number | null) => {
			const saved = { ...r, version: expectedVersion === null ? 0 : expectedVersion + 1 };
			runStore.set(r.month, saved);
			return saved;
		}),
	};
	const service = new PayrollService(
		{ list: async () => PEOPLE } as never,
		{ get: async () => ATTENDANCE } as never,
		runs as never,
		{} as never,
		{} as never,
		{ append: async () => undefined } as never,
		{ forMonth: async () => RULES } as never,
		{ list: async () => locations } as never,
		{ issue: async () => 'PS/26-27/000001' } as never,
	);
	return { service, runs };
}

describe('preparing a run with people in several States (ST2)', () => {
	it('taxes each person by their work location’s State, else the State saved on them', async () => {
		const run = await payroll().service.prepare('2026-11', now);
		expect(
			run.rows.map((r) => [r.employeeId, r.stateCode, r.ptPaise, r.lwfEmployeePaise, r.lwfEmployerPaise]),
		).toEqual([
			// No set for Tamil Nadu or Karnataka: neither tax.
			['emp_arjun', '33', 0, 0, 0],
			['emp_meera', '19', 20_000, 300, 1_500],
			// Pune's State, though his saved one is West Bengal; no welfare fund in November.
			['emp_rahul', '27', 25_000, 0, 0],
			['emp_asha', '29', 0, 0, 0],
			['emp_sudip', '19', 20_000, 300, 1_500],
		]);
		// The welfare fund comes out of the person's pay.
		const meera = run.rows.find((r) => r.employeeId === 'emp_meera') as PayrollRow;
		const asha = run.rows.find((r) => r.employeeId === 'emp_asha') as PayrollRow;
		expect(asha.netPaise - meera.netPaise).toBe(20_000 + 300);
		expect(run.statesMissing).toEqual(['29', '33']);
	});

	it('lists no State missing when every person’s State has a set', async () => {
		const run = await payroll([{ id: 'loc_gone', stateCode: '19' }, ...LOCATIONS.slice(0, 2)]).service.prepare(
			'2026-11',
			now,
		);
		expect(run.rows.map((r) => r.stateCode)).toEqual(['19', '19', '27', '19', '19']);
		expect(run.statesMissing).toEqual([]);
	});

	it('holds the run back from approval until the missing States are added, the approver checked first', async () => {
		const { service } = payroll();
		await service.prepare('2026-11', now);
		const approve = { to: 'approved', version: 0, bankLedgerId: null, paidOn: null } as const;
		await expect(service.step('2026-11', approve, clerk, now)).rejects.toMatchObject(
			refusal('payroll_approver_only'),
		);
		await expect(service.step('2026-11', approve, ca, now)).rejects.toMatchObject(
			refusal('payroll_state_rules_missing'),
		);
	});
});

const row = (employeeId: string, over: Partial<PayrollRow> = {}): PayrollRow => ({
	employeeId,
	name: employeeId,
	locationId: 'loc_bar',
	paidDays: 30,
	grossPaise: 1_600_000,
	pfWagesPaise: 0,
	pfEmployeePaise: 0,
	pfEmployerPaise: 0,
	epsPaise: 0,
	esiEmployeePaise: 0,
	esiEmployerPaise: 0,
	ptPaise: 0,
	tdsPaise: 0,
	advancePaise: 0,
	netPaise: 0,
	...over,
});
/** November, posted: West Bengal (one row from before States), Maharashtra, and Karnataka with no set in the version. */
const NOVEMBER = {
	id: 'pay_2026-11',
	month: '2026-11',
	status: 'posted',
	rows: [
		row('emp_meera', { stateCode: '19', ptPaise: 20_000, lwfEmployeePaise: 300, lwfEmployerPaise: 1_500 }),
		row('emp_old', { ptPaise: 15_000 }),
		row('emp_rahul', { stateCode: '27', ptPaise: 25_000 }),
		row('emp_asha', { stateCode: '29', ptPaise: 10_000 }),
	],
	rulesFrom: '2026-04-01',
	voucherId: null,
	payVoucherId: null,
	approvedBy: null,
	approvedAt: null,
	createdAt: at,
	updatedAt: at,
	version: 2,
} as PayrollRun;

function returns(filings: unknown[]) {
	return new PayrollReturnsService(
		{ list: async () => [NOVEMBER], get: async () => NOVEMBER } as never,
		{ list: async () => [] } as never,
		{ list: async () => filings, insert: vi.fn() } as never,
		{ get: async () => null } as never,
		{ get: async () => null } as never,
		{ forMonth: async () => RULES } as never,
		{ schedule: async () => ({ rows: [] }) } as never,
		{ seller: async (f: unknown) => f, renderActiveCopies: async () => new Uint8Array() } as never,
	);
}

describe('professional tax and the welfare fund returns per State (ST2)', () => {
	it('give each State its own return on its own day, the schemes’ day where the version has no set, State by State', async () => {
		const list = await returns([
			// Filed before returns were per State: West Bengal's.
			{ kind: 'pt', period: '2026-11', filedOn: '2026-12-18', reference: 'WBPT-1' },
		]).returns(new Date('2027-01-10T06:00:00.000Z'));
		const perState = list.filter((r) => r.kind === 'pt' || r.kind === 'lwf');
		expect(perState.map((r) => [r.kind, r.stateCode, r.due, r.amountPaise, r.status])).toEqual(
			[
				['lwf', '19', '2026-12-15', 1_800, 'ready'],
				['pt', '19', '2026-12-21', 35_000, 'filed'],
				['pt', '27', '2026-12-21', 25_000, 'ready'],
				['pt', '29', statutoryDue('pt', '2026-11', RULES.schemes), 10_000, 'ready'],
			].sort((a, b) => String(a[2]).localeCompare(String(b[2])) || String(a[0]).localeCompare(String(b[0]))),
		);
		expect(perState.find((r) => r.stateCode === '19' && r.kind === 'pt')?.reference).toBe('WBPT-1');
	});
});
