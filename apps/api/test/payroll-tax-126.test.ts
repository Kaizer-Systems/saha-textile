import type { Employee, TaxDeclaration } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { BUILT_IN_INCOME_TAX } from '../src/payroll/payroll-rules.service';
import { taxWorkingFor, yearToDate } from '../src/payroll/payroll.service';

/**
 * Brief 26 TX3–TX5 in the API's working: section 126's two groups read from the declaration (the family senior by the
 * employee's age or the spouse's tick, parents' proof apart), and the rent city against the version's list, a
 * declaration saved before keeping its yes/no.
 */
const lakh = (n: number) => n * 100_000_00;
const rupees = (n: number) => n * 100;
/** ₹1 lakh a month: ₹50,000 basic and DA, ₹40,000 rent allowance. */
const MONTH = { grossPaise: lakh(1), pfPaise: 0, ptPaise: 0, hraPaise: rupees(40_000), basicDaPaise: rupees(50_000) };
const declaration = (over: Partial<TaxDeclaration> = {}): TaxDeclaration => ({
	year: '2026-27',
	regime: 'old',
	chosenOn: '2026-04-02',
	rentMonthlyINR: 25_000,
	metroCity: false,
	s80cINR: 0,
	s80dINR: 0,
	homeLoanInterestINR: 0,
	previousSalaryINR: 0,
	previousTdsINR: 0,
	proof: { rent: true, s80c: false, s80d: false, homeLoan: false },
	...over,
});
const working = (d: TaxDeclaration, over: Partial<Employee> = {}, month = '2026-11') =>
	taxWorkingFor({
		employee: { taxRegime: 'old', dateOfBirth: null, leftOn: null, taxDeclarations: [d], ...over } as Employee,
		month,
		ytd: yearToDate([], 'emp_x'),
		thisMonth: MONTH,
		fullMonth: MONTH,
		rules: BUILT_IN_INCOME_TAX,
		regime: null,
	}).working;

describe('section 126 from the declaration (TX3)', () => {
	it('deducts both groups, the parents’ at the senior limit with their medical bills', () => {
		const d = declaration({
			s80dINR: 18_000,
			s126SelfCheckupINR: 2_000,
			s126ParentsINR: 30_000,
			s126ParentsCheckupINR: 3_000,
			s126ParentsSenior: true,
			s126SeniorMedicalINR: 20_000,
		});
		// Family 20,000 of 25,000; parents 30,000 + 3,000 (the check-ups' ₹5,000 left after 2,000) + 20,000, held to 50,000.
		expect(working(d).deductionsPaise).toBe(rupees(20_000 + 50_000));
	});

	it('gives the family the senior limit for a senior employee or spouse', () => {
		const d = declaration({ s80dINR: 40_000 });
		expect(working(d).deductionsPaise).toBe(rupees(25_000));
		expect(working(declaration({ s80dINR: 40_000, s126SpouseSenior: true })).deductionsPaise).toBe(rupees(40_000));
		expect(working(d, { dateOfBirth: '1960-05-01' }).deductionsPaise).toBe(rupees(40_000));
	});

	it('counts the parents’ group from the proof month only with its own proof', () => {
		const d = declaration({ s126ParentsINR: 20_000 });
		expect(working(d, {}, '2027-01').deductionsPaise).toBe(0);
		const proven = declaration({ s126ParentsINR: 20_000, proof: { ...d.proof, s126Parents: true } });
		expect(working(proven, {}, '2027-01').deductionsPaise).toBe(rupees(20_000));
	});
});

describe('the rent city (TX5)', () => {
	// November and the four months left: basic and DA 2,50,000, the allowance 2,00,000, rent 4,80,000 less 25,000;
	// so the city's share of basic and DA decides: 50% = 1,25,000, 40% = 1,00,000.
	const hra = (over: Partial<TaxDeclaration>) =>
		working(declaration({ rentMonthlyINR: 40_000, ...over })).hraExemptPaise;

	it('counts a city on the list at 50%, and another or none at 40%', () => {
		expect(hra({ rentCity: 'Pune' })).toBe(rupees(1_25_000));
		expect(hra({ rentCity: 'Barasat' })).toBe(rupees(1_00_000));
		expect(hra({ rentCity: '' })).toBe(rupees(1_00_000));
	});

	it('reads a declaration saved before by its yes/no', () => {
		expect(hra({ metroCity: true })).toBe(rupees(1_25_000));
		expect(hra({ metroCity: false })).toBe(rupees(1_00_000));
	});
});
