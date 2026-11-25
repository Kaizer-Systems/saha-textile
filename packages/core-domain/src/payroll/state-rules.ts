import type { LeaveType } from './leave';

/**
 * Professional tax and the labour welfare fund per State (brief 25 ST1, ST2; approved 2026-11-25). Pure. Each dated
 * payroll-rules version holds a set per State, entered by the admin or the CA from the State's notification; a person
 * is taxed by the State of their work location. Nothing here names a State's figures: West Bengal is only the State
 * whose set the company-wide figures of an older version stand for.
 */

export type PtFrequency = 'monthly' | 'half_yearly' | 'yearly' | 'none';

/** PT2: a half-yearly or yearly tax on the period's actual pay (`actual`), or on this month's times six or twelve. */
export type PtBasis = 'projected' | 'actual';

/** PT1: a slab, and the one month in which it charges another amount (Maharashtra's ₹300 in February). */
export interface PtSlab {
	upToPaise: number | null;
	taxPaise: number;
	otherMonth?: { month: number; taxPaise: number } | null;
}

export interface StateRules {
	stateCode: string;
	ptFrequency: PtFrequency;
	ptSlabs: readonly PtSlab[];
	/** PT1: separate slabs for women; none (or empty) when everyone is on `ptSlabs`. */
	ptWomenSlabs?: readonly PtSlab[] | null;
	/** PT2: what a half-yearly or yearly tax is worked on; `projected` (today's way) when not set. */
	ptBasis?: PtBasis;
	/** PT1: the age from which the tax stops, when the State's Act says so. */
	ptExemptFromAge?: number | null;
	/** PT1: no tax for a person with a disability of 40% or more, when the State's Act says so. */
	ptExemptDisability?: boolean;
	/** Brief 26 LV1: the State's leave types, each with its rules. */
	leaveTypes?: readonly LeaveType[];
	/** Months a half-yearly or yearly tax is deducted in. */
	ptMonths: readonly number[];
	ptDueDay: number;
	lwfEmployeePaise: number;
	lwfEmployerPaise: number;
	lwfMonths: readonly number[];
	lwfDueDay: number;
}

/** The GST State code whose set an older version's company-wide figures are (they were entered for West Bengal). */
export const LEGACY_STATE_CODE = '19';

/** What a version holds: its States, or (saved before States existed) the company-wide figures. */
export interface VersionStates {
	states?: readonly StateRules[];
	ptSlabs: StateRules['ptSlabs'];
	ptDueDay: number;
	lwfEmployeePaise: number;
	lwfEmployerPaise: number;
	lwfMonths: readonly number[];
	lwfDueDay: number;
}

/** A version's State sets: its own, or one set from the company-wide figures for an older version. */
export function stateRulesOf(version: VersionStates): StateRules[] {
	if (version.states?.length) return [...version.states];
	return [
		{
			stateCode: LEGACY_STATE_CODE,
			ptFrequency: 'monthly',
			ptSlabs: version.ptSlabs,
			ptMonths: [],
			ptDueDay: version.ptDueDay,
			lwfEmployeePaise: version.lwfEmployeePaise,
			lwfEmployerPaise: version.lwfEmployerPaise,
			lwfMonths: version.lwfMonths,
			lwfDueDay: version.lwfDueDay,
		},
	];
}

export function stateRulesFor(states: readonly StateRules[], stateCode: string): StateRules | null {
	return states.find((s) => s.stateCode === stateCode) ?? null;
}

const PERIOD_MONTHS: Record<PtFrequency, number> = { monthly: 1, half_yearly: 6, yearly: 12, none: 0 };

/** PT3: only what a State's rules may ask about the person. */
export interface PtPerson {
	woman: boolean;
	/** On the month's last day; null when the date of birth isn't kept. */
	age: number | null;
	disability: boolean;
	/** Not charged for another reason the State exempts (kept with the person, with its reason). */
	exempt: boolean;
}

/** Someone the rules ask nothing about: the slabs for everyone, no exemption. */
export const PT_ANYONE: PtPerson = { woman: false, age: null, disability: false, exempt: false };

/** A person's age on a day. In law an age is reached on the day before the birthday. */
export function ageOn(dateOfBirth: string, day: string): number {
	const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
	const y = Number(day.slice(0, 4));
	const eve = new Date(Date.UTC(y, bm - 1, bd - 1)).toISOString().slice(0, 10);
	return y - by - (day < eve ? 1 : 0);
}

/** PT3: what the State's rules may ask, read from an employee, with their age on the month's last day. */
export function ptPersonOf(
	employee: { gender?: string; disability?: boolean; ptExemptReason?: string; dateOfBirth?: string | null },
	month: string,
): PtPerson {
	const [y, m] = month.split('-').map(Number) as [number, number];
	const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
	return {
		woman: employee.gender === 'woman',
		age: employee.dateOfBirth ? ageOn(employee.dateOfBirth, last) : null,
		disability: employee.disability === true,
		exempt: !!employee.ptExemptReason?.trim(),
	};
}

/** PT2: on the actual-pay basis, what the period paid so far (this month included), and whether they leave this month. */
export interface PtPeriodPay {
	grossPaise: number;
	leaving: boolean;
}

/** The slab a base falls in, and its amount, or the one month it charges another amount in. */
function slabTax(base: number, slabs: readonly PtSlab[], monthNo: number): number {
	const slab = slabs.find((s) => s.upToPaise === null || base <= s.upToPaise);
	if (!slab) return 0;
	return slab.otherMonth?.month === monthNo ? slab.otherMonth.taxPaise : slab.taxPaise;
}

/** PT1, PT3: the person is not charged under the State's exemptions. */
function ptExempt(rules: StateRules, person: PtPerson): boolean {
	if (person.exempt) return true;
	if (rules.ptExemptDisability && person.disability) return true;
	return rules.ptExemptFromAge != null && person.age != null && person.age >= rules.ptExemptFromAge;
}

/**
 * A month's professional tax under a State's set (brief 26 PT1–PT3). Monthly on the month's gross, by the person's
 * slabs (women's when the State has them), with a slab's one differing month. Half-yearly or yearly in the set's
 * months: on the period's actual pay when the State taxes that (and in the leaving month for someone leaving before
 * the period ends), otherwise on this month's times six or twelve. Nothing for someone not paid, exempt, or in a
 * State without the tax.
 */
export function statePt(
	month: string,
	grossPaise: number,
	rules: StateRules,
	person: PtPerson = PT_ANYONE,
	period: PtPeriodPay | null = null,
): number {
	if (grossPaise <= 0 || rules.ptFrequency === 'none' || ptExempt(rules, person)) return 0;
	const monthNo = Number(month.slice(5, 7));
	const slabs = person.woman && rules.ptWomenSlabs?.length ? rules.ptWomenSlabs : rules.ptSlabs;
	if (rules.ptFrequency === 'monthly') return slabTax(grossPaise, slabs, monthNo);
	const actual = rules.ptBasis === 'actual' && period !== null;
	if (!rules.ptMonths.includes(monthNo) && !(actual && period.leaving)) return 0;
	return slabTax(actual ? period.grossPaise : grossPaise * PERIOD_MONTHS[rules.ptFrequency], slabs, monthNo);
}

/**
 * PT2: the months of the period that ends with `month` on the actual-pay basis: from the month after the set's
 * previous deduction month, to `month`. A monthly or untaxed State's period is the month itself.
 */
export function ptPeriodMonths(month: string, rules: StateRules): string[] {
	const [y, m] = month.split('-').map(Number) as [number, number];
	const shift = (k: number) => {
		const t = y * 12 + (m - 1) - k;
		return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
	};
	if (rules.ptFrequency === 'monthly' || rules.ptFrequency === 'none' || !rules.ptMonths.length) return [month];
	const out = [month];
	for (let k = 1; k < 12; k++) {
		if (rules.ptMonths.includes(Number(shift(k).slice(5, 7)))) break;
		out.unshift(shift(k));
	}
	return out;
}

/**
 * PT1: the most one person can pay in a year under the set, worked out from its slabs (both lists, each slab's
 * differing month counted once), so a figure past the Constitution's ₹2,500 a year (Article 276) is caught.
 */
export function ptYearMost(rules: StateRules): number {
	if (rules.ptFrequency === 'none') return 0;
	const times = rules.ptFrequency === 'monthly' ? 12 : rules.ptMonths.length;
	const most = (slabs: readonly PtSlab[]) =>
		Math.max(
			0,
			...slabs.map((s) => {
				const other = s.otherMonth;
				const counted = other && (rules.ptFrequency === 'monthly' || rules.ptMonths.includes(other.month));
				return s.taxPaise * times + (counted ? other.taxPaise - s.taxPaise : 0);
			}),
		);
	return Math.max(most(rules.ptSlabs), most(rules.ptWomenSlabs ?? []));
}

/** The Constitution's cap on a profession tax, a year (Article 276(2)). */
export const PT_YEAR_CAP_PAISE = 2_500_00;

/** The labour welfare fund for a month under a State's set: due only in its months, for someone paid that month. */
export function stateLwf(
	month: string,
	grossPaise: number,
	rules: StateRules,
): { employeePaise: number; employerPaise: number } {
	if (grossPaise <= 0 || !rules.lwfMonths.includes(Number(month.slice(5, 7))))
		return { employeePaise: 0, employerPaise: 0 };
	return { employeePaise: rules.lwfEmployeePaise, employerPaise: rules.lwfEmployerPaise };
}

/** When a State's professional tax or welfare fund for a month falls due: its day in the following month. */
export function stateDue(kind: 'pt' | 'lwf', month: string, rules: StateRules): string {
	const [y, m] = month.split('-').map(Number) as [number, number];
	const ny = m === 12 ? y + 1 : y;
	const nm = m === 12 ? 1 : m + 1;
	const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
	const day = Math.min(kind === 'pt' ? rules.ptDueDay : rules.lwfDueDay, last);
	return `${ny}-${String(nm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
