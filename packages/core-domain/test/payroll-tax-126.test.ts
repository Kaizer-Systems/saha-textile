import { describe, expect, it } from 'vitest';

import {
	HEALTH_126_2026,
	INCOME_TAX_2026,
	RENT_CITIES_2026,
	healthByGroup,
	healthDeduction,
	rentCityCounts,
	taxForYear,
	type HealthCover,
	type TaxYearInput,
} from '../src/payroll/income-tax';

/** Brief 26 TX3–TX5: section 126's two groups, rounding to ₹10 or the rupee, and the rent cities. */
const rupees = (n: number) => n * 100;
const cover = (over: Partial<HealthCover> = {}): HealthCover => ({
	selfPaise: 0,
	selfCheckupPaise: 0,
	selfSenior: false,
	parentsPaise: 0,
	parentsCheckupPaise: 0,
	parentsSenior: false,
	seniorMedicalPaise: 0,
	...over,
});

describe('section 126 (was 80D)', () => {
	it('holds each group to its limit, the higher one with a senior in it', () => {
		expect(healthDeduction(cover({ selfPaise: rupees(30_000) }), INCOME_TAX_2026)).toBe(rupees(25_000));
		expect(healthDeduction(cover({ selfPaise: rupees(30_000), selfSenior: true }), INCOME_TAX_2026)).toBe(
			rupees(30_000),
		);
		// TX3's example: ₹18,000 + ₹2,000 check-up for the family; ₹42,000 + ₹3,000 for senior parents.
		expect(
			healthDeduction(
				cover({
					selfPaise: rupees(18_000),
					selfCheckupPaise: rupees(2_000),
					parentsPaise: rupees(42_000),
					parentsCheckupPaise: rupees(3_000),
					parentsSenior: true,
				}),
				INCOME_TAX_2026,
			),
		).toBe(rupees(20_000 + 45_000));
	});

	it('holds check-ups to ₹5,000 across both groups, the family’s first', () => {
		const both = cover({ selfCheckupPaise: rupees(4_000), parentsCheckupPaise: rupees(4_000) });
		expect(healthDeduction(both, INCOME_TAX_2026)).toBe(rupees(5_000));
		expect(healthDeduction(cover({ selfCheckupPaise: rupees(7_000) }), INCOME_TAX_2026)).toBe(rupees(5_000));
	});

	it('counts an uninsured senior parent’s medical bills, and none for parents under 60', () => {
		const bills = cover({ seniorMedicalPaise: rupees(40_000) });
		expect(healthDeduction({ ...bills, parentsSenior: true }, INCOME_TAX_2026)).toBe(rupees(40_000));
		expect(healthDeduction(bills, INCOME_TAX_2026)).toBe(0);
	});

	it('uses the built-in limits for a version saved before them', () => {
		expect(
			healthDeduction(cover({ parentsPaise: rupees(60_000), parentsSenior: true }), { health126: undefined }),
		).toBe(HEALTH_126_2026.parentsSeniorPaise);
	});
});

const input = (over: Partial<TaxYearInput> = {}): TaxYearInput => ({
	regime: 'old',
	ageBand: 'below_60',
	salaryPaise: rupees(8_00_000),
	hraPaise: 0,
	basicDaPaise: 0,
	pfPaise: 0,
	professionalTaxPaise: 0,
	rentPaise: 0,
	metro: false,
	s80cPaise: 0,
	s80dPaise: 0,
	homeLoanInterestPaise: 0,
	...over,
});

describe('the year’s tax with section 126 and the rounding chosen', () => {
	it('deducts the groups when declared that way, and the old single 80D figure otherwise', () => {
		const groups = taxForYear(
			input({ health: cover({ selfPaise: rupees(18_000), parentsPaise: rupees(42_000), parentsSenior: true }) }),
			INCOME_TAX_2026,
		);
		expect(groups.deductionsPaise).toBe(rupees(60_000));
		expect(taxForYear(input({ s80dPaise: rupees(40_000) }), INCOME_TAX_2026).deductionsPaise).toBe(rupees(25_000));
	});

	it('rounds taxable income and tax to ₹10 by default, or to the rupee when the version says so', () => {
		const salary = input({ salaryPaise: rupees(8_00_004) + 60 });
		const ten = taxForYear(salary, INCOME_TAX_2026);
		expect(ten.taxablePaise).toBe(rupees(7_50_000));
		expect(ten.taxPaise % 1_000).toBe(0);
		const rupee = taxForYear(salary, { ...INCOME_TAX_2026, rounding: 'rupee' });
		expect(rupee.taxablePaise).toBe(rupees(7_50_005));
		expect(rupee.taxPaise % 100).toBe(0);
	});
});

describe('rent cities (TX5)', () => {
	it('counts a city on the version’s list at 50%, whatever its case or spaces', () => {
		expect(rentCityCounts(' bengaluru ', INCOME_TAX_2026)).toBe(true);
		expect(rentCityCounts('Barasat', INCOME_TAX_2026)).toBe(false);
		expect(rentCityCounts('', INCOME_TAX_2026)).toBe(false);
		expect(rentCityCounts('Noida', { rentCities: ['Noida'] })).toBe(true);
	});

	it('uses the eight cities of the 2026 Rules for a version without its own list', () => {
		expect(RENT_CITIES_2026).toHaveLength(8);
		expect(rentCityCounts('Pune', {})).toBe(true);
	});
});

describe('section 126 by group (TX3)', () => {
	it('shows each group against its limit, the senior one when someone in it is 60 or over', () => {
		expect(
			healthByGroup(
				cover({ selfPaise: rupees(18_000), parentsPaise: rupees(60_000), parentsSenior: true }),
				INCOME_TAX_2026,
			),
		).toEqual({
			selfPaise: rupees(18_000),
			selfLimitPaise: rupees(25_000),
			parentsPaise: rupees(50_000),
			parentsLimitPaise: rupees(50_000),
		});
	});
});
