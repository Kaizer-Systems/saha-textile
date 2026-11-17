import type { ScheduleEntry } from '@saha-textile/contracts';

/**
 * The schedule is data, read on every request (Page Builder FX-6): which revision shows now is decided from the
 * entries and the server's clock, never by a job having run. Entries are stored in UTC.
 */

const at = (iso: string): number => Date.parse(iso);

/** Entries showing at `now`: started, and not ended. */
function active(schedule: readonly ScheduleEntry[], now: Date): ScheduleEntry[] {
	const time = now.getTime();
	return schedule.filter((entry) => at(entry.from) <= time && (entry.until === null || time < at(entry.until)));
}

/**
 * The entry showing at `now`. When entries overlap, the later start wins, so a switch with an end hands back to
 * whatever started before it, by itself.
 */
export function liveEntry(schedule: readonly ScheduleEntry[], now: Date): ScheduleEntry | null {
	const showing = active(schedule, now);
	if (showing.length === 0) return null;
	return showing.reduce((best, entry) => (at(entry.from) >= at(best.from) ? entry : best));
}

/** The next moment what shows may change (a start or an end after `now`): the page's cache ends there (FX-18). */
export function nextSwitchAt(schedule: readonly ScheduleEntry[], now: Date): Date | null {
	const time = now.getTime();
	const moments = schedule
		.flatMap((entry) => [at(entry.from), entry.until === null ? Number.NaN : at(entry.until)])
		.filter((moment) => Number.isFinite(moment) && moment > time);
	return moments.length ? new Date(Math.min(...moments)) : null;
}

/** Entries that overlap another entry's time, for the "the later start wins" warning in the list. */
export function overlappingEntries(schedule: readonly ScheduleEntry[]): ScheduleEntry[] {
	const end = (entry: ScheduleEntry) => (entry.until === null ? Number.POSITIVE_INFINITY : at(entry.until));
	return schedule.filter((entry) =>
		schedule.some(
			(other) =>
				other !== entry &&
				other.until !== null &&
				entry.until !== null &&
				at(other.from) < end(entry) &&
				at(entry.from) < end(other),
		),
	);
}
