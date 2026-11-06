import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CollectionCategoryFilter } from './collection-category-filter';
import { CollectionRatingFilter } from '../collection-rating-filter/collection-rating-filter';

const data = signal<unknown>(undefined);
vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: (params: () => unknown) => {
		params();
		return { data };
	},
}));

const render = <T>(type: new () => T, filter: Record<string, unknown>) => {
	const router = { navigate: vi.fn() };
	const route = {};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ActivatedRoute, useValue: route },
			{ provide: Router, useValue: router },
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	fixture.componentRef.setInput('filter', filter);
	TestBed.tick();
	return { widget: fixture.componentInstance, router, route };
};
const box = (value: string, checked: boolean) => ({ target: { value, checked } }) as never;

afterEach(() => data.set(undefined));

describe('CollectionCategoryFilter', () => {
	it('lists product categories only', () => {
		const { widget } = render(CollectionCategoryFilter, {});
		expect(widget.categories).toEqual([]);
		data.set({
			data: [
				{ id: 1, type: 'product' },
				{ id: 2, type: 'post' },
			],
		});
		TestBed.tick();
		expect(widget.categories).toEqual([{ id: 1, type: 'product' }]);
	});

	it('survives a response with no list', () => {
		const { widget } = render(CollectionCategoryFilter, {});
		data.set({});
		TestBed.tick();
		expect(widget.categories).toBeUndefined();
	});

	it('reads the selection from the filter', () => {
		const { widget } = render(CollectionCategoryFilter, { category: 'silk,cotton' });
		widget.ngOnChanges();
		expect(widget.checked('silk')).toBe(true);
		expect(widget.checked('wool')).toBe(false);
		const empty = render(CollectionCategoryFilter, {});
		empty.widget.ngOnChanges();
		expect(empty.widget.selectedCategories).toEqual([]);
	});

	it('ticks and unticks in the address', () => {
		const { widget, router, route } = render(CollectionCategoryFilter, {});
		widget.ngOnChanges();
		widget.applyFilter(box('silk', true));
		expect(router.navigate).toHaveBeenLastCalledWith([], {
			relativeTo: route,
			queryParams: { category: 'silk' },
			queryParamsHandling: 'merge',
			skipLocationChange: false,
		});
		widget.applyFilter(box('silk', false));
		expect(router.navigate.mock.lastCall?.[1].queryParams).toEqual({ category: null });
	});

	it('copes with an event that has no target', () => {
		const { widget } = render(CollectionCategoryFilter, {});
		widget.ngOnChanges();
		widget.applyFilter({ target: null } as never);
		widget.applyFilter(undefined as never);
		expect(widget.selectedCategories).toEqual([]);
	});
});

describe('CollectionRatingFilter', () => {
	it('offers five down to one', () => {
		expect(render(CollectionRatingFilter, {}).widget.numbers).toEqual([5, 4, 3, 2, 1]);
	});

	it('reads the selection from the filter', () => {
		const { widget } = render(CollectionRatingFilter, { rating: '4,5' });
		widget.ngOnChanges();
		expect(widget.checked('4')).toBe(true);
		expect(widget.checked('1')).toBe(false);
		const empty = render(CollectionRatingFilter, {});
		empty.widget.ngOnChanges();
		expect(empty.widget.selectedRatings).toEqual([]);
	});

	it('ticks and unticks in the address', () => {
		const { widget, router } = render(CollectionRatingFilter, {});
		widget.ngOnChanges();
		widget.applyFilter(box('4', true));
		expect(router.navigate.mock.lastCall?.[1].queryParams).toEqual({ rating: '4' });
		widget.applyFilter(box('4', false));
		expect(router.navigate.mock.lastCall?.[1].queryParams).toEqual({ rating: null });
	});

	it('copes with an event that has no target', () => {
		const { widget } = render(CollectionRatingFilter, {});
		widget.ngOnChanges();
		widget.applyFilter({ target: null } as never);
		widget.applyFilter(undefined as never);
		expect(widget.selectedRatings).toEqual([]);
	});
});
