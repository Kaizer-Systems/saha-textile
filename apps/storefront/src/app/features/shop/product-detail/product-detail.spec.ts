import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { RESPONSE } from '@analogjs/router/tokens';
import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ACTIVE_LOCALE } from '@core/i18n/active-locale';
import { LocaleSeo } from '@core/i18n/locale-seo';
import { SiteConfigStore } from '@core/state/site-config.store';

import { ProductDetail } from './product-detail';

const product = signal<unknown>(undefined);
const pending = signal(true);
const failure = signal<unknown>(null);
const rails = signal<unknown>(undefined);
vi.mock('@data-access/queries/product.queries', () => ({
	RELATED_PRODUCTS_KEY: ['related'],
	injectProductBySlugQuery: (slug: () => string, variant: () => string) => {
		slug();
		variant();
		return { data: product, isPending: pending, error: failure };
	},
	injectProductRelationsQuery: (slug: () => string) => {
		slug();
		return { data: rails };
	},
}));

const render = (
	options: { platform?: string; variant?: string | null; response?: unknown; noQuery?: boolean } = {},
) => {
	const params = new BehaviorSubject<Record<string, string>>({ slug: 'red-saree' });
	const map = (value: string | null) => ({ get: () => value });
	const queryParamMap = options.noQuery ? undefined : new BehaviorSubject(map(options.variant ?? null));
	const route = {
		params,
		queryParamMap,
		snapshot: {
			params: { slug: 'red-saree' },
			queryParamMap: options.noQuery ? undefined : map(options.variant ?? null),
		},
	};
	const router = { navigate: vi.fn() };
	const seo = {
		applyJsonLd: vi.fn(),
		applyDocument: vi.fn(),
		absoluteUrl: (path: string) => `https://shop.test${path}`,
		absoluteAsset: (path: string) => `https://cdn.test${path}`,
	};
	const client = { setQueryData: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ActivatedRoute, useValue: route },
			{ provide: Router, useValue: router },
			{ provide: LocaleSeo, useValue: seo },
			{ provide: QueryClient, useValue: client },
			{ provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
			{ provide: ACTIVE_LOCALE, useValue: 'en' },
			{ provide: SiteConfigStore, useValue: { siteConfig: signal(null) } },
			{ provide: TranslocoService, useValue: { translate: () => 'Product' } },
			...(options.response ? [{ provide: RESPONSE, useValue: options.response }] : []),
		],
	});
	TestBed.overrideComponent(ProductDetail, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ProductDetail);
	TestBed.tick();
	return { fixture, page: fixture.componentInstance, params, route, router, seo, client };
};
const jsonLd = (seo: ReturnType<typeof render>['seo'], id: string) =>
	seo.applyJsonLd.mock.calls.filter(([name]) => name === id).at(-1)?.[1];
const base = {
	slug: 'red-saree',
	name: 'Red saree',
	sku: 'SKU-1',
	price: 2000,
	sale_price: 1500,
	stock_status: 'in_stock',
	attributes: [],
};

afterEach(() => {
	product.set(undefined);
	pending.set(true);
	failure.set(null);
	rails.set(undefined);
	localStorage.clear();
	document.body.classList.remove('stickyCart');
	document.querySelector('.scroll-button')?.remove();
});

describe('ProductDetail data', () => {
	it('reports loading and a bare breadcrumb until the product arrives', () => {
		const { page } = render();
		expect(page.loading()).toBe(true);
		expect(page.breadcrumb()).toEqual({ title: 'Product', items: [] });
		pending.set(false);
		expect(page.loading()).toBe(false);
	});

	it('keeps the skeleton on a timed-out server render, but not for a missing product', () => {
		const { page } = render({ platform: 'server' });
		pending.set(false);
		failure.set(new HttpErrorResponse({ status: 504 }));
		expect(page.loading()).toBe(true);
		failure.set(new HttpErrorResponse({ status: 404 }));
		expect(page.loading()).toBe(false);
		failure.set(null);
		expect(page.loading()).toBe(false);
	});

	it('leaves a failed browser read without the skeleton', () => {
		const { page } = render();
		pending.set(false);
		failure.set(new HttpErrorResponse({ status: 500 }));
		expect(page.loading()).toBe(false);
		failure.set(null);
	});

	it('follows the address, with or without a query map', () => {
		const { params } = render({ noQuery: true });
		params.next({ slug: 'blue-saree' });
		expect(params.value['slug']).toBe('blue-saree');
		const { route } = render({ variant: 'SKU-2' });
		route.queryParamMap?.next({ get: () => null });
	});

	it('builds the breadcrumb from the trail, or from a plain label', () => {
		const { page } = render();
		product.set({ ...base, breadcrumb_trail: [{ name: 'Sarees', path: '/collections/sarees' }] });
		expect(page.breadcrumb().items).toEqual([
			{ label: 'Sarees', url: '/collections/sarees', active: false },
			{ label: 'Red saree', active: true },
		]);
		product.set(base);
		expect(page.breadcrumb().items[0]).toEqual({ label: 'Product', active: false });
	});

	it('merges the rails without repeats, at most twelve', () => {
		const { page, client } = render();
		expect(page.alsoLike()).toEqual([]);
		const many = Array.from({ length: 14 }, (_, id) => ({ id }));
		rails.set({ related: many, upsell: [{ id: 0 }], crossSell: [{ id: 99 }], boughtTogether: [] });
		TestBed.tick();
		expect(page.alsoLike()).toHaveLength(12);
		expect(client.setQueryData).toHaveBeenCalledWith(['related'], expect.any(Array));
	});

	it('reads the gallery carousel when it exists', () => {
		const { page } = render();
		expect(page.owlCar()).toBeUndefined();
	});
});

describe('ProductDetail routing', () => {
	it('shows the real 404 only for a 404', () => {
		const { router } = render();
		failure.set(new HttpErrorResponse({ status: 500 }));
		TestBed.tick();
		expect(router.navigate).not.toHaveBeenCalled();
		failure.set(new HttpErrorResponse({ status: 404 }));
		TestBed.tick();
		expect(router.navigate).toHaveBeenCalledWith(['/404'], { skipLocationChange: true });
	});

	it('redirects an unknown variant with a real 302 on the server', () => {
		const response = { statusCode: 200, setHeader: vi.fn() };
		render({ variant: 'NOPE', response, platform: 'server' });
		product.set({ ...base, unknown_variant: true });
		TestBed.tick();
		expect(response.statusCode).toBe(302);
		expect(response.setHeader).toHaveBeenCalledWith('Location', expect.stringContaining('/product/red-saree'));
		expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
	});

	it('replaces the address in the browser for an unknown variant', () => {
		const { router, route } = render({ variant: 'NOPE' });
		product.set({ ...base, unknown_variant: true });
		TestBed.tick();
		expect(router.navigate).toHaveBeenCalledWith([], { relativeTo: route, queryParams: {}, replaceUrl: true });
	});

	it('leaves the address alone without a variant in it', () => {
		const { router } = render();
		product.set({ ...base, unknown_variant: true });
		TestBed.tick();
		expect(router.navigate).not.toHaveBeenCalled();
	});
});

describe('ProductDetail recent views', () => {
	it('remembers the product in the browser only', () => {
		render();
		product.set(base);
		TestBed.tick();
		expect(localStorage.getItem('st_recent')).toContain('red-saree');
		localStorage.clear();
		render({ platform: 'server' });
		TestBed.tick();
		expect(localStorage.getItem('st_recent')).toBeNull();
	});

	it('skips a product without a slug', () => {
		render();
		product.set({ ...base, slug: '' });
		TestBed.tick();
		expect(localStorage.getItem('st_recent')).toBeNull();
	});
});

describe('ProductDetail SEO', () => {
	it('describes a simple product from its own price and stock', () => {
		const { seo } = render();
		product.set({ ...base, stock_status: 'out_of_stock', product_thumbnail: { original_url: '/t.jpg' } });
		TestBed.tick();
		expect(jsonLd(seo, 'product-group')).toMatchObject({
			'@type': 'Product',
			sku: 'SKU-1',
			image: 'https://cdn.test/t.jpg',
			offers: { price: 1500, availability: 'https://schema.org/OutOfStock' },
		});
	});

	it('uses the regular price when there is no sale price', () => {
		const { seo } = render();
		product.set({ ...base, sale_price: 0 });
		TestBed.tick();
		expect(jsonLd(seo, 'product-group')).toMatchObject({ offers: { price: 2000 } });
	});

	it('describes a single-variant product from that variant', () => {
		const { seo } = render();
		product.set({ ...base, variations: [{ sku: 'V1', sale_price: 0, price: 900, stock_status: 'in_stock' }] });
		TestBed.tick();
		expect(jsonLd(seo, 'product-group')).toMatchObject({
			sku: 'V1',
			offers: { price: 900, availability: 'https://schema.org/InStock' },
		});
		product.set({ ...base, variations: [{ sku: '', sale_price: 5, price: 900, stock_status: 'out_of_stock' }] });
		TestBed.tick();
		expect(jsonLd(seo, 'product-group')).toMatchObject({
			sku: 'SKU-1',
			offers: { price: 5, availability: 'https://schema.org/OutOfStock' },
		});
	});

	it('describes a product group with its variants', () => {
		const { seo } = render();
		product.set({
			...base,
			attributes: [
				{ slug: 'color', name: 'Colour' },
				{ slug: 'border', name: 'Border' },
			],
			variations: [
				{ sku: 'V1', name: 'Red', sale_price: 100, price: 200, stock_status: 'in_stock' },
				{ sku: 'V2', name: '', sale_price: 0, price: 200, stock_status: 'out_of_stock' },
			],
		});
		TestBed.tick();
		expect(jsonLd(seo, 'product-group')).toMatchObject({
			'@type': 'ProductGroup',
			variesBy: ['https://schema.org/color', 'Border'],
			hasVariant: [
				{ name: 'Red', offers: { price: 100 } },
				{ name: 'Red saree', offers: { price: 200, availability: 'https://schema.org/OutOfStock' } },
			],
		});
	});

	it('lists the breadcrumb trail ending on the product', () => {
		const { seo } = render();
		product.set({ ...base, breadcrumb_trail: [{ name: 'Sarees', path: '/collections/sarees' }] });
		TestBed.tick();
		expect(jsonLd(seo, 'product-crumbs')).toMatchObject({
			itemListElement: [{ position: 1 }, { position: 2, item: 'https://shop.test/product/red-saree' }],
		});
	});

	it('applies the meta title only when there is one', () => {
		const { seo } = render();
		product.set(base);
		TestBed.tick();
		expect(seo.applyDocument).not.toHaveBeenCalled();
		product.set({
			...base,
			meta_title: 'T',
			meta_description: 'D',
			product_meta_image: { original_url: '/m.jpg' },
		});
		TestBed.tick();
		expect(seo.applyDocument).toHaveBeenCalledWith({ title: 'T', description: 'D', image: '/m.jpg' });
		product.set({ ...base, meta_title: 'T' });
		TestBed.tick();
		expect(seo.applyDocument).toHaveBeenLastCalledWith({ title: 'T', description: undefined, image: undefined });
	});
});

describe('ProductDetail sticky bar', () => {
	const button = (bottom: number) => {
		const element = document.createElement('div');
		element.className = 'scroll-button';
		element.getBoundingClientRect = () => ({ bottom }) as DOMRect;
		document.body.append(element);
	};

	it('does nothing on the server or without the button', () => {
		const server = render({ platform: 'server' });
		button(-10);
		server.page.onScroll();
		expect(document.body.classList.contains('stickyCart')).toBe(false);
		document.querySelector('.scroll-button')?.remove();
		render().page.onScroll();
		expect(document.body.classList.contains('stickyCart')).toBe(false);
	});

	it('shows once the button has scrolled away, and hides again', () => {
		const { page } = render();
		button(-10);
		page.onScroll();
		expect(document.body.classList.contains('stickyCart')).toBe(true);
		document.querySelector('.scroll-button')?.remove();
		button(100);
		page.onScroll();
		expect(document.body.classList.contains('stickyCart')).toBe(false);
		document.querySelector('.scroll-button')?.remove();
		button(window.innerHeight + 100);
		page.onScroll();
		expect(document.body.classList.contains('stickyCart')).toBe(false);
	});

	it('removes the bar when leaving, in the browser only', () => {
		const server = render({ platform: 'server' });
		document.body.classList.add('stickyCart');
		server.fixture.destroy();
		expect(document.body.classList.contains('stickyCart')).toBe(true);
		const browser = render();
		browser.fixture.destroy();
		expect(document.body.classList.contains('stickyCart')).toBe(false);
	});
});
