import { AsyncPipe, isPlatformBrowser } from '@angular/common';
import { Component, HostListener, PLATFORM_ID, computed, effect, inject, signal, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Meta } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';

import { injectQueryClient } from '@tanstack/angular-query-experimental';
import { Observable } from 'rxjs';

import { SiteConfigStore } from '@core/state/site-config.store';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { Params } from '@data-access/interfaces/core.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';
import {
	RELATED_PRODUCTS_KEY,
	injectProductBySlugQuery,
	injectRelatedProductsQuery,
} from '@data-access/queries/product.queries';
import { SiteConfigService } from '@data-access/services/site-config.service';
import { ProductSidebar } from '@features/shop/product-detail/sidebar/sidebar';
import { PaymentOption } from '@features/shop/product-detail/widgets/payment-option/payment-option';
import { ProductAction } from '@features/shop/product-detail/widgets/product-action/product-action';
import { ProductBundle } from '@features/shop/product-detail/widgets/product-bundle/product-bundle';
import { ProductDeliveryInformation } from '@features/shop/product-detail/widgets/product-delivery-information/product-delivery-information';
import { ProductDetailsTabs } from '@features/shop/product-detail/widgets/product-details-tabs/product-details-tabs';
import { ProductInformation } from '@features/shop/product-detail/widgets/product-information/product-information';
import { ProductSocialShare } from '@features/shop/product-detail/widgets/product-social-share/product-social-share';
import { StickyCheckout } from '@features/shop/product-detail/widgets/sticky-checkout/sticky-checkout';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';

import { BuyBox } from './buy-box/buy-box';
import { ProductBlogs } from './product-blogs/product-blogs';
import { ProductGallery } from './product-gallery/product-gallery';
import { YouMayAlsoLike } from './you-may-also-like/you-may-also-like';

/**
 * Dynamic product detail page (our architecture — the demo `features/shop/product`
 * is left untouched). Thin orchestrator: reusable gallery + role-aware buy-box +
 * reused detail widgets (info, delivery, tabs, related, FBT, sidebar) + sticky.
 * Mounted at the KB-shaped `/en/product/:slug`.
 */
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
		AsyncPipe,
	],
})
export class ProductDetail {
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private meta = inject(Meta);
	private platformId = inject<Object>(PLATFORM_ID);
	private siteConfigService = inject(SiteConfigService);
	private queryClient = injectQueryClient();

	private readonly slug = signal<string | undefined>(undefined);
	private readonly productQuery = injectProductBySlugQuery(() => this.slug());
	product$: Observable<IProduct | undefined> = toObservable(computed(() => this.productQuery.data()));

	private readonly relatedParams = computed<Params | undefined>(() => {
		const p = this.productQuery.data();
		if (!p) return undefined;
		const ids = [...(p.related_products ?? []), ...(p.cross_sell_products ?? [])];
		const categoryIds = (p.categories ?? []).map((category) => category.id);
		return { ids: ids.join(','), category_ids: categoryIds.join(','), status: 1 };
	});
	private readonly relatedQuery = injectRelatedProductsQuery(() => this.relatedParams());

	siteConfig$: Observable<ISiteConfig> = toObservable(inject(SiteConfigStore).siteConfig) as Observable<ISiteConfig>;

	private readonly galleryRef = viewChild(ProductGallery);
	readonly owlCar = computed(() => this.galleryRef()?.carousel());

	public breadcrumb: IBreadcrumb = { title: 'Product', items: [] };
	public product: IProduct | undefined;
	public isBrowser: boolean;

	constructor() {
		this.isBrowser = isPlatformBrowser(this.platformId);

		this.route.params.subscribe((params) => this.slug.set(params['slug']));

		effect(() => {
			const related = this.relatedQuery.data();
			if (related) this.queryClient.setQueryData(RELATED_PRODUCTS_KEY, related);
		});

		// 404 when the slug matches no product.
		effect(() => {
			if (this.slug() && !this.productQuery.isFetching() && this.productQuery.data() === undefined) {
				void this.router.navigate(['/404']);
			}
		});

		effect(() => {
			this.siteConfigService.preloader.set(this.productQuery.isFetching() || this.relatedQuery.isFetching());
		});

		this.product$.subscribe((product) => {
			if (!product) return;
			this.product = product;
			this.breadcrumb = {
				title: product.name,
				items: [
					{ label: 'Product', active: true },
					{ label: product.name, active: false },
				],
			};
			product.meta_title && this.meta.updateTag({ property: 'og:title', content: product.meta_title });
			product.meta_description &&
				this.meta.updateTag({ property: 'og:description', content: product.meta_description });
			product.product_meta_image &&
				this.meta.updateTag({ property: 'og:image', content: product.product_meta_image.original_url });
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
