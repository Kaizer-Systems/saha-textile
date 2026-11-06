import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { describe, expect, it, vi } from 'vitest';

import { CollectionAttributes } from './collection-attributes-filter';

const render = (attribute?: string, key = 'fabric') => {
	const router = { navigate: vi.fn() };
	const route = {};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ActivatedRoute, useValue: route },
			{ provide: Router, useValue: router },
		],
	});
	TestBed.overrideComponent(CollectionAttributes, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(CollectionAttributes);
	fixture.componentRef.setInput('facetKey', key);
	if (attribute !== undefined) fixture.componentRef.setInput('filter', { attribute });
	return { filter: fixture.componentInstance, router, route };
};
const tick = (value: string, checked: boolean) => ({ target: { value, checked } }) as never;
const sent = (router: { navigate: ReturnType<typeof vi.fn> }) => router.navigate.mock.lastCall?.[1].queryParams;

describe('CollectionAttributes', () => {
	it('reads ticks for its own facet only', () => {
		const { filter } = render('fabric:silk,cotton|color:red');
		expect(filter.checked('silk')).toBe(true);
		expect(filter.checked('red')).toBe(false);
	});

	it('reads nothing with no filter, or from a malformed group', () => {
		expect(render().filter.checked('silk')).toBe(false);
		expect(render('fabric|:silk').filter.checked('silk')).toBe(false);
	});

	it('adds a tick and returns to page one', () => {
		const { filter, router, route } = render('color:red');
		filter.applyFilter(tick('silk', true));
		expect(router.navigate).toHaveBeenCalledWith([], {
			relativeTo: route,
			queryParams: { attribute: 'color:red|fabric:silk', page: 1 },
			queryParamsHandling: 'merge',
			skipLocationChange: false,
		});
	});

	it('does not repeat a tick already there', () => {
		const { filter, router } = render('fabric:silk');
		filter.applyFilter(tick('silk', true));
		expect(sent(router).attribute).toBe('fabric:silk');
	});

	it('removes a tick, dropping the group and then the whole parameter', () => {
		const { filter, router } = render('fabric:silk,cotton');
		filter.applyFilter(tick('silk', false));
		expect(sent(router).attribute).toBe('fabric:cotton');
		const last = render('fabric:silk');
		last.filter.applyFilter(tick('silk', false));
		expect(sent(last.router).attribute).toBeNull();
	});

	it('ignores unticking something that was not ticked', () => {
		const { filter, router } = render('fabric:silk');
		filter.applyFilter(tick('wool', false));
		expect(sent(router).attribute).toBe('fabric:silk');
	});
});
