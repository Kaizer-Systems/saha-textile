import { AsyncPipe, NgClass, NgStyle, isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { lengthText } from '@core/catalog/metre-length';
import { AuthStore } from '@core/state/auth.store';
import { cartChildCounts, cartChildRows } from '@core/state/cart/cart-children';
import { CartFacade } from '@core/state/cart/cart.facade';
import { isMetreLine, minusDeletes, stepLine, typedLineLength } from '@core/state/cart/metre-line';
import { SettingStore } from '@core/state/setting.store';
import { SiteConfigStore } from '@core/state/site-config.store';
import { ICart, ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';
import { IValues } from '@data-access/interfaces/setting.interface';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { Button } from '@shared/ui/button/button';
import { CartLineConfig } from '@shared/ui/cart-line-config/cart-line-config';
import { ProductConfigModal } from '@shared/ui/modal/product-config-modal/product-config-modal';

@Component({
	selector: 'app-header-cart',
	templateUrl: './cart.html',
	styleUrls: ['./cart.scss'],
	providers: [CurrencySymbolPipe],
	imports: [
		Button,
		RouterLink,
		CartLineConfig,
		ProductConfigModal,
		AsyncPipe,
		TranslocoModule,
		CurrencySymbolPipe,
		NgClass,
		NgStyle,
	],
})
export class Cart {
	private cartFacade = inject(CartFacade);
	private settingStore = inject(SettingStore);
	private authStore = inject(AuthStore);
	private platformId = inject(PLATFORM_ID);

	cartItem$: Observable<ICart[]> = this.cartFacade.cartItems$;
	cartTotal$: Observable<number> = this.cartFacade.cartTotal$;
	sidebarCartOpen$: Observable<boolean> = this.cartFacade.sidebarCartOpen$;
	siteConfig$: Observable<ISiteConfig> = toObservable(inject(SiteConfigStore).siteConfig) as Observable<ISiteConfig>;
	setting$: Observable<IValues> = toObservable(this.settingStore.setting) as Observable<IValues>;

	readonly style = input<string>('basic');
	/** The line whose options popup is asked for; the popup is drawn, and its code loaded, from then on. */
	readonly editing = signal<ICart | null>(null);
	readonly configModal = viewChild<ProductConfigModal>('configModal');
	/** A popup asked for before its code had loaded opens as soon as it has. */
	private opening: ICart | null = null;

	public cartStyle: string = 'cart_sidebar';
	public shippingFreeAmt: number = 0;
	public cartTotal: number = 0;
	public shippingCal: number = 0;

	/** Composed per-unit price (base + add-on/bundle deltas) when present, else plain sale price. */
	unitPrice(item: ICart): number {
		return item.unit_price ?? (item.variation ? item.variation.sale_price : item.product.sale_price);
	}
	public confettiItems = Array.from({ length: 150 }, (_, index) => index);
	public confetti: number = 0;
	public loader: boolean = false;

	constructor() {
		effect(() => {
			const popup = this.configModal();
			untracked(() => {
				if (popup && this.opening) {
					const line = this.opening;
					this.opening = null;
					popup.openModal(line);
				}
			});
		});
		// Signing in merges the guest cart on the server and signing out leaves it, so the cart is
		// read again whenever the session changes. The server has no cookies for this read.
		effect(() => {
			this.authStore.isAuthenticated();
			if (isPlatformBrowser(this.platformId)) untracked(() => this.cartFacade.getCartItems());
		});
		// The store starts empty, so keep the default until config arrives. Dropping it would remove
		// `fixed-cart` during hydration and flash the closed cart into view.
		this.siteConfig$.subscribe((option) => (this.cartStyle = option?.general?.cart_style ?? this.cartStyle));

		// Calculation
		this.cartTotal$.subscribe((total) => {
			this.setting$.subscribe((setting) => (this.shippingFreeAmt = setting?.general?.min_order_free_shipping));
			this.cartTotal = total;
			this.shippingCal = (this.cartTotal * 100) / this.shippingFreeAmt;
			if (this.shippingCal > 100) {
				this.shippingCal = 100;
				if (this.confetti == 0) {
					this.confetti = 1;
					setTimeout(() => {
						this.confetti = 2;
					}, 4500);
				}
			} else {
				this.confetti = 0;
			}
		});
	}

	/** A line's Edit: its options popup, with the line's saved choices. */
	edit(item: ICart) {
		const popup = this.configModal();
		if (popup && this.editing()?.id === item.id) return popup.openModal(item);
		this.opening = item;
		this.editing.set(item);
	}

	readonly isMetre = isMetreLine;
	readonly minusDeletes = minusDeletes;

	readonly childRows = cartChildRows;
	readonly childCounts = cartChildCounts;
	/** Sets opened to show what they hold (E04: one row with the count, closed by default). */
	private readonly openSets = signal<ReadonlySet<string>>(new Set());

	isOpen(item: ICart): boolean {
		return this.openSets().has(item.id);
	}

	toggle(item: ICart): void {
		this.openSets.update((open) => {
			const next = new Set(open);
			if (!next.delete(item.id)) next.add(item.id);
			return next;
		});
	}

	/** A product's free items by name, for its one green row. */
	freeNames(item: ICart): string {
		return (item.children ?? [])
			.filter((child) => child.role === 'free')
			.map((child) => child.title)
			.join(', ');
	}

	/** "2.5 m" for a metre line's box (M10). */
	qtyText(item: ICart, unit: string): string {
		return isMetreLine(item) ? lengthText(item.quantity, unit) : String(item.quantity);
	}

	/** − and +: pieces by one, metres by 0.5 m; at the floor minus removes the line. */
	step(item: ICart, direction: 1 | -1) {
		const move = stepLine(item, direction);
		if (move.kind === 'delete') this.delete(item.id);
		else if (move.kind === 'change') this.updateQuantity(item, move.delta);
	}

	/** A length typed into a metre line's box, snapped to 0.1 m and set outright. */
	typeLength(item: ICart, box: HTMLInputElement, unit: string) {
		const tenths = typedLineLength(item, box.value);
		box.value = this.qtyText(item, unit);
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

	cartToggle(value: boolean) {
		this.cartFacade.toggleSidebarCart(value);
	}

	updateQuantity(item: ICart, qty: number) {
		const params: ICartAddOrUpdate = {
			id: item?.id,
			product_id: item?.product?.id,
			product: item?.product ? item?.product : null,
			variation_id: item?.variation_id ? item?.variation_id : null,
			variation: item?.variation ? item?.variation : null,
			quantity: qty,
		};
		this.cartFacade.updateCart(params);
	}

	delete(id: string) {
		this.cartFacade.deleteCart(id);
	}
}
