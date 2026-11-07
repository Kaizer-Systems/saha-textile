import type { DashboardPeriodQuery, DashboardRange } from '@saha-textile/contracts';

/**
 * The shop works in India time, which has no daylight saving, so one fixed offset is exact.
 * A day or month on the admin home page always starts at midnight there, not at UTC midnight.
 */
const INDIA_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A UTC instant for midnight on a calendar day in India. Out-of-range parts roll over. */
function indiaMidnight(year: number, month: number, day: number): Date {
	return new Date(Date.UTC(year, month, day) - INDIA_OFFSET_MS);
}

/** The calendar fields of an instant, as read on a clock in India. */
function indiaCalendar(instant: Date): { year: number; month: number; day: number; weekday: number } {
	const shifted = new Date(instant.getTime() + INDIA_OFFSET_MS);
	return {
		year: shifted.getUTCFullYear(),
		month: shifted.getUTCMonth(),
		day: shifted.getUTCDate(),
		weekday: shifted.getUTCDay(),
	};
}

function range(from: Date, to: Date): DashboardRange {
	return { from: from.toISOString(), to: to.toISOString() };
}

function customRange(fromDay: string, toDay: string): DashboardRange {
	const start = new Date(`${fromDay}T00:00:00.000Z`).getTime() - INDIA_OFFSET_MS;
	const end = new Date(`${toDay}T00:00:00.000Z`).getTime() - INDIA_OFFSET_MS + DAY_MS;
	return range(new Date(start), new Date(end));
}

/**
 * Turns a period choice into the exact instants to read: `from` inclusive, `to` exclusive.
 *
 * `last_12_months` is this calendar month and the eleven before it, so the Total Revenue tile
 * and the Monthly Revenue chart add up to the same figure. Quarters are calendar quarters and
 * a week starts on Monday. Periods that are still running end at `now`.
 */
export function resolveDashboardPeriod(query: DashboardPeriodQuery, now: Date): DashboardRange {
	const { year, month, day, weekday } = indiaCalendar(now);
	const quarterStart = month - (month % 3);

	switch (query.period) {
		case 'custom':
			// The contract refuses a custom period without both days.
			return customRange(query.from as string, query.to as string);
		case 'last_30_days':
			return range(indiaMidnight(year, month, day - 29), now);
		case 'last_month':
			return range(indiaMidnight(year, month - 1, 1), indiaMidnight(year, month, 1));
		case 'last_quarter':
			return range(indiaMidnight(year, quarterStart - 3, 1), indiaMidnight(year, quarterStart, 1));
		case 'current_quarter':
			return range(indiaMidnight(year, quarterStart, 1), now);
		case 'today':
			return range(indiaMidnight(year, month, day), now);
		case 'last_week': {
			const thisMonday = day - ((weekday + 6) % 7);
			return range(indiaMidnight(year, month, thisMonday - 7), indiaMidnight(year, month, thisMonday));
		}
		case 'this_year':
			return range(indiaMidnight(year, 0, 1), now);
		case 'last_12_months':
			return range(indiaMidnight(year, month - 11, 1), now);
	}
}

/** The twelve `YYYY-MM` months of the chart, oldest first, ending with this month in India. */
export function dashboardChartMonths(now: Date): string[] {
	const { year, month } = indiaCalendar(now);
	return Array.from({ length: 12 }, (_, index) => {
		const date = new Date(Date.UTC(year, month - 11 + index, 1));
		return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
	});
}
