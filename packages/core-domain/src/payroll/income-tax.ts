/**
 * Income tax on salary under both regimes (brief 25 TX1, TX2; approved 2026-11-25). Pure. Every rate and limit comes
 * from a dated rules version (Settings › Payroll rules); INCOME_TAX_2026 is the built-in one for 2026-27, marked for
 * the CA's review: the Finance Act 2025 new-regime slabs, ₹75,000 standard deduction and the 87A rebate up to ₹12 lakh
 * with marginal relief, which Budget 2026 left as they were for the first year under the Income-tax Act 2025; the old
 * regime's slabs by age band, ₹50,000 standard deduction and the ₹12,500 rebate up to ₹5 lakh. Money is paise.
 */

export interface TaxSlab {
	upToPaise: number | null;
	ratePct: number;
}

export interface SurchargeTier {
	overPaise: number;
	ratePct: number;
}

export interface IncomeTaxRules {
	newSlabs: readonly TaxSlab[];
	newStandardDeductionPaise: number;
	newRebateUpToPaise: number;
	newSurcharge: readonly SurchargeTier[];
	oldSlabsBelow60: readonly TaxSlab[];
	oldSlabs60To79: readonly TaxSlab[];
	oldSlabs80Plus: readonly TaxSlab[];
	oldStandardDeductionPaise: number;
	oldRebateUpToPaise: number;
	oldRebateMaxPaise: number;
	oldSurcharge: readonly SurchargeTier[];
	cessPct: number;
	limit80cPaise: number;
	limit80dPaise: number;
	limitHomeLoanPaise: number;
	proofFromMonth: number;
}

const lakh = (n: number) => n * 1_00_000_00;

export const INCOME_TAX_2026: IncomeTaxRules = {
	newSlabs: [
		{ upToPaise: lakh(4), ratePct: 0 },
		{ upToPaise: lakh(8), ratePct: 5 },
		{ upToPaise: lakh(12), ratePct: 10 },
		{ upToPaise: lakh(16), ratePct: 15 },
		{ upToPaise: lakh(20), ratePct: 20 },
		{ upToPaise: lakh(24), ratePct: 25 },
		{ upToPaise: null, ratePct: 30 },
	],
	newStandardDeductionPaise: 75_000_00,
	newRebateUpToPaise: lakh(12),
	newSurcharge: [
		{ overPaise: lakh(50), ratePct: 10 },
		{ overPaise: lakh(100), ratePct: 15 },
		{ overPaise: lakh(200), ratePct: 25 },
	],
	oldSlabsBelow60: [
		{ upToPaise: 2_50_000_00, ratePct: 0 },
		{ upToPaise: lakh(5), ratePct: 5 },
		{ upToPaise: lakh(10), ratePct: 20 },
		{ upToPaise: null, ratePct: 30 },
	],
	oldSlabs60To79: [
		{ upToPaise: lakh(3), ratePct: 0 },
		{ upToPaise: lakh(5), ratePct: 5 },
		{ upToPaise: lakh(10), ratePct: 20 },
		{ upToPaise: null, ratePct: 30 },
	],
	oldSlabs80Plus: [
		{ upToPaise: lakh(5), ratePct: 0 },
		{ upToPaise: lakh(10), ratePct: 20 },
		{ upToPaise: null, ratePct: 30 },
	],
	oldStandardDeductionPaise: 50_000_00,
	oldRebateUpToPaise: lakh(5),
	oldRebateMaxPaise: 12_500_00,
	oldSurcharge: [
		{ overPaise: lakh(50), ratePct: 10 },
		{ overPaise: lakh(100), ratePct: 15 },
		{ overPaise: lakh(200), ratePct: 25 },
		{ overPaise: lakh(500), ratePct: 37 },
	],
	cessPct: 4,
	limit80cPaise: 1_50_000_00,
	limit80dPaise: 25_000_00,
	limitHomeLoanPaise: 2_00_000_00,
	proofFromMonth: 1,
};

export type AgeBand = 'below_60' | '60_to_79' | '80_plus';

/**
 * The old regime's age band: a person's age on the last day of the financial year (`2026-27` → 31 March 2027). In law
 * an age is reached on the day before the birthday, so someone born on 1 April counts a year older on 31 March (the
 * return forms' "born on or before 1 April").
 */
export function ageBand(dateOfBirth: string | null, year: string): AgeBand {
	if (!dateOfBirth) return 'below_60';
	const years =
		Number(year.slice(0, 4)) + 1 - Number(dateOfBirth.slice(0, 4)) - (dateOfBirth.slice(5) > '04-01' ? 1 : 0);
	return years >= 80 ? '80_plus' : years >= 60 ? '60_to_79' : 'below_60';
}

/** Tax by slabs on taxable income. */
export function slabTax(taxablePaise: number, slabs: readonly TaxSlab[]): number {
	let tax = 0;
	let floor = 0;
	for (const slab of slabs) {
		const top = slab.upToPaise ?? Number.POSITIVE_INFINITY;
		if (taxablePaise > floor) tax += ((Math.min(taxablePaise, top) - floor) * slab.ratePct) / 100;
		floor = top;
	}
	return tax;
}

/**
 * Surcharge on the slab tax with marginal relief: above a tier, tax and surcharge together never exceed what they
 * would be at the tier's start plus the income above it.
 */
export function surchargeOf(
	taxablePaise: number,
	taxPaise: number,
	tiers: readonly SurchargeTier[],
	taxAt: (taxablePaise: number) => number,
): number {
	const tier = [...tiers].reverse().find((t) => taxablePaise > t.overPaise);
	if (!tier) return 0;
	const surcharge = (taxPaise * tier.ratePct) / 100;
	const below = [...tiers].reverse().find((t) => t.overPaise < tier.overPaise);
	const atStart = taxAt(tier.overPaise);
	const ceiling = atStart + (atStart * (below?.ratePct ?? 0)) / 100 + (taxablePaise - tier.overPaise);
	return Math.max(0, Math.min(surcharge, ceiling - taxPaise));
}

/** House rent allowance exempt under the old regime: the least of HRA received, rent less 10% of basic and DA, and 50% (metro) or 40% of basic and DA. */
export function hraExempt(input: {
	hraPaise: number;
	basicDaPaise: number;
	rentPaise: number;
	metro: boolean;
}): number {
	return Math.max(
		0,
		Math.min(
			input.hraPaise,
			input.rentPaise - input.basicDaPaise / 10,
			(input.basicDaPaise * (input.metro ? 50 : 40)) / 100,
		),
	);
}

/** What a year's working needs (paise a year). */
export interface TaxYearInput {
	regime: 'new' | 'old';
	ageBand: AgeBand;
	/** Salary for the year, an earlier employer's this year included. */
	salaryPaise: number;
	hraPaise: number;
	basicDaPaise: number;
	/** The employee's own PF for the year (counts in 80C) and professional tax paid (deducted under the old regime). */
	pfPaise: number;
	professionalTaxPaise: number;
	rentPaise: number;
	metro: boolean;
	s80cPaise: number;
	s80dPaise: number;
	homeLoanInterestPaise: number;
}

export interface TaxYearWorking {
	regime: 'new' | 'old';
	salaryPaise: number;
	hraExemptPaise: number;
	standardDeductionPaise: number;
	deductionsPaise: number;
	professionalTaxPaise: number;
	taxablePaise: number;
	slabTaxPaise: number;
	rebatePaise: number;
	surchargePaise: number;
	cessPaise: number;
	taxPaise: number;
}

const rupee = (paise: number) => Math.round(paise / 100) * 100;

/**
 * A year's income tax on salary (TX1). New regime: salary less the standard deduction; the rebate takes the whole tax
 * up to its limit and, above it, never leaves more tax than the income over the limit. Old regime: salary less the
 * exempt rent allowance, the standard deduction, professional tax, and 80C (own PF included), 80D and home loan
 * interest within their limits; the rebate up to its amount when taxable income is within its limit. Then surcharge
 * with marginal relief, then cess. The tax is rounded to the rupee.
 */
export function taxForYear(input: TaxYearInput, rules: IncomeTaxRules): TaxYearWorking {
	const old = input.regime === 'old';
	const slabs = !old
		? rules.newSlabs
		: input.ageBand === '80_plus'
			? rules.oldSlabs80Plus
			: input.ageBand === '60_to_79'
				? rules.oldSlabs60To79
				: rules.oldSlabsBelow60;
	const hra = old
		? hraExempt({
				hraPaise: input.hraPaise,
				basicDaPaise: input.basicDaPaise,
				rentPaise: input.rentPaise,
				metro: input.metro,
			})
		: 0;
	const standard = Math.min(
		old ? rules.oldStandardDeductionPaise : rules.newStandardDeductionPaise,
		input.salaryPaise,
	);
	const deductions = old
		? Math.min(input.pfPaise + input.s80cPaise, rules.limit80cPaise) +
			Math.min(input.s80dPaise, rules.limit80dPaise) +
			Math.min(input.homeLoanInterestPaise, rules.limitHomeLoanPaise)
		: 0;
	const pt = old ? input.professionalTaxPaise : 0;
	const taxable = rupee(Math.max(0, input.salaryPaise - hra - standard - pt - deductions));
	const before = slabTax(taxable, slabs);
	const after = (income: number, tax: number): number => {
		if (!old) return income <= rules.newRebateUpToPaise ? 0 : Math.min(tax, income - rules.newRebateUpToPaise);
		return income <= rules.oldRebateUpToPaise ? Math.max(0, tax - rules.oldRebateMaxPaise) : tax;
	};
	const tax = after(taxable, before);
	const surcharge = surchargeOf(taxable, tax, old ? rules.oldSurcharge : rules.newSurcharge, (income) =>
		after(income, slabTax(income, slabs)),
	);
	const cess = ((tax + surcharge) * rules.cessPct) / 100;
	return {
		regime: input.regime,
		salaryPaise: input.salaryPaise,
		hraExemptPaise: rupee(hra),
		standardDeductionPaise: standard,
		deductionsPaise: deductions,
		professionalTaxPaise: pt,
		taxablePaise: taxable,
		slabTaxPaise: rupee(before),
		rebatePaise: rupee(before - tax),
		surchargePaise: rupee(surcharge),
		cessPaise: rupee(cess),
		taxPaise: rupee(tax + surcharge + cess),
	};
}

/** The financial year a month falls in: `2027-01` → `2026-27`. */
export function financialYearOf(month: string): string {
	const y = Number(month.slice(0, 4));
	const start = Number(month.slice(5, 7)) >= 4 ? y : y - 1;
	return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

/**
 * Months of the financial year after this one: November → 4 (December to March); fewer for someone leaving (`leftOn`)
 * before March, none once they have left.
 */
export function monthsAfter(month: string, leftOn: string | null = null): number {
	const m = Number(month.slice(5, 7));
	const toMarch = m >= 4 ? 15 - m : 3 - m;
	if (!leftOn) return toMarch;
	return Math.max(0, Math.min(toMarch, monthIndex(leftOn.slice(0, 7)) - monthIndex(month)));
}

/** Whether a month is in the proof period: from the proof month to March. */
export function proofDue(month: string, proofFromMonth: number): boolean {
	const m = Number(month.slice(5, 7));
	const fy = (n: number) => (n >= 4 ? n - 4 : n + 8);
	return fy(m) >= fy(proofFromMonth);
}
