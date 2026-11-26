import type { Attendance, Employee, PayrollRow, PayrollRun } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { payslipData } from '../src/documents/payslip-print';
import { BUILT_IN_PAYROLL_RULES, rulesOf } from '../src/payroll/payroll-rules.service';
import { PayrollService } from '../src/payroll/payroll.service';

/**
 * Brief 26 SR2, SR4 in the run: each month paid on the salary in force in it, and a revision dated back paying its
 * arrears once, with the next run, PF worked on them, named on the payslip.
 */

const at = '2026-12-01T06:00:00.000Z';
const now = new Date(at);
const RULES = rulesOf({ ...BUILT_IN_PAYROLL_RULES });

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
const OLD = { basic: 10_000, da: 0, hra: 0, special: 6_000, conveyance: 0, other: 0 };
const NEW = { ...OLD, basic: 11_000, special: 6_600 };
const version = (from: string, structure: typeof OLD) => ({
	from,
	structure,
	ctcYearINR: null,
	reason: '',
	decrease: false,
	acceptedBy: null,
	acceptedAt: at,
	arrearsPaidIn: null,
});
const PEOPLE = [
	employee('emp_priya', 'loc_kolkata', {
		pfOn: true,
		structure: NEW,
		salaryHistory: [version('2025-04-01', OLD), version('2026-09-01', NEW)],
	}),
	employee('emp_plain', 'loc_kolkata'),
];
const attendance = (month: string): Attendance => ({
	month,
	daysInMonth: 30,
	rows: PEOPLE.map((p) => ({ employeeId: p.id, paidDays: 30, leaveTaken: 0, note: '' })),
	lockedAt: at,
	lockedBy: 'adm_clerk',
	version: 1,
});
/** Every day of the month paid. */
const fullMonth = (month: string) =>
	new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const paidRun = (month: string, status: PayrollRun['status'] = 'paid', over: Partial<PayrollRow> = {}): PayrollRun =>
	({
		month,
		status,
		rows: [
			{
				employeeId: 'emp_priya',
				paidDays: fullMonth(month),
				grossPaise: 1_600_000,
				pfWagesPaise: 1_000_000,
				...over,
			},
			{ employeeId: 'emp_plain', paidDays: fullMonth(month), grossPaise: 1_600_000, pfWagesPaise: 1_000_000 },
		],
	}) as never;

function payroll(month: string, earlier: PayrollRun[], rules = RULES) {
	const store = new Map<string, PayrollRun>(earlier.map((r) => [r.month, r]));
	const runs = {
		list: async () => [...store.values()],
		get: async (m: string) => (m === month ? (store.get(m) ?? null) : null),
		save: vi.fn(async (r: PayrollRun) => ({ ...r, version: 0 })),
	};
	return new PayrollService(
		{ list: async () => PEOPLE } as never,
		{ get: async () => attendance(month) } as never,
		runs as never,
		{} as never,
		{} as never,
		{ append: async () => undefined } as never,
		{ forMonth: async () => rules } as never,
		{ list: async () => [{ id: 'loc_kolkata', stateCode: '19' }] } as never,
		{ issue: async () => 'PS/26-27/000001' } as never,
	);
}

describe('a revision dated back, in the run (SR2, SR4)', () => {
	it('pays September and October’s difference with November, once, PF on it, the heads at the new salary', async () => {
		const run = await payroll('2026-11', [
			paidRun('2026-08'),
			paidRun('2026-09'),
			paidRun('2026-10'),
			// A draft is not paid yet: nothing owed for it.
			paidRun('2026-07', 'draft'),
		]).prepare('2026-11', now);
		const priya = run.rows.find((r) => r.employeeId === 'emp_priya') as PayrollRow;
		expect(priya).toMatchObject({
			grossPaise: 1_760_000 + 320_000,
			arrearsPaise: 320_000,
			arrearsFor: [
				{ month: '2026-09', paise: 160_000 },
				{ month: '2026-10', paise: 160_000 },
			],
			arrearsPfWagesPaise: 200_000,
			pfWagesPaise: 1_100_000 + 200_000,
		});
		expect(Object.values(priya.headsPaise ?? {}).reduce((a, b) => a + b, 0)).toBe(1_760_000);
		const plain = run.rows.find((r) => r.employeeId === 'emp_plain') as PayrollRow;
		expect([plain.grossPaise, plain.arrearsPaise]).toEqual([1_600_000, undefined]);
	});

	it('owes nothing more in December once November paid them, and pays August on the salary then', async () => {
		const run = await payroll('2026-12', [
			paidRun('2026-09'),
			paidRun('2026-10'),
			paidRun('2026-11', 'paid', {
				grossPaise: 2_080_000,
				pfWagesPaise: 1_300_000,
				arrearsPaise: 320_000,
				arrearsPfWagesPaise: 200_000,
				arrearsFor: [
					{ month: '2026-09', paise: 160_000 },
					{ month: '2026-10', paise: 160_000 },
				],
			}),
		]).prepare('2026-12', now);
		expect(run.rows.find((r) => r.employeeId === 'emp_priya')).toMatchObject({ grossPaise: 1_760_000 });
		expect(run.rows.find((r) => r.employeeId === 'emp_priya')?.arrearsPaise).toBeUndefined();
		const august = await payroll('2026-08', []).prepare('2026-08', now);
		expect(august.rows.find((r) => r.employeeId === 'emp_priya')?.grossPaise).toBe(1_600_000);
	});
});

describe('PF wages on arrears by the heads PF follows (SR4, BN-D3)', () => {
	it('takes the Codes’ heads, or the version’s own list, once PF is switched to them', async () => {
		const earlier = [paidRun('2026-09'), paidRun('2026-10')];
		const codes = rulesOf({ ...BUILT_IN_PAYROLL_RULES, pfUsesCodeWages: true });
		const own = rulesOf({ ...BUILT_IN_PAYROLL_RULES, pfUsesCodeWages: true, wageHeads: ['basic'] });
		const pfOn = async (rules: typeof RULES) =>
			(await payroll('2026-11', earlier, rules).prepare('2026-11', now)).rows.find(
				(r) => r.employeeId === 'emp_priya',
			)?.arrearsPfWagesPaise;
		expect(await pfOn(codes)).toBe(320_000);
		expect(await pfOn(own)).toBe(200_000);
	});
});

describe('arrears on the payslip (SR4)', () => {
	it('prints one line with the months they are for, and none when there are none', () => {
		const row = {
			employeeId: 'emp_priya',
			grossPaise: 2_080_000,
			arrearsPaise: 320_000,
			arrearsFor: [
				{ month: '2026-09', paise: 160_000 },
				{ month: '2026-10', paise: 160_000 },
			],
		} as unknown as PayrollRow;
		const text = JSON.stringify(payslipData({ month: '2026-11', row, earlier: [], employee: PEOPLE[0] } as never));
		expect(text).toContain('Arrears (Sep 2026, Oct 2026)');
		expect(text).not.toContain('section 89');
		// Arrears for March 2026 paid in a 2026-27 month: the earlier year is named, with the relief.
		const march = JSON.stringify(
			payslipData({
				month: '2026-11',
				row: {
					...row,
					arrearsFor: [
						{ month: '2026-03', paise: 100_000 },
						{ month: '2026-04', paise: 100_000 },
					],
				},
				earlier: [],
				employee: PEOPLE[0],
			} as never),
		);
		expect(march).toContain(
			'Arrears (Mar 2026, Apr 2026) · of FY 2025-26: taxed this year; relief under section 89 (Form 10E) may be claimed',
		);
		const none = JSON.stringify(
			payslipData({
				row: { ...row, arrearsPaise: undefined, arrearsFor: undefined },
				earlier: [],
				employee: PEOPLE[0],
			} as never),
		);
		expect(none).toContain('"head":"Arrears"');
	});
});
