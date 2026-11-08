import type { StoreLocation, Weekday } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { compareStoreLocations, storeLocationGaps } from '../src/stores/store-location-rules';

const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const open = WEEKDAYS.map((day) => ({ day, open: true, opens: '10:00', closes: '21:00' }));
const closedWeek = () => WEEKDAYS.map((day) => ({ day, open: false, opens: null, closes: null }));
const store = (overrides: Partial<StoreLocation> = {}) => ({
	name: { en: 'Saha Textile, Barasat', bn: 'সাহা টেক্সটাইল, বারাসাত' },
	address: { en: 'KB Basu Rd', bn: 'কে বি বসু রোড' },
	landmark: {},
	hours: open,
	...overrides,
});

describe('storeLocationGaps', () => {
	it('lets a complete store with an open day go active', () => {
		expect(storeLocationGaps(store(), ['en', 'bn'])).toEqual([]);
	});

	it('lists every missing language and a week with no open day', () => {
		const gaps = storeLocationGaps(
			store({
				name: { en: 'A' },
				address: { en: 'B', bn: ' ' },
				landmark: { en: 'Near the station' },
				hours: closedWeek(),
			}),
			['en', 'bn'],
		);
		expect(gaps).toEqual([
			{ field: 'name', locale: 'bn' },
			{ field: 'address', locale: 'bn' },
			{ field: 'landmark', locale: 'bn' },
			{ field: 'hours', locale: null },
		]);
	});

	it('asks for a Bengali landmark only once English has one', () => {
		expect(storeLocationGaps(store({ landmark: { bn: 'স্টেশনের কাছে' } }), ['en', 'bn'])).toEqual([]);
	});
});

describe('compareStoreLocations', () => {
	const row = (id: string, displayOrder: number, en?: string) => ({
		id,
		displayOrder,
		name: (en ? { en } : {}) as Record<string, string>,
	});

	it('orders by display order, then English name, then id', () => {
		const rows = [row('c', 1, 'B'), row('b', 1, 'A'), row('a', 0, 'Z'), row('e', 2), row('d', 2)];
		expect(rows.sort(compareStoreLocations).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
	});
});
