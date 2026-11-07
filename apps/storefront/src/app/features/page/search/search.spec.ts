import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { IProduct } from '@data-access/interfaces/product.interface';
import { ProductService } from '@data-access/services/product.service';

import { Search } from './search';

const silk = { id: 1, name: 'Silk Saree', slug: 'silk-saree' } as unknown as IProduct;
const cotton = { id: 2, name: 'Cotton Saree', slug: 'cotton-saree' } as unknown as IProduct;

function open(search: (term: string) => unknown, params = { search: 'silk' }) {
	const queryParams = new BehaviorSubject<{ search?: string }>(params);
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [Search, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ActivatedRoute, useValue: { queryParams } },
			{ provide: Router, useValue: { navigate: vi.fn() } },
			{
				provide: ProductService,
				useValue: { search, getCatalog: () => of({ data: [cotton], total: 1 }), skeletonLoader: false },
			},
		],
	});
	TestBed.overrideComponent(Search, {
		set: {
			imports: [],
			template: `@if (loading()) {<p class="waiting"></p>}
				@for (product of products(); track product.id) {<p class="row">{{ product.name }}</p>}
				@if (unavailable()) {<p class="down"></p>}`,
		},
	});
	const fixture = TestBed.createComponent(Search);
	fixture.autoDetectChanges();
	return { el: fixture.nativeElement as HTMLElement, queryParams };
}

const names = (el: HTMLElement) => [...el.querySelectorAll('.row')].map((row) => row.textContent);

describe('the search page', () => {
	it('shows the results as soon as they arrive', async () => {
		const answer = new Subject<IProduct[]>();
		const { el } = open(() => answer);
		await vi.waitFor(() => expect(el.querySelector('.waiting')).not.toBeNull());

		answer.next([silk]);

		await vi.waitFor(() => expect(names(el)).toEqual(['Silk Saree']));
		expect(el.querySelector('.waiting')).toBeNull();
	});

	it('lists the catalogue when there is no term', async () => {
		const { el } = open(() => of([silk]), {} as { search: string });

		await vi.waitFor(() => expect(names(el)).toEqual(['Cotton Saree']));
	});

	it('ignores an older answer that lands after a newer search', async () => {
		const first = new Subject<IProduct[]>();
		const { el, queryParams } = open((term) => (term === 'silk' ? first : of([cotton])));

		queryParams.next({ search: 'cotton' });
		first.next([silk]);

		await vi.waitFor(() => expect(names(el)).toEqual(['Cotton Saree']));
	});

	it('says search is unavailable when the API fails', async () => {
		const { el } = open(() => throwError(() => new Error('503')));

		await vi.waitFor(() => expect(el.querySelector('.down')).not.toBeNull());
		expect(names(el)).toEqual([]);
	});
});
