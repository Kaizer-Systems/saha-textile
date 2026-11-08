import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
	injectBlogsQuery: (p: () => unknown) => (p(), { data: blogs }),
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
const settle = async () => {
	await new Promise((done) => setTimeout(done, 0));
};
const months = { months: [{ month: '2026-10', revenueINR: 900 }] };

afterEach(() => {
	for (const value of [
		blogs,
		statistics,
		commission,
		categories,
		stores,
		revenue,
		monthly,
		orders,
		recent,
		customers,
		top,
		stock,
		reviews,
	])
		value.set(undefined);
	fetching.set(false);
	apex.created.length = 0;
	apex.render.mockClear();
	apex.updateOptions.mockClear();
	document.body.classList.remove('loader-none');
});

describe('Dashboard permissions', () => {
	const QUERIES = [
		['revenue', 'dashboard.revenue'],
		['monthly', 'dashboard.revenue'],
		['orders', 'dashboard.orders'],
		['recent', 'dashboard.orders'],
		['customers', 'dashboard.customers'],
		['top', 'dashboard.top_products'],
		['stock', 'dashboard.stock'],
		['reviews', 'dashboard.reviews'],
		['categories', 'category.index'],
	] as const;

	it.each(QUERIES)('%s asks for its data only with %s', (name, code) => {
		render({ permissions: [code] });
		expect(asked.enabled[name]?.()).toBe(true);
		render({ permissions: ['order.index', 'product.index', 'review.index', 'customer.index'] });
		expect(asked.enabled[name]?.()).toBe(false);
	});

	it('says so when nothing is granted', () => {
		const { page, held } = render();
		expect(page.hasAnyWidget()).toBe(false);
		held.set(['blog.index']);
		expect(page.hasAnyWidget()).toBe(true);
	});
});

describe('Dashboard data', () => {
	it('starts empty', async () => {
		const { page } = render();
		expect(page.blogs()).toEqual([]);
		expect(page.revenue()).toBeUndefined();
		expect(page.orderCount()).toBeUndefined();
		expect(page.customerCount()).toBeUndefined();
		expect(page.topProducts()).toEqual([]);
		expect(page.reviews()).toEqual([]);
		expect(page.orderTableConfig().data).toEqual([]);
		expect(page.productStockTableConfig().data).toEqual([]);
		expect(page.activeStores()).toBe(0);
		expect(await firstValueFrom(page.category$)).toEqual([]);
	});

	it('reads the tiles', () => {
		const { page } = render();
		revenue.set({ revenueINR: 37000 });
		orders.set({ orders: 5 });
		customers.set({ customers: 78 });
		expect(page.revenue()).toBe(37000);
		expect(page.orderCount()).toBe(5);
		expect(page.customerCount()).toBe(78);
	});

	it('gives each tile its own period', () => {
		const { page } = render();
		expect(asked.inputs['revenue']?.()).toEqual({ period: 'last_12_months' });
		page.revenuePeriod.set({ period: 'last_month' });
		expect(asked.inputs['revenue']?.()).toEqual({ period: 'last_month' });
		expect(asked.inputs['orders']?.()).toEqual({ period: 'last_12_months' });
	});

	it('lays out the recent orders, with a guest as a dash', () => {
		const { page } = render();
		const order = { id: 'o', orderNumber: 'N1', placedAt: 'd', totalINR: 10, status: 'paid' };
		recent.set({
			items: [
				{ ...order, customerName: 'Asha' },
				{ ...order, customerName: null },
			],
		});
		TestBed.tick();
		expect(page.orderTableConfig().total).toBe(2);
		expect(page.orderTableConfig().data[0]).toMatchObject({
			order_number: 'N1',
			order_id: '<span class="fw-bolder">#N1</span>',
			consumer_name: 'Asha',
			total: 10,
			order_payment_status: '<div class="status-paid"><span>paid</span></div>',
		});
		expect(page.orderTableConfig().data[1]).toMatchObject({ consumer_name: '-' });
	});

	it('lays out the stock report in the admin language', () => {
		const { page } = render();
		const row = { productId: 'p', sku: 'S', quantity: 0, state: 'out_of_stock' };
		stock.set({
			items: [
				{ ...row, title: { en: 'Silk', bn: 'সিল্ক' }, thumbnailUrl: 'i.png' },
				{ ...row, title: { en: 'Silk' }, thumbnailUrl: null },
			],
		});
		TestBed.tick();
		expect(page.productStockTableConfig().total).toBe(2);
		expect(page.productStockTableConfig().data[0]).toMatchObject({
			id: 'p',
			name: 'সিল্ক (S)',
			product_thumbnail: { original_url: 'i.png' },
			stock: '<div class="status-out_of_stock"><span>t:out_of_stock</span></div>',
		});
		expect(page.productStockTableConfig().data[1]).toMatchObject({ name: 'Silk (S)', product_thumbnail: null });
	});

	// A mutated object never reached the table when no other widget redrew the page.
	it('hands the tables a new config when rows arrive, keeping what the table cleared', () => {
		const { page } = render();
		const before = page.productStockTableConfig();
		before.rowActions = [];
		stock.set({ items: [] });
		TestBed.tick();
		expect(page.productStockTableConfig()).not.toBe(before);
		expect(page.productStockTableConfig().rowActions).toEqual([]);
	});

	it('counts the active stores and keeps the demo blog widget working', () => {
		const { page } = render();
		stores.set([{ store: { active: true } }, { store: { active: false } }, { store: { active: true } }]);
		blogs.set({ data: [{ id: 1 }] });
		TestBed.tick();
		expect(page.activeStores()).toBe(2);
		expect(page.blogs()).toHaveLength(1);
		expect(asked.enabled['stores']?.()).toBe(false);
	});

	it('lists the categories, with a fallback image', async () => {
		const { page } = render();
		categories.set({
			data: [
				{ id: 1, name: 'A', slug: 'a', category_icon: { original_url: 'i.png' } },
				{ id: 2, name: 'B', slug: 'b' },
			],
		});
		TestBed.tick();
		expect(await firstValueFrom(page.category$)).toMatchObject([
			{ data: { image: 'i.png' } },
			{ data: { image: 'assets/images/category.png' } },
		]);
	});

	it('mirrors the fetch state', () => {
		const { page } = render();
		fetching.set(true);
		TestBed.tick();
		expect(page.topProductLoader()).toBe(true);
		expect(page.productStockLoader()).toBe(true);
	});
});

describe('Dashboard chart', () => {
	it('draws real revenue, then updates it', async () => {
		const { page } = render();
		monthly.set(months);
		TestBed.tick();
		await settle();
		expect(page.chartOptions.series?.[0]).toMatchObject({ name: 'Revenue', data: [900] });
		expect(apex.created).toHaveLength(1);
		expect(apex.render).toHaveBeenCalledOnce();
		monthly.set({ months: [{ month: '2026-11', revenueINR: 5 }] });
		TestBed.tick();
		expect(apex.updateOptions).toHaveBeenCalledOnce();
	});

	it('labels months in the admin language', async () => {
		const { page } = render();
		monthly.set(months);
		TestBed.tick();
		await settle();
		// Bengali month name, English digits (BN-3).
		expect(page.chartOptions.xaxis?.categories).toEqual(["অক্টোঃ '26"]);
	});

	it('keeps the demo commission line, cut to the months shown', async () => {
		const { page } = render();
		commission.set({ commissions: [30, 60, 90] });
		monthly.set(months);
		TestBed.tick();
		await settle();
		expect(page.chartOptions.series?.[1]).toMatchObject({ data: [30] });
	});

	it('draws nothing on the server', async () => {
		render({ platform: 'server' });
		monthly.set(months);
		TestBed.tick();
		await settle();
		expect(apex.created).toEqual([]);
	});

	it('draws nothing while the chart is hidden', async () => {
		render({ template: '' });
		monthly.set(months);
		TestBed.tick();
		await settle();
		expect(apex.created).toEqual([]);
	});

	it('waits for the element when the data arrives first', async () => {
		monthly.set(months);
		const { page } = render();
		await settle();
		expect(page.chartOptions).toBeDefined();
		expect(apex.created).toHaveLength(1);
	});

	it('draws nothing without data', async () => {
		render();
		await settle();
		expect(apex.created).toEqual([]);
	});
});

describe('Dashboard actions', () => {
	const pick = (value: unknown) => ({ value }) as never;

	it('filters the top products, defaulting to this year', () => {
		const { page } = render();
		page.filterTopProduct(pick('today'));
		expect(asked.inputs['top']?.()).toEqual({ period: 'today' });
		page.filterTopProduct(pick(''));
		expect(asked.inputs['top']?.()).toEqual({ period: 'this_year' });
		expect(document.body.classList.contains('loader-none')).toBe(true);
	});

	it('filters the stock table by category', () => {
		const { page } = render();
		page.filterProduct(pick(3));
		expect(asked.inputs['stock']?.()).toBe('3');
		page.filterProduct(pick(''));
		expect(asked.inputs['stock']?.()).toBeUndefined();
	});

	it('opens an order or a product, and nothing else', () => {
		const { page, router } = render();
		page.onOrderActionClicked({ actionToPerform: 'view', data: { order_number: 7 } } as never);
		expect(router.navigateByUrl).toHaveBeenLastCalledWith('/order/details/7');
		page.onProductActionClicked({ actionToPerform: 'edit', data: { id: 3 } } as never);
		expect(router.navigateByUrl).toHaveBeenLastCalledWith('/product/edit/3');
		page.onOrderActionClicked({ actionToPerform: 'other', data: {} } as never);
		page.onProductActionClicked({ actionToPerform: 'other', data: {} } as never);
		expect(router.navigateByUrl).toHaveBeenCalledTimes(2);
	});

	it('removes the body class when leaving', () => {
		const { fixture } = render();
		document.body.classList.add('loader-none');
		fixture.destroy();
		expect(document.body.classList.contains('loader-none')).toBe(false);
	});
});
