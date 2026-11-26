import { describe, expect, it } from 'vitest';

import { accountsHint, accountsRange, rangeText } from './accounts-period';

/** The accounts lists' periods (accounts brief A): India days, the financial year from 1 April. */

const nov = new Date('2026-11-23T10:00:00+05:30');
const feb = new Date('2027-02-10T10:00:00+05:30');

describe('accounts periods', () => {
	it('works out each period on 23 Nov 2026', () => {
		const range = (period: Parameters<typeof accountsRange>[0]['period']) => accountsRange({ period }, nov);
		expect(range('today')).toEqual({ from: '2026-11-23', to: '2026-11-23' });
		expect(range('last_7_days')).toEqual({ from: '2026-11-17', to: '2026-11-23' });
		expect(range('last_30_days')).toEqual({ from: '2026-10-24', to: '2026-11-23' });
		expect(range('this_month')).toEqual({ from: '2026-11-01', to: '2026-11-23' });
		expect(range('last_month')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
		expect(range('current_quarter')).toEqual({ from: '2026-10-01', to: '2026-11-23' });
		expect(range('last_quarter')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
		expect(range('this_fy')).toEqual({ from: '2026-04-01', to: '2026-11-23' });
		expect(range('last_fy')).toEqual({ from: '2025-04-01', to: '2026-03-31' });
		expect(range('last_12_months')).toEqual({ from: '2025-11-24', to: '2026-11-23' });
	});

	it('crosses the year in January to March, and takes a custom range as typed', () => {
		expect(accountsRange({ period: 'this_fy' }, feb)).toEqual({ from: '2026-04-01', to: '2027-02-10' });
		expect(accountsRange({ period: 'last_fy' }, feb)).toEqual({ from: '2025-04-01', to: '2026-03-31' });
		expect(accountsRange({ period: 'last_quarter' }, feb)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
		expect(accountsRange({ period: 'last_month' }, feb)).toEqual({ from: '2027-01-01', to: '2027-01-31' });
		expect(accountsRange({ period: 'custom', from: '2026-10-12', to: '2026-11-23' }, nov)).toEqual({
			from: '2026-10-12',
			to: '2026-11-23',
		});
		expect(accountsRange({ period: 'custom' }, nov)).toEqual({ from: '2026-11-23', to: '2026-11-23' });
		expect(accountsRange({ period: 'this_month' })).toHaveProperty('from');
	});

	it('says the days a period covers in the menu', () => {
		expect(rangeText({ from: '2026-10-24', to: '2026-11-23' })).toBe('24 Oct – 23 Nov 2026');
		expect(rangeText({ from: '2025-04-01', to: '2026-03-31' })).toBe('1 Apr 2025 – 31 Mar 2026');
		expect(rangeText({ from: '2026-11-23', to: '2026-11-23' })).toBe('23 Nov 2026');
		expect(accountsHint('last_quarter', nov)).toBe('1 Jul – 30 Sep 2026');
		expect(accountsHint('custom', nov)).toBeNull();
		expect(typeof accountsHint('today')).toBe('string');
	});
});
