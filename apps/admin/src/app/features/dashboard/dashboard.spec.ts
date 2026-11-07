import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';

import { Dashboard } from './dashboard';

const blogs = signal<unknown>(undefined);
const statistics = signal<unknown>(undefined);
const revenue = signal<unknown>(undefined);
const orders = signal<unknown>(undefined);
const products = signal<unknown>(undefined);
const reviews = signal<unknown>(undefined);
const categories = signal<unknown>(undefined);
const stores = signal<unknown>(undefined);
const fetching = signal(false);
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
vi.mock('@data-access/queries/dashboard.queries', () => ({
	injectStatisticsQuery: () => ({ data: statistics }),
	injectRevenueChartQuery: () => ({ data: revenue }),
}));
vi.mock('@data-access/queries/order.queries', () => ({
	injectOrdersQuery: (p: () => unknown) => (p(), { data: orders }),
}));
vi.mock('@data-access/queries/product.queries', () => ({
	injectProductsQuery: (p: () => unknown) => (p(), { data: products, isFetching: fetching }),
}));
vi.mock('@data-access/queries/review.queries', () => ({
	injectReviewsQuery: (p: () => unknown) => (p(), { data: reviews }),
}));
vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: (p: () => unknown) => (p(), { data: categories }),
}));
vi.mock('@data-access/queries/store.queries', () => ({
	injectStoresQuery: (p: () => unknown) => (p(), { data: stores, isFetching: fetching }),
}));

const render = (platform = 'browser') => {
	const router = { navigateByUrl: vi.fn() };
	const user = signal<unknown>(null);
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: Router, useValue: router },
			{ provide: AuthStore, useValue: { user } },
			{ provide: PLATFORM_ID, useValue: platform },
		],
	});
	TestBed.overrideComponent(Dashboard, { set: { imports: [], template: '<div #chart></div>' } });
	const fixture = TestBed.createComponent(Dashboard);
	fixture.detectChanges();
	TestBed.tick();
	return { fixture, page: fixture.componentInstance, router, user };
};
const settle = async () => {
	await new Promise((done) => setTimeout(done, 0));
};
const chart = { revenues: [1], commissions: [2], months: ['Jan'] };

afterEach(() => {
	for (const value of [blogs, statistics, revenue, orders, products, reviews, categories, stores])
		value.set(undefined);
	fetching.set(false);
	apex.created.length = 0;
	apex.render.mockClear();
	apex.updateOptions.mockClear();
	document.body.classList.remove('loader-none');
});

describe('Dashboard data', () => {
	it('starts empty', async () => {
		const { page } = render();
		expect(page.blogs()).toEqual([]);
		expect(page.orderTableConfig.data).toEqual([]);
		expect(page.productStockTableConfig.data).toEqual([]);
		expect(page.sellerTableConfig.data).toEqual([]);
		expect(await firstValueFrom(page.topProduct$)).toEqual([]);
		expect(await firstValueFrom(page.category$)).toEqual([]);
		expect(page.isVendor()).toBe(false);
	});

	it('knows a vendor', () => {
		const { page, user } = render();
		user.set({ role: 'vendor' });
		expect(page.isVendor()).toBe(true);
	});

	it('decorates the orders, products and sellers', () => {
		const { page } = render();
		orders.set({
			data: [
				{ order_number: 7, payment_status: 'PENDING', consumer: { name: 'Asha' } },
				{ order_number: 8, consumer: { name: 'Bina' } },
			],
			total: 2,
		});
		products.set({
			data: [{ stock_status: 'out_of_stock' }, {}],
			total: 2,
		});
		stores.set({ data: [{ id: 1 }], total: 1 });
		blogs.set({ data: [{ id: 1 }] });
		TestBed.tick();
		expect(page.orderTableConfig.data[0]).toMatchObject({ order_id: '<span class="fw-bolder">#7</span>' });
		expect(page.orderTableConfig.data[1]).toMatchObject({ order_payment_status: '-' });
		expect(page.productStockTableConfig.data[0]).toMatchObject({
			stock: '<div class="status-out_of_stock"><span>out of stock</span></div>',
		});
		expect(page.productStockTableConfig.data[1]).toMatchObject({ stock: '-' });
		expect(page.sellerTableConfig.total).toBe(1);
		expect(page.blogs()).toHaveLength(1);
	});

	it('copes with answers that have no rows', () => {
		const { page } = render();
		stores.set({ total: 0 });
		TestBed.tick();
		expect(page.sellerTableConfig.data).toBeUndefined();
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

	it('keeps seven top products', async () => {
		const { page } = render();
		products.set({ data: Array.from({ length: 9 }, (_, id) => ({ id })), total: 9 });
		TestBed.tick();
		expect(await firstValueFrom(page.topProduct$)).toHaveLength(7);
	});

	it('mirrors the fetch state', () => {
		const { page } = render();
		fetching.set(true);
		TestBed.tick();
		expect(page.topSellerLoader).toBe(true);
		expect(page.topProductLoader).toBe(true);
		expect(page.productStockLoader).toBe(true);
	});
});

describe('Dashboard chart', () => {
	it('draws once the view and data are ready, then updates it', async () => {
		const { page } = render();
		revenue.set(chart);
		TestBed.tick();
		await settle();
		expect(page.chartOptions.series).toHaveLength(2);
		expect(apex.created).toHaveLength(1);
		expect(apex.render).toHaveBeenCalledOnce();
		revenue.set({ ...chart, months: ['Feb'] });
		TestBed.tick();
		expect(apex.updateOptions).toHaveBeenCalledOnce();
	});

	it('draws nothing on the server', async () => {
		render('server');
		revenue.set(chart);
		TestBed.tick();
		await settle();
		expect(apex.created).toEqual([]);
	});

	it('waits for the view when the data arrives first', async () => {
		revenue.set(chart);
		const { page } = render();
		await settle();
		expect(page.chartOptions).toBeDefined();
		expect(apex.created).toHaveLength(1);
	});
});

describe('Dashboard actions', () => {
	const pick = (value: unknown) => ({ value }) as never;

	it('filters the top products', () => {
		const { page } = render();
		page.filterTopProduct(pick('today'));
		page.filterTopProduct(pick(''));
		expect(document.body.classList.contains('loader-none')).toBe(true);
	});

	it('pins the order and product table sizes', () => {
		const { page } = render();
		const orderParams: Record<string, unknown> = {};
		page.onOrderTableChange(orderParams);
		expect(orderParams['paginate']).toBe(7);
		page.onOrderTableChange();
		const productParams: Record<string, unknown> = {};
		page.onProductTableChange(productParams);
		expect(productParams).toMatchObject({ paginate: 8, field: 'quantity', sort: 'asc' });
		page.onProductTableChange();
	});

	it('filters the stock table by category', () => {
		const { page } = render();
		page.filterProduct(pick(3));
		expect(page.productStockLoader).toBe(true);
		page.filterProduct(pick(''));
	});

	it('fills in the seller defaults only when needed', () => {
		const { page } = render();
		const bare: Record<string, unknown> = {};
		page.onSellerTableChange(bare);
		expect(bare).toMatchObject({ paginate: 6, top_vendor: 1, filter_by: 'this_year' });
		const chosen: Record<string, unknown> = { filter_by: 'today' };
		page.onSellerTableChange(chosen);
		expect(chosen).toEqual({ filter_by: 'today' });
		page.onSellerTableChange();
		page.filterSeller(pick('today'));
		page.filterSeller(pick(''));
		expect(page.topSellerLoader).toBe(true);
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
