import type { ScheduleEntry } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { WARM_HORIZON_MS, switchesWithin, warmPath } from '../src/page-builder/index';

const T0 = new Date('2026-11-17T10:00:00.000Z');
const at = (hours: number) => new Date(T0.getTime() + hours * 3_600_000).toISOString();
const entry = (from: string, until: string | null = null): ScheduleEntry => ({
	revisionId: 'rev_1',
	layoutId: 'lay_1',
	from,
	until,
	by: null,
});

describe('cache warming at a switch (FX-8)', () => {
	it('lists each start and end still ahead within the horizon, earliest first, each once', () => {
		const schedule = [entry(at(-5)), entry(at(2), at(30)), entry(at(2)), entry(at(20), at(25))];
		expect(switchesWithin(schedule, T0).map((moment) => moment.toISOString())).toEqual([at(2), at(20), at(25)]);
		expect(WARM_HORIZON_MS).toBe(26 * 3_600_000);
		expect(switchesWithin(schedule, T0, 3 * 3_600_000)).toHaveLength(1);
		expect(switchesWithin([], T0)).toEqual([]);
	});

	it('knows the one address of Home, and none for a page type without one', () => {
		expect(warmPath('home')).toBe('/');
		expect(warmPath('product')).toBeNull();
	});
});
