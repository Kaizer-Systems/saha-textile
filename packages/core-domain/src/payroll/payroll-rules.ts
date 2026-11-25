/**
 * Payroll (accounts brief S). Pure: a month's pay for one person from their salary structure, paid days and the payroll
 * rules in force (each a dated version, so a law change never alters a past payslip). Money is paise; payroll amounts
 * are whole rupees.
 *
 * - PF: 12% of PF wages up to ₹15,000 a month, from the employee and the employer (employer: EPS 8.33% up to ₹1,250,
 *   the rest to EPF).
 * - ESI: 0.75% from the employee and 3.25% from the employer while gross pay is ₹21,000 or less, rounded up.
 * - Professional tax by the State's monthly slab.
 * - Labour Codes: when basic and DA are under half of the pay, the shortfall counts as wages for PF (and gratuity, bonus).
 * - Income tax on salary: projected for the year under the person's regime, spread over the months left.
 */

export interface PayrollRules {
	from: string;
	pfRatePct: number;
	pfWageCapPaise: number;
	epsRatePct: number;
	epsCapPaise: number;
	esiEmployeePct: number;
	esiEmployerPct: number;
	esiGrossLimitPaise: number;
	/** Monthly slabs: up to an amount (null = above every slab), the tax. */
	ptSlabs: readonly { upToPaise: number | null; taxPaise: number }[];
	/** Most of a month's wages that deductions (advance recovery included) may take, %. */
	maxDeductionPct: number;
}

const rupee = (paise: number) => Math.round(paise / 100) * 100;
const rupeeUp = (paise: number) => Math.ceil(paise / 100) * 100;

/** The rules in force from 1 April 2026 with West Bengal's professional tax (the CA confirms each version). */
export const PAYROLL_RULES_2026: PayrollRules = {
	from: '2026-04-01',
	pfRatePct: 12,
	pfWageCapPaise: 15_000_00,
	epsRatePct: 8.33,
	epsCapPaise: 1_250_00,
	esiEmployeePct: 0.75,
	esiEmployerPct: 3.25,
	esiGrossLimitPaise: 21_000_00,
	ptSlabs: [
		{ upToPaise: 10_000_00, taxPaise: 0 },
		{ upToPaise: 15_000_00, taxPaise: 110_00 },
		{ upToPaise: 25_000_00, taxPaise: 130_00 },
		{ upToPaise: 40_000_00, taxPaise: 150_00 },
		{ upToPaise: null, taxPaise: 200_00 },
	],
	maxDeductionPct: 50,
};

/** A person's monthly pay by head (paise). */
export interface SalaryStructure {
	basic: number;
	da: number;
	hra: number;
	special: number;
	conveyance: number;
	other: number;
}

export const structureTotal = (s: SalaryStructure) => s.basic + s.da + s.hra + s.special + s.conveyance + s.other;

/** Labour Codes' wage rule: basic and DA, raised to half the pay when they fall short. */
export function codeWages(s: SalaryStructure): number {
	return Math.max(s.basic + s.da, Math.ceil(structureTotal(s) / 2));
}

/** The professional tax for a month's gross pay. */
export function professionalTax(grossPaise: number, slabs: PayrollRules['ptSlabs']): number {
	return slabs.find((s) => s.upToPaise === null || grossPaise <= s.upToPaise)?.taxPaise ?? 0;
}

export interface PayInput {
	structure: SalaryStructure;
	daysInMonth: number;
	paidDays: number;
	pfOn: boolean;
	esiOn: boolean;
	/** The advance asked to be recovered this month (paise). */
	advanceDuePaise: number;
	tdsPaise: number;
	rules: PayrollRules;
}

export interface PayResult {
	grossPaise: number;
	pfWagesPaise: number;
	pfEmployeePaise: number;
	pfEmployerPaise: number;
	epsPaise: number;
	esiEmployeePaise: number;
	esiEmployerPaise: number;
	ptPaise: number;
	tdsPaise: number;
	advancePaise: number;
	netPaise: number;
}

/** A month's pay: each head paid for the days worked, then PF, ESI, professional tax, TDS and the advance. */
export function monthPay(input: PayInput): PayResult {
	const share = input.daysInMonth > 0 ? Math.min(input.paidDays, input.daysInMonth) / input.daysInMonth : 0;
	const grossPaise = rupee(structureTotal(input.structure) * share);
	const pfWagesPaise = rupee(codeWages(input.structure) * share);
	const r = input.rules;
	const pfBase = Math.min(pfWagesPaise, r.pfWageCapPaise);
	const pfEmployeePaise = input.pfOn ? rupee((pfBase * r.pfRatePct) / 100) : 0;
	const epsPaise = input.pfOn ? Math.min(rupee((pfBase * r.epsRatePct) / 100), r.epsCapPaise) : 0;
	const pfEmployerPaise = input.pfOn ? rupee((pfBase * r.pfRatePct) / 100) : 0;
	const esiDue = input.esiOn && grossPaise > 0 && grossPaise <= r.esiGrossLimitPaise;
	const esiEmployeePaise = esiDue ? rupeeUp((grossPaise * r.esiEmployeePct) / 100) : 0;
	const esiEmployerPaise = esiDue ? rupeeUp((grossPaise * r.esiEmployerPct) / 100) : 0;
	const ptPaise = grossPaise > 0 ? professionalTax(grossPaise, r.ptSlabs) : 0;
	const tdsPaise = Math.min(input.tdsPaise, grossPaise);
	const statutory = pfEmployeePaise + esiEmployeePaise + ptPaise + tdsPaise;
	const room = Math.max(0, Math.floor((grossPaise * r.maxDeductionPct) / 100) - statutory);
	// Whole rupees, rounded down so the recovery never goes past the limit.
	const advancePaise = Math.floor(Math.min(input.advanceDuePaise, room) / 100) * 100;
	return {
		grossPaise,
		pfWagesPaise,
		pfEmployeePaise,
		pfEmployerPaise,
		epsPaise,
		esiEmployeePaise,
		esiEmployerPaise,
		ptPaise,
		tdsPaise,
		advancePaise,
		netPaise: grossPaise - statutory - advancePaise,
	};
}

/** Income tax on salary for a year under the new regime (FY 2025-26 onward): slabs, ₹75,000 standard deduction, 87A, cess. */
export function newRegimeTax(annualSalaryPaise: number): number {
	const taxable = Math.max(0, annualSalaryPaise - 75_000_00);
	const slabs: [number, number][] = [
		[4_00_000_00, 0],
		[8_00_000_00, 5],
		[12_00_000_00, 10],
		[16_00_000_00, 15],
		[20_00_000_00, 20],
		[24_00_000_00, 25],
		[Number.POSITIVE_INFINITY, 30],
	];
	let tax = 0;
	let floor = 0;
	for (const [upTo, rate] of slabs) {
		if (taxable > floor) tax += ((Math.min(taxable, upTo) - floor) * rate) / 100;
		floor = upTo;
	}
	// Section 87A: no tax up to ₹12 lakh taxable, and above it never more than the income over ₹12 lakh (marginal
	// relief), before the 4% cess.
	tax = Math.min(tax, Math.max(0, taxable - 12_00_000_00));
	return rupee(tax * 1.04);
}

/** This month's TDS: the year's tax less what was deducted, spread over the months left (this one included). */
export function monthlyTds(annualTaxPaise: number, deductedPaise: number, monthsLeft: number): number {
	return monthsLeft > 0 ? Math.max(0, rupee((annualTaxPaise - deductedPaise) / monthsLeft)) : 0;
}
