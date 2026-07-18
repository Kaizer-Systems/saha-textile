import { Component, computed } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { IProduct } from '@data-access/interfaces/product.interface';
import { injectProductsQuery } from '@data-access/queries/product.queries';
import { Product as ThemeProduct } from '@features/themes/widgets/product/product';
import { relatedProductSliderNav } from '@shared/data/owl-carousel';
import { Title } from '@shared/ui/title/title';

/**
 * "You May Also Like" rail below the PDP tabs. Reuses the shared theme
 * product-rail carousel (`app-theme-product`) with the SAME config the homepage
 * rails use, so the styled nav arrows and card look are identical (no custom
 * carousel styling). Gated on loaded products so owl mounts with the full item
 * set. `app-theme-product` lives in the kept `features/themes/widgets` library
 * (used by the homepage) — not a demo page. For now it shows the whole
 * catalogue; it will narrow to true related products when relations are wired.
 */
@Component({
	selector: 'app-you-may-also-like',
	templateUrl: './you-may-also-like.html',
	styleUrls: ['./you-may-also-like.scss'],
	imports: [Title, ThemeProduct, TranslocoModule],
})
export class YouMayAlsoLike {
	private readonly productsQuery = injectProductsQuery(() => undefined);

	readonly products = computed<IProduct[]>(() => this.productsQuery.data()?.data ?? []);
	readonly productIds = computed(() => this.products().map((p) => p.id));

	public slider = relatedProductSliderNav;
}
