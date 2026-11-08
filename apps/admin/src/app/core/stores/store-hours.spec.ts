import { displayPhone as sharedPhone, summariseStoreHours as shared } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { WEEKDAYS, displayPhone, summariseStoreHours } from './store-hours';

const week = (pattern: Record<string, [string, string] | null>, fallback: [string, string] | null) =>
	WEEKDAYS.map((day) => {
		const value = day in pattern ? pattern[day] : fallback;
		return value
			? { day, open: true, opens: value[0], closes: value[1] }
			: { day, open: false, opens: null, closes: null };
	});

const cases = [
	week({ sun: null }, ['10:00', '20:30']),
	week({}, ['10:00', '21:00']),
	week({}, null),
	week({ sat: ['10:30', '21:00'], sun: ['11:00', '18:00'] }, ['10:30', '20:00']),
	week({ tue: null, thu: null }, ['10:00', '20:00']),
];

describe('summariseStoreHours (admin copy)', () => {
	it.each(['en', 'bn', 'xx'])('gives the same line as the shared contract in %s', (locale) => {
		for (const hours of cases) expect(summariseStoreHours(hours, locale)).toBe(shared(hours, locale));
	});

	it('reads the usual week as the owner wrote it', () => {
		expect(summariseStoreHours(cases[0] ?? [], 'en')).toBe('Mon–Sat 10:00–20:30, Sun closed');
	});

	it('groups phones the same way as the shared contract', () => {
		for (const phone of ['+919836663137', '+913325521595', '+913812345678', '+441234567890']) {
			expect(displayPhone(phone)).toBe(sharedPhone(phone));
		}
	});
});
