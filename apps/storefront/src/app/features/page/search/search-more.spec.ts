import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, NEVER } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ConsentStore } from '@core/consent/consent.store';
import { ProductService } from '@data-access/services/product.service';

import { Search } from './search';

const open = (params: { search?: string }, platform = 'browser') => {
	const navigate = vi.fn();
	const searchClick = vi.fn();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ActivatedRoute, useValue: { queryParams: new BehaviorSubject(params) } },
			{ provide: Router, useValue: { navigate } },
			{ provide: PLATFORM_ID, useValue: platform },
			{ provide: ConsentStore, useValue: { allows: () => true } },
			{
				provide: ProductService,
				useValue: { search: () => NEVER, getCatalog: () => NEVER, searchClick, skeletonLoader: false },
			},
		],
	});
	TestBed.overrideComponent(Search, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(Search);
	fixture.detectChanges();
	return { page: fixture.componentInstance, navigate, searchClick };
};

describe('the search page: the remaining cases', () => {
	it('counts nothing while results or the catalogue are still loading', () => {
		expect(open({ search: 'silk' }).page.total()).toBe(0);
		expect(open({}).page.total()).toBe(0);
	});

	it('searches for nothing when the box is cleared', () => {
		const { page, navigate } = open({ search: 'silk' });
		page.search.setValue(null);
		page.searchProduct();
		expect(navigate).toHaveBeenLastCalledWith(
			[],
			expect.objectContaining({ queryParams: { search: null, page: null } }),
		);
	});

	it('goes back to the top of the page after a page change in the browser', () => {
		const { page } = open({ search: 'silk' });
		const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
		page.setPage(2);
		TestBed.tick();
		expect(scroll).toHaveBeenCalledWith({ top: 0 });
		scroll.mockRestore();
	});

	it('on the server: changes page without scrolling, and counts an opened product without remembering it', () => {
		const { page, navigate, searchClick } = open({ search: 'silk' }, 'server');
		const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
		page.setPage(2);
		expect(navigate).toHaveBeenCalled();
		const link = document.createElement('a');
		link.href = '/product/silk-saree';
		page.openedFromResults({ target: link } as unknown as Event, { id: 1, slug: 'silk-saree' } as never);
		expect(searchClick).toHaveBeenCalledWith('silk', 1);
		expect(localStorage.getItem('st_search')).toBeNull();
		expect(scroll).not.toHaveBeenCalled();
	});
});
