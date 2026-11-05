import { Component, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { IProduct } from '@data-access/interfaces/product.interface';
import { Product as ThemeProduct } from '@features/themes/widgets/product/product';
import { relatedProductSliderNav } from '@shared/data/owl-carousel';
import { Title } from '@shared/ui/title/title';

/**
 * "You May Also Like" rail below the PDP tabs. Reuses the shared theme
 * product-rail carousel (`app-theme-product`) with the SAME config the homepage
 * rails use, so the styled nav arrows and card look are identical (no custom
 * carousel styling). The product page supplies the cards: its saved related and
 * upsell relations, at most 12.
 */
@Component({
	selector: 'app-you-may-also-like',
	templateUrl: './you-may-also-like.html',
	styleUrls: ['./you-may-also-like.scss'],
	imports: [Title, ThemeProduct, TranslocoModule],
})
export class YouMayAlsoLike {
	readonly products = input<IProduct[]>([]);

	public slider = relatedProductSliderNav;
}
