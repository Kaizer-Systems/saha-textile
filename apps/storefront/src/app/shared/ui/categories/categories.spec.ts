import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Categories } from './categories';

const data = signal<unknown>(undefined);
vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: (params: () => unknown) => {
		params();
		return { data };
	},
}));

const rows = [
	{ id: 1, type: 'product', slug: 'silk' },
	{ id: 2, type: 'post', slug: 'news' },
	{ id: 3, type: 'product', slug: 'cotton' },
];

const render = (query: Record<string, string> = {}, platform = 'browser') => {
	const router = { navigate: vi.fn() };
	const route = { queryParams: new BehaviorSubject(query) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ActivatedRoute, useValue: route },
			{ provide: Router, useValue: router },
			{ provide: PLATFORM_ID, useValue: platform },
		],
	});
	TestBed.overrideComponent(Categories, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(Categories);
	TestBed.tick();
	return { fixture, list: fixture.componentInstance, router, route };
};

afterEach(() => data.set(undefined));

describe('Categories', () => {
	it('starts empty, then keeps only product categories', () => {
		const { list } = render({}, 'server');
		expect(list.isBrowser).toBe(false);
		expect(list.categories).toEqual([]);
		data.set({ data: rows, total: 3 });
		TestBed.tick();
		expect(list.categories.map((row) => row.id)).toEqual([1, 3]);
	});

	it('reads the selected categories from the address', () => {
		expect(render({ category: 'silk,cotton' }).list.selectedCategorySlug).toEqual(['silk', 'cotton']);
		expect(render().list.selectedCategorySlug).toEqual([]);
	});

	it('narrows to the requested ids', () => {
		data.set({ data: rows, total: 3 });
		const { fixture, list } = render();
		fixture.componentRef.setInput('categoryIds', [2]);
		list.ngOnChanges();
		expect(list.categories.map((row) => row.id)).toEqual([2]);
	});

	it('ignores empty or missing ids', () => {
		data.set({ data: rows, total: 3 });
		const { fixture, list } = render();
		list.ngOnChanges();
		fixture.componentRef.setInput('categoryIds', null);
		list.ngOnChanges();
		expect(list.categories.map((row) => row.id)).toEqual([1, 3]);
	});

	it('tolerates a list with no data, and reads ids that went missing later', () => {
		const { fixture, list } = render();
		data.set({});
		TestBed.tick();
		expect(list.categories).toBeUndefined();
		data.set({ data: rows });
		TestBed.tick();
		fixture.componentRef.setInput('categoryIds', [1]);
		list.ngOnChanges();
		fixture.componentRef.setInput('categoryIds', null);
		TestBed.tick();
		data.set({ data: [{ id: 1 }] });
		TestBed.tick();
		expect(list.categories).toEqual([]);
	});

	it('emits the chosen id', () => {
		const { list } = render();
		const seen: number[] = [];
		list.selectedCategory.subscribe((id) => seen.push(id));
		list.selectCategory(4);
		expect(seen).toEqual([4]);
	});

	it('toggles a category in the address', () => {
		const { list, router, route } = render();
		list.redirectToCollection('silk');
		expect(router.navigate).toHaveBeenLastCalledWith(['/collections'], {
			relativeTo: route,
			queryParams: { category: 'silk' },
			queryParamsHandling: 'merge',
			skipLocationChange: false,
		});
		list.redirectToCollection('silk');
		expect(router.navigate.mock.lastCall?.[1].queryParams).toEqual({ category: null });
	});
});
