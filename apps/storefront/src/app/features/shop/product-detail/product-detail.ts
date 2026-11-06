import { AsyncPipe, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, HostListener, PLATFORM_ID, computed, effect, inject, signal, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { RESPONSE } from '@analogjs/router/tokens';

import { TranslocoService } from '@jsverse/transloco';
import { injectQueryClient } from '@tanstack/angular-query-experimental';
import { Observable } from 'rxjs';

import { rememberRecentView } from '@core/catalog/recent-views';
import { ACTIVE_LOCALE } from '@core/i18n/active-locale';
import { withLocale } from '@core/i18n/locale';
import { LocaleSeo } from '@core/i18n/locale-seo';
import { SiteConfigStore } from '@core/state/site-config.store';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { Params } from '@data-access/interfaces/core.interface';
import { IProduct, IVariation } from '@data-access/interfaces/product.interface';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';
import {
	RELATED_PRODUCTS_KEY,
	injectProductBySlugQuery,
	injectProductRelationsQuery,
} from '@data-access/queries/product.queries';
import { ProductSidebar } from '@features/shop/product-detail/sidebar/sidebar';
import { PaymentOption } from '@features/shop/product-detail/widgets/payment-option/payment-option';
import { ProductAction } from '@features/shop/product-detail/widgets/product-action/product-action';
import { ProductBundle } from '@features/shop/product-detail/widgets/product-bundle/product-bundle';
import { ProductDeliveryInformation } from '@features/shop/product-detail/widgets/product-delivery-information/product-delivery-information';
import { ProductDetailsTabs } from '@features/shop/product-detail/widgets/product-details-tabs/product-details-tabs';
import { ProductInformation } from '@features/shop/product-detail/widgets/product-information/product-information';
import { ProductSocialShare } from '@features/shop/product-detail/widgets/product-social-share/product-social-share';
import { StickyCheckout } from '@features/shop/product-detail/widgets/sticky-checkout/sticky-checkout';
import { SkeletonPage } from '@features/page/skeleton-page/skeleton-page';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';

import { BuyBox } from './buy-box/buy-box';
import { ProductBlogs } from './product-blogs/product-blogs';
import { ProductGallery } from './product-gallery/product-gallery';
import { YouMayAlsoLike } from './you-may-also-like/you-may-also-like';

/**
 * Dynamic product detail page (our architecture — the demo `features/shop/product`
 * is left untouched). Thin orchestrator: reusable gallery + role-aware buy-box +
 * reused detail widgets (info, delivery, tabs, related, FBT, sidebar) + sticky.
 * Mounted at `/<locale>/product/:slug`.
 */
const uniqueCards = (cards: IProduct[]): IProduct[] =>
	cards.filter((card, index) => cards.findIndex((other) => other.id === card.id) === index);

@Component({
	selector: 'app-product-detail',
	templateUrl: './product-detail.html',
	styleUrls: ['./product-detail.scss'],
	imports: [
		Breadcrumb,
		ProductGallery,
		BuyBox,
		ProductAction,
		ProductInformation,
		ProductDeliveryInformation,
		PaymentOption,
		ProductSocialShare,
		ProductBundle,
		ProductDetailsTabs,
		ProductSidebar,
		YouMayAlsoLike,
		ProductBlogs,
		StickyCheckout,
		SkeletonPage,
		AsyncPipe,
	],
})
export class ProductDetail {
	private route = inject(ActivatedRoute);
	private transloco = inject(TranslocoService);
	private router = inject(Router);
	private seo = inject(LocaleSeo);
	private platformId = inject<Object>(PLATFORM_ID);
	private queryClient = injectQueryClient();

	private readonly locale = inject(ACTIVE_LOCALE);
	/** Present only while rendering on the server. */
	private readonly response = inject(RESPONSE, { optional: true });

	private readonly slug = signal<string | undefined>(this.route.snapshot.params['slug']);
	private readonly variantSku = signal<string | null>(this.route.snapshot.queryParamMap?.get('variant') ?? null);
	private readonly productQuery = injectProductBySlugQuery(
		() => this.slug(),
		() => this.variantSku(),
	);
	/**
	 * Read straight from the query signal, so the template re-renders when the data lands. A plain
	 * field assigned from a `toObservable` subscription is written inside an effect, which never marks
	 * the view dirty: the server render showed the product, but the hydrated page went blank.
	 */
	readonly product = computed<IProduct | undefined>(() => this.productQuery.data());
	/** True only until a product first arrives; a variant change keeps the current one on screen. */
	readonly loading = computed(() => this.productQuery.isPending());
	readonly selectedVariation = signal<IVariation | null>(null);
	readonly breadcrumb = computed<IBreadcrumb>(() => {
		const product = this.product();
		const productLabel = this.transloco.translate('product');
		if (!product) return { title: productLabel, items: [] };
		return {
			title: product.name,
			items: [
				{ label: productLabel, active: true },
				{ label: product.name, active: false },
			],
		};
	});

	private readonly relationsQuery = injectProductRelationsQuery(() => this.slug());
	/** "You May Also Like": saved related, then upsell cards, at most 12. */
	readonly alsoLike = computed<IProduct[]>(() => {
		const rails = this.relationsQuery.data();
		return rails ? uniqueCards([...rails.related, ...rails.upsell]).slice(0, 12) : [];
	});

	siteConfig$: Observable<ISiteConfig> = toObservable(inject(SiteConfigStore).siteConfig) as Observable<ISiteConfig>;

	private readonly galleryRef = viewChild(ProductGallery);
	readonly owlCar = computed(() => this.galleryRef()?.carousel());

	private readonly document = inject(DOCUMENT);

	public isBrowser: boolean;

	constructor() {
		this.isBrowser = isPlatformBrowser(this.platformId);

		this.route.params.subscribe((params) => this.slug.set(params['slug']));
		this.route.queryParamMap?.subscribe((params) => this.variantSku.set(params.get('variant')));

		effect(() => {
			const rails = this.relationsQuery.data();
			if (!rails) return;
			const cards = uniqueCards([...rails.related, ...rails.crossSell, ...rails.upsell, ...rails.boughtTogether]);
			this.queryClient.setQueryData(RELATED_PRODUCTS_KEY, cards.slice(0, 12));
		});

		// 404 only when the API says the product does not exist. A server render that ran out
		// of time leaves the page to the browser instead.
		effect(() => {
			const error = this.productQuery.error();
			if (error instanceof HttpErrorResponse && error.status === 404) void this.router.navigate(['/404']);
		});

		effect(() => {
			const product = this.product();
			if (!this.isBrowser || !product?.slug) return;
			rememberRecentView(window.sessionStorage, product.slug);
		});

		// An unknown SKU redirects once to the clean path: a real 302 on the server, a replace in the browser.
		effect(() => {
			const product = this.product();
			if (!product?.unknown_variant || !this.variantSku()) return;
			if (this.response) {
				this.response.statusCode = 302;
				this.response.setHeader('Location', withLocale(this.locale, `/product/${product.slug}`));
				this.response.setHeader('Cache-Control', 'private, no-store');
				return;
			}
			void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
		});

		effect(() => {
			const product = this.product();
			if (!product) return;
			const scriptId = 'product-group';
			let script = this.document.getElementById(scriptId) as HTMLScriptElement | null;
			if (!script) {
				script = this.document.createElement('script');
				script.id = scriptId;
				script.type = 'application/ld+json';
				this.document.head.appendChild(script);
			}
			const variants = product.variations ?? [];
			const offer = (variation: {
				sku?: string;
				name?: string;
				sale_price?: number;
				price?: number;
				quantity?: number;
			}) => ({
				'@type': 'Offer',
				priceCurrency: 'INR',
				price: variation.sale_price || variation.price,
				availability: variation.quantity ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
			});
			script.textContent = JSON.stringify(
				variants.length > 1
					? {
							'@context': 'https://schema.org',
							'@type': 'ProductGroup',
							name: product.name,
							productGroupID: product.slug,
							hasVariant: variants.map((variation) => ({
								'@type': 'Product',
								sku: variation.sku,
								name: variation.name || product.name,
								offers: offer(variation),
							})),
						}
					: {
							'@context': 'https://schema.org',
							'@type': 'Product',
							name: product.name,
							sku: variants[0]?.sku || product.sku,
							offers: offer(
								variants[0] ?? {
									sale_price: product.sale_price,
									price: product.price,
									quantity: product.quantity,
								},
							),
						},
			);
			this.seo.applyJsonLd('product-crumbs', {
				'@context': 'https://schema.org',
				'@type': 'BreadcrumbList',
				itemListElement: [
					{ '@type': 'ListItem', position: 1, name: 'Product', item: '/product' },
					{ '@type': 'ListItem', position: 2, name: product.name, item: `/product/${product.slug}` },
				],
			});
		});

		effect(() => {
			const product = this.product();
			if (!product) return;
			product.meta_title &&
				this.seo.applyDocument({
					title: product.meta_title,
					description: product.meta_description,
					image: product.product_meta_image?.original_url,
				});
		});
	}

	@HostListener('window:scroll')
	onScroll() {
		if (!this.isBrowser) return;
		const button = document.querySelector('.scroll-button');
		if (!button) return;
		const rect = button.getBoundingClientRect();
		if (rect.bottom < window.innerHeight && rect.bottom < 0) {
			document.body.classList.add('stickyCart');
		} else {
			document.body.classList.remove('stickyCart');
		}
	}

	ngOnDestroy() {
		if (this.isBrowser) document.body.classList.remove('stickyCart');
	}
}
