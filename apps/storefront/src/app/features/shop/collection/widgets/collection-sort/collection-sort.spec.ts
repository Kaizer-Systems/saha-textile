import { PLATFORM_ID, SimpleChange } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AttributeService } from '@data-access/services/attribute.service';

import { CollectionSort } from './collection-sort';

const render = (platform = 'browser') => {
	const router = { navigate: vi.fn() };
	const attributes = { offCanvasMenu: false };
	const route = {};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ActivatedRoute, useValue: route },
			{ provide: Router, useValue: router },
			{ provide: AttributeService, useValue: attributes },
			{ provide: PLATFORM_ID, useValue: platform },
			{
				provide: TranslocoService,
				useValue: { selectTranslation: () => of({}), translate: (key: string) => `t:${key}` },
			},
		],
	});
	TestBed.overrideComponent(CollectionSort, { set: { imports: [], template: '' } });
	const sort = TestBed.createComponent(CollectionSort).componentInstance;
	const emitted: string[] = [];
	sort.setGridClass.subscribe((value) => emitted.push(value));
	return { sort, router, attributes, route, emitted };
};
const change = (value: unknown) => new SimpleChange(undefined, value, true);

describe('CollectionSort', () => {
	it('leaves an option group untranslated', () => {
		const dictionary = new Subject<unknown>();
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: ActivatedRoute, useValue: {} },
				{ provide: Router, useValue: {} },
				{ provide: AttributeService, useValue: {} },
				{
					provide: TranslocoService,
					useValue: { selectTranslation: () => dictionary, translate: (key: string) => key },
				},
			],
		});
		TestBed.overrideComponent(CollectionSort, { set: { imports: [], template: '' } });
		const sort = TestBed.createComponent(CollectionSort).componentInstance;
		const group = { options: [] };
		sort.sorting = [group as never];
		dictionary.next({});
		expect(sort.sortOptions()).toEqual([group]);
	});

	it('knows the platform and translates the sort labels', () => {
		const { sort } = render('server');
		expect(sort.isBrowser).toBe(false);
		expect(sort.sortOptions()[0]).toEqual({ value: 'asc', label: 't:sort_ascending' });
	});

	it.each([
		['collection_3_grid', 'row-cols-xl-3'],
		['collection_4_grid', 'row-cols-xxl-4'],
		['collection_5_grid', 'row-cols-xl-5'],
		['collection_list_view', 'list-style'],
	])('applies the %s layout', (value, marker) => {
		const { sort, emitted } = render();
		sort.grid(value);
		expect(sort.selectedGrid).toBe(value);
		expect(emitted.at(-1)).toContain(marker);
	});

	it('keeps the class for a layout in the list that has no style', () => {
		const { sort, emitted } = render();
		sort.gridArray = [...sort.gridArray, 'collection_custom'];
		const before = sort.class;
		sort.grid('collection_custom');
		expect(sort.class).toBe(before);
		expect(emitted).toEqual([before]);
	});

	it('ignores an unknown layout', () => {
		const { sort, emitted } = render();
		sort.grid('collection_9_grid');
		expect(sort.selectedGrid).toBe('collection_4_grid');
		expect(emitted).toEqual([]);
	});

	it('follows a grid column input and a filter layout', () => {
		const { sort } = render();
		sort.ngOnChanges({ gridCol: change('collection_5_grid') });
		expect(sort.class).toContain('row-cols-xl-5');
		sort.ngOnChanges({ filter: change({ layout: 'collection_list_view' }) });
		expect(sort.selectedGrid).toBe('collection_list_view');
		sort.ngOnChanges({ filter: change({ layout: 'none' }), gridCol: change('none') });
		expect(sort.selectedGrid).toBe('collection_list_view');
		sort.ngOnChanges({});
		expect(sort.selectedGrid).toBe('collection_list_view');
	});

	it('sorts by date for the two date options only', () => {
		const { sort, router, route } = render();
		sort.sortByFilter({ value: 'asc' } as never);
		expect(router.navigate).toHaveBeenLastCalledWith([], {
			relativeTo: route,
			queryParams: { sortBy: 'asc', field: 'created_at' },
			queryParamsHandling: 'merge',
			skipLocationChange: false,
		});
		sort.sortByFilter({ value: 'desc' } as never);
		expect(router.navigate.mock.lastCall?.[1].queryParams.field).toBe('created_at');
		sort.sortByFilter({ value: 'a-z' } as never);
		expect(router.navigate.mock.lastCall?.[1].queryParams).toEqual({ sortBy: 'a-z', field: null });
	});

	it('clears the sort for an empty choice', () => {
		const { sort, router } = render();
		sort.sortByFilter({ value: '' } as never);
		expect(router.navigate.mock.lastCall?.[1].queryParams).toEqual({ sortBy: null, field: null });
		sort.sortByFilter(null as never);
		expect(router.navigate.mock.lastCall?.[1].queryParams).toEqual({ sortBy: null, field: null });
	});

	it('opens and closes the filter panel', () => {
		const { sort, attributes } = render();
		sort.openOffCanvasMenu();
		expect(attributes.offCanvasMenu).toBe(true);
		sort.openFilter(false);
		expect(attributes.offCanvasMenu).toBe(false);
	});
});
