import { Component, computed, inject } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { Button } from '@shared/ui/button/button';

import { BUY_BAR_HOST } from './buy-bar-host';

/**
 * The buy bar (owner, 21 Nov 2026, product page brief P4, section 7): one markup for every kind of product, a summary
 * line (photo, name, price) and an action line (quantity or length, Add to cart, Buy now; Notify me when sold out). It
 * reads and acts through the page's own buy box, so a choice made anywhere is the same choice in the cart. The page
 * reveals it with the theme's `stickyCart` switch: from the start on phones, on laptops whenever its buttons are out
 * of view.
 */
@Component({
	selector: 'app-buy-bar',
	templateUrl: './buy-bar.html',
	providers: [CurrencySymbolPipe],
	imports: [Button, CurrencySymbolPipe, TranslocoModule],
})
export class BuyBar {
	readonly host = inject(BUY_BAR_HOST);

	/** The chosen option's photo, else the product's. */
	readonly photo = computed(
		() =>
			this.host.summary()?.variation?.variation_image?.original_url ??
			this.host.product().product_thumbnail?.original_url ??
			'assets/images/product.png',
	);
}
