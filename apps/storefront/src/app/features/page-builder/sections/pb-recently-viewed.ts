import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, Component, computed, inject, input, PLATFORM_ID, signal } from '@angular/core';

import { readRecentViews } from '@core/catalog/recent-views';
import { IProduct } from '@data-access/interfaces/product.interface';
import { ProductService } from '@data-access/services/product.service';
import { Product } from '@features/themes/widgets/product/product';
import { productSlider6ItemMarginNav } from '@shared/data/owl-carousel';
import { Title } from '@shared/ui/title/title';

import { type ResolvedPageSectionView, sectionContainer } from '../page-builder.types';

/** Recently viewed: filled in the browser after paint, so only ever below the first screen (FX-14). */
@Component({
	selector: 'app-pb-recently-viewed',
	imports: [Product, Title],
	template: `
		@if (products().length) {
			<div class="product-section product-section-3">
				<div [class]="container()">
					<app-title
						[title]="section().title ?? ''"
						[style]="'simple'"
					/>
					<app-theme-product
						[supplied]="products()"
						[fold]="'below'"
						[style]="'horizontal'"
						[slider]="true"
						[sliderOption]="slider"
						[productStyle]="'product-solid'"
						[boxClass]="'product-box-bg'"
					/>
				</div>
			</div>
		}
	`,
})
export class PbRecentlyViewed {
	readonly section = input.required<ResolvedPageSectionView>();
	readonly slider = productSlider6ItemMarginNav;
	readonly products = signal<IProduct[]>([]);
	readonly container = computed(() => sectionContainer(this.section()));

	constructor() {
		const browser = isPlatformBrowser(inject(PLATFORM_ID));
		const api = inject(ProductService);
		afterNextRender(() => {
			if (!browser) return;
			const slugs = readRecentViews(localStorage).map((row) => row.slug);
			if (slugs.length) api.cardsFor(slugs).subscribe((cards) => this.products.set(cards));
		});
	}
}
