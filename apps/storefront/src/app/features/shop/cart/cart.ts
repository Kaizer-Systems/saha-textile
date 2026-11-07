import { AsyncPipe } from '@angular/common';
import { Component, effect, inject, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { CartFacade } from '@core/state/cart/cart.facade';
import { OnlineStatus } from '@core/state/online-status';
import { WishlistFacade } from '@core/state/wishlist/wishlist.store';
import { ICart, ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { CartLineConfig } from '@shared/ui/cart-line-config/cart-line-config';
import { ProductConfigModal } from '@shared/ui/modal/product-config-modal/product-config-modal';
import { NoData } from '@shared/ui/no-data/no-data';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

@Component({
	selector: 'app-cart',
	templateUrl: './cart.html',
	styleUrls: ['./cart.scss'],
	providers: [CurrencySymbolPipe],
	imports: [
		Breadcrumb,
		RouterLink,
		Button,
		CartLineConfig,
		ProductConfigModal,
		NoData,
		AsyncPipe,
		CurrencySymbolPipe,
		TranslocoModule,
	],
})
export class Cart {
	private wishlistFacade = inject(WishlistFacade);
	private cartFacade = inject(CartFacade);

	/** Offline the saved cart stays readable; prices and stock need the server, so changes pause. */
	readonly online = inject(OnlineStatus).online;
	private wasOffline = false;

	cartItem$: Observable<ICart[]> = this.cartFacade.cartItems$;
	cartTotal$: Observable<number> = this.cartFacade.cartTotal$;

	/** Composed per-unit price (base + add-on/bundle deltas) when present, else plain sale price. */
	unitPrice(item: ICart): number {
		return item.unit_price ?? (item.variation ? item.variation.sale_price : item.product.sale_price);
	}

	public breadcrumb = translatedBreadcrumb('cart');

	constructor() {
		effect(() => {
			const online = this.online();
			if (online && this.wasOffline) untracked(() => this.cartFacade.getCartItems());
			this.wasOffline = !online;
		});
	}

	updateQuantity(item: ICart, qty: number) {
		const params: ICartAddOrUpdate = {
			id: item.id,
			product: item.product,
			product_id: item.product.id,
			variation: item.variation,
			variation_id: item?.variation_id ? item?.variation_id : null,
			quantity: qty,
		};
		this.cartFacade.updateCart(params);
	}

	delete(id: string) {
		this.cartFacade.deleteCart(id);
	}

	addToWishlist(id: number | string) {
		this.wishlistFacade.addToWishlist({ product_id: id });
	}
}
