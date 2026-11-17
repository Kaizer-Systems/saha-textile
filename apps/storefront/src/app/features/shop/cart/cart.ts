import { AsyncPipe } from '@angular/common';
import { afterNextRender, Component, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { lengthText } from '@core/catalog/metre-length';
import { CartFacade } from '@core/state/cart/cart.facade';
import { isMetreLine, minusDeletes, stepLine, typedLineLength } from '@core/state/cart/metre-line';
import { OnlineStatus } from '@core/state/online-status';
import { WishlistStore } from '@core/state/wishlist/wishlist.store';
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
	private readonly wishlist = inject(WishlistStore);
	private cartFacade = inject(CartFacade);
	private transloco = inject(TranslocoService);

	readonly isMetre = isMetreLine;
	readonly minusDeletes = minusDeletes;

	/** Offline the saved cart stays readable; prices and stock need the server, so changes pause. */
	readonly online = inject(OnlineStatus).online;
	private wasOffline = false;

	cartItem$: Observable<ICart[]> = this.cartFacade.cartItems$;
	cartTotal$: Observable<number> = this.cartFacade.cartTotal$;

	/**
	 * False on the server and until the browser's first paint. The server never has the shopper's
	 * cart (the browser keeps it), so it holds the space rather than showing a false "No Items Added";
	 * drawing either state there left that block on the page beside a filled cart after hydration.
	 * Same approach as the wishlist page.
	 */
	readonly ready = signal(false);

	/** Composed per-unit price (base + add-on/bundle deltas) when present, else plain sale price. */
	unitPrice(item: ICart): number {
		return item.unit_price ?? (item.variation ? item.variation.sale_price : item.product.sale_price);
	}

	public breadcrumb = translatedBreadcrumb('cart');

	constructor() {
		afterNextRender(() => this.ready.set(true));
		effect(() => {
			const online = this.online();
			if (online && this.wasOffline) untracked(() => this.cartFacade.getCartItems());
			this.wasOffline = !online;
		});
	}

	/** The stepper's box: pieces as a number, metre lines as "2.5 m" (M09). */
	qtyText(item: ICart): string {
		return isMetreLine(item)
			? lengthText(item.quantity, this.transloco.translate('unit_m'))
			: String(item.quantity);
	}

	/** − and +: pieces by one, metres by 0.5 m; at the floor minus removes the line. */
	step(item: ICart, direction: 1 | -1) {
		const move = stepLine(item, direction);
		if (move.kind === 'delete') this.delete(item.id);
		else if (move.kind === 'change') this.updateQuantity(item, move.delta);
	}

	/** A length typed into a metre line's box, snapped to 0.1 m and set outright. */
	typeLength(item: ICart, box: HTMLInputElement) {
		const tenths = typedLineLength(item, box.value);
		box.value = this.qtyText(item);
		if (tenths === null) return;
		this.cartFacade.editLine({
			id: item.id,
			product: item.product,
			product_id: item.product.id,
			variation: item.variation,
			variation_id: item.variation_id ?? null,
			quantity: tenths,
			line_config: item.line_config,
		});
	}

	/** "1.0 m" for a shortest cut in a line's message. */
	lengthOf(tenths: number): string {
		return lengthText(tenths, this.transloco.translate('unit_m'));
	}

	/** Any metre line in the cart: the line under the table explains the step. */
	hasMetre(items: readonly ICart[]): boolean {
		return items.some(isMetreLine);
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

	/** Saves the line's product to the wishlist; it stays in the cart. Already saved, nothing changes. */
	addToWishlist(id: number | string) {
		if (!this.wishlist.has(id)) void this.wishlist.toggle({ id });
	}
}
