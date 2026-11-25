import { describe, expect, it } from 'vitest';

import {
	INCOME_TAX_2026,
	ageBand,
	financialYearOf,
	hraExempt,
	monthsAfter,
	proofDue,
	slabTax,
	surchargeOf,
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
		// An age is reached the day before the birthday: born on 1 April 1967, 60 on 31 March 2027.
		expect(ageBand('1967-04-01', '2026-27')).toBe('60_to_79');
		expect(ageBand('1967-04-02', '2026-27')).toBe('below_60');
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

describe('the slabs and surcharge on their own', () => {
	const newTax = (taxable: number) => slabTax(rupees(taxable), INCOME_TAX_2026.newSlabs);

	it('taxes each new-regime slab at its rate, nothing up to ₹4 lakh', () => {
		expect([newTax(4_00_000), newTax(8_00_000), newTax(12_00_000), newTax(16_00_000)]).toEqual([
			0,
			rupees(20_000),
			rupees(60_000),
			rupees(1_20_000),
		]);
		expect([newTax(20_00_000), newTax(24_00_000), newTax(25_00_000)]).toEqual([
			rupees(2_00_000),
			rupees(3_00_000),
			rupees(3_30_000),
		]);
		expect(slabTax(rupees(9_00_000), INCOME_TAX_2026.oldSlabsBelow60)).toBe(rupees(92_500));
		expect(slabTax(0, INCOME_TAX_2026.oldSlabsBelow60)).toBe(0);
	});

	const tiers = INCOME_TAX_2026.newSurcharge;
	const taxAt = (taxable: number) => slabTax(taxable, INCOME_TAX_2026.newSlabs);
	const surcharge = (taxable: number) => surchargeOf(rupees(taxable), taxAt(rupees(taxable)), tiers, taxAt);

	it('adds no surcharge up to ₹50 lakh', () => {
		expect(surcharge(50_00_000)).toBe(0);
		expect(surchargeOf(rupees(10_00_000), rupees(1), [], taxAt)).toBe(0);
	});

	it('holds the surcharge just over a tier to what the income above it adds, the tier below’s rate counted', () => {
		// ₹1,01,00,000: 15% would be ₹3,91,500; at ₹1 crore the tax with 10% is ₹28,38,000, so ₹29,38,000 at most.
		expect(surcharge(1_01_00_000)).toBe(rupees(3_28_000));
		// ₹1,10,00,000: well past the relief, the full 15%.
		expect(surcharge(1_10_00_000)).toBe(rupees(4_32_000));
		// ₹2,10,00,000: 25% of ₹58,80,000, the new regime's top rate, under the ₹74,17,000 the relief would allow.
		expect(surcharge(2_10_00_000)).toBe(rupees(14_70_000));
	});

	it('never takes a surcharge below nothing', () => {
		expect(surchargeOf(rupees(50_00_100), rupees(50_00_000), tiers, () => 0)).toBe(0);
	});
});

describe('a year’s working at its edges', () => {
	const old = (over: Partial<TaxYearInput>) => taxForYear(input({ regime: 'old', ...over }), INCOME_TAX_2026);

	it('takes ₹62,500 by the old slabs on ₹7.5 lakh below 60, less for the elderly', () => {
		expect(old({ salaryPaise: rupees(8_00_000) })).toMatchObject({
			taxablePaise: rupees(7_50_000),
			slabTaxPaise: rupees(62_500),
			rebatePaise: 0,
			taxPaise: rupees(65_000),
		});
		expect(old({ salaryPaise: rupees(8_00_000), ageBand: '60_to_79' }).slabTaxPaise).toBe(rupees(60_000));
		expect(old({ salaryPaise: rupees(8_00_000), ageBand: '80_plus' }).slabTaxPaise).toBe(rupees(50_000));
	});

	it('caps the standard deduction at the salary, under both regimes', () => {
		expect(taxForYear(input({ salaryPaise: rupees(30_000) }), INCOME_TAX_2026)).toMatchObject({
			standardDeductionPaise: rupees(30_000),
			taxablePaise: 0,
			taxPaise: 0,
		});
		expect(old({ salaryPaise: rupees(40_000) }).standardDeductionPaise).toBe(rupees(40_000));
	});

	it('counts own PF in 80C with the rest to ₹1.5 lakh, 80D to ₹25,000 and home loan interest to ₹2 lakh', () => {
		const working = old({
			salaryPaise: rupees(20_00_000),
			pfPaise: rupees(1_00_000),
			s80cPaise: rupees(1_00_000),
			s80dPaise: rupees(40_000),
			homeLoanInterestPaise: rupees(3_00_000),
			professionalTaxPaise: rupees(2_500),
		});
		expect(working).toMatchObject({
			deductionsPaise: rupees(3_75_000),
			professionalTaxPaise: rupees(2_500),
			taxablePaise: rupees(20_00_000 - 50_000 - 2_500 - 3_75_000),
		});
		const under = old({ salaryPaise: rupees(20_00_000), pfPaise: rupees(21_600), s80cPaise: rupees(50_000) });
		expect(under.deductionsPaise).toBe(rupees(71_600));
	});

	it('gives no deductions, professional tax or rent allowance under the new regime', () => {
		const working = taxForYear(
			input({
				salaryPaise: rupees(20_00_000),
				hraPaise: rupees(3_00_000),
				basicDaPaise: rupees(8_00_000),
				rentPaise: rupees(3_00_000),
				pfPaise: rupees(96_000),
				s80cPaise: rupees(1_50_000),
				s80dPaise: rupees(25_000),
				homeLoanInterestPaise: rupees(2_00_000),
				professionalTaxPaise: rupees(2_500),
			}),
			INCOME_TAX_2026,
		);
		expect(working).toMatchObject({
			hraExemptPaise: 0,
			deductionsPaise: 0,
			professionalTaxPaise: 0,
			taxablePaise: rupees(19_25_000),
			// ₹1,20,000 to ₹16 lakh and 20% of ₹3,25,000, with 4% cess.
			slabTaxPaise: rupees(1_85_000),
			rebatePaise: 0,
			taxPaise: rupees(1_92_400),
		});
	});

	it('wipes the new regime’s tax at exactly ₹12 lakh taxable and holds it to the income above just past it', () => {
		const at = (taxable: number) => taxForYear(input({ salaryPaise: rupees(taxable + 75_000) }), INCOME_TAX_2026);
		expect(at(12_00_000)).toMatchObject({ slabTaxPaise: rupees(60_000), rebatePaise: rupees(60_000), taxPaise: 0 });
		expect(at(12_00_001)).toMatchObject({ rebatePaise: rupees(59_999), taxPaise: rupees(1) });
		// Past ₹12,70,588 the slab tax is the smaller: no relief left.
		expect(at(13_00_000)).toMatchObject({ slabTaxPaise: rupees(75_000), rebatePaise: 0, taxPaise: rupees(78_000) });
	});

	it('takes the old regime’s 37% over ₹5 crore, held just past the tier', () => {
		// ₹5,01,00,000 taxable: ₹1,48,42,500 by the slabs; at ₹5 crore with 25% the tax is ₹1,85,15,625.
		const working = old({ salaryPaise: rupees(5_01_50_000) });
		expect(working).toMatchObject({
			taxablePaise: rupees(5_01_00_000),
			slabTaxPaise: rupees(1_48_42_500),
			surchargePaise: rupees(37_73_125),
			taxPaise: rupees(1_93_60_250),
		});
	});

	it('rounds the taxable income and the tax to the rupee', () => {
		const working = taxForYear(input({ salaryPaise: rupees(13_00_000) + 49 }), INCOME_TAX_2026);
		expect(working.taxablePaise).toBe(rupees(12_25_000));
		expect(working.taxPaise % 100).toBe(0);
	});
});

describe('ages, years and months at their edges', () => {
	it('turns 60 or 80 on a birthday by 31 March, and stays below on one after', () => {
		expect(ageBand('1966-12-31', '2026-27')).toBe('60_to_79');
		expect(ageBand('1947-03-31', '2026-27')).toBe('80_plus');
		expect(ageBand('1947-04-02', '2026-27')).toBe('60_to_79');
		expect(ageBand('1990-06-15', '2026-27')).toBe('below_60');
	});

	it('names the year for March, April and a century’s turn', () => {
		expect(financialYearOf('2027-03')).toBe('2026-27');
		expect(financialYearOf('2009-05')).toBe('2009-10');
		expect(financialYearOf('2099-12')).toBe('2099-00');
	});

	it('counts no months after March, and none for someone who left before this month', () => {
		expect(monthsAfter('2027-03')).toBe(0);
		expect(monthsAfter('2027-01')).toBe(2);
		expect(monthsAfter('2026-11', '2026-09-30')).toBe(0);
		expect(monthsAfter('2027-01', '2027-03-31')).toBe(2);
		expect(monthsAfter('2026-11', null)).toBe(4);
	});

	it('runs a proof period from a month after April to March, or the whole year from April', () => {
		expect(proofDue('2026-09', 10)).toBe(false);
		expect(proofDue('2026-10', 10)).toBe(true);
		expect(proofDue('2027-02', 10)).toBe(true);
		expect(proofDue('2026-04', 4)).toBe(true);
		expect(proofDue('2027-03', 4)).toBe(true);
	});

	it('exempts the rent allowance by each of the three tests in turn, rent below a tenth of pay nothing', () => {
		const base = { basicDaPaise: rupees(6_00_000), metro: false };
		// Received ₹1 lakh is the least.
		expect(hraExempt({ ...base, hraPaise: rupees(1_00_000), rentPaise: rupees(3_00_000) })).toBe(rupees(1_00_000));
		// Rent ₹1,50,000 less ₹60,000.
		expect(hraExempt({ ...base, hraPaise: rupees(3_00_000), rentPaise: rupees(1_50_000) })).toBe(rupees(90_000));
		// 40% of ₹6 lakh outside a metro, half in one.
		expect(hraExempt({ ...base, hraPaise: rupees(4_00_000), rentPaise: rupees(5_00_000) })).toBe(rupees(2_40_000));
		expect(hraExempt({ ...base, metro: true, hraPaise: rupees(4_00_000), rentPaise: rupees(5_00_000) })).toBe(
			rupees(3_00_000),
		);
		expect(hraExempt({ ...base, hraPaise: rupees(1_00_000), rentPaise: rupees(50_000) })).toBe(0);
		expect(hraExempt({ ...base, hraPaise: 0, rentPaise: rupees(5_00_000) })).toBe(0);
	});
});
