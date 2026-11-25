/**
 * Leave types and their rules (brief 26 LV1, LV2, OB1, OB2; approved 2026-11-26). Pure. Each State's set in a dated
 * payroll-rules version holds its leave types; each type holds ordered rules, the first whose condition matches the
 * person applying. Every type runs on its own year: any start month and length, or from each person's joining day
 * (owner, 26 Nov: the April–March year is only where a new type starts). Nothing about a particular law is written
 * here: the West Bengal starting set below is data, copied into a version and edited like anything typed. Days may
 * be fractional (half days).
 */

/** A type's year: from a month for some months, or from each person's joining day for twelve months. */
export type LeaveYear = { startMonth: number; months: number } | { fromJoining: true };

/** How a type is credited. */
export type LeaveCredit =
	| { kind: 'year_start'; days: number }
	| { kind: 'monthly'; days: number }
	| { kind: 'per_days_worked'; every: number; give: number }
	| { kind: 'on_request'; days: number }
	| { kind: 'none' };

/** How long each credit stays valid. */
export type LeaveValidity = { kind: 'year_end' } | { kind: 'days' | 'months'; n: number } | { kind: 'never' };

export interface LeaveRule {
	/** Who the rule is for; the last rule of a type has none and is for everyone else. */
	when?: { designation?: string; department?: string } | null;
	year: LeaveYear;
	credit: LeaveCredit;
	/** Days worked in the type's year before anything is credited (180 for earned leave under the OSH Code). */
	waitDays?: number | null;
	/** Someone joining during the year: leave given at the year's start is shared by the months or days left. */
	joiners: 'months_left' | 'days_left' | 'none';
	rounding: 'half' | 'whole' | 'none';
	/** At the year's end: the most that carries forward (null: all of it); above it, encashed or lapsed. */
	carryMax: number | null;
	aboveCap: 'encash' | 'lapse';
	validity: LeaveValidity;
	encash: { onLeaving: boolean; onRequestMax: number | null; dayPay: 'month_days' | '26' | '30' };
	taking: { halfDays: boolean; noticeDays: number | null; countOffsBetween: boolean; canGoNegative: boolean };
}

export interface LeaveType {
	/** Short code shown in attendance: EL, CL, SL. */
	key: string;
	name: string;
	paid: 'full' | 'half' | 'unpaid';
	active: boolean;
	rules: LeaveRule[];
}

/** The rule that applies to a person: the first whose condition matches (an empty one matches everyone). */
export function ruleFor(type: LeaveType, person: { designation?: string; department?: string }): LeaveRule | null {
	const same = (want: string | undefined, have: string | undefined) =>
		!want || want.trim().toLowerCase() === (have ?? '').trim().toLowerCase();
	return (
		type.rules.find(
			(r) =>
				!r.when || (same(r.when.designation, person.designation) && same(r.when.department, person.department)),
		) ?? null
	);
}

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) =>
	Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/** The type's year that holds a day: its first and last days. */
export function leaveYearOn(year: LeaveYear, day: string, joinedOn: string): { start: string; end: string } {
	const [y, m] = day.split('-').map(Number) as [number, number];
	if ('fromJoining' in year) {
		const [, jm, jd] = joinedOn.split('-').map(Number) as [number, number, number];
		const thisYear = iso(y, jm, jd);
		const start = thisYear <= day ? thisYear : iso(y - 1, jm, jd);
		const sy = Number(start.slice(0, 4));
		return { start, end: iso(sy + 1, jm, jd - 1) };
	}
	const startYear = m >= year.startMonth ? y : y - 1;
	const start = iso(startYear, year.startMonth, 1);
	const end = iso(startYear, year.startMonth + year.months, 0);
	// A year shorter than twelve months may end before the day; step on to the one holding it.
	return end < day ? stepOn(year, start, day) : { start, end };
}

/** A year of fewer than twelve months: the run of such years from `start` that holds `day`. */
function stepOn(
	year: { startMonth: number; months: number },
	start: string,
	day: string,
): { start: string; end: string } {
	let [sy, sm] = start.split('-').map(Number) as [number, number];
	for (;;) {
		const end = iso(sy, sm + year.months, 0);
		if (end >= day) return { start: iso(sy, sm, 1), end };
		const next = new Date(Date.UTC(sy, sm - 1 + year.months, 1));
		sy = next.getUTCFullYear();
		sm = next.getUTCMonth() + 1;
	}
}

export function roundLeave(days: number, rounding: LeaveRule['rounding']): number {
	if (rounding === 'half') return Math.round(days * 2) / 2;
	if (rounding === 'whole') return Math.round(days);
	return Math.round(days * 100) / 100;
}

/**
 * OB1, OB2: leave credited in the type's current year up to a day, as the rules give it. Days worked come from the
 * attendance when given; before the books held any (a person added at go-live), each week's calendar days count six
 * worked, one off. The figure is shown worked out and stays editable.
 */
export function creditSoFar(rule: LeaveRule, input: { joinedOn: string; asOf: string; daysWorked?: number }): number {
	const year = leaveYearOn(rule.year, input.asOf, input.joinedOn);
	const from = input.joinedOn > year.start ? input.joinedOn : year.start;
	if (from > input.asOf) return 0;
	const elapsed = daysBetween(from, input.asOf);
	const worked = input.daysWorked ?? Math.round((elapsed * 6) / 7);
	if (rule.waitDays && worked < rule.waitDays) return 0;
	const c = rule.credit;
	let days = 0;
	if (c.kind === 'year_start') {
		const joinedIn = input.joinedOn > year.start;
		const yearDays = daysBetween(year.start, year.end);
		const share =
			!joinedIn || rule.joiners === 'none'
				? 1
				: rule.joiners === 'days_left'
					? daysBetween(input.joinedOn, year.end) / yearDays
					: monthsFrom(input.joinedOn, year.end) / monthsFrom(year.start, year.end);
		days = c.days * share;
	} else if (c.kind === 'monthly') {
		days = c.days * monthsFrom(from, input.asOf);
	} else if (c.kind === 'per_days_worked') {
		days = (worked * c.give) / c.every;
	}
	return roundLeave(days, rule.rounding);
}

/** Calendar months from one day's month to another's, both counted. */
function monthsFrom(from: string, to: string): number {
	return (
		(Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1
	);
}

/** LV2: at the type's year end, what of a balance carries forward, is encashed, or lapses. */
export function yearEndSplit(balance: number, rule: LeaveRule): { carry: number; encash: number; lapse: number } {
	// Nothing to split, or leave that never lapses (maternity): it all stays.
	if (balance <= 0 || rule.validity.kind === 'never') return { carry: balance, encash: 0, lapse: 0 };
	const carry = rule.carryMax === null ? balance : Math.min(balance, rule.carryMax);
	const rest = balance - carry;
	return rule.aboveCap === 'encash' ? { carry, encash: rest, lapse: 0 } : { carry, encash: 0, lapse: rest };
}

/** OB1, OB2: a person's leave of one type on the day they were added, as kept with the employee. */
export interface OpeningLeave {
	asOf: string;
	carried: number | null;
	credited: number;
	/** What the rules worked out on that day, so credit earned since is added on top of a typed figure. */
	creditedWorkedOut: number;
	taken: number;
}

const dayAfter = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * AT1: a type's leave left on a day. From the opening balance (or, without one, the joining day), each of the type's
 * years is credited by its rules (the current one up to the day) less the leave taken in it (leave already approved
 * for later in the year included), and what is left carries into the next year as its year-end rule says. A credit's
 * own validity in days or months is applied at the year's end for now.
 */
export function leaveLeft(
	rule: LeaveRule,
	input: {
		joinedOn: string;
		today: string;
		opening: OpeningLeave | null;
		/** Leave of this type taken between two days, both counted. */
		taken: (from: string, to: string) => number;
	},
): number {
	let opening = input.opening;
	let year = leaveYearOn(rule.year, opening?.asOf ?? input.joinedOn, input.joinedOn);
	let carry = opening?.carried ?? 0;
	for (;;) {
		const upTo = year.end < input.today ? year.end : input.today;
		const worked = creditSoFar(rule, { joinedOn: input.joinedOn, asOf: upTo });
		const balance = opening
			? carry +
				opening.credited +
				Math.max(0, worked - opening.creditedWorkedOut) -
				opening.taken -
				input.taken(dayAfter(opening.asOf), year.end)
			: carry + worked - input.taken(year.start, year.end);
		if (year.end >= input.today) return roundLeave(balance, 'none');
		carry = yearEndSplit(balance, rule).carry;
		opening = null;
		year = leaveYearOn(rule.year, dayAfter(year.end), input.joinedOn);
	}
}

/** LV2: a day's pay for encashment: the month's wages over the month's days, or over 26 or 30, as the rule says. */
export function encashPaise(
	days: number,
	monthWagesPaise: number,
	daysInMonth: number,
	dayPay: LeaveRule['encash']['dayPay'],
): number {
	const per = dayPay === '26' ? 26 : dayPay === '30' ? 30 : daysInMonth;
	return Math.round((monthWagesPaise / per) * days);
}

const yearRule = (over: Partial<LeaveRule>): LeaveRule => ({
	year: { startMonth: 4, months: 12 },
	credit: { kind: 'none' },
	joiners: 'months_left',
	rounding: 'half',
	carryMax: 0,
	aboveCap: 'lapse',
	validity: { kind: 'year_end' },
	encash: { onLeaving: false, onRequestMax: null, dayPay: 'month_days' },
	taking: { halfDays: true, noticeDays: null, countOffsBetween: false, canGoNegative: false },
	...over,
});

/**
 * LV-D2's West Bengal starting set, each item the more generous of the OSH Code 2020 and the West Bengal Shops and
 * Establishments Act 1963, marked for the CA's review: earned leave by the OSH Code (one day for every 20 days worked
 * after 180, up to 30 carried, the rest and the balance on leaving paid), casual leave 10 days (lapses), sick leave
 * 14 days at half pay (up to 56 carried), maternity 26 weeks by the Social Security Code, and leave without pay.
 */
export const WEST_BENGAL_LEAVE: readonly LeaveType[] = [
	{
		key: 'EL',
		name: 'Earned leave',
		paid: 'full',
		active: true,
		rules: [
			yearRule({
				// The OSH Code (s.32) counts annual leave by calendar year: days worked in one year earn leave in the next.
				year: { startMonth: 1, months: 12 },
				credit: { kind: 'per_days_worked', every: 20, give: 1 },
				waitDays: 180,
				joiners: 'none',
				carryMax: 30,
				aboveCap: 'encash',
				encash: { onLeaving: true, onRequestMax: null, dayPay: 'month_days' },
			}),
		],
	},
	{
		key: 'CL',
		name: 'Casual leave',
		paid: 'full',
		active: true,
		rules: [yearRule({ credit: { kind: 'year_start', days: 10 } })],
	},
	{
		key: 'SL',
		name: 'Sick leave',
		paid: 'half',
		active: true,
		rules: [yearRule({ credit: { kind: 'year_start', days: 14 }, carryMax: 56 })],
	},
	{
		key: 'ML',
		name: 'Maternity leave',
		paid: 'full',
		active: true,
		rules: [yearRule({ credit: { kind: 'on_request', days: 182 }, waitDays: 80, validity: { kind: 'never' } })],
	},
	{ key: 'LOP', name: 'Leave without pay', paid: 'unpaid', active: true, rules: [yearRule({ rounding: 'none' })] },
];
