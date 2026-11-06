import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleSeo } from '@core/i18n/locale-seo';
import { AttributeService } from '@data-access/services/attribute.service';

import { Collection } from './collection';

const data = signal<unknown>(undefined);
const error = signal<unknown>(null);
vi.mock('@data-access/queries/product.queries', () => ({
	injectCatalogQuery: (filter: () => unknown) => {
		filter();
		return { data, error };
	},
}));

const render = (url = '/collections/sarees/silk/?page=2', query: Record<string, unknown> = { page: '2' }) => {
	const params = new BehaviorSubject(query);
	const router = { url, navigate: vi.fn() };
	const title = { setTitle: vi.fn() };
	const seo = {
		applyDocument: vi.fn(),
		applyJsonLd: vi.fn(),
		setCanonicalPath: vi.fn(),
		absoluteUrl: (path: string) => `https://shop.test${path}`,
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ActivatedRoute, useValue: { url: of([]), queryParams: params } },
			{ provide: Router, useValue: router },
			{ provide: Title, useValue: title },
			{ provide: Meta, useValue: {} },
			{ provide: LocaleSeo, useValue: seo },
			{ provide: AttributeService, useValue: {} },
			{ provide: TranslocoService, useValue: { translate: () => 'Collections' } },
		],
	});
	TestBed.overrideComponent(Collection, { set: { imports: [], template: '' } });
	const page = TestBed.createComponent(Collection).componentInstance;
	TestBed.tick();
	return { page, params, router, title, seo };
};
const jsonLd = (seo: ReturnType<typeof render>['seo'], id: string) =>
	seo.applyJsonLd.mock.calls.filter(([name]) => name === id).at(-1)?.[1];

afterEach(() => {
	data.set(undefined);
	error.set(null);
});

describe('Collection filter', () => {
	it('takes the category from the path and cleans the query', () => {
		const { page } = render('/collections/sarees/silk/?page=2', {
			page: '2',
			price: '100-200',
			sortBy: 'a-z',
			tag: 'new',
			sort: 'asc',
			field: 'created_at',
			junk: 'x',
		});
		expect(page.filter()).toMatchObject({
			page: 2,
			path: 'sarees/silk',
			paginate: 25,
			sortBy: 'a-z',
			tag: 'new',
			sort: 'asc',
			field: 'created_at',
		});
	});

	it('uses the general page with empty filters, and keeps the earlier field', () => {
		const { page, params } = render('/collections', {});
		expect(page.filter()).toMatchObject({ path: '', price: '', category: '', tag: '', sortBy: '', rating: '' });
		page.filter.update((value) => ({ ...value, field: 'held' }));
		params.next({});
		expect(page.filter()['field']).toBe('held');
	});

	it('decodes a path with spaces', () => {
		expect(render('/collections/hand%20loom', {}).page.filter()['path']).toBe('hand loom');
	});

	it('passes every clean filter through', () => {
		const { page } = render('/collections', {
			category: 'silk',
			rating: '4',
			attribute: 'fabric:silk',
		});
		expect(page.filter()).toMatchObject({ category: 'silk', rating: '4', attribute: 'fabric:silk' });
	});
});

describe('Collection SEO', () => {
	it('keeps its own address while nothing has loaded', () => {
		const { seo, title, page } = render();
		expect(title.setTitle).toHaveBeenCalledWith('Collections | Saha Textile');
		expect(seo.setCanonicalPath).not.toHaveBeenCalled();
		expect(page.breadcrumb().items).toEqual([{ label: 'Collections', active: true }]);
		expect(jsonLd(seo, 'collection-crumbs')).toMatchObject({
			itemListElement: [{ name: 'Collections', item: 'https://shop.test/collections' }],
		});
		expect(jsonLd(seo, 'collection-jsonld')).toMatchObject({ itemListElement: [] });
	});

	it('describes a resolved category, its trail and its products', async () => {
		const { seo, title, page } = render();
		data.set({
			category: { name: 'Silk', canonical_path: 'sarees/silk' },
			breadcrumb: [
				{ name: 'Sarees', path: 'sarees' },
				{ name: 'Silk', path: 'sarees/silk' },
			],
			data: [{ name: 'Red saree', slug: 'red-saree' }],
		});
		TestBed.tick();
		expect(title.setTitle).toHaveBeenLastCalledWith('Silk | Saha Textile');
		expect(seo.setCanonicalPath).toHaveBeenCalledWith('/collections/sarees/silk');
		expect(page.breadcrumb()).toEqual({
			title: 'Silk',
			items: [
				{ label: 'Sarees', url: '/collections/sarees', active: false },
				{ label: 'Silk', url: '/collections/sarees/silk', active: true },
			],
		});
		expect(jsonLd(seo, 'collection-jsonld')).toMatchObject({
			itemListElement: [{ position: 1, url: 'https://shop.test/product/red-saree' }],
		});
		expect(jsonLd(seo, 'collection-crumbs')).toMatchObject({
			itemListElement: [{ item: 'https://shop.test/collections/sarees' }, { position: 2 }],
		});
		expect(await firstValueFrom(page.product$)).toBeDefined();
	});

	it('canonicalises the general page, and a trail with no category', () => {
		const { seo, page } = render('/collections', {});
		data.set({ data: [] });
		TestBed.tick();
		expect(seo.setCanonicalPath).toHaveBeenCalledWith('/collections');
		data.set({ data: [], breadcrumb: [{ name: 'Sarees', path: 'sarees' }] });
		TestBed.tick();
		expect(page.breadcrumb().title).toBe('Collections');
	});
});

describe('Collection missing path', () => {
	it('shows the real 404 at the same address', () => {
		const { router } = render();
		error.set(new HttpErrorResponse({ status: 404 }));
		TestBed.tick();
		expect(router.navigate).toHaveBeenCalledWith(['/404'], { skipLocationChange: true });
	});

	it('leaves other failures alone', () => {
		const { router } = render();
		error.set(new HttpErrorResponse({ status: 500 }));
		TestBed.tick();
		error.set(new Error('offline'));
		TestBed.tick();
		expect(router.navigate).not.toHaveBeenCalled();
	});
});
