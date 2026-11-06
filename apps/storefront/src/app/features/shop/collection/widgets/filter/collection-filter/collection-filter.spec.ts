import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { describe, expect, it, vi } from 'vitest';

import { CollectionFilter } from './collection-filter';

const render = (filter?: Record<string, unknown>) => {
	const router = { navigate: vi.fn() };
	const route = {};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ActivatedRoute, useValue: route },
			{ provide: Router, useValue: router },
		],
	});
	TestBed.overrideComponent(CollectionFilter, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(CollectionFilter);
	if (filter) fixture.componentRef.setInput('filter', filter);
	const chips = fixture.componentInstance;
	chips.ngOnChanges();
	return { chips, router, route };
};
const all = {
	category: 'silk,cotton',
	tag: 'new',
	rating: '4,5',
	price: '100-200',
	attribute: 'fabric:silk,linen|color:red',
};

describe('CollectionFilter', () => {
	it('lists one chip per active filter', () => {
		expect(render(all).chips.filters).toEqual([
			'silk',
			'cotton',
			'new',
			'rating 4',
			'rating 5',
			'100-200',
			'silk',
			'linen',
			'red',
		]);
	});

	it('shows nothing with no filter at all', () => {
		expect(render().chips.filters).toEqual([]);
	});

	it('accepts an attribute with no terms and a rating already labelled', () => {
		const { chips } = render({ attribute: 'fabric', rating: 'rating 3' });
		expect(chips.filtersObj['attribute']).toEqual(['fabric:']);
		expect(chips.filters).toContain('rating 3');
	});

	it('removes a category chip and keeps the rest in the address', () => {
		const { chips, router, route } = render(all);
		chips.remove('cotton');
		expect(router.navigate).toHaveBeenCalledWith([], {
			relativeTo: route,
			queryParams: {
				category: 'silk',
				tag: 'new',
				rating: '4,5',
				price: '100-200',
				attribute: 'fabric:silk,linen|color:red',
			},
			queryParamsHandling: 'merge',
			skipLocationChange: false,
		});
	});

	it('removes a rating by its label', () => {
		const { chips, router } = render(all);
		chips.remove('rating 4');
		expect(router.navigate.mock.lastCall?.[1].queryParams.rating).toBe('5');
	});

	it('removes one attribute term, and the whole attribute with its last term', () => {
		const { chips, router } = render({ attribute: 'fabric:linen|color:red' });
		chips.remove('linen');
		expect(router.navigate.mock.lastCall?.[1].queryParams.attribute).toBe('color:red');
		chips.remove('red');
		expect(router.navigate.mock.lastCall?.[1].queryParams).toMatchObject({ attribute: null, category: null });
	});

	it('survives a chip with no separator when writing the address back', () => {
		const { chips, router } = render();
		chips.filtersObj['attribute'] = ['bare'];
		chips.remove('nothing');
		expect(router.navigate.mock.lastCall?.[1].queryParams.attribute).toBe('bare:');
	});

	it('clears everything', () => {
		const { chips, router, route } = render(all);
		chips.clear();
		expect(router.navigate).toHaveBeenCalledWith([], {
			relativeTo: route,
			queryParams: null,
			skipLocationChange: false,
		});
	});
});
