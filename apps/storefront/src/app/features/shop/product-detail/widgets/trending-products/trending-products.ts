import { Component, computed, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { IProduct } from '@data-access/interfaces/product.interface';
import { injectProductTrendingQuery } from '@data-access/queries/product.queries';
import { ProductBox } from '@shared/ui/product-box/product-box';

/**
 * "Trending products" beside the product: what shoppers have been opening in the same
 * categories lately, topped up with their bestsellers, in the theme's small list cards.
 */
@Component({
	selector: 'app-trending-products',
	templateUrl: './trending-products.html',
	styleUrls: ['./trending-products.scss'],
	imports: [ProductBox, TranslocoModule],
})
export class TrendingProducts {
	readonly product = input<IProduct | null>();

	private readonly trendingQuery = injectProductTrendingQuery(() => this.product()?.slug);
	readonly products = computed(() => this.trendingQuery.data() ?? []);
}
