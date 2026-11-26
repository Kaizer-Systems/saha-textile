/**
 * Salary structures from the CTC and pay revisions (brief 26 SR1-SR4; approved 2026-11-26). Pure. A structure says
 * how each head follows from the total: a % of the CTC, a % of Basic, a fixed amount, or "the rest", which absorbs
 * whatever is left so the total always matches. A revision changes one number (the CTC by a %, by an amount, or to a
 * new figure) and the heads re-split by themselves; or the heads are typed and the CTC follows them. Paise
 * throughout; heads in whole rupees, the rest taking the rounding.
 */

import type { SalaryStructure, WageHead } from './payroll-rules';

/** SR1: how a head of a CTC structure is set. `percent` is a % of the month's CTC. */
export interface CtcComponent {
	head: WageHead;
	how: 'percent' | 'percent_basic' | 'fixed' | 'rest';
	/** A percentage, or paise for `fixed`. */
	value: number;
}

const HEADS: readonly WageHead[] = ['basic', 'da', 'hra', 'conveyance', 'special', 'other'];
const empty = (): SalaryStructure => ({ basic: 0, da: 0, hra: 0, special: 0, conveyance: 0, other: 0 });
/** Whole rupees, in paise. */
const wholeRupees = (paise: number) => Math.round(paise / 100) * 100;
const gross = (s: SalaryStructure) => HEADS.reduce((sum, h) => sum + s[h], 0);

/** What the employer pays on top of the gross inside the CTC (PF, gratuity, ESI, bonus), from the structure. */
export type EmployerCost = (structure: SalaryStructure) => number;

export interface CtcSplit {
	structure: SalaryStructure;
	grossPaise: number;
	employerPaise: number;
	/** False when the other heads and the employer's share take more than the CTC: the rest would go below zero. */
	fits: boolean;
}

/**
 * SR1: a month's structure from a month's CTC. Basic first (a % of the CTC or fixed), then the heads on Basic, then
 * the fixed ones; the rest takes what the CTC leaves after the employer's share, which itself may depend on the rest
 * (PF on code wages), so it is settled by repeating until it stops moving.
 */
export function structureFromCtc(components: readonly CtcComponent[], ctcPaise: number, cost: EmployerCost): CtcSplit {
	const out = empty();
	const ordered = [...components].sort((a, b) => order(a) - order(b));
	let rest: WageHead | null = null;
	for (const c of ordered) {
		if (c.how === 'rest') rest = c.head;
		else if (c.how === 'fixed') out[c.head] = c.value;
		else out[c.head] = wholeRupees(((c.how === 'percent' ? ctcPaise : out.basic) * c.value) / 100);
	}
	let employer = cost(out);
	if (rest) {
		for (let i = 0; i < 50; i++) {
			const left = ctcPaise - (gross(out) - out[rest]) - employer;
			out[rest] = left;
			const next = cost(out);
			if (next === employer) break;
			employer = next;
		}
	}
	const fits = !rest || out[rest] >= 0;
	if (rest && out[rest] < 0) out[rest] = 0;
	return { structure: out, grossPaise: gross(out), employerPaise: cost(out), fits };
}

/** Basic before the heads worked on it; the rest last. */
function order(c: CtcComponent): number {
	if (c.how === 'rest') return 3;
	if (c.how === 'percent_basic') return 2;
	return c.head === 'basic' ? 0 : 1;
}

/** SR2: the four ways in. A % or an amount (a month) changes the CTC; a new CTC is typed (a year); or the heads are. */
export type RevisionWay =
	| { kind: 'percent'; pct: number }
	| { kind: 'amount'; monthPaise: number }
	| { kind: 'ctc'; yearPaise: number }
	| { kind: 'heads'; structure: SalaryStructure };

/** SR2: the new month's CTC a revision gives (heads typed: the gross plus the employer's share on them). */
export function revisedCtc(nowCtcPaise: number, way: RevisionWay, cost: EmployerCost): number {
	if (way.kind === 'percent') return wholeRupees(nowCtcPaise * (1 + way.pct / 100));
	if (way.kind === 'amount') return nowCtcPaise + way.monthPaise;
	if (way.kind === 'ctc') return wholeRupees(way.yearPaise / 12);
	return gross(way.structure) + cost(way.structure);
}

/**
 * SR2: a head typed over after the figures appear. With the CTC locked, the rest moves to keep the total; otherwise
 * the CTC follows the heads.
 */
export function typedOver(
	structure: SalaryStructure,
	head: WageHead,
	paise: number,
	lock: { ctcPaise: number; rest: WageHead } | null,
	cost: EmployerCost,
): CtcSplit {
	const next = { ...structure, [head]: paise };
	if (!lock || head === lock.rest)
		return { structure: next, grossPaise: gross(next), employerPaise: cost(next), fits: true };
	return structureFromCtc(
		HEADS.map((h): CtcComponent =>
			h === lock.rest ? { head: h, how: 'rest', value: 0 } : { head: h, how: 'fixed', value: next[h] },
		),
		lock.ctcPaise,
		cost,
	);
}

/** SR2's breakup: each head now and new, and the change. */
export function breakup(
	now: SalaryStructure,
	next: SalaryStructure,
): { head: WageHead; now: number; next: number; change: number }[] {
	return HEADS.filter((h) => now[h] || next[h]).map((h) => ({
		head: h,
		now: now[h],
		next: next[h],
		change: next[h] - now[h],
	}));
}

/**
 * SR4: arrears for a revision dated back: for each month already paid on the old structure, the difference in gross
 * for the days paid. One line on the next payslip, with the months in its note.
 */
export function arrears(
	old: SalaryStructure,
	next: SalaryStructure,
	paid: readonly { month: string; paidDays: number; daysInMonth: number }[],
): { paise: number; months: string[] } {
	const diff = gross(next) - gross(old);
	const months = paid.filter((m) => m.paidDays > 0 && m.daysInMonth > 0);
	return {
		paise: months.reduce(
			(sum, m) => sum + Math.round((diff * Math.min(m.paidDays, m.daysInMonth)) / m.daysInMonth),
			0,
		),
		months: months.map((m) => m.month),
	};
}

/** SR4: a State's minimum wages a month by skill level (paise), dated by its notification. */
export type SkillLevel = 'unskilled' | 'semi_skilled' | 'skilled' | 'highly_skilled';
export interface MinimumWages {
	from: string;
	levels: Partial<Record<SkillLevel, number>>;
}

/**
 * SR4, SR-D5: a structure under the State's minimum wage for the person's skill level: basic and DA (the minimum
 * rates of wages) against the figure in force; the shortfall, or 0. A State or level without a figure checks nothing.
 */
export function minimumWageShortfall(
	structure: SalaryStructure,
	level: SkillLevel | null | undefined,
	wages: readonly MinimumWages[] | undefined,
	on: string,
): number {
	if (!level) return 0;
	const inForce = [...(wages ?? [])]
		.filter((w) => w.from <= on)
		.sort((a, b) => a.from.localeCompare(b.from))
		.at(-1);
	const least = inForce?.levels[level];
	if (!least) return 0;
	return Math.max(0, least - structure.basic - structure.da);
}

/** SR2: a dated salary: the structure from a day. */
export interface DatedStructure {
	from: string;
	structure: SalaryStructure;
}

/**
 * SR2: the structure in force on a day. Without any revision, the person's structure; otherwise the last version from
 * on or before the day (the first for a day before them all), the latest being the person's structure as it stands.
 */
export function structureOn(
	current: SalaryStructure,
	history: readonly DatedStructure[] | undefined,
	day: string,
): SalaryStructure {
	if (!history?.length) return current;
	let at = 0;
	history.forEach((v, i) => {
		if (v.from <= day) at = i;
	});
	return at === history.length - 1 ? current : (history[at] as DatedStructure).structure;
}

/**
 * SR4: arrears due in a month: for each earlier month paid since the first revision, what the structure in force then
 * gives for the days paid, less what that month paid and any arrears already paid for it. Never below nothing (a
 * decrease dated back is not recovered here). PF wages follow the same way.
 */
export function arrearsDue(input: {
	since: string;
	months: readonly {
		month: string;
		paidDays: number;
		daysInMonth: number;
		paidPaise: number;
		paidPfWagesPaise: number;
	}[];
	dueOn: (month: string) => SalaryStructure;
	pfHeads: readonly WageHead[];
	arrearsPaid: (month: string) => number;
}): { paise: number; pfWagesPaise: number; byMonth: { month: string; paise: number }[] } {
	const byMonth: { month: string; paise: number }[] = [];
	let pfWagesPaise = 0;
	for (const m of input.months) {
		if (m.month < input.since.slice(0, 7) || m.daysInMonth <= 0) continue;
		const share = Math.min(m.paidDays, m.daysInMonth) / m.daysInMonth;
		const due = input.dueOn(m.month);
		const owed = Math.round(gross(due) * share) - m.paidPaise - input.arrearsPaid(m.month);
		if (owed <= 0) continue;
		byMonth.push({ month: m.month, paise: owed });
		const pfDue = Math.round(input.pfHeads.reduce((sum, h) => sum + due[h], 0) * share);
		pfWagesPaise += Math.max(0, Math.min(owed, pfDue - m.paidPfWagesPaise));
	}
	return { paise: byMonth.reduce((sum, m) => sum + m.paise, 0), pfWagesPaise, byMonth };
}
