/**
 * Rent and recurring entries (accounts brief R5). Pure: the days a schedule falls on. A schedule falls on a day of the
 * month (1–28, so every month has it) or on the month's last day.
 */

const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const iso = (year: number, month: number, day: number) =>
	`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** The schedule's day in a month (`YYYY-MM`). */
export function dayInMonth(every: 'monthDay' | 'monthEnd', day: number, month: string): string {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return iso(y, m, every === 'monthEnd' ? lastDay(y, m) : day);
}

/** The first day the schedule falls on, on or after `from`. */
export function firstOnOrAfter(every: 'monthDay' | 'monthEnd', day: number, from: string): string {
	const here = dayInMonth(every, day, from.slice(0, 7));
	if (here >= from) return here;
	const [y, m] = from.split('-').map(Number) as [number, number];
	return dayInMonth(every, day, new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7));
}

/** The day after `on` the schedule next falls on. */
export function nextAfter(every: 'monthDay' | 'monthEnd', day: number, on: string): string {
	const next = new Date(Date.parse(`${on}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
	return firstOnOrAfter(every, day, next);
}

/** The day after a day (a reversal the next morning). */
export function dayAfter(on: string): string {
	return new Date(Date.parse(`${on}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
