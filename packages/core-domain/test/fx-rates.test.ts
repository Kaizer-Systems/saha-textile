import { describe, expect, it } from 'vitest';

import type { Currency } from '@saha-textile/contracts';

import { applyFetchedRates, indiaClock, inrPerUnitOf, isDailyFetchDue, rateFromInrPerUnit } from '../src/fx/index';

const settings = (over: Partial<{ enabled: boolean; time: string; lastRunAt: string | null }> = {}) => ({
	dailyFetch: { enabled: true, time: '12:30', lastRunAt: null, lastError: null, ...over },
});

describe('exchange rates (brief fx01)', () => {
	it('shows and takes a rate as rupees per unit', () => {
		expect(inrPerUnitOf(1 / 88.42)).toBe(88.42);
		expect(rateFromInrPerUnit(88.42)).toBeCloseTo(0.0113096, 6);
		expect(() => rateFromInrPerUnit(0)).toThrow(RangeError);
	});

	it('reads India time', () => {
		// 07:00 UTC is 12:30 in India.
		expect(indiaClock(new Date('2026-11-19T07:00:00.000Z'))).toEqual({ date: '2026-11-19', minutes: 750 });
		// 20:00 UTC on the 19th is already the 20th in India.
		expect(indiaClock(new Date('2026-11-19T20:00:00.000Z')).date).toBe('2026-11-20');
	});

	it('fetches once a day after the set India time, catching up if missed, and never when off', () => {
		const noon = new Date('2026-11-19T06:30:00.000Z'); // 12:00 IST
		const after = new Date('2026-11-19T07:05:00.000Z'); // 12:35 IST
		expect(isDailyFetchDue(settings(), noon)).toBe(false);
		expect(isDailyFetchDue(settings(), after)).toBe(true);
		expect(isDailyFetchDue(settings({ lastRunAt: '2026-11-19T07:01:00.000Z' }), after)).toBe(false);
		// Ran yesterday: due again today.
		expect(isDailyFetchDue(settings({ lastRunAt: '2026-11-18T07:01:00.000Z' }), after)).toBe(true);
		// Fetched by hand this morning, before the set time: the daily one still runs.
		expect(isDailyFetchDue(settings({ lastRunAt: '2026-11-19T03:00:00.000Z' }), after)).toBe(true);
		expect(isDailyFetchDue(settings({ enabled: false }), after)).toBe(false);
	});

	it('applies fetched rates to the launch and stored currencies, never to rupees', () => {
		const stored: Currency[] = [
			{
				code: 'INR',
				symbol: '₹',
				enabled: true,
				rateFromINR: 1,
				paypalActive: false,
				paypalPct: 0,
				paypalFixed: 0,
				rateSetBy: null,
				rateSetById: null,
				rateSetAt: null,
			},
			{
				code: 'USD',
				symbol: '$',
				enabled: false,
				rateFromINR: 0.012,
				paypalActive: true,
				paypalPct: 0,
				paypalFixed: 0,
				rateSetBy: 'staff',
				rateSetById: 'admin-1',
				rateSetAt: null,
			},
		];
		const now = new Date('2026-11-19T07:00:00.000Z');
		const result = applyFetchedRates(stored, { INR: 1, USD: 0.01131, GBP: 0.00855, JPY: 1.8 }, now);
		expect(result.map((c) => c.code)).toEqual(['USD', 'GBP']);
		// A stored currency keeps its own symbol and its on/off; the rate and who set it change.
		expect(result[0]).toMatchObject({ symbol: '$', enabled: false, rateFromINR: 0.01131, rateSetBy: 'fetch' });
		// A launch currency gets its row the first time, switched on, with the brief's symbol.
		expect(result[1]).toMatchObject({ symbol: '£', enabled: true, rateSetAt: now.toISOString() });
	});
});
