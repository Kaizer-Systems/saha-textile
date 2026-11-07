import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Store } from '@ngrx/store';
import { firstValueFrom, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LoaderStore } from '@core/state/loader.store';

import { CreateOrder } from './create-order';

const products = signal<unknown>(undefined);
const fetching = signal(false);
const productParams: Array<() => Record<string, unknown>> = [];

vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: (p: () => unknown) => (p(), { data: signal(undefined) }),
}));
vi.mock('@data-access/queries/product.queries', () => ({
	injectProductsQuery: (p: () => Record<string, unknown>) => {
		productParams.push(p);
		return { data: products, isFetching: fetching };
	},
}));

const render = () => {
	const store = { select: vi.fn(() => of([])), dispatch: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: Store, useValue: store },
			{ provide: LoaderStore, useValue: {} },
		],
	});
	TestBed.overrideComponent(CreateOrder, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(CreateOrder);
	fixture.detectChanges();
	TestBed.tick();
	return {
		fixture,
		page: fixture.componentInstance,
		store,
		params: productParams.at(-1) as () => Record<string, unknown>,
	};
};
const quiet = () => document.body.classList.contains('loader-none');

afterEach(() => {
	products.set(undefined);
	fetching.set(false);
	productParams.length = 0;
	vi.useRealTimers();
	document.body.classList.remove('loader-none');
});

describe('CreateOrder', () => {
	it('loads the cart and tracks the product total and fetch state', async () => {
		const { page, store } = render();
		expect(store.dispatch).toHaveBeenCalledOnce();
		expect(page.loading).toBe(false);
		products.set({ data: [], total: 7 });
		fetching.set(true);
		TestBed.tick();
		expect(page.totalItems).toBe(7);
		expect(page.loading).toBe(true);
		expect(await firstValueFrom(page.product$)).toEqual({ data: [], total: 7 });
	});

	it('searches after a pause', () => {
		vi.useFakeTimers();
		const { page, params } = render();
		page.term.setValue('silk');
		vi.advanceTimersByTime(400);
		expect(params()).toMatchObject({ search: 'silk', status: 1 });
	});

	it('only shows the loader when asked', () => {
		const { page } = render();
		page.getProducts({ page: 2 }, true);
		expect(quiet()).toBe(false);
		page.getProducts({ page: 2 });
		expect(quiet()).toBe(true);
	});

	it('toggles a category card', () => {
		const { page, params } = render();
		page.selectCategory({ id: 4 } as never);
		expect(params()).toMatchObject({ category_ids: '4' });
		page.selectCategory({ id: 4 } as never);
		expect(page.activeCategory).toBeNull();
		expect(params()).toMatchObject({ category_ids: '' });
	});

	it('filters by the category dropdown', () => {
		const { page, params } = render();
		page.selectCategory({ id: 4 } as never);
		page.selectCategoryItem([1, 2] as never);
		expect(page.activeCategory).toBeNull();
		expect(params()).toMatchObject({ category_ids: '1,2' });
	});

	it('updates a cart line', () => {
		const { page, store } = render();
		page.updateQuantity({ id: 1, product: { id: 2 }, variation_id: 3 } as never, 2);
		expect(store.dispatch).toHaveBeenLastCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({ product_id: 2, variation_id: 3, quantity: 2 }),
			}),
		);
		page.updateQuantity({ id: 1, product: { id: 2 } } as never, 1);
		expect(store.dispatch).toHaveBeenLastCalledWith(
			expect.objectContaining({ payload: expect.objectContaining({ variation_id: null }) }),
		);
		expect(quiet()).toBe(true);
	});

	it('pages', () => {
		const { page, params } = render();
		page.setPaginate(3);
		expect(params()).toMatchObject({ page: 3 });
	});

	it('removes the body class when leaving', () => {
		const { page, fixture } = render();
		page.getProducts({});
		fixture.destroy();
		expect(quiet()).toBe(false);
	});
});
