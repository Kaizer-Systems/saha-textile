import { describe, expect, it } from 'vitest';

import { dashboardChartMonths, dashboardStockState, resolveDashboardPeriod } from '../src/dashboard/index';

/** 23:19 on Saturday 7 November 2026 in India. */
const now = new Date('2026-11-07T17:49:00.000Z');
/** A day and a month later in India than in UTC: 01:30 on 1 December there. */
const justAfterMidnight = new Date('2026-11-30T20:00:00.000Z');

const istMidnight = (day: string): string => new Date(`${day}T00:00:00.000+05:30`).toISOString();

describe('resolveDashboardPeriod', () => {
	it.each([
		['last_12_months', '2025-12-01'],
		['last_30_days', '2026-10-09'],
		['current_quarter', '2026-10-01'],
		['today', '2026-11-07'],
		['this_year', '2026-01-01'],
	] as const)('%s starts at midnight in India and ends now', (period, from) => {
		expect(resolveDashboardPeriod({ period }, now)).toEqual({ from: istMidnight(from), to: now.toISOString() });
	});

	it.each([
		['last_month', '2026-10-01', '2026-11-01'],
		['last_quarter', '2026-07-01', '2026-10-01'],
		['last_week', '2026-10-26', '2026-11-02'],
	] as const)('%s covers a whole closed period', (period, from, to) => {
		expect(resolveDashboardPeriod({ period }, now)).toEqual({ from: istMidnight(from), to: istMidnight(to) });
	});

	it('rolls into the previous year for January', () => {
		const january = new Date('2027-01-15T06:00:00.000Z');
		expect(resolveDashboardPeriod({ period: 'last_month' }, january).from).toBe(istMidnight('2026-12-01'));
		expect(resolveDashboardPeriod({ period: 'last_quarter' }, january)).toEqual({
			from: istMidnight('2026-10-01'),
			to: istMidnight('2027-01-01'),
		});
	});

	it('treats a Sunday as the end of its week', () => {
		const sunday = new Date('2026-11-08T06:00:00.000Z');
		expect(resolveDashboardPeriod({ period: 'last_week' }, sunday).from).toBe(istMidnight('2026-10-26'));
	});

	it('uses the calendar in India, not UTC', () => {
		expect(resolveDashboardPeriod({ period: 'last_month' }, justAfterMidnight)).toEqual({
			from: istMidnight('2026-11-01'),
			to: istMidnight('2026-12-01'),
		});
	});

	it('includes the whole of the last custom day', () => {
		expect(resolveDashboardPeriod({ period: 'custom', from: '2026-10-01', to: '2026-10-31' }, now)).toEqual({
			from: istMidnight('2026-10-01'),
			to: istMidnight('2026-11-01'),
		});
	});
});

describe('dashboardChartMonths', () => {
	it('lists twelve months, oldest first, ending this month', () => {
		const months = dashboardChartMonths(now);
		expect(months).toHaveLength(12);
		expect(months[0]).toBe('2025-12');
		expect(months[11]).toBe('2026-11');
	});

	it('ends on the month it is in India', () => {
		expect(dashboardChartMonths(justAfterMidnight)[11]).toBe('2026-12');
	});

	it('starts where the 12-month period starts', () => {
		const [first] = dashboardChartMonths(now);
		expect(resolveDashboardPeriod({ period: 'last_12_months' }, now).from).toBe(istMidnight(`${first}-01`));
	});
});

describe('dashboardStockState', () => {
	const state = (quantity: number, variantThreshold: number | null = null, productThreshold: number | null = null) =>
		dashboardStockState({ quantity, variantThreshold, productThreshold });

	it('calls zero or less out of stock', () => {
		expect(state(0)).toBe('out_of_stock');
		expect(state(-1)).toBe('out_of_stock');
	});

	it('uses the shop default of 2', () => {
		expect(state(2)).toBe('low_stock');
		expect(state(3)).toBe('in_stock');
	});

	it('lets the product change the limit', () => {
		expect(state(5, null, 5)).toBe('low_stock');
		expect(state(2, null, 1)).toBe('in_stock');
	});

	it('lets the variant override the product', () => {
		expect(state(5, 1, 9)).toBe('in_stock');
		expect(state(5, 5, 1)).toBe('low_stock');
	});
});
