import { Component, computed, input } from '@angular/core';

import { injectHomeRailsQuery } from '@data-access/queries/product.queries';
import { Product } from '@features/themes/widgets/product/product';
import { productSlider6ItemMarginNav } from '@shared/data/owl-carousel';
import { Title } from '@shared/ui/title/title';

import { type ResolvedPageSectionView, sectionContainer } from '../page-builder.types';

/**
 * A product row (today's home rows: New arrivals, Bestsellers, Featured, On sale), reusing the home rows' own
 * markup and data. A row with nothing in it is not drawn (FX-12); Bestsellers stay hidden until there are orders.
 */
@Component({
	selector: 'app-pb-product-row',
	imports: [Product, Title],
	template: `
		@if (loading() || products().length) {
			<div class="product-section product-section-3">
				<div [class]="container()">
					<app-title
						[title]="section().title ?? ''"
						[style]="'simple'"
					/>
					<app-theme-product
						[supplied]="products()"
						[loading]="loading()"
						[fold]="early() ? 'first' : 'below'"
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
export class PbProductRow {
	readonly section = input.required<ResolvedPageSectionView>();
	/** The page's first section: its first card is then the early picture (FX-13). */
	readonly early = input(false);
	private readonly rails = injectHomeRailsQuery();
	readonly slider = productSlider6ItemMarginNav;
	readonly container = computed(() => sectionContainer(this.section()));
	readonly loading = computed(() => this.rails.isPending());
	readonly products = computed(() => {
		const data = this.rails.data();
		const rows = {
			new_arrivals: data?.newArrivals,
			bestsellers: data?.bestsellers,
			featured: data?.featured,
			on_sale: data?.sale,
		} as const;
		const source = this.section().source;
		const list = source && source in rows ? (rows[source as keyof typeof rows] ?? []) : [];
		return list.slice(0, this.section().cards ?? 8);
	});
}
