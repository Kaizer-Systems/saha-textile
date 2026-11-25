import { Reflector } from '@nestjs/core';
import type { Employee, PayrollRow, PayrollRulesVersion, PayrollRun, TaxDeclaration } from '@saha-textile/contracts';
import { statePt, stateRulesOf, type StateRules } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { PayrollController } from '../src/payroll/payroll.controller';
import {
	BUILT_IN_INCOME_TAX,
	BUILT_IN_PAYROLL_RULES,
	PayrollRulesService,
	rulesOf,
} from '../src/payroll/payroll-rules.service';
import { PayrollService, taxWorkingFor, yearToDate } from '../src/payroll/payroll.service';

/**
 * Income tax on salary under both regimes (brief 25 TX1, TX2): the year so far from earlier runs, an employee's year
 * worked both ways for a month, declarations that count until the proof month and then only with proof, and the
 * built-in rules standing in for a version saved before income tax was part of them.
 */

const lakh = (n: number) => n * 100_000_00;
const refusal = (code: string) => ({ response: { message: code } });

const row = (employeeId: string, over: Partial<PayrollRow> = {}): PayrollRow => ({
	employeeId,
	name: employeeId,
	locationId: 'loc_bar',
	paidDays: 30,
	grossPaise: 0,
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
const run = (month: string, rows: PayrollRow[]) =>
	({
		id: `pay_${month}`,
		month,
		status: 'paid',
		rows,
		rulesFrom: '2026-04-01',
		voucherId: null,
		payVoucherId: null,
		approvedBy: null,
		approvedAt: null,
		createdAt: '2026-12-01T06:00:00.000Z',
		updatedAt: '2026-12-01T06:00:00.000Z',
		version: 1,
	}) as PayrollRun;

describe('the year so far (TX1)', () => {
	it('adds up one person’s earlier rows, heads a row didn’t keep counting as nothing', () => {
		const runs = [
			run('2026-05', [
				row('emp_meera', {
					grossPaise: 100_000,
					tdsPaise: 5_000,
					pfEmployeePaise: 1_800,
					ptPaise: 200,
					headsPaise: { basic: 50_000, da: 10_000, hra: 20_000 },
				}),
				row('emp_rahul', { grossPaise: 999_999, tdsPaise: 999 }),
			]),
			// Saved before the heads were kept; and one kept without DA or HRA.
			run('2026-06', [
				row('emp_meera', { grossPaise: 100_000, tdsPaise: 5_000 }),
				row('emp_meera', { grossPaise: 1, headsPaise: { basic: 7 } }),
			]),
		];
		expect(yearToDate(runs, 'emp_meera')).toEqual({
			grossPaise: 200_001,
			tdsPaise: 10_000,
			pfPaise: 1_800,
			ptPaise: 200,
			hraPaise: 20_000,
			basicDaPaise: 60_007,
		});
		expect(yearToDate(runs, 'emp_nobody')).toEqual({
			grossPaise: 0,
			tdsPaise: 0,
			pfPaise: 0,
			ptPaise: 0,
			hraPaise: 0,
			basicDaPaise: 0,
		});
	});
});

const declaration = (over: Partial<TaxDeclaration> = {}): TaxDeclaration => ({
	year: '2026-27',
	regime: 'old',
	chosenOn: null,
	rentMonthlyINR: 20_000,
	metroCity: true,
	s80cINR: 150_000,
	s80dINR: 25_000,
	homeLoanInterestINR: 200_000,
	previousSalaryINR: 0,
	previousTdsINR: 0,
	proof: { rent: false, s80c: false, s80d: false, homeLoan: false },
	...over,
});
/** ₹1 lakh a month: ₹50,000 basic, ₹20,000 HRA, ₹30,000 special; nothing paid in these books yet. */
const MONTH = { grossPaise: lakh(1), pfPaise: 0, ptPaise: 20_000, hraPaise: 20_000_00, basicDaPaise: 50_000_00 };
const NOTHING_YET = yearToDate([], 'emp_meera');
const person = (taxDeclarations: TaxDeclaration[], over: Partial<Employee> = {}) =>
	({ taxRegime: 'new', dateOfBirth: null, leftOn: null, taxDeclarations, ...over }) as Employee;
const working = (employee: Employee, month: string, regime: 'new' | 'old' | null = null) =>
	taxWorkingFor({
		employee,
		month,
		ytd: NOTHING_YET,
		thisMonth: MONTH,
		fullMonth: MONTH,
		rules: BUILT_IN_INCOME_TAX,
		regime,
	});

describe('declarations and the proof month (TX1)', () => {
	it('count as declared before the proof month, and from it only those with proof', () => {
		const declared = person([declaration()]);
		const november = working(declared, '2026-11');
		expect(november.declarationsCount).toBe(true);
		// From January: rent and 80D are proven, 80C and the home loan aren't.
		const partlyProven = person([declaration({ proof: { rent: true, s80c: false, s80d: true, homeLoan: false } })]);
		const january = working(partlyProven, '2027-01');
		expect(january.declarationsCount).toBe(false);
		const onlyProven = person([declaration({ s80cINR: 0, homeLoanInterestINR: 0 })]);
		const asIfOnlyProven = taxWorkingFor({
			employee: onlyProven,
			month: '2027-01',
			ytd: NOTHING_YET,
			thisMonth: MONTH,
			fullMonth: MONTH,
			// Without a proof month in the year, everything declared counts.
			rules: { ...BUILT_IN_INCOME_TAX, proofFromMonth: 3 },
			regime: null,
		});
		expect(january.working.deductionsPaise).toBe(asIfOnlyProven.working.deductionsPaise);
		expect(january.working.hraExemptPaise).toBe(asIfOnlyProven.working.hraExemptPaise);
		expect(january.working.hraExemptPaise).toBeGreaterThan(0);
		// Nothing proven: no rent exemption and no declared deductions.
		const unproven = working(declared, '2027-01');
		expect(unproven.working.hraExemptPaise).toBe(0);
		expect(unproven.working.deductionsPaise).toBeLessThan(january.working.deductionsPaise);
	});

	it('takes the regime asked for, else the year’s declaration, else the person’s; and the leaving month', () => {
		const declared = person([declaration()], { taxRegime: 'new', leftOn: '2027-01-15' });
		expect(working(declared, '2026-11').regime).toBe('old');
		expect(working(declared, '2026-11', 'new').regime).toBe('new');
		// No declaration for this year: the person's regime.
		expect(working(person([declaration({ year: '2025-26' })], { taxRegime: 'old' }), '2026-11').regime).toBe('old');
		// November, December and January: leaving in January.
		expect(working(declared, '2026-11').monthsLeft).toBe(3);
	});
});

/** Meera at the bar (West Bengal's set); Rahul in Pune, a State with no set; Asha's shop is gone, saved State 19. */
const employee = (id: string, locationId: string, over: Partial<Employee> = {}): Employee => ({
	id,
	name: id,
	code: '',
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
	dateOfBirth: '1960-06-01',
	taxDeclarations: [],
	bankAccount: '',
	ifsc: '',
	pfOn: false,
	esiOn: false,
	structure: { basic: 150_000, da: 0, hra: 0, special: 50_000, conveyance: 0, other: 0 },
	advanceDueINR: 0,
	advancePerMonthINR: 0,
	createdAt: '2026-04-01T00:00:00.000Z',
	updatedAt: '2026-04-01T00:00:00.000Z',
	version: 0,
	...over,
});
const PEOPLE = [
	employee('emp_meera', 'loc_bar', { taxDeclarations: [declaration({ previousTdsINR: 10_000 })] }),
	employee('emp_rahul', 'loc_pune'),
	employee('emp_asha', 'loc_gone'),
];
const PT_WB = statePt('2026-11', lakh(2), stateRulesOf(BUILT_IN_PAYROLL_RULES)[0] as StateRules);
/** ₹4 lakh in May at West Bengal's tax; last year's March, December and the month itself are not "so far". */
const RUNS = [
	run('2026-03', [row('emp_meera', { grossPaise: lakh(9), tdsPaise: 99_00 })]),
	run('2026-05', [row('emp_meera', { grossPaise: lakh(4), tdsPaise: 5_000_00, ptPaise: PT_WB })]),
	run('2026-11', [row('emp_meera', { grossPaise: lakh(7), tdsPaise: 7_00 })]),
	run('2026-12', [row('emp_meera', { grossPaise: lakh(8), tdsPaise: 8_00 })]),
];

function payroll() {
	const people = new Map(PEOPLE.map((p) => [p.id, p]));
	return new PayrollService(
		{ list: async () => PEOPLE, get: async (id: string) => people.get(id) ?? null } as never,
		{} as never,
		{ list: async () => RUNS } as never,
		{} as never,
		{} as never,
		{ append: async () => undefined } as never,
		{ forMonth: async () => rulesOf(BUILT_IN_PAYROLL_RULES) } as never,
		{
			list: async () => [
				{ id: 'loc_bar', stateCode: '19' },
				{ id: 'loc_pune', stateCode: '27' },
			],
		} as never,
	);
}

describe('an employee’s year worked both ways (TX1)', () => {
	it('works the year from the earlier runs of the year, this month and a full month for each month left', async () => {
		const view = await payroll().incomeTax('emp_meera', '2026-11');
		expect(view).toMatchObject({
			year: '2026-27',
			// Her declaration chooses the old regime; born 1960, she is 66 at the year's end.
			regime: 'old',
			ageBand: '60_to_79',
			declarationsCount: true,
			// May's TDS and ₹10,000 from an earlier employer.
			deductedPaise: 5_000_00 + 10_000_00,
			monthsLeft: 5,
		});
		// ₹4 lakh so far, November and four more months of ₹2 lakh.
		expect([view.old.regime, view.new.regime]).toEqual(['old', 'new']);
		expect(view.new.salaryPaise).toBe(lakh(14));
		// New: ₹13,25,000 taxable → ₹78,750 + 4% cess.
		expect(view.new).toMatchObject({ taxablePaise: 13_25_000_00, taxPaise: 81_900_00 });
		expect(view.new.monthlyPaise).toBe(Math.round((81_900_00 - 15_000_00) / 5 / 100) * 100);
		// The old regime takes off professional tax: May's and five months of West Bengal's.
		expect(view.old.professionalTaxPaise).toBe(6 * PT_WB);
		expect(PT_WB).toBeGreaterThan(0);
	});

	it('takes no professional tax in a State without a set, and the saved State where the location is gone', async () => {
		const service = payroll();
		const rahul = await service.incomeTax('emp_rahul', '2026-11');
		expect(rahul).toMatchObject({ regime: 'new', deductedPaise: 0, declarationsCount: true });
		expect(rahul.old.professionalTaxPaise).toBe(0);
		const asha = await service.incomeTax('emp_asha', '2026-11');
		expect(asha.old.professionalTaxPaise).toBe(5 * PT_WB);
	});

	it('counts only proven declarations from the proof month', async () => {
		const january = await payroll().incomeTax('emp_meera', '2027-01');
		const november = await payroll().incomeTax('emp_meera', '2026-11');
		expect(january.declarationsCount).toBe(false);
		expect(january.old.deductionsPaise).toBeLessThan(november.old.deductionsPaise);
	});

	it('refuses someone not on the register', async () => {
		await expect(payroll().incomeTax('emp_gone', '2026-11')).rejects.toMatchObject(refusal('employee_not_found'));
	});

	it('is read at GET employees/:id/income-tax/:month by anyone who may see the accounts', async () => {
		const payrollService = { incomeTax: vi.fn(async () => 'view') };
		const controller = new PayrollController(payrollService as never);
		expect(await controller.incomeTax('emp_meera', '2026-11')).toBe('view');
		expect(payrollService.incomeTax).toHaveBeenCalledWith('emp_meera', '2026-11');
		expect(new Reflector().get(PERMISSIONS_KEY, PayrollController.prototype.incomeTax)).toEqual(['accounts.index']);
		expect(Reflect.getMetadata('path', PayrollController.prototype.incomeTax)).toBe(
			'employees/:id/income-tax/:month',
		);
	});
});

describe('income tax as part of the payroll rules (TX2)', () => {
	const { incomeTax: _builtIn, ...withoutIncomeTax } = BUILT_IN_PAYROLL_RULES;
	const older = { ...withoutIncomeTax, id: 'prs_2026_10', builtIn: false, from: '2026-10-01' } as PayrollRulesVersion;
	const own = {
		...BUILT_IN_PAYROLL_RULES,
		id: 'prs_2027',
		builtIn: false,
		from: '2027-04-01',
		incomeTax: { ...BUILT_IN_INCOME_TAX, cessPct: 5 },
	} as PayrollRulesVersion;

	it('uses the built-in rules for a version saved before income tax was part of them', () => {
		expect(rulesOf(older).incomeTax).toBe(BUILT_IN_INCOME_TAX);
		expect(rulesOf(own).incomeTax.cessPct).toBe(5);
	});

	it('lists every version with its income tax, the built-in rules filled into older ones', async () => {
		const service = new PayrollRulesService(
			{ list: async () => [own, older] } as never,
			{ list: async () => [] } as never,
			{ append: async () => undefined } as never,
		);
		const versions = await service.list();
		expect(versions.map((v) => [v.id, v.incomeTax?.cessPct])).toEqual([
			['prs_built_in', BUILT_IN_INCOME_TAX.cessPct],
			['prs_2026_10', BUILT_IN_INCOME_TAX.cessPct],
			['prs_2027', 5],
		]);
		expect(versions[1]?.incomeTax).toBe(BUILT_IN_INCOME_TAX);
	});
});
