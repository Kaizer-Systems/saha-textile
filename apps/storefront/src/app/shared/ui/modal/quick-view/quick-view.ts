import { Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import { SiteConfigStore } from '@core/state/site-config.store';
import { IProduct, IVariation } from '@data-access/interfaces/product.interface';
import { injectProductBySlugQuery } from '@data-access/queries/product.queries';
import { BuyBox } from '@features/shop/product-detail/buy-box/buy-box';
import { ProductGallery } from '@features/shop/product-detail/product-gallery/product-gallery';

/**
 * Quick view rebuilt from the product page's own parts (bundle builder brief G03/G04, HF; owner, 22 Nov 2026): the
 * page's gallery (its thumbnails, phone dots and zoom) and its buy box (every option, free items, a set's rows, Add to
 * cart), side by side on laptops and tablets. On phones the pop-up is centred with space above and below; its content
 * scrolls inside while the page behind stays still. The product is the page's own query, so a later visit to the page
 * opens from the cache.
 */
@Component({
	selector: 'app-quick-view',
	templateUrl: './quick-view.html',
	styleUrls: ['./quick-view.scss'],
	// The rules size the pop-up's own frame, which sits outside this component; all are keyed on `.st-quick-view`.
	encapsulation: ViewEncapsulation.None,
	imports: [TranslocoModule, RouterLink, ProductGallery, BuyBox],
})
export class QuickView {
	readonly modal = inject(NgbActiveModal);
	readonly siteConfig = inject(SiteConfigStore).siteConfig;

	/** Set by the opener. */
	readonly slug = signal<string | undefined>(undefined);
	/** The card's own product, shown by name while the full product loads. */
	readonly card = signal<IProduct | null>(null);

	private readonly query = injectProductBySlugQuery(
		() => this.slug(),
		() => null,
	);
	readonly product = computed<IProduct | undefined>(() => this.query.data());
	readonly failed = computed(() => this.query.isError());
	readonly variation = signal<IVariation | null>(null);
}

/** How every card opens the quick view: centred, scrolling inside, sized by its window class. */
export const QUICK_VIEW_OPTIONS = {
	centered: true,
	scrollable: true,
	size: 'xl',
	windowClass: 'st-quick-view',
	ariaLabelledBy: undefined,
} as const;
