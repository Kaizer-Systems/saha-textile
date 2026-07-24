import { Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbRating } from '@ng-bootstrap/ng-bootstrap';
import { CarouselComponent } from 'ngx-owl-carousel-o';

import { CartFacade } from '@core/state/cart/cart.facade';
import { CompareFacade } from '@core/state/compare/compare.store';
import { WishlistFacade } from '@core/state/wishlist/wishlist.store';
import { ICart } from '@data-access/interfaces/cart.interface';
import { IConfiguratorSummary } from '@data-access/interfaces/product-detail.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';
import { SaleTimer } from '@features/shop/product-detail/widgets/sale-timer/sale-timer';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { Button } from '@shared/ui/button/button';
import { ProductConfigurator } from '@shared/ui/product-config/product-configurator/product-configurator';

/**
 * PDP right column. Renders the title/price/rating header and the checkout
 * footer around the shared `ProductConfigurator`, which owns every configurable
 * section and the price/validity maths. The buy-box only reflects the
 * configurator's summary and forwards its composed payload to the cart.
 */
@Component({
	selector: 'app-buy-box',
	templateUrl: './buy-box.html',
	styleUrls: ['./buy-box.scss'],
	providers: [CurrencySymbolPipe],
	imports: [NgbRating, Button, SaleTimer, ProductConfigurator, CurrencySymbolPipe, TranslocoModule],
})
export class BuyBox {
	private wishlistFacade = inject(WishlistFacade);
	private compareFacade = inject(CompareFacade);
	private cartFacade = inject(CartFacade);
	private router = inject(Router);

	readonly product = input.required<IProduct>();
	readonly option = input<ISiteConfig | null>();
	readonly owlCar = input<CarouselComponent>();

	private readonly cartItems = toSignal(this.cartFacade.cartItems$, { initialValue: [] as ICart[] });

	readonly configurator = viewChild(ProductConfigurator);
	readonly summary = signal<IConfiguratorSummary | null>(null);

	public productQty: number = 1;

	// Header/footer bindings fall back to the plain product until the configurator reports in.
	readonly displayPrice = computed(() => this.summary()?.displayPrice ?? this.product().sale_price);
	readonly comparePrice = computed(() => this.summary()?.comparePrice ?? this.product().price);
	readonly discount = computed(() => this.summary()?.discount ?? this.product().discount);
	readonly purchasable = computed(() => this.summary()?.purchasable ?? this.product().stock_status === 'in_stock');
	readonly soldOut = computed(() => this.summary()?.soldOut ?? this.product().stock_status === 'out_of_stock');

	get cartItem(): ICart | null {
		return this.cartItems().find((item) => item.product.id == this.product().id) ?? null;
	}

	onSummary(summary: IConfiguratorSummary) {
		this.summary.set(summary);
	}

	updateQuantity(qty: number) {
		if (1 > this.productQty + qty) return;
		this.productQty = this.productQty + qty;
	}

	addToCart() {
		const params = this.configurator()?.buildParams(this.productQty, this.cartItem ? this.cartItem.id : null);
		if (params) this.cartFacade.addToCart(params);
	}

	buyNow() {
		this.addToCart();
		void this.router.navigate(['/checkout']);
	}

	addToWishlist() {
		this.wishlistFacade.addToWishlist({ product_id: this.product().id });
	}

	addToCompare() {
		this.compareFacade.addToCompare({ product_id: this.product().id });
	}
}
