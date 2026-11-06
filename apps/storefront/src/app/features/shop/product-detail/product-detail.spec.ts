import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meta } from '@angular/platform-browser';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SiteConfigStore } from '@core/state/site-config.store';
import { IProduct } from '@data-access/interfaces/product.interface';
import { ProductService } from '@data-access/services/product.service';

import { ProductDetail } from './product-detail';

const saree = {
	id: 1,
	name: 'Pure Cotton Handloom Saree',
	slug: 'pure-cotton-handloom-saree',
	meta_title: 'Pure Cotton Handloom Saree | Saha Textile',
	categories: [],
} as unknown as IProduct;

/**
 * The page must show the product as soon as its query resolves, with no manual change detection.
 * The original bug was a plain field written from a subscription: the state was right, but the
 * hydrated view stayed blank. The real template (carousels, buy-box) is replaced with a thin one
 * that reads the same bindings.
 */
function harness(slug: string) {
	const navigate = vi.fn().mockResolvedValue(true);
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [ProductDetail, TranslocoTestingModule.forRoot({ langs: { en: { product: 'Product' } } })],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ActivatedRoute, useValue: { params: of({ slug }), snapshot: { params: { slug } } } },
			{ provide: Router, useValue: { navigate, events: of() } },
			{
				provide: ProductService,
				useValue: {
					getProductPage: (slug: string) =>
						slug === saree.slug ? of(saree) : throwError(() => new HttpErrorResponse({ status: 404 })),
				},
			},
			{ provide: SiteConfigStore, useValue: { siteConfig: signal(null) } },
		],
	});
	TestBed.overrideComponent(ProductDetail, {
		set: {
			imports: [],
			template: THIN_TEMPLATE,
		},
	});
	const fixture = TestBed.createComponent(ProductDetail);
	fixture.autoDetectChanges();
	return { fixture, navigate, meta: TestBed.inject(Meta) };
}

const THIN_TEMPLATE = `<h2 class="crumb">{{ breadcrumb().title }}</h2>
	@if (product(); as product) {<section class="product-section">{{ product.name }}</section>}
	@else if (loading()) {<section class="waiting"></section>}`;

/** A page whose every product request stays open until the test answers it. */
function waitingHarness() {
	const params = new BehaviorSubject({ slug: saree.slug });
	const query = new BehaviorSubject(convertToParamMap({}));
	const requests: Subject<IProduct>[] = [];
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [ProductDetail, TranslocoTestingModule.forRoot({ langs: { en: { product: 'Product' } } })],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{
				provide: ActivatedRoute,
				useValue: { params, queryParamMap: query, snapshot: { params: { slug: saree.slug } } },
			},
			{ provide: Router, useValue: { navigate: vi.fn(), events: of() } },
			{
				provide: ProductService,
				useValue: {
					getProductPage: () => {
						const request = new Subject<IProduct>();
						requests.push(request);
						return request;
					},
				},
			},
			{ provide: SiteConfigStore, useValue: { siteConfig: signal(null) } },
		],
	});
	TestBed.overrideComponent(ProductDetail, { set: { imports: [], template: THIN_TEMPLATE } });
	const fixture = TestBed.createComponent(ProductDetail);
	fixture.autoDetectChanges();
	const answer = (product: IProduct) => {
		const request = requests[requests.length - 1];
		request.next(product);
		request.complete();
	};
	return { el: fixture.nativeElement as HTMLElement, params, query, requests, answer };
}

describe('the product detail page', () => {
	it('renders the product, its breadcrumb and OG title once the query resolves', async () => {
		const { fixture, meta } = harness(saree.slug);

		const el: HTMLElement = fixture.nativeElement;
		await vi.waitFor(() => expect(el.querySelector('.product-section')?.textContent).toBe(saree.name));
		expect(el.querySelector('.crumb')?.textContent).toBe(saree.name);
		expect(meta.getTag('property="og:title"')?.content).toBe(saree.meta_title);
	});

	it('sends an unknown slug to the 404 page', async () => {
		const { fixture, navigate } = harness('no-such-saree');

		await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(['/404'], { skipLocationChange: true }));
		expect(fixture.nativeElement.querySelector('.product-section')).toBeNull();
	});

	it('shows placeholders only until the first product arrives', async () => {
		const { el, requests, answer } = waitingHarness();

		await vi.waitFor(() => expect(requests).toHaveLength(1));
		expect(el.querySelector('.waiting')).not.toBeNull();

		answer(saree);
		await vi.waitFor(() => expect(el.querySelector('.product-section')?.textContent).toBe(saree.name));
		expect(el.querySelector('.waiting')).toBeNull();
	});

	it('keeps the product on screen while another variant of it loads', async () => {
		const { el, query, requests, answer } = waitingHarness();
		await vi.waitFor(() => expect(requests).toHaveLength(1));
		answer(saree);
		await vi.waitFor(() => expect(el.querySelector('.product-section')).not.toBeNull());

		query.next(convertToParamMap({ variant: 'SKU-RED' }));

		await vi.waitFor(() => expect(requests).toHaveLength(2));
		expect(el.querySelector('.product-section')?.textContent).toBe(saree.name);
		expect(el.querySelector('.waiting')).toBeNull();
	});

	it('goes back to placeholders when moving to a different product', async () => {
		const { el, params, requests, answer } = waitingHarness();
		await vi.waitFor(() => expect(requests).toHaveLength(1));
		answer(saree);
		await vi.waitFor(() => expect(el.querySelector('.product-section')).not.toBeNull());

		params.next({ slug: 'kurti-palazzo-set' });

		await vi.waitFor(() => expect(requests).toHaveLength(2));
		await vi.waitFor(() => expect(el.querySelector('.waiting')).not.toBeNull());
		expect(el.querySelector('.product-section')).toBeNull();
	});
});
