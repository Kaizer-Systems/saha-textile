import { describe, expect, it } from 'vitest';

import { countdownParts, formatIst } from '../src/catalog/ist-time';

describe('India time for shoppers', () => {
	it('writes the same fixed IST text for every shopper', () => {
		expect(formatIst('2027-09-27T18:29:00.000Z', 'en')).toBe('27 Sep 2027, 11:59 PM IST');
		expect(formatIst('2027-09-01T04:30:00.000Z', 'en')).toBe('1 Sep 2027, 10:00 AM IST');
		expect(formatIst('2027-09-27T18:29:00.000Z', 'bn')).toBe('27 সেপ্টেম্বর 2027, রাত 11:59 IST');
		expect(formatIst('2027-09-01T04:30:00.000Z', 'bn')).toBe('1 সেপ্টেম্বর 2027, সকাল 10:00 IST');
	});

	it('counts long waits in days', () => {
		expect(countdownParts(64 * 86_400_000 + 3_661_000)).toEqual({ days: 64, hours: 1, minutes: 1, seconds: 1 });
		expect(countdownParts(-5)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
	});
});
