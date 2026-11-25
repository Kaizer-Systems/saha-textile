import type { Attendance, Employee, PayrollRun, PayrollRulesVersion, StatePayrollRules } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { BUILT_IN_PAYROLL_RULES, PayrollRulesService, rulesOf } from '../src/payroll/payroll-rules.service';
import { PayrollService } from '../src/payroll/payroll.service';

/**
 * Brief 26 PT1–PT3 in the run: women's slabs and a State's exemptions read from the person, and a half-yearly State
 * taxed on the period's actual pay, in its month or on leaving earlier. Saving rules refuses a set past ₹2,500 a year.
 */

const at = '2026-12-01T06:00:00.000Z';
const now = new Date(at);
const refusal = (code: string) => ({ response: { message: code } });

const state = (stateCode: string, over: Partial<StatePayrollRules>): StatePayrollRules => ({
	stateCode,
	ptFrequency: 'monthly',
	ptSlabs: [{ upToPaise: null, taxPaise: 0 }],
	ptMonths: [],
	ptDueDay: 21,
	lwfEmployeePaise: 0,
	lwfEmployerPaise: 0,
	lwfMonths: [],
	lwfDueDay: 15,
	...over,
});
const MAHARASHTRA = state('27', {
	ptSlabs: [
		{ upToPaise: 750_000, taxPaise: 0 },
		{ upToPaise: null, taxPaise: 20_000, otherMonth: { month: 2, taxPaise: 30_000 } },
	],
	ptWomenSlabs: [
		{ upToPaise: 2_500_000, taxPaise: 0 },
		{ upToPaise: null, taxPaise: 20_000 },
	],
	ptExemptFromAge: 65,
	ptExemptDisability: true,
});
const CHENNAI = state('33', {
	ptFrequency: 'half_yearly',
	ptBasis: 'actual',
	ptMonths: [9, 3],
	ptSlabs: [
		{ upToPaise: 2_100_000, taxPaise: 0 },
		{ upToPaise: 3_000_000, taxPaise: 13_500 },
		{ upToPaise: null, taxPaise: 31_500 },
	],
});
const RULES = rulesOf({ ...BUILT_IN_PAYROLL_RULES, states: [MAHARASHTRA, CHENNAI] });
const LOCATIONS = [
	{ id: 'loc_pune', stateCode: '27' },
	{ id: 'loc_chennai', stateCode: '33' },
];

const employee = (id: string, locationId: string, over: Partial<Employee> = {}): Employee => ({
	id,
	name: id,
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
	ptState: '19',
	taxRegime: 'new',
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
	...over,
});
const PEOPLE = [
	employee('emp_ravi', 'loc_pune'),
	employee('emp_neha', 'loc_pune', { gender: 'woman' }),
	employee('emp_old', 'loc_pune', { dateOfBirth: '1960-01-15' }),
	employee('emp_vikram', 'loc_pune', { disability: true }),
	employee('emp_jawan', 'loc_pune', { ptExemptReason: 'Armed forces' }),
	employee('emp_leaving', 'loc_chennai', { leftOn: '2026-11-20' }),
	employee('emp_staying', 'loc_chennai'),
];
const ATTENDANCE: Attendance = {
	month: '2026-11',
	daysInMonth: 30,
	rows: PEOPLE.map((p) => ({ employeeId: p.id, paidDays: 30, leaveTaken: 0, note: '' })),
	lockedAt: at,
	lockedBy: 'adm_clerk',
	version: 1,
};
/** October's run: the Chennai half-year began in October, so it is in the leaver's period; September's is not. */
const earlierRun = (month: string): PayrollRun =>
	({
		month,
		status: 'paid',
		rows: [
			{ employeeId: 'emp_leaving', grossPaise: 1_600_000 },
			{ employeeId: 'emp_ravi', grossPaise: 1_600_000 },
		],
	}) as never;

function payroll() {
	const store = new Map<string, PayrollRun>([
		['2026-09', earlierRun('2026-09')],
		['2026-10', earlierRun('2026-10')],
	]);
	const runs = {
		list: async () => [...store.values()],
		get: async (month: string) => (month === '2026-11' ? (store.get(month) ?? null) : null),
		save: vi.fn(async (r: PayrollRun) => {
			store.set(r.month, { ...r, version: 0 });
			return { ...r, version: 0 };
		}),
	};
	return new PayrollService(
		{ list: async () => PEOPLE } as never,
		{ get: async () => ATTENDANCE } as never,
		runs as never,
		{} as never,
		{} as never,
		{ append: async () => undefined } as never,
		{ forMonth: async () => RULES } as never,
		{ list: async () => LOCATIONS } as never,
		{ issue: async () => 'PS/26-27/000001' } as never,
	);
}

describe('professional tax by the person and the period (PT1–PT3)', () => {
	it('reads women’s slabs and exemptions, and taxes a Chennai leaver on the half-year’s actual pay', async () => {
		const run = await payroll().prepare('2026-11', now);
		expect(Object.fromEntries(run.rows.map((r) => [r.employeeId, r.ptPaise]))).toEqual({
			emp_ravi: 20_000,
			// ₹16,000 is under the women's ₹25,000.
			emp_neha: 0,
			// 66 on 30 November: past Maharashtra's 65.
			emp_old: 0,
			emp_vikram: 0,
			emp_jawan: 0,
			// October and November paid ₹32,000: the top slab, taken in the leaving month.
			emp_leaving: 31_500,
			// Not leaving, and November isn't a deduction month.
			emp_staying: 0,
		});
	});
});

describe('saving rules past the Constitution’s cap (PT1)', () => {
	const write = (states: StatePayrollRules[]) =>
		({ ...BUILT_IN_PAYROLL_RULES, from: '2026-12-01', states }) as unknown as PayrollRulesVersion;
	const service = () =>
		new PayrollRulesService(
			{ list: async () => [], insert: vi.fn(async () => undefined) } as never,
			{ list: async () => [] } as never,
			{ append: vi.fn(async () => undefined) } as never,
		);

	it('refuses a State whose year’s most is above ₹2,500, and keeps one at it', async () => {
		const over = state('27', { ptSlabs: [{ upToPaise: null, taxPaise: 25_000 }] });
		await expect(service().add(write([over]), undefined, now)).rejects.toMatchObject(refusal('pt_over_year_cap'));
		await expect(service().add(write([MAHARASHTRA]), undefined, now)).resolves.toMatchObject({
			from: '2026-12-01',
		});
	});
});
