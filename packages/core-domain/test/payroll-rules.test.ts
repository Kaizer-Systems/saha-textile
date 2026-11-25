import { describe, expect, it } from 'vitest';

import {
	PAYROLL_RULES_2026,
	type PayInput,
	type SalaryStructure,
	codeWages,
	monthPay,
	monthlyTds,
	newRegimeTax,
	professionalTax,
	structureTotal,
} from '../src/payroll/payroll-rules';

/**
 * Payroll (accounts brief S), checked against the law: PF at 12% on wages up to ₹15,000 with EPS 8.33% up to ₹1,250
 * (EPF Scheme), ESI at 0.75% and 3.25% rounded up while gross is up to ₹21,000, West Bengal's professional tax slabs,
 * the Labour Codes' rule that basic and DA count as at least half the pay, deductions at most half the wages (Code on
 * Wages s.18), and new-regime income tax with the ₹75,000 standard deduction, the s.87A rebate and 4% cess.
 */

const rs = (rupees: number) => Math.round(rupees * 100);
const pay = (over: Partial<SalaryStructure> = {}): SalaryStructure => ({
	basic: 0,
	da: 0,
	hra: 0,
	special: 0,
	conveyance: 0,
	other: 0,
	...over,
});
const halves = (each: number) => pay({ basic: rs(each), special: rs(each) });
const input = (structure: SalaryStructure, over: Partial<PayInput> = {}): PayInput => ({
	structure,
	daysInMonth: 30,
	paidDays: 30,
	pfOn: true,
	esiOn: true,
	advanceDuePaise: 0,
	tdsPaise: 0,
	rules: PAYROLL_RULES_2026,
	...over,
});

describe('the rules in force from April 2026', () => {
	it('hold PF, EPS, ESI, West Bengal’s professional tax and the deduction limit', () => {
		expect(PAYROLL_RULES_2026).toEqual({
			from: '2026-04-01',
			pfRatePct: 12,
			pfWageCapPaise: rs(15_000),
			epsRatePct: 8.33,
			epsCapPaise: rs(1_250),
			esiEmployeePct: 0.75,
			esiEmployerPct: 3.25,
			esiGrossLimitPaise: rs(21_000),
			ptSlabs: [
				{ upToPaise: rs(10_000), taxPaise: 0 },
				{ upToPaise: rs(15_000), taxPaise: rs(110) },
				{ upToPaise: rs(25_000), taxPaise: rs(130) },
				{ upToPaise: rs(40_000), taxPaise: rs(150) },
				{ upToPaise: null, taxPaise: rs(200) },
			],
			maxDeductionPct: 50,
		});
	});
});

describe('the approved S5 picture', () => {
	it('pays Meera ₹32,000 for 30 days: PF on the ₹15,000 cap, no ESI above ₹21,000, ₹150 professional tax', () => {
		expect(monthPay(input(halves(16_000)))).toEqual({
			grossPaise: rs(32_000),
			pfWagesPaise: rs(16_000),
			pfEmployeePaise: rs(1_800),
			pfEmployerPaise: rs(1_800),
			epsPaise: rs(1_250),
			esiEmployeePaise: 0,
			esiEmployerPaise: 0,
			ptPaise: rs(150),
			tdsPaise: 0,
			advancePaise: 0,
			netPaise: rs(30_050),
		});
	});

	it('pays Priya ₹17,400 for 29 days, ESI rounded up to ₹131, and recovers ₹1,000 of her advance', () => {
		expect(monthPay(input(halves(9_000), { paidDays: 29, advanceDuePaise: rs(1_000) }))).toEqual({
			grossPaise: rs(17_400),
			pfWagesPaise: rs(8_700),
			pfEmployeePaise: rs(1_044),
			pfEmployerPaise: rs(1_044),
			epsPaise: rs(725),
			esiEmployeePaise: rs(131),
			esiEmployerPaise: rs(566),
			ptPaise: rs(130),
			tdsPaise: 0,
			advancePaise: rs(1_000),
			netPaise: rs(15_095),
		});
	});

	it('pays Rahul ₹16,000: PF ₹960, ESI ₹120, professional tax ₹130', () => {
		expect(monthPay(input(halves(8_000)))).toMatchObject({
			grossPaise: rs(16_000),
			pfEmployeePaise: rs(960),
			esiEmployeePaise: rs(120),
			esiEmployerPaise: rs(520),
			ptPaise: rs(130),
			netPaise: rs(14_790),
		});
	});

	it('pays Sudip ₹55,000: PF ₹1,800 on the cap, no ESI, professional tax ₹200', () => {
		expect(monthPay(input(halves(27_500)))).toMatchObject({
			grossPaise: rs(55_000),
			pfWagesPaise: rs(27_500),
			pfEmployeePaise: rs(1_800),
			esiEmployeePaise: 0,
			ptPaise: rs(200),
			netPaise: rs(53_000),
		});
	});
});

describe('wages and professional tax', () => {
	it('adds every head of the pay', () => {
		expect(structureTotal(pay({ basic: 1, da: 2, hra: 4, special: 8, conveyance: 16, other: 32 }))).toBe(63);
	});

	it('raises basic and DA to half the pay when they fall short, and keeps them when they don’t', () => {
		expect(codeWages(pay({ basic: rs(10_000), hra: rs(15_000), special: rs(5_000) }))).toBe(rs(15_000));
		expect(codeWages(pay({ basic: 10_000, special: 20_001 }))).toBe(15_001);
		expect(codeWages(pay({ basic: rs(12_000), da: rs(3_000), hra: rs(15_000) }))).toBe(rs(15_000));
		expect(codeWages(pay({ basic: rs(20_000), da: rs(2_000), hra: rs(8_000) }))).toBe(rs(22_000));
	});

	it('charges West Bengal’s professional tax by slab, each edge in its slab', () => {
		const pt = (rupees: number) => professionalTax(rs(rupees), PAYROLL_RULES_2026.ptSlabs) / 100;
		expect(pt(10_000)).toBe(0);
		expect(pt(10_001)).toBe(110);
		expect(pt(15_000)).toBe(110);
		expect(pt(15_001)).toBe(130);
		expect(pt(25_000)).toBe(130);
		expect(pt(25_001)).toBe(150);
		expect(pt(40_000)).toBe(150);
		expect(pt(40_001)).toBe(200);
		expect(pt(5_00_000)).toBe(200);
	});

	it('charges nothing above slabs that end without a top slab', () => {
		expect(professionalTax(rs(50_000), [{ upToPaise: rs(40_000), taxPaise: rs(150) }])).toBe(0);
	});
});

describe('a month’s pay: the other cases', () => {
	it('pays nothing and deducts nothing in a month of no days', () => {
		expect(
			monthPay(input(halves(9_000), { daysInMonth: 0, advanceDuePaise: rs(1_000), tdsPaise: rs(500) })),
		).toEqual({
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
		});
	});

	it('pays no more than the month for more days than it has', () => {
		expect(monthPay(input(halves(8_000), { paidDays: 35 })).grossPaise).toBe(rs(16_000));
	});

	it('takes no PF from someone outside PF, and no ESI from someone outside ESI', () => {
		expect(monthPay(input(halves(8_000), { pfOn: false }))).toMatchObject({
			pfEmployeePaise: 0,
			pfEmployerPaise: 0,
			epsPaise: 0,
			esiEmployeePaise: rs(120),
			netPaise: rs(16_000 - 120 - 130),
		});
		expect(monthPay(input(halves(8_000), { esiOn: false }))).toMatchObject({
			esiEmployeePaise: 0,
			esiEmployerPaise: 0,
			netPaise: rs(16_000 - 960 - 130),
		});
	});

	it('takes ESI on a gross of ₹21,000 exactly, rounded up, and none on a rupee more', () => {
		expect(monthPay(input(halves(10_500)))).toMatchObject({ esiEmployeePaise: rs(158), esiEmployerPaise: rs(683) });
		expect(monthPay(input(pay({ basic: rs(10_500), special: rs(10_501) })))).toMatchObject({
			grossPaise: rs(21_001),
			esiEmployeePaise: 0,
			esiEmployerPaise: 0,
		});
	});

	it('caps the employer’s pension share at ₹1,250 should the PF wage ceiling rise', () => {
		const higher = { ...PAYROLL_RULES_2026, pfWageCapPaise: rs(25_000) };
		expect(monthPay(input(halves(25_000), { rules: higher }))).toMatchObject({
			pfEmployeePaise: rs(3_000),
			pfEmployerPaise: rs(3_000),
			epsPaise: rs(1_250),
		});
	});

	it('takes no more tax than the month’s pay', () => {
		expect(monthPay(input(halves(8_000), { tdsPaise: rs(50_000) }))).toMatchObject({
			tdsPaise: rs(16_000),
			advancePaise: 0,
		});
	});

	it('recovers an advance only within half the pay less the deductions the law requires, and none without room', () => {
		// Half of ₹16,000 is ₹8,000; PF, ESI and professional tax take ₹1,210, leaving ₹6,790.
		expect(monthPay(input(halves(8_000), { advanceDuePaise: rs(10_000) }))).toMatchObject({
			advancePaise: rs(6_790),
			netPaise: rs(16_000 - 1_210 - 6_790),
		});
		expect(monthPay(input(halves(8_000), { advanceDuePaise: rs(10_000), tdsPaise: rs(7_000) }))).toMatchObject({
			advancePaise: 0,
		});
	});
});

describe('income tax on salary, new regime', () => {
	it('is nothing up to ₹12 lakh taxable after the ₹75,000 standard deduction (s.87A)', () => {
		expect(newRegimeTax(0)).toBe(0);
		expect(newRegimeTax(rs(75_000))).toBe(0);
		expect(newRegimeTax(rs(8_00_000))).toBe(0);
		expect(newRegimeTax(rs(12_75_000))).toBe(0);
	});

	it('charges the slabs with 4% cess beyond the rebate’s reach: ₹13 lakh taxable', () => {
		// 0 + 20,000 + 40,000 + 15,000 = 75,000; with cess 78,000.
		expect(newRegimeTax(rs(13_75_000))).toBe(rs(78_000));
	});

	it('charges every slab on a high salary: ₹30 lakh taxable', () => {
		// 20,000 + 40,000 + 60,000 + 80,000 + 1,00,000 + 1,80,000 = 4,80,000; with cess 4,99,200.
		expect(newRegimeTax(rs(30_75_000))).toBe(rs(4_99_200));
	});

	it('rounds to the rupee', () => {
		// ₹13,00,001 taxable: 75,000.15 with cess 78,000.156 → ₹78,000.
		expect(newRegimeTax(rs(13_75_001))).toBe(rs(78_000));
	});
});

describe('this month’s TDS', () => {
	it('spreads what is left of the year’s tax over the months left, this one included', () => {
		expect(monthlyTds(rs(4_99_200), rs(1_00_000), 8)).toBe(rs(49_900));
		expect(monthlyTds(rs(78_000), 0, 12)).toBe(rs(6_500));
	});

	it('takes nothing once the year’s tax is deducted, or with no months left', () => {
		expect(monthlyTds(rs(78_000), rs(80_000), 3)).toBe(0);
		expect(monthlyTds(rs(78_000), rs(78_000), 3)).toBe(0);
		expect(monthlyTds(rs(78_000), 0, 0)).toBe(0);
	});
});

describe('the s.87A marginal relief just above ₹12 lakh', () => {
	it('charges no more than the income above ₹12 lakh, with cess', () => {
		// ₹12,10,000 taxable: the slabs give 61,500; relief keeps it to the 10,000 above ₹12 lakh; with cess ₹10,400.
		expect(newRegimeTax(rs(12_85_000))).toBe(rs(10_400));
		// ₹100 above: ₹104.
		expect(newRegimeTax(rs(12_75_100))).toBe(rs(104));
		// ₹12,60,000 taxable: 69,000 by the slabs, 60,000 above the line: ₹62,400.
		expect(newRegimeTax(rs(13_35_000))).toBe(rs(62_400));
	});

	it('gives way to the slabs once they charge less than the income above ₹12 lakh', () => {
		// ₹12,80,000 taxable: 72,000 by the slabs, under the 80,000 above the line: ₹74,880.
		expect(newRegimeTax(rs(13_55_000))).toBe(rs(74_880));
		expect(newRegimeTax(rs(13_75_000))).toBe(rs(78_000));
		expect(newRegimeTax(rs(30_75_000))).toBe(rs(4_99_200));
	});
});

describe('the advance, in whole rupees', () => {
	it('rounds the recovery down, so deductions never pass half the pay', () => {
		// Gross ₹17,401: half is ₹8,700.50; PF, ESI and professional tax take ₹1,305, leaving ₹7,395.50.
		const pay17401 = pay({ basic: rs(8_700), special: rs(8_701) });
		const month = monthPay(input(pay17401, { advanceDuePaise: rs(10_000) }));
		expect(month).toMatchObject({
			grossPaise: rs(17_401),
			pfEmployeePaise: rs(1_044),
			esiEmployeePaise: rs(131),
			ptPaise: rs(130),
			advancePaise: rs(7_395),
		});
		expect(month.pfEmployeePaise + month.esiEmployeePaise + month.ptPaise + month.advancePaise).toBeLessThanOrEqual(
			month.grossPaise / 2,
		);
	});
});
