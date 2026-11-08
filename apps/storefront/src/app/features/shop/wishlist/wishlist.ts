import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { WishlistStore } from '@core/state/wishlist/wishlist.store';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { NoData } from '@shared/ui/no-data/no-data';
import { ProductBox } from '@shared/ui/product-box/product-box';
import { SkeletonProductBox } from '@shared/ui/product-box/skeleton-product-box/skeleton-product-box';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

/**
 * The wishlist page: the shopper's real list, newest first, as theme product cards with the
 * remove button. A guest's comes from the session cookie, a customer's from the account.
 */
@Component({
	selector: 'app-wishlist',
	templateUrl: './wishlist.html',
	styleUrls: ['./wishlist.scss'],
	imports: [Breadcrumb, SkeletonProductBox, ProductBox, NoData, TranslocoModule],
})
export class Wishlist {
	readonly wishlist = inject(WishlistStore);

	public breadcrumb = translatedBreadcrumb('wishlist');

	public skeletonItems = Array.from({ length: 6 }, (_, index) => index);

	/** False until the browser has the list: the server shows the skeleton, never a false "empty". */
	readonly ready = signal(false);

	constructor() {
		if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
		void this.wishlist.loadPage().then(() => this.ready.set(true));
	}
}
