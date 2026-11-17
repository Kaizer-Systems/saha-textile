import { AsyncPipe, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, HostListener, PLATFORM_ID, computed, effect, inject, signal, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { RESPONSE } from '@analogjs/router/tokens';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQueryClient } from '@tanstack/angular-query-experimental';
import { Observable } from 'rxjs';

import { rememberRecentView } from '@core/catalog/recent-views';
import { ConsentStore } from '@core/consent/consent.store';
import { ACTIVE_LOCALE } from '@core/i18n/active-locale';
import { withLocale } from '@core/i18n/locale';
import { LocaleSeo } from '@core/i18n/locale-seo';
import { roleSrcset } from '@core/media/resolved-image';
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
import { SkeletonPage } from '@features/page/skeleton-page/skeleton-page';
import { ProductSidebar } from '@features/shop/product-detail/sidebar/sidebar';
import { PaymentOption } from '@features/shop/product-detail/widgets/payment-option/payment-option';
import { ProductAction } from '@features/shop/product-detail/widgets/product-action/product-action';
import { ProductBundle } from '@features/shop/product-detail/widgets/product-bundle/product-bundle';
import { ProductDeliveryInformation } from '@features/shop/product-detail/widgets/product-delivery-information/product-delivery-information';
import { ProductDetailsTabs } from '@features/shop/product-detail/widgets/product-details-tabs/product-details-tabs';
import { ProductInformation } from '@features/shop/product-detail/widgets/product-information/product-information';
import { StickyCheckout } from '@features/shop/product-detail/widgets/sticky-checkout/sticky-checkout';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { FaqAccordion } from '@shared/ui/faq-accordion/faq-accordion';
import { isoDuration, posterFor, watchUrl } from '@shared/ui/video/video-links';

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
/** Schema.org's names for the options it knows. Anything else is named as the shop names it. */
const VARIES_BY: Record<string, string> = {
	color: 'https://schema.org/color',
	size: 'https://schema.org/size',
	material: 'https://schema.org/material',
	pattern: 'https://schema.org/pattern',
};

/** Description markup as plain text for structured data. */
const textOf = (html: string | undefined): string =>
	(html ?? '')
		.replace(/<[^>]*>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

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
		ProductBundle,
		ProductDetailsTabs,
		ProductSidebar,
		YouMayAlsoLike,
		ProductBlogs,
		StickyCheckout,
		SkeletonPage,
		FaqAccordion,
		AsyncPipe,
		TranslocoModule,
	],
})
export class ProductDetail {
	private readonly consent = inject(ConsentStore);
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
	/**
	 * A server render that ran out of time keeps the skeleton, so the page holds its shape while
	 * the browser fetches the product. Only a real 404 leaves the skeleton behind.
	 */
	readonly loading = computed(() => {
		if (this.productQuery.isPending()) return true;
		const error = this.productQuery.error();
		const missing = error instanceof HttpErrorResponse && error.status === 404;
		return !this.isBrowser && !!error && !missing;
	});
	readonly selectedVariation = signal<IVariation | null>(null);
	readonly breadcrumb = computed<IBreadcrumb>(() => {
		const product = this.product();
		const productLabel = this.transloco.translate('product');
		if (!product) return { title: productLabel, items: [] };
		const trail = product.breadcrumb_trail ?? [];
		return {
			title: product.name,
			items: [
				...(trail.length
					? trail.map((crumb) => ({ label: crumb.name, url: crumb.path, active: false }))
					: [{ label: productLabel, active: false }]),
				{ label: product.name, active: true },
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

	/** The lead photo's gallery widths for the server-rendered image (the browser swaps in the gallery). */
	readonly leadSrcset = computed(() => roleSrcset(this.product()?.product_thumbnail?.image, 'gallery'));

	private readonly galleryRef = viewChild(ProductGallery);
	readonly owlCar = computed(() => this.galleryRef()?.carousel());

	public isBrowser: boolean;
	/** The gallery is server-rendered (shop speed round 4); the browser-only stand-in waits for clean-up item SP1. */
	readonly galleryOnServer = true;

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
			if (error instanceof HttpErrorResponse && error.status === 404) {
				void this.router.navigate(['/404'], { skipLocationChange: true });
			}
		});

		effect(() => {
			const product = this.product();
			if (!this.isBrowser || !product?.slug || !this.consent.allows('functional')) return;
			rememberRecentView(window.localStorage, product.slug);
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
			this.seo.applyJsonLd('product-group', this.structuredProduct(product));
			// FAQ structured data mirrors the visible section, and goes when the section does.
			if (product.faq?.length) {
				this.seo.applyJsonLd('product-faq', {
					'@context': 'https://schema.org',
					'@type': 'FAQPage',
					mainEntity: product.faq.map((entry) => ({
						'@type': 'Question',
						name: entry.question,
						acceptedAnswer: { '@type': 'Answer', text: entry.answer },
					})),
				});
			} else {
				this.seo.removeJsonLd('product-faq');
			}
			this.seo.applyJsonLd('product-crumbs', {
				'@context': 'https://schema.org',
				'@type': 'BreadcrumbList',
				itemListElement: [
					...(product.breadcrumb_trail ?? []).map((crumb) => ({ name: crumb.name, path: crumb.path })),
					{ name: product.name, path: `/product/${product.slug}` },
				].map((crumb, index) => ({
					'@type': 'ListItem',
					position: index + 1,
					name: crumb.name,
					item: this.seo.absoluteUrl(crumb.path),
				})),
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
			const price = product.sale_price || product.price;
			const percent =
				product.sale_price && product.sale_price < product.price
					? Math.round((1 - product.sale_price / product.price) * 100)
					: 0;
			const facts = (product.semantic_attributes ?? [])
				.map((fact) => fact.value)
				.filter(Boolean)
				.slice(0, 3);
			this.seo.applyProduct({
				priceINR: price,
				imageAlt: product.name,
				// Link previews carry the price and why this saree (share brief, M1).
				shareTitle: `${product.name} · ₹${price.toLocaleString('en-IN')}`,
				shareDescription: [
					facts.join(' · '),
					percent ? this.transloco.translate('share_preview_offer', { percent }) : '',
				]
					.filter(Boolean)
					.join('. '),
				inStock: product.stock_status !== 'out_of_stock',
				cardImage: product.product_meta_image?.mime_type === 'image/jpeg',
			});
		});
	}

	/**
	 * Availability follows the buyable flag, so a made-to-order piece with no stock on hand
	 * still reads as in stock. Every address and image is absolute, as search engines need.
	 */
	private structuredProduct(product: IProduct) {
		const url = this.seo.absoluteUrl(`/product/${product.slug}`);
		const images = [
			...new Set(
				[product.product_thumbnail, ...(product.product_galleries ?? [])]
					.map((frame) => frame?.original_url)
					.filter((source): source is string => !!source),
			),
		]
			.slice(0, 10)
			.map((source) => this.seo.absoluteAsset(source));
		const image = images.length > 1 ? images : images[0];
		const facts = new Map((product.semantic_attributes ?? []).map((fact) => [fact.code, fact.value]));
		const description = textOf(product.description || product.short_description).slice(0, 5000) || undefined;
		const brand = { '@type': 'Brand', name: 'Saha Textile' };
		const seller = { '@type': 'Organization', name: 'Saha Textile' };
		// Stars only from approved reviews, and only once there is one (owner log § product page).
		const aggregateRating = product.reviews_count
			? {
					'@type': 'AggregateRating',
					ratingValue: Number(product.rating_count.toFixed(1)),
					reviewCount: product.reviews_count,
					bestRating: 5,
					worstRating: 1,
				}
			: undefined;
		// Fabric by the metre: the price is per metre (unit code MTR), so search shows "₹180 / m".
		const perMetre = product.sold_by === 'metre';
		const offer = (price: number, inStock: boolean, offerUrl = url) => ({
			'@type': 'Offer',
			priceCurrency: 'INR',
			price,
			...(perMetre
				? {
						priceSpecification: {
							'@type': 'UnitPriceSpecification',
							price,
							priceCurrency: 'INR',
							referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'MTR' },
						},
					}
				: {}),
			url: offerUrl,
			itemCondition: 'https://schema.org/NewCondition',
			availability: `https://schema.org/${inStock ? 'InStock' : 'OutOfStock'}`,
			seller,
		});
		// The product's videos, as search engines read them (VideoObject on the Product).
		const videos = (product.videos ?? []).map((video) => ({
			'@type': 'VideoObject',
			name: video.title,
			description: video.title,
			thumbnailUrl: [posterFor(video, 'large')],
			...(video.publishedAt ? { uploadDate: video.publishedAt } : {}),
			...(video.durationSeconds ? { duration: isoDuration(video.durationSeconds) } : {}),
			embedUrl: `https://www.youtube-nocookie.com/embed/${video.videoId}`,
			contentUrl: watchUrl(video),
		}));
		const shared = {
			...(videos.length ? { subjectOf: videos } : {}),
			description,
			brand,
			material: facts.get('fabric'),
			color: facts.get('color'),
			pattern: facts.get('pattern'),
			aggregateRating,
		};
		const variants = product.variations ?? [];
		if (variants.length > 1) {
			return {
				'@context': 'https://schema.org',
				'@type': 'ProductGroup',
				name: product.name,
				url,
				image,
				...shared,
				productGroupID: product.slug,
				variesBy: product.attributes.map((attribute) => VARIES_BY[attribute.slug] ?? attribute.name),
				hasVariant: variants.map((variation) => {
					const variantUrl = `${url}?variant=${encodeURIComponent(variation.sku)}`;
					return {
						'@type': 'Product',
						sku: variation.sku,
						name: variation.name || product.name,
						url: variantUrl,
						image,
						inProductGroupWithID: product.slug,
						offers: offer(
							variation.sale_price || variation.price,
							variation.stock_status === 'in_stock',
							variantUrl,
						),
					};
				}),
			};
		}
		const [only] = variants;
		return {
			'@context': 'https://schema.org',
			'@type': 'Product',
			name: product.name,
			url,
			image,
			...shared,
			sku: only?.sku || product.sku,
			offers: only
				? offer(only.sale_price || only.price, only.stock_status === 'in_stock')
				: offer(product.sale_price || product.price, product.stock_status === 'in_stock'),
		};
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
		// The next page must not inherit this product's structured data.
		for (const id of ['product-group', 'product-crumbs', 'product-faq']) this.seo.removeJsonLd(id);
	}
}
