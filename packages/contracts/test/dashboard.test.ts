import { describe, expect, it } from 'vitest';

import { DashboardMonthlyRevenueResponse, DashboardPeriodQuery, DashboardStockQuery } from '../src/dashboard';

describe('DashboardPeriodQuery', () => {
	it('defaults to the last 12 months', () => {
		expect(DashboardPeriodQuery.parse({})).toEqual({ period: 'last_12_months' });
	});

	it('takes a preset with no dates', () => {
		expect(DashboardPeriodQuery.parse({ period: 'current_quarter' }).period).toBe('current_quarter');
	});

	it('refuses a period it does not know', () => {
		expect(DashboardPeriodQuery.safeParse({ period: 'everything' }).success).toBe(false);
	});

	it('takes a custom period with both days', () => {
		const custom = { period: 'custom', from: '2026-01-01', to: '2026-03-31' };
		expect(DashboardPeriodQuery.parse(custom)).toEqual(custom);
	});

	it.each([
		['no days', {}],
		['only a start', { from: '2026-01-01' }],
		['only an end', { to: '2026-01-01' }],
		['a start after the end', { from: '2026-02-01', to: '2026-01-01' }],
		['something that is not a day', { from: 'soon', to: '2026-01-01' }],
	])('refuses a custom period with %s', (_name, days) => {
		expect(DashboardPeriodQuery.safeParse({ period: 'custom', ...days }).success).toBe(false);
	});

	it('allows exactly 24 months and refuses a day more', () => {
		const from = '2024-01-15';
		expect(DashboardPeriodQuery.safeParse({ period: 'custom', from, to: '2026-01-15' }).success).toBe(true);
		expect(DashboardPeriodQuery.safeParse({ period: 'custom', from, to: '2026-01-16' }).success).toBe(false);
	});
});

describe('dashboard shapes', () => {
	it('takes a category on the stock report, or none', () => {
		expect(DashboardStockQuery.parse({})).toEqual({});
		expect(DashboardStockQuery.parse({ categoryId: 'cat_1' })).toEqual({ categoryId: 'cat_1' });
	});

	it('holds a month as YYYY-MM', () => {
		const months = (month: string) =>
			DashboardMonthlyRevenueResponse.safeParse({ months: [{ month, revenueINR: 0 }] });
		expect(months('2026-11').success).toBe(true);
		expect(months('Nov 26').success).toBe(false);
	});
});
