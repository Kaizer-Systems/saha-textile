import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meta } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SiteConfigStore } from '@core/state/site-config.store';
import { IProduct } from '@data-access/interfaces/product.interface';
import { ProductService } from '@data-access/services/product.service';
import { SiteConfigService } from '@data-access/services/site-config.service';

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
			{ provide: SiteConfigService, useValue: { preloader: signal(true) } },
			{ provide: SiteConfigStore, useValue: { siteConfig: signal(null) } },
		],
	});
	TestBed.overrideComponent(ProductDetail, {
		set: {
			imports: [],
			template: `<h2 class="crumb">{{ breadcrumb().title }}</h2>
				@if (product(); as product) {<section class="product-section">{{ product.name }}</section>}`,
		},
	});
	const fixture = TestBed.createComponent(ProductDetail);
	fixture.autoDetectChanges();
	return { fixture, navigate, meta: TestBed.inject(Meta) };
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

		await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(['/404']));
		expect(fixture.nativeElement.querySelector('.product-section')).toBeNull();
	});
});
