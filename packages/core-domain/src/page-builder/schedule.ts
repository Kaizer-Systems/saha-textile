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
	// Read only for entries with an end (the filter checks both first).
	const end = (entry: ScheduleEntry) => at(entry.until as string);
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

export type LayoutScheduleStatus = 'live' | 'scheduled' | 'draft' | 'ended';

/**
 * Where a layout stands at `now`, as Home's layout cards show it (A1): live (what shoppers see), scheduled (it shows
 * later, or again after a switch hands back), ended (it showed and nothing brings it back), or draft (never on the
 * schedule). `from`/`until` are the times of the entry that decides it.
 */
export function layoutStatus(
	layoutId: string,
	schedule: readonly ScheduleEntry[],
	now: Date,
): { status: LayoutScheduleStatus; from: string | null; until: string | null } {
	const mine = schedule.filter((entry) => entry.layoutId === layoutId);
	if (mine.length === 0) return { status: 'draft', from: null, until: null };
	const live = liveEntry(schedule, now);
	if (live?.layoutId === layoutId) return { status: 'live', from: live.from, until: live.until };
	const time = now.getTime();
	const coming = mine
		.filter((entry) => at(entry.from) > time || entry.until === null || at(entry.until) > time)
		.sort((a, b) => at(a.from) - at(b.from));
	const next = coming[0];
	if (next) return { status: 'scheduled', from: next.from, until: next.until };
	const last = [...mine].sort((a, b) => at(b.from) - at(a.from))[0] as ScheduleEntry;
	return { status: 'ended', from: last.from, until: last.until };
}

/** One stretch of time during which one schedule entry was what shoppers saw (SG-23). */
export interface LivePeriod {
	readonly entry: ScheduleEntry;
	readonly from: string;
	/** Null: still showing at `now`. */
	readonly until: string | null;
}

/**
 * Who was live when, up to `now`, newest first (SG-23 "sales by schedule"): the timeline cut at every start and end,
 * each piece given to the entry showing then (the later start wins), and neighbouring pieces of the same entry
 * joined. Stretches with nothing showing are left out; `limit` keeps the newest.
 */
export function livePeriods(schedule: readonly ScheduleEntry[], now: Date, limit = 20): LivePeriod[] {
	const time = now.getTime();
	const cuts = [
		...new Set(
			schedule
				.flatMap((entry) => [at(entry.from), entry.until === null ? Number.NaN : at(entry.until)])
				.filter((moment) => Number.isFinite(moment) && moment <= time),
		),
	].sort((a, b) => a - b);
	const periods: { entry: ScheduleEntry; from: number; until: number | null }[] = [];
	cuts.forEach((start, index) => {
		const end = cuts[index + 1] ?? null;
		const entry = liveEntry(schedule, new Date(start));
		if (!entry) return;
		const last = periods.at(-1);
		if (last && last.entry === entry && last.until === start) last.until = end;
		else periods.push({ entry, from: start, until: end });
	});
	return periods
		.reverse()
		.slice(0, limit)
		.map((period) => ({
			entry: period.entry,
			from: new Date(period.from).toISOString(),
			until: period.until === null ? null : new Date(period.until).toISOString(),
		}));
}
