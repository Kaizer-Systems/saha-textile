/**
 * Payroll beyond a month's pay (accounts brief S1, S2, S4, S6, S7, S9). Pure: which schemes apply, the employer's PF
 * charges, the West Bengal labour welfare fund, the gratuity provision, salary structure templates, payslip lines,
 * statutory due dates, the files each portal takes, and an advance's recovery schedule. Money is paise.
 */
import { codeWages, structureTotal, type SalaryStructure } from './payroll-rules';

export const SALARY_HEADS = ['basic', 'da', 'hra', 'conveyance', 'special', 'other'] as const;
export type SalaryHead = (typeof SALARY_HEADS)[number];

/** The scheme rules in force from a day (S1, S2); each value is a preset the CA confirms. */
export interface PayrollSchemes {
	from: string;
	/** EPF administration charges: % of EPF wages, with a monthly minimum per establishment. */
	pfAdminPct: number;
	pfAdminMinPaise: number;
	/** EDLI insurance: % of EPF wages (capped like PF). */
	edliPct: number;
	pfHeadcount: number;
	esiHeadcount: number;
	bonusHeadcount: number;
	/** Bonus applies from this many; a warning shows from `bonusWarnAt`. */
	bonusWarnAt: number;
	gratuityHeadcount: number;
	/** Gratuity: 15 days' wages for each year, a month taken as 26 days. */
	gratuityDaysPerYear: number;
	gratuityMonthDays: number;
	/** Labour welfare fund, in the months it is due (West Bengal: June and December). */
	lwfEmployeePaise: number;
	lwfEmployerPaise: number;
	lwfMonths: readonly number[];
	/** Day of the following month each payment falls due. */
	pfDueDay: number;
	esiDueDay: number;
	ptDueDay: number;
	lwfDueDay: number;
}

export const PAYROLL_SCHEMES_2026: PayrollSchemes = {
	from: '2026-04-01',
	pfAdminPct: 0.5,
	pfAdminMinPaise: 500_00,
	edliPct: 0.5,
	pfHeadcount: 20,
	esiHeadcount: 10,
	bonusHeadcount: 20,
	bonusWarnAt: 18,
	gratuityHeadcount: 10,
	gratuityDaysPerYear: 15,
	gratuityMonthDays: 26,
	lwfEmployeePaise: 3_00,
	lwfEmployerPaise: 15_00,
	lwfMonths: [6, 12],
	pfDueDay: 15,
	esiDueDay: 15,
	ptDueDay: 21,
	lwfDueDay: 15,
};

const rupee = (paise: number) => Math.round(paise / 100) * 100;

export type SchemeKey = 'pf' | 'esi' | 'bonus' | 'gratuity' | 'pt' | 'lwf';
export type SchemeStatus = 'applies' | 'voluntary' | 'soon' | 'not_yet';
export interface SchemeLine {
	scheme: SchemeKey;
	/** The headcount it starts at; null when any salaried staff bring it in. */
	startsAt: number | null;
	headcount: number;
	/** ESI: how many earn within its limit. */
	eligible: number | null;
	status: SchemeStatus;
}

/** S2: which schemes apply this month, from the headcount and pay. */
export function schemeLines(
	input: { headcount: number; esiEligible: number; pfOnAny: boolean },
	s: PayrollSchemes,
): SchemeLine[] {
	const { headcount } = input;
	const at = (n: number): SchemeStatus => (headcount >= n ? 'applies' : 'not_yet');
	const anyone: SchemeStatus = headcount > 0 ? 'applies' : 'not_yet';
	return [
		{
			scheme: 'pf',
			startsAt: s.pfHeadcount,
			headcount,
			eligible: null,
			status: headcount >= s.pfHeadcount ? 'applies' : input.pfOnAny ? 'voluntary' : 'not_yet',
		},
		{ scheme: 'esi', startsAt: s.esiHeadcount, headcount, eligible: input.esiEligible, status: at(s.esiHeadcount) },
		{
			scheme: 'bonus',
			startsAt: s.bonusHeadcount,
			headcount,
			eligible: null,
			status: headcount >= s.bonusHeadcount ? 'applies' : headcount >= s.bonusWarnAt ? 'soon' : 'not_yet',
		},
		{
			scheme: 'gratuity',
			startsAt: s.gratuityHeadcount,
			headcount,
			eligible: null,
			status: at(s.gratuityHeadcount),
		},
		{ scheme: 'pt', startsAt: null, headcount, eligible: null, status: anyone },
		{ scheme: 'lwf', startsAt: null, headcount, eligible: null, status: anyone },
	];
}

/** The employer's EPF administration charges and EDLI for a month, from each member's capped EPF wages. */
export function pfEstablishmentCharges(
	cappedWagesPaise: readonly number[],
	s: PayrollSchemes,
): { adminPaise: number; edliPaise: number } {
	const wages = cappedWagesPaise.reduce((sum, w) => sum + w, 0);
	if (wages <= 0) return { adminPaise: 0, edliPaise: 0 };
	return {
		adminPaise: Math.max(s.pfAdminMinPaise, rupee((wages * s.pfAdminPct) / 100)),
		edliPaise: rupee((wages * s.edliPct) / 100),
	};
}

/** The labour welfare fund for a month: due only in its months, and only for someone paid that month. */
export function labourWelfare(
	month: string,
	grossPaise: number,
	s: PayrollSchemes,
): { employeePaise: number; employerPaise: number } {
	const m = Number(month.slice(5, 7));
	if (grossPaise <= 0 || !s.lwfMonths.includes(m)) return { employeePaise: 0, employerPaise: 0 };
	return { employeePaise: s.lwfEmployeePaise, employerPaise: s.lwfEmployerPaise };
}

/** A month's gratuity provision: 15/26 of a month's wages a year, a twelfth each month (0 when it doesn't apply). */
export function gratuityProvision(structure: SalaryStructure, applies: boolean, s: PayrollSchemes): number {
	if (!applies) return 0;
	return rupee((codeWages(structure) * s.gratuityDaysPerYear) / s.gratuityMonthDays / 12);
}

/** S4: how a template sets one head: a % of pay, a % of Basic (brief 26 SR1), a fixed amount (paise), or what is left. */
export interface StructureComponent {
	head: SalaryHead;
	how: 'percent' | 'percent_basic' | 'fixed' | 'rest';
	value: number;
}

/**
 * S4: a person's structure from a template and their monthly pay. Heads on Basic follow Basic; "the rest" takes
 * whatever the others leave.
 */
export function structureFromTemplate(components: readonly StructureComponent[], payPaise: number): SalaryStructure {
	const out: SalaryStructure = { basic: 0, da: 0, hra: 0, special: 0, conveyance: 0, other: 0 };
	let rest: SalaryHead | null = null;
	for (const c of components) {
		if (c.how === 'rest') rest = c.head;
		else if (c.how !== 'percent_basic')
			out[c.head] += c.how === 'percent' ? rupee((payPaise * c.value) / 100) : c.value;
	}
	for (const c of components) if (c.how === 'percent_basic') out[c.head] += rupee((out.basic * c.value) / 100);
	if (rest) out[rest] += Math.max(0, payPaise - structureTotal(out));
	return out;
}

/** S4 "Counts as wages": basic and DA always; HRA never; the rest only above the 50% line. */
export function wageTreatment(head: SalaryHead): 'yes' | 'excluded' | 'over_half' {
	if (head === 'basic' || head === 'da') return 'yes';
	return head === 'hra' ? 'excluded' : 'over_half';
}

/** S4's warning: how much of the allowances counts as wages because basic and DA are under half. */
export function wageShortfall(structure: SalaryStructure): number {
	return codeWages(structure) - structure.basic - structure.da;
}

/** S6: each head paid for the days worked, to the paisa, adding up exactly to the month's gross. */
export function payslipHeads(
	structure: SalaryStructure,
	daysInMonth: number,
	paidDays: number,
	grossPaise: number,
): Record<SalaryHead, number> {
	const share = daysInMonth > 0 ? Math.min(paidDays, daysInMonth) / daysInMonth : 0;
	const out = {} as Record<SalaryHead, number>;
	let last: SalaryHead | null = null;
	let sum = 0;
	for (const head of SALARY_HEADS) {
		out[head] = Math.round(structure[head] * share);
		sum += out[head];
		if (structure[head] > 0) last = head;
	}
	if (last) out[last] += grossPaise - sum;
	return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
const nextMonthDay = (month: string, day: number) => {
	const [y, m] = month.split('-').map(Number) as [number, number];
	const ny = m === 12 ? y + 1 : y;
	const nm = m === 12 ? 1 : m + 1;
	const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
	return `${ny}-${pad(nm)}-${pad(Math.min(day, last))}`;
};

/** A financial year's quarter for a month: its first and last month and the TDS statement's due day (S7, 24Q). */
export function tdsQuarter(month: string): { from: string; to: string; due: string } {
	const [y, m] = month.split('-').map(Number) as [number, number];
	if (m >= 4 && m <= 6) return { from: `${y}-04`, to: `${y}-06`, due: `${y}-07-31` };
	if (m >= 7 && m <= 9) return { from: `${y}-07`, to: `${y}-09`, due: `${y}-10-31` };
	if (m >= 10) return { from: `${y}-10`, to: `${y}-12`, due: `${y + 1}-01-31` };
	return { from: `${y}-01`, to: `${y}-03`, due: `${y}-05-31` };
}

export type StatutoryKind = 'pf' | 'esi' | 'pt' | 'lwf' | 'tds';

/** S7: when a month's (or, for TDS, the quarter's) return and payment fall due. */
export function statutoryDue(kind: StatutoryKind, month: string, s: PayrollSchemes): string {
	if (kind === 'tds') return tdsQuarter(month).due;
	const day = { pf: s.pfDueDay, esi: s.esiDueDay, pt: s.ptDueDay, lwf: s.lwfDueDay }[kind];
	return nextMonthDay(month, day);
}

/** One member's line in the EPFO electronic challan-cum-return (ECR 2.0), amounts in whole rupees. */
export interface EcrMember {
	uan: string;
	name: string;
	grossPaise: number;
	epfWagesPaise: number;
	epsWagesPaise: number;
	edliWagesPaise: number;
	employeePaise: number;
	epsPaise: number;
	employerDiffPaise: number;
	ncpDays: number;
	refundPaise: number;
}

const whole = (paise: number) => String(Math.round(paise / 100));

/** S7: the ECR text file: one line per member, fields joined by #~#. */
export function ecrFile(members: readonly EcrMember[]): string {
	return members
		.map((m) =>
			[
				m.uan,
				m.name.toUpperCase(),
				whole(m.grossPaise),
				whole(m.epfWagesPaise),
				whole(m.epsWagesPaise),
				whole(m.edliWagesPaise),
				whole(m.employeePaise),
				whole(m.epsPaise),
				whole(m.employerDiffPaise),
				String(m.ncpDays),
				whole(m.refundPaise),
			].join('#~#'),
		)
		.join('\n');
}

const cell = (value: string | number) => {
	const text = String(value);
	return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** A CSV with a header row, every cell quoted where it needs to be. */
export function csvText(header: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
	return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n');
}

/** S7: the ESIC monthly contribution upload's columns. A person who left in the month gets reason 2 and the day. */
export function esicFile(
	rows: readonly { ipNumber: string; name: string; paidDays: number; grossPaise: number; leftOn: string | null }[],
): string {
	return csvText(
		[
			'IP Number',
			'IP Name',
			'No of Days for which wages paid/payable during the month',
			'Total Monthly Wages',
			'Reason Code for Zero workings days',
			'Last Working Day',
		],
		rows.map((r) => [
			r.ipNumber,
			r.name,
			r.paidDays,
			whole(r.grossPaise),
			r.leftOn ? 2 : 0,
			r.leftOn ? `${r.leftOn.slice(8, 10)}/${r.leftOn.slice(5, 7)}/${r.leftOn.slice(0, 4)}` : '',
		]),
	);
}

/** S9: one month of an advance: what was recovered, what is left, and how (by payroll, or planned). */
export interface AdvanceMonth {
	month: string;
	givenPaise: number;
	recoveredPaise: number;
	leftPaise: number;
	how: 'none' | 'payroll' | 'planned';
}

const addMonth = (month: string) => nextMonthDay(month, 1).slice(0, 7);

/**
 * S9: an advance's schedule from the month it was first given: actual recoveries for months with a posted payroll,
 * then the monthly amount planned until nothing is left (at most five years ahead).
 */
export function advanceSchedule(input: {
	given: readonly { month: string; paise: number }[];
	recovered: Readonly<Record<string, number>>;
	/** The last month whose payroll is posted; later months are planned. */
	postedThrough: string | null;
	perMonthPaise: number;
}): AdvanceMonth[] {
	if (!input.given.length) return [];
	const out: AdvanceMonth[] = [];
	let left = 0;
	let month = input.given.map((g) => g.month).sort()[0] as string;
	for (let i = 0; i < 60; i++) {
		const givenPaise = input.given.filter((g) => g.month === month).reduce((sum, g) => sum + g.paise, 0);
		left += givenPaise;
		const posted = input.postedThrough !== null && month <= input.postedThrough;
		const recoveredPaise = posted
			? (input.recovered[month] ?? 0)
			: Math.max(0, Math.min(left, input.perMonthPaise));
		left -= recoveredPaise;
		const how = !recoveredPaise ? 'none' : posted ? 'payroll' : 'planned';
		out.push({ month, givenPaise, recoveredPaise, leftPaise: left, how });
		const givenLater = input.given.some((g) => g.month > month);
		// Done once nothing is left; and a plan with nothing to recover a month would never end.
		if (!givenLater && (left <= 0 || (!posted && !recoveredPaise))) break;
		month = addMonth(month);
	}
	return out;
}
