import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BlogService } from './blog.service';
import { CategoryService, toBlogCategory } from './category.service';
import { ProductService } from './product.service';
import { SearchTermService } from './search-term.service';
import { ShopEventService } from './shop-event.service';

const setup = () => {
	const http = { get: vi.fn(() => of({ items: [{ id: 'e1' }], total: 1 })) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
	const sent = () => (http.get.mock.lastCall as unknown[] | undefined)?.[1] as { params: Record<string, string> };
	return { http, sent };
};

describe('list filters sent to the API', () => {
	it('blog posts and search terms: the trimmed search and the missing language', () => {
		const { sent } = setup();
		void TestBed.inject(BlogService).getBlogs({ search: '  silk ', missing: 'bn' });
		expect(sent().params).toEqual({ page: '1', pageSize: '20', search: 'silk', missing: 'bn' });
		void TestBed.inject(SearchTermService).list({ search: ' silk', missing: 'bn', page: 2, paginate: 500 });
		expect(sent().params).toEqual({ page: '2', pageSize: '100', search: 'silk', missing: 'bn' });
	});

	it('events: search, kind, missing language and the sort, newest first unless asked', async () => {
		const { sent } = setup();
		const events = TestBed.inject(ShopEventService);
		await expect(
			firstValueFrom(
				events.list({ search: ' Puja ', type: 'sale', missing: 'bn', field: 'starts_at', sort: 'asc' }),
			),
		).resolves.toEqual({ data: [{ id: 'e1' }], total: 1 });
		expect(sent().params).toEqual({
			page: '1',
			pageSize: '20',
			search: 'Puja',
			type: 'sale',
			missing: 'bn',
			sort: 'startsAt',
			direction: 'asc',
		});
		void events.list({ type: 'launch', field: 'name' });
		expect(sent().params).toEqual({ page: '1', pageSize: '20', type: 'launch', sort: 'name', direction: 'desc' });
		void events.list({ type: 'other', field: 'colour' });
		expect(sent().params).toEqual({ page: '1', pageSize: '20' });
	});

	it('the catalogue: the missing language', () => {
		const { sent } = setup();
		void TestBed.inject(ProductService).getCatalogProducts({ missing: 'bn' });
		expect(sent().params).toEqual({ missing: 'bn' });
	});

	it('categories: the HSN impact, and a blog category with no English name shows its slug', () => {
		const { http } = setup();
		void TestBed.inject(CategoryService).hsnImpact('cat 1');
		expect(String((http.get.mock.lastCall as unknown[] | undefined)?.[0])).toMatch(/\/cat%201\/hsn-impact$/);
		expect(toBlogCategory({ id: 'c1', name: {}, slug: 'weaving', description: {} } as never).name).toBe('weaving');
	});
});
