import { AsyncPipe, isPlatformBrowser } from '@angular/common';
import { Component, HostListener, computed, effect, inject, PLATFORM_ID, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Meta } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';

import { injectQueryClient } from '@tanstack/angular-query-experimental';
import { Observable } from 'rxjs';

import { ProductAccordion } from './product-details/product-accordion/product-accordion';
import { ProductImages } from './product-details/product-images/product-images';
import { ProductSlider } from './product-details/product-slider/product-slider';
import { ProductSticky } from './product-details/product-sticky/product-sticky';
import { ProductThumbnail } from './product-details/product-thumbnail/product-thumbnail';
import { RelatedProducts } from './product-details/widgets/related-products/related-products';
import { StickyCheckout } from './product-details/widgets/sticky-checkout/sticky-checkout';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import {
	RELATED_PRODUCTS_KEY,
	injectProductBySlugQuery,
	injectRelatedProductsQuery,
} from '@data-access/queries/product.queries';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { Params } from '@data-access/interfaces/core.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { ThemeOptionService } from '@data-access/services/theme-option.service';
import { ThemeOptionStore } from '@core/state/theme-option.store';

@Component({
	selector: 'app-product',
	templateUrl: './product.html',
	styleUrls: ['./product.scss'],
	imports: [
		Breadcrumb,
		ProductThumbnail,
		ProductImages,
		ProductSlider,
		ProductSticky,
		ProductAccordion,
		RelatedProducts,
		StickyCheckout,
		AsyncPipe,
	],
})
export class Product {
	private route = inject(ActivatedRoute);
	private meta = inject(Meta);
	private router = inject(Router);
	private platformId = inject<Object>(PLATFORM_ID);
	private themeOptionService = inject(ThemeOptionService);
	private queryClient = injectQueryClient();

	private readonly slug = signal<string | undefined>(undefined);
	private readonly productQuery = injectProductBySlugQuery(() => this.slug());
	product$: Observable<IProduct | undefined> = toObservable(computed(() => this.productQuery.data()));

	// Related/cross-sell + same-category params derived from the selected product
	// (the slug reducer used to chain-dispatch GetRelatedProductsAction with these).
	private readonly relatedParams = computed<Params | undefined>(() => {
		const p = this.productQuery.data();
		if (!p) return undefined;
		const ids = [...(p.related_products ?? []), ...(p.cross_sell_products ?? [])];
		const categoryIds = (p.categories ?? []).map((category) => category.id);
		return { ids: ids.join(','), category_ids: categoryIds.join(','), status: 1 };
	});
	private readonly relatedQuery = injectRelatedProductsQuery(() => this.relatedParams());

	themeOptions$: Observable<IOption> = toObservable(inject(ThemeOptionStore).themeOptions) as Observable<IOption>;

	public breadcrumb: IBreadcrumb = {
		title: 'Product',
		items: [],
	};
	public layout: string = 'product_thumbnail';
	public product: IProduct;
	public isScrollActive = false;
	public isBrowser: boolean;

	constructor() {
		this.isBrowser = isPlatformBrowser(this.platformId);

		// Product looked up by slug via the query (was ProductResolver + selectedProduct).
		this.route.params.subscribe((params) => this.slug.set(params['slug']));

		// Mirror the derived related set into the shared slot the detail widgets read.
		effect(() => {
			const related = this.relatedQuery.data();
			if (related) this.queryClient.setQueryData(RELATED_PRODUCTS_KEY, related);
		});

		// 404 when the slug matches no product (was router.navigate in the reducer).
		effect(() => {
			if (this.slug() && !this.productQuery.isFetching() && this.productQuery.data() === undefined) {
				void this.router.navigate(['/404']);
			}
		});

		// Preloader mirrors the two queries' fetch state (was toggled by the reducers).
		effect(() => {
			this.themeOptionService.preloader.set(
				this.productQuery.isFetching() || this.relatedQuery.isFetching(),
			);
		});

		this.product$.subscribe((product) => {
			if (product) {
				this.breadcrumb.items = [];
				this.breadcrumb.title = product.name;
				this.breadcrumb.items.push({ label: 'Product', active: true }, { label: product.name, active: false });
				this.product = product;
				product?.meta_title && this.meta.updateTag({ property: 'og:title', content: product?.meta_title });
				product?.meta_description &&
					this.meta.updateTag({ property: 'og:description', content: product?.meta_description });
				product?.product_meta_image &&
					this.meta.updateTag({
						property: 'og:image',
						content: product?.product_meta_image.original_url,
					});
				product?.product_meta_image && this.meta.updateTag({ property: 'og:image:width', content: '500' });
				product?.product_meta_image && this.meta.updateTag({ property: 'og:image:height', content: '500' });
			}
		});

		// For Demo Purpose only
		this.route.queryParams.subscribe((params) => {
			if (params['layout']) {
				this.layout = params['layout'];
			} else {
				// Get Product Layout
				this.themeOptions$.subscribe((option) => {
					this.layout =
						option?.product && option?.product?.product_layout
							? option?.product?.product_layout
							: 'product_thumbnail';
				});
			}
		});
	}

	@HostListener('window:scroll')
	onScroll() {
		if (this.isBrowser) {
			const button = document.querySelector('.scroll-button');
			if (button) {
				const buttonRect = button.getBoundingClientRect();
				if (buttonRect.bottom < window.innerHeight && buttonRect.bottom < 0) {
					this.isScrollActive = true;
					document.body.classList.add('stickyCart');
				} else {
					this.isScrollActive = false;
					document.body.classList.remove('stickyCart');
				}
			}
		}
	}

	ngOnDestroy() {
		if (this.isBrowser) {
			document.body.classList.remove('stickyCart');
		}
	}
}
