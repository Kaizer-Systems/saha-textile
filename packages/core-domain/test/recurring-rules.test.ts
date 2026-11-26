import { describe, expect, it } from 'vitest';

import { dayAfter, dayInMonth, firstOnOrAfter, nextAfter } from '../src/assets/recurring-rules';

/** Rent and recurring entries (accounts brief R5): the days a schedule falls on, a day of the month or its last day. */

describe('a schedule’s day in a month', () => {
	it('falls on the day of the month asked for', () => {
		expect(dayInMonth('monthDay', 1, '2026-11')).toBe('2026-11-01');
		expect(dayInMonth('monthDay', 28, '2027-02')).toBe('2027-02-28');
		expect(dayInMonth('monthDay', 5, '2026-12')).toBe('2026-12-05');
	});

	it('falls on the month’s last day, 28 or 29 February, 30 or 31 otherwise', () => {
		expect(dayInMonth('monthEnd', 1, '2027-02')).toBe('2027-02-28');
		expect(dayInMonth('monthEnd', 1, '2028-02')).toBe('2028-02-29');
		expect(dayInMonth('monthEnd', 1, '2100-02')).toBe('2100-02-28');
		expect(dayInMonth('monthEnd', 1, '2000-02')).toBe('2000-02-29');
		expect(dayInMonth('monthEnd', 1, '2026-11')).toBe('2026-11-30');
		expect(dayInMonth('monthEnd', 1, '2026-12')).toBe('2026-12-31');
	});
});

describe('the first day on or after a start', () => {
	it('is this month’s day when it has not passed, the start itself included', () => {
		expect(firstOnOrAfter('monthDay', 10, '2026-11-03')).toBe('2026-11-10');
		expect(firstOnOrAfter('monthDay', 10, '2026-11-10')).toBe('2026-11-10');
		expect(firstOnOrAfter('monthEnd', 1, '2026-11-30')).toBe('2026-11-30');
	});

	it('is next month’s day when this month’s has passed, across a year’s end', () => {
		expect(firstOnOrAfter('monthDay', 10, '2026-11-11')).toBe('2026-12-10');
		expect(firstOnOrAfter('monthDay', 1, '2026-12-02')).toBe('2027-01-01');
		expect(firstOnOrAfter('monthEnd', 1, '2028-01-31')).toBe('2028-01-31');
	});
});

describe('the next day after one made', () => {
	it('is next month’s day after this month’s', () => {
		expect(nextAfter('monthDay', 10, '2026-11-10')).toBe('2026-12-10');
		expect(nextAfter('monthDay', 1, '2026-12-01')).toBe('2027-01-01');
	});

	it('moves month ends through the short months', () => {
		expect(nextAfter('monthEnd', 1, '2028-01-31')).toBe('2028-02-29');
		expect(nextAfter('monthEnd', 1, '2028-02-29')).toBe('2028-03-31');
		expect(nextAfter('monthEnd', 1, '2026-12-31')).toBe('2027-01-31');
	});

	it('is this month’s day when the last one was made earlier in the month', () => {
		expect(nextAfter('monthDay', 20, '2026-11-05')).toBe('2026-11-20');
	});
});

describe('the day after', () => {
	it('runs across a month’s end, a leap February and a year’s end', () => {
		expect(dayAfter('2026-11-14')).toBe('2026-11-15');
		expect(dayAfter('2026-11-30')).toBe('2026-12-01');
		expect(dayAfter('2028-02-28')).toBe('2028-02-29');
		expect(dayAfter('2027-02-28')).toBe('2027-03-01');
		expect(dayAfter('2026-12-31')).toBe('2027-01-01');
	});
});
