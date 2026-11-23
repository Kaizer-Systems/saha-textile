import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { RESPONSE } from '@analogjs/router/tokens';
import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsentStore } from '@core/consent/consent.store';
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
	options: {
		platform?: string;
		variant?: string | null;
		response?: unknown;
		noQuery?: boolean;
		functional?: boolean;
	} = {},
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
		removeJsonLd: vi.fn(),
		applyDocument: vi.fn(),
		applyProduct: vi.fn(),
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
			{ provide: ConsentStore, useValue: { allows: () => options.functional ?? true } },
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

describe('ProductDetail: share picture size, metre offers and the lead photo', () => {
	it('gives link previews the share picture’s size and type only when the API sent both', () => {
		const { seo } = render();
		pending.set(false);
		product.set({
			...base,
			product_meta_image: {
				original_url: '/share.jpg',
				pixels: { width: 1200, height: 630 },
				mime_type: 'image/jpeg',
			},
		});
		TestBed.tick();
		expect(seo.applyProduct.mock.lastCall?.[0]).toMatchObject({
			imageSize: { width: 1200, height: 630, type: 'image/jpeg' },
		});
		product.set({
			...base,
			product_meta_image: { original_url: '/share.jpg', pixels: { width: 1200, height: 630 } },
		});
		TestBed.tick();
		expect(seo.applyProduct.mock.lastCall?.[0]?.imageSize).toBeUndefined();
	});

	it('prices fabric per metre in its structured data', () => {
		const { seo } = render();
		pending.set(false);
		product.set({ ...base, sold_by: 'metre' });
		TestBed.tick();
		expect(JSON.stringify(jsonLd(seo, 'product-group'))).toContain('"unitCode":"MTR"');
	});

	it('offers the lead photo’s gallery widths, none without pipeline images', () => {
		const { page } = render();
		expect(page.leadSrcset()).toBeNull();
	});
});
