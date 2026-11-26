import type { ScheduleEntry } from '@saha-textile/contracts';

/**
 * Cache warming at a switch (Page Builder FX-6, FX-8). The schedule is data, so the shop changes at the switch moment
 * without any job; the job only asks for the page in each shop language just after it, so the first shopper after a
 * switch doesn't wait for the new layout to be drawn and its pictures to be resolved.
 */

/** How long after the switch the page is asked for, so the answer is already the new one. */
export const WARM_AFTER_MS = 2_000;

/** How far ahead switches are queued: the nightly check re-queues the next day's, in case the queue lost one. */
export const WARM_HORIZON_MS = 26 * 3_600_000;

/** The shop path of each page type with one address; item and collection pages join with their own targets. */
const PAGE_PATHS: Readonly<Record<string, string>> = { home: '/' };

export const warmPath = (pageType: string): string | null => PAGE_PATHS[pageType] ?? null;

/** Every switch moment (a start or an end) after `now` and within the horizon, earliest first, each once. */
export function switchesWithin(schedule: readonly ScheduleEntry[], now: Date, horizonMs = WARM_HORIZON_MS): Date[] {
	const start = now.getTime();
	const end = start + horizonMs;
	const moments = new Set<number>();
	for (const entry of schedule) {
		for (const iso of [entry.from, entry.until]) {
			if (!iso) continue;
			const at = Date.parse(iso);
			if (at > start && at <= end) moments.add(at);
		}
	}
	return [...moments].sort((a, b) => a - b).map((at) => new Date(at));
}
