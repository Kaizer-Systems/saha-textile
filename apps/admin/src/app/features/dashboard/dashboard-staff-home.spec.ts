import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';

import { Dashboard } from './dashboard';

const blogs = signal<unknown>(undefined);
const statistics = signal<unknown>(undefined);
const commission = signal<unknown>(undefined);
const categories = signal<unknown>(undefined);
const stores = signal<unknown>(undefined);
const revenue = signal<unknown>(undefined);
const monthly = signal<unknown>(undefined);
const orders = signal<unknown>(undefined);
const recent = signal<unknown>(undefined);
const customers = signal<unknown>(undefined);
const top = signal<unknown>(undefined);
const stock = signal<unknown>(undefined);
const reviews = signal<unknown>(undefined);
const fetching = signal(false);
const asked = vi.hoisted(() => ({
	enabled: {} as Record<string, () => boolean>,
	inputs: {} as Record<string, () => unknown>,
}));
const apex = vi.hoisted(() => ({ created: [] as unknown[][], render: vi.fn(), updateOptions: vi.fn() }));

vi.mock('apexcharts', () => ({
	default: class {
		render = apex.render;
		updateOptions = apex.updateOptions;
		constructor(...args: unknown[]) {
			apex.created.push(args);
		}
	},
}));
vi.mock('@data-access/queries/blog.queries', () => ({
	injectBlogsQuery: (p: () => unknown, enabled: () => boolean) => (
		p(),
		(asked.enabled['blogs'] = enabled),
		{ data: blogs }
	),
}));
vi.mock('@data-access/queries/dashboard.queries', () => {
	const plain = (name: string, data: () => unknown) => (enabled: () => boolean) => {
		asked.enabled[name] = enabled;
		return { data: data(), isFetching: fetching };
	};
	const withInput = (name: string, data: () => unknown) => (input: () => unknown, enabled: () => boolean) => {
		asked.enabled[name] = enabled;
		asked.inputs[name] = input;
		return { data: data(), isFetching: fetching };
	};
	return {
		injectStatisticsQuery: () => ({ data: statistics }),
		injectRevenueChartQuery: () => ({ data: commission }),
		injectDashboardRevenueQuery: withInput('revenue', () => revenue),
		injectDashboardOrdersQuery: withInput('orders', () => orders),
		injectDashboardTopProductsQuery: withInput('top', () => top),
		injectDashboardStockQuery: withInput('stock', () => stock),
		injectDashboardMonthlyRevenueQuery: plain('monthly', () => monthly),
		injectDashboardRecentOrdersQuery: plain('recent', () => recent),
		injectDashboardCustomersQuery: plain('customers', () => customers),
		injectDashboardReviewsQuery: plain('reviews', () => reviews),
	};
});
vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: (p: () => unknown, enabled: () => boolean) => (
		p(),
		(asked.enabled['categories'] = enabled),
		{ data: categories }
	),
}));
vi.mock('@core/stores/store-location.gateway', () => ({
	injectStoreLocationsQuery: (enabled: () => boolean) => (
		(asked.enabled['stores'] = enabled),
		{ data: stores, isFetching: fetching }
	),
}));

const render = ({ platform = 'browser', permissions = [] as string[], template = '<div #chart></div>' } = {}) => {
	const router = { navigateByUrl: vi.fn() };
	const held = signal<string[]>(permissions);
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: Router, useValue: router },
			{ provide: AuthStore, useValue: { permissions: held } },
			{ provide: PLATFORM_ID, useValue: platform },
			{
				provide: TranslocoService,
				useValue: { getActiveLang: () => 'bn', translate: (key: string) => `t:${key}` },
			},
		],
	});
	TestBed.overrideComponent(Dashboard, { set: { imports: [], template } });
	const fixture = TestBed.createComponent(Dashboard);
	fixture.detectChanges();
	TestBed.tick();
	return { fixture, page: fixture.componentInstance, router, held };
};

/** Brief 26 AT-D1: a shop-floor login (Staff: no dashboard widget, its own attendance) lands on My attendance. */
describe('the home page for a shop-floor login', () => {
	const landed = (router: { navigateByUrl: ReturnType<typeof vi.fn> }) =>
		router.navigateByUrl.mock.calls.filter(([url]) => url === '/payroll/my-attendance');

	it('sends someone with their own attendance and no dashboard to My attendance, in place of the home page', () => {
		const { router } = render({ permissions: ['attendance.use'] });
		expect(landed(router)).toEqual([['/payroll/my-attendance', { replaceUrl: true }]]);
	});

	it('keeps everyone else on the home page: any dashboard widget, or no attendance of their own', () => {
		for (const permissions of [['attendance.use', 'blog.index'], ['attendance.index'], []]) {
			const { router } = render({ permissions });
			expect(landed(router), permissions.join()).toEqual([]);
		}
	});

	it('sends the person on once the attendance arrives with their permissions', () => {
		const { router, held } = render();
		expect(landed(router)).toEqual([]);
		held.set(['attendance.use']);
		TestBed.tick();
		expect(landed(router)).toHaveLength(1);
	});
});

describe('the revenue chart', () => {
	it('is drawn once when new figures arrive while the chart library is still loading', async () => {
		render();
		monthly.set({ months: [{ month: '2026-10', revenueINR: 900 }] });
		TestBed.tick();
		monthly.set({ months: [{ month: '2026-11', revenueINR: 1_200 }] });
		TestBed.tick();
		await new Promise((done) => setTimeout(done, 0));
		expect(apex.created).toHaveLength(1);
		expect(apex.render).toHaveBeenCalledOnce();
		monthly.set(undefined);
		apex.created.length = 0;
		apex.render.mockClear();
	});
});
