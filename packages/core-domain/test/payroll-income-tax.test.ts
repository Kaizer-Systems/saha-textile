import { describe, expect, it } from 'vitest';

import {
	INCOME_TAX_2026,
	ageBand,
	financialYearOf,
	hraExempt,
	monthsAfter,
	proofDue,
	taxForYear,
	type TaxYearInput,
} from '../src/payroll/income-tax';

/** Income tax on salary, both regimes (brief 25 TX1, TX2). */

const rupees = (n: number) => n * 100;
const input = (over: Partial<TaxYearInput>): TaxYearInput => ({
	regime: 'new',
	ageBand: 'below_60',
	salaryPaise: 0,
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

describe('the brief’s TX1 example: ₹1,10,000 a month, rent ₹25,000 outside a metro', () => {
	const year = {
		salaryPaise: rupees(13_20_000),
		hraPaise: rupees(3_00_000),
		basicDaPaise: rupees(5_28_000),
		rentPaise: rupees(3_00_000),
		s80cPaise: rupees(1_50_000),
		s80dPaise: rupees(25_000),
		homeLoanInterestPaise: rupees(2_00_000),
	};

	it('old regime: ₹6,83,800 taxable, ₹49,260 by the slabs, ₹51,230 with cess', () => {
		expect(taxForYear(input({ ...year, regime: 'old' }), INCOME_TAX_2026)).toMatchObject({
			hraExemptPaise: rupees(2_11_200),
			standardDeductionPaise: rupees(50_000),
			deductionsPaise: rupees(3_75_000),
			taxablePaise: rupees(6_83_800),
			slabTaxPaise: rupees(49_260),
			cessPaise: rupees(1_970),
			taxPaise: rupees(51_230),
		});
	});

	it('new regime: ₹12,45,000 taxable, ₹66,750 by the slabs, ₹21,750 of 87A relief, ₹46,800 with cess', () => {
		expect(taxForYear(input(year), INCOME_TAX_2026)).toMatchObject({
			hraExemptPaise: 0,
			deductionsPaise: 0,
			taxablePaise: rupees(12_45_000),
			slabTaxPaise: rupees(66_750),
			rebatePaise: rupees(21_750),
			taxPaise: rupees(46_800),
		});
	});
});

describe('the rebate, age bands and surcharge', () => {
	it('charges nothing up to ₹12 lakh taxable, and ₹10,400 at ₹12.1 lakh (marginal relief)', () => {
		expect(taxForYear(input({ salaryPaise: rupees(12_75_000) }), INCOME_TAX_2026).taxPaise).toBe(0);
		expect(taxForYear(input({ salaryPaise: rupees(12_85_000) }), INCOME_TAX_2026).taxPaise).toBe(rupees(10_400));
	});

	it('takes the old regime’s ₹12,500 rebate only up to ₹5 lakh taxable, and taxes the elderly later', () => {
		const at = (salary: number, band: TaxYearInput['ageBand']) =>
			taxForYear(input({ regime: 'old', ageBand: band, salaryPaise: rupees(salary) }), INCOME_TAX_2026).taxPaise;
		expect(at(5_50_000, 'below_60')).toBe(0);
		// No marginal relief in the old regime: a rupee over ₹5 lakh taxable loses the whole rebate.
		expect(at(5_50_001, 'below_60')).toBe(rupees(13_000));
		expect(at(8_00_000, '60_to_79')).toBe(rupees(62_400));
		expect(at(8_00_000, '80_plus')).toBe(rupees(52_000));
	});

	it('adds surcharge with marginal relief just over ₹50 lakh', () => {
		// ₹51 lakh taxable: ₹11,10,000 by the slabs; surcharge held to ₹70,000 so the tax rises no more than the income.
		const working = taxForYear(input({ salaryPaise: rupees(51_75_000) }), INCOME_TAX_2026);
		expect(working).toMatchObject({ surchargePaise: rupees(70_000), taxPaise: rupees(12_27_200) });
		const high = taxForYear(input({ salaryPaise: rupees(1_10_75_000) }), INCOME_TAX_2026);
		expect(high.surchargePaise).toBeGreaterThan(rupees(4_00_000));
	});

	it('reads the age band on the year’s last day', () => {
		expect(ageBand(null, '2026-27')).toBe('below_60');
		expect(ageBand('1967-03-31', '2026-27')).toBe('60_to_79');
		expect(ageBand('1967-04-01', '2026-27')).toBe('below_60');
		expect(ageBand('1945-01-01', '2026-27')).toBe('80_plus');
	});
});

describe('the pieces of the year', () => {
	it('exempts the least of HRA, rent over 10% of pay, and half (metro) or 40% of pay', () => {
		expect(hraExempt({ hraPaise: 100, basicDaPaise: 1000, rentPaise: 600, metro: true })).toBe(100);
		expect(hraExempt({ hraPaise: 900, basicDaPaise: 1000, rentPaise: 300, metro: true })).toBe(200);
		expect(hraExempt({ hraPaise: 900, basicDaPaise: 1000, rentPaise: 900, metro: false })).toBe(400);
		expect(hraExempt({ hraPaise: 900, basicDaPaise: 1000, rentPaise: 50, metro: false })).toBe(0);
	});

	it('counts the months left, and stops at a leaving month', () => {
		expect(monthsAfter('2026-11')).toBe(4);
		expect(monthsAfter('2027-02')).toBe(1);
		expect(monthsAfter('2026-04')).toBe(11);
		expect(monthsAfter('2026-11', '2027-01-15')).toBe(2);
		expect(monthsAfter('2026-11', '2026-11-10')).toBe(0);
		expect(monthsAfter('2026-11', '2028-01-01')).toBe(4);
	});

	it('names the year and the proof period', () => {
		expect(financialYearOf('2027-01')).toBe('2026-27');
		expect(financialYearOf('2026-04')).toBe('2026-27');
		expect(proofDue('2026-12', 1)).toBe(false);
		expect(proofDue('2027-01', 1)).toBe(true);
		expect(proofDue('2027-03', 1)).toBe(true);
		expect(proofDue('2026-12', 12)).toBe(true);
	});
});
