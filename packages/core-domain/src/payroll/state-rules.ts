import { professionalTax } from './payroll-rules';

/**
 * Professional tax and the labour welfare fund per State (brief 25 ST1, ST2; approved 2026-11-25). Pure. Each dated
 * payroll-rules version holds a set per State, entered by the admin or the CA from the State's notification; a person
 * is taxed by the State of their work location. Nothing here names a State's figures: West Bengal is only the State
 * whose set the company-wide figures of an older version stand for.
 */

export type PtFrequency = 'monthly' | 'half_yearly' | 'yearly' | 'none';

export interface StateRules {
	stateCode: string;
	ptFrequency: PtFrequency;
	ptSlabs: readonly { upToPaise: number | null; taxPaise: number }[];
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

/**
 * A month's professional tax under a State's set: monthly on the month's gross; half-yearly or yearly on the period's
 * gross (this month's times six or twelve), taken in the set's months; nothing in a State without the tax or for
 * someone not paid.
 */
export function statePt(month: string, grossPaise: number, rules: StateRules): number {
	if (grossPaise <= 0 || rules.ptFrequency === 'none') return 0;
	if (rules.ptFrequency !== 'monthly' && !rules.ptMonths.includes(Number(month.slice(5, 7)))) return 0;
	return professionalTax(grossPaise * PERIOD_MONTHS[rules.ptFrequency], rules.ptSlabs);
}

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
