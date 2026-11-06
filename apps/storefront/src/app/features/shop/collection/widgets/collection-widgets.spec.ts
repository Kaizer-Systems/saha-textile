import { ViewportScroller } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttributeService } from '@data-access/services/attribute.service';
import { ProductService } from '@data-access/services/product.service';

import { CollectionPaginate } from './collection-paginate/collection-paginate';
import { CollectionProducts } from './collection-products/collection-products';
import { CollectionPriceFilter } from './filter/collection-price-filter/collection-price-filter';
import { CollectionSidebar } from './sidebar/sidebar';

const data = signal<unknown>(undefined);
const pending = signal(true);
const fetching = signal(false);
vi.mock('@data-access/queries/product.queries', () => ({
	injectCatalogQuery: (filter: () => unknown) => {
		filter();
		return { data, isPending: pending, isFetching: fetching };
	},
}));

afterEach(() => {
	data.set(undefined);
	pending.set(true);
	fetching.set(false);
});

describe('CollectionPaginate', () => {
	const render = () => {
		const router = { navigate: vi.fn(async () => true) };
		const route = {};
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: ActivatedRoute, useValue: route },
				{ provide: Router, useValue: router },
				{ provide: ViewportScroller, useValue: {} },
			],
		});
		TestBed.overrideComponent(CollectionPaginate, { set: { imports: [], template: '' } });
		const widget = TestBed.createComponent(CollectionPaginate).componentInstance;
		TestBed.tick();
		return { widget, router, route };
	};

	it('counts the results, zero until loaded', async () => {
		const { widget } = render();
		expect(widget.totalItems()).toBe(0);
		data.set({ total: 9 });
		TestBed.tick();
		expect(widget.totalItems()).toBe(9);
		expect(await firstValueFrom(widget.product$)).toEqual({ total: 9 });
	});

	it('moves to a page in the address', () => {
		const { widget, router, route } = render();
		widget.setPaginate(3);
		expect(router.navigate).toHaveBeenCalledWith([], {
			relativeTo: route,
			queryParams: { page: 3 },
			queryParamsHandling: 'merge',
			skipLocationChange: false,
		});
	});
});

describe('CollectionProducts', () => {
	const render = () => {
		const service = { skeletonLoader: false };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: ProductService, useValue: service }] });
		TestBed.overrideComponent(CollectionProducts, { set: { imports: [], template: '' } });
		const widget = TestBed.createComponent(CollectionProducts).componentInstance;
		TestBed.tick();
		return { widget, service };
	};

	it('mirrors the fetch state', async () => {
		const { widget, service } = render();
		fetching.set(true);
		data.set({ total: 1 });
		TestBed.tick();
		expect(service.skeletonLoader).toBe(true);
		expect(await firstValueFrom(widget.product$)).toEqual({ total: 1 });
	});

	it('takes the grid class the sort bar reports', () => {
		const { widget } = render();
		widget.setGridClass('row');
		expect(widget.gridClass).toBe('row');
	});
});

describe('CollectionSidebar', () => {
	const render = () => {
		const service = { skeletonLoader: false, offCanvasMenu: true };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: AttributeService, useValue: service }] });
		TestBed.overrideComponent(CollectionSidebar, { set: { imports: [], template: '' } });
		const widget = TestBed.createComponent(CollectionSidebar).componentInstance;
		TestBed.tick();
		return { widget, service };
	};

	it('reads the facets, none until loaded', () => {
		const { widget } = render();
		expect(widget.facetKeys()).toEqual([]);
		data.set({ facets: { fabric: [], color: [] } });
		expect(widget.facetKeys()).toEqual(['fabric', 'color']);
	});

	it('mirrors the first load and closes the panel', () => {
		const { widget, service } = render();
		expect(service.skeletonLoader).toBe(true);
		widget.closeCanvasMenu();
		expect(service.offCanvasMenu).toBe(false);
	});
});

describe('CollectionPriceFilter', () => {
	const render = (filter: Record<string, unknown>) => {
		const router = { navigate: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: ActivatedRoute, useValue: {} },
				{ provide: Router, useValue: router },
			],
		});
		TestBed.overrideComponent(CollectionPriceFilter, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(CollectionPriceFilter);
		fixture.componentRef.setInput('filter', filter);
		fixture.componentInstance.ngOnChanges();
		return { widget: fixture.componentInstance, router };
	};
	const box = (value: string, checked: boolean) => ({ target: { value, checked } }) as never;

	it('reads the selection from the filter', () => {
		const { widget } = render({ price: '0-1000,20000-' });
		expect(widget.checked('0-1000')).toBe(true);
		expect(widget.checked('1000-2500')).toBe(false);
		expect(render({}).widget.selectedPrices).toEqual([]);
	});

	it('ticks and unticks in the address', () => {
		const { widget, router } = render({});
		widget.applyFilter(box('0-1000', true));
		expect(router.navigate.mock.lastCall?.[1].queryParams).toEqual({ price: '0-1000' });
		widget.applyFilter(box('0-1000', false));
		expect(router.navigate.mock.lastCall?.[1].queryParams).toEqual({ price: null });
	});

	it('copes with an event that has no target', () => {
		const { widget } = render({});
		widget.applyFilter({ target: null } as never);
		widget.applyFilter(undefined as never);
		expect(widget.selectedPrices).toEqual([]);
	});
});
