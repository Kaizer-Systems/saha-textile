import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbRating, NgbTooltip } from '@ng-bootstrap/ng-bootstrap';
import { CarouselComponent } from 'ngx-owl-carousel-o';

import { rememberNotifyIntent } from '@core/catalog/notify-intent';
import { AuthStore } from '@core/state/auth.store';
import { CartFacade } from '@core/state/cart/cart.facade';
import { CompareStore } from '@core/state/compare/compare.store';
import { WishlistStore } from '@core/state/wishlist/wishlist.store';
import { ICart } from '@data-access/interfaces/cart.interface';
import { IConfiguratorSummary } from '@data-access/interfaces/product-detail.interface';
import { IProduct, IVariation } from '@data-access/interfaces/product.interface';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';
import { NotificationService } from '@data-access/services/notification.service';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { Button } from '@shared/ui/button/button';
import { ProductConfigurator } from '@shared/ui/product-config/product-configurator/product-configurator';

import { environment } from '../../../../../../public/environments/environment';

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
	imports: [NgbRating, NgbTooltip, Button, ProductConfigurator, CurrencySymbolPipe, TranslocoModule],
})
export class BuyBox {
	private readonly wishlist = inject(WishlistStore);
	private readonly compare = inject(CompareStore);
	private cartFacade = inject(CartFacade);
	private notification = inject(NotificationService);
	private transloco = inject(TranslocoService);
	private router = inject(Router);
	private http = inject(HttpClient);
	private authStore = inject(AuthStore);

	readonly product = input.required<IProduct>();
	readonly option = input<ISiteConfig | null>();
	readonly owlCar = input<CarouselComponent>();
	readonly variationChange = output<IVariation | null>();

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
		if (summary.variation !== this.summary()?.variation) this.variationChange.emit(summary.variation);
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

	notify() {
		const slug = this.product().slug;
		const variant = this.summary()?.variation?.sku ?? this.product().sku;
		if (!this.authStore.isAuthenticated()) {
			rememberNotifyIntent(sessionStorage, slug, variant);
			void this.router.navigate(['/auth/login']);
			return;
		}
		this.http
			.post(
				`${environment.apiUrl}/catalog/products/${encodeURIComponent(slug)}/stock-alerts`,
				{ variantSku: variant },
				{ withCredentials: true },
			)
			.subscribe(() => this.notification.showSuccess(this.transloco.translate('stock_alert_saved')));
	}

	/** Filled red heart while saved; the store reads the guest cookie or the account. */
	readonly saved = computed(() => this.wishlist.saved().has(String(this.product().id)));
	readonly compared = computed(() => this.compare.chosen().has(this.product().slug));

	toggleWishlist() {
		void this.wishlist.toggle(this.product());
	}

	toggleCompare() {
		this.compare.toggle(this.product());
	}
}
