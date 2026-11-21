import { HttpClient } from '@angular/common/http';
import { Component, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, NgbPopover, NgbRating, NgbTooltip } from '@ng-bootstrap/ng-bootstrap';
import { CarouselComponent } from 'ngx-owl-carousel-o';

import { lengthProblem, lengthText, metreTotal, readLength, stepLength } from '@core/catalog/metre-length';
import { rememberNotifyIntent } from '@core/catalog/notify-intent';
import { AuthStore } from '@core/state/auth.store';
import { CartFacade } from '@core/state/cart/cart.facade';
import { CompareStore } from '@core/state/compare/compare.store';
import { WishlistStore } from '@core/state/wishlist/wishlist.store';
import { IAttributeValue } from '@data-access/interfaces/attribute.interface';
import { ICart } from '@data-access/interfaces/cart.interface';
import { IConfiguratorSummary } from '@data-access/interfaces/product-detail.interface';
import { IProduct, IVariation } from '@data-access/interfaces/product.interface';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';
import { NotificationService } from '@data-access/services/notification.service';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { Button } from '@shared/ui/button/button';
import { AddonSheet, type AddonSheetResult } from '@shared/ui/product-config/parts/addon-sheet/addon-sheet';
import { AttributesInfo } from '@shared/ui/product-config/parts/attributes-info/attributes-info';
import { LOW_STOCK_AT, VariationTable } from '@shared/ui/product-config/parts/variation-table/variation-table';
import { ProductConfigurator } from '@shared/ui/product-config/product-configurator/product-configurator';

import { environment } from '../../../../../../public/environments/environment';
import { ProductSocialShare } from '../widgets/product-social-share/product-social-share';
import { SaleTimer } from '../widgets/sale-timer/sale-timer';

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
	imports: [
		NgbRating,
		NgbTooltip,
		NgbPopover,
		ProductSocialShare,
		Button,
		ProductConfigurator,
		VariationTable,
		AttributesInfo,
		SaleTimer,
		CurrencySymbolPipe,
		TranslocoModule,
	],
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
	private modals = inject(NgbModal);

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
	/** Fabric by the metre (shop brief M02–M04): the length is whole tenths of a metre. */
	readonly rule = computed(() => (this.product().sold_by === 'metre' ? (this.product().metre_rule ?? null) : null));
	readonly length = signal(0);
	/** "2.55 m became 2.6 m" after a typed length is snapped (M03). */
	readonly snapped = signal<{ typed: string; length: string } | null>(null);
	/** What is free to sell of the chosen variant, in tenths; null for made to order. */
	readonly available = computed<number | null>(() => {
		if (this.product().made_to_order) return null;
		return this.summary()?.variation?.quantity ?? this.product().quantity ?? null;
	});
	readonly lengthIssue = computed(() => {
		const rule = this.rule();
		return rule ? lengthProblem(this.length(), rule, this.available()) : null;
	});
	/** Length × price per metre, as the server will charge it. */
	readonly lineTotal = computed(() => metreTotal(this.displayPrice(), this.length()));

	readonly purchasable = computed(
		() => (this.summary()?.purchasable ?? this.product().stock_status === 'in_stock') && !this.lengthIssue(),
	);
	readonly soldOut = computed(() => this.summary()?.soldOut ?? this.product().stock_status === 'out_of_stock');

	/** Same rule as the configurator's, from the data alone, so the server draws the option table too. */
	readonly hasVariation = computed(() => !!(this.product().attributes?.length && this.product().variations?.length));

	/**
	 * The chosen option's stock for the price line (brief P10): "In stock · 3 left", amber "Only 2 left", red
	 * "Out of stock". Null where a count would mislead: made to order, fabric by the metre (tenths), a set, or
	 * before an option is chosen.
	 */
	readonly stockChip = computed<{ kind: 'in' | 'low' | 'out'; count: number | null } | null>(() => {
		const product = this.product();
		if (product.made_to_order || this.rule() || product.bundle) return null;
		const source = this.hasVariation() ? this.summary()?.variation : product;
		if (!source) return null;
		if (source.stock_status === 'out_of_stock') return { kind: 'out', count: 0 };
		if (source.stock_status !== 'in_stock') return null;
		const count = typeof source.quantity === 'number' ? source.quantity : null;
		return { kind: count !== null && count <= LOW_STOCK_AT ? 'low' : 'in', count };
	});

	get cartItem(): ICart | null {
		return this.cartItems().find((item) => item.product.id == this.product().id) ?? null;
	}

	constructor() {
		// A new product starts at its shortest cut (M2: 1.0 m unless set otherwise).
		effect(() => {
			const rule = this.rule();
			untracked(() => {
				this.length.set(rule?.shortestCutTenths ?? 0);
				this.snapped.set(null);
			});
		});
	}

	/** "2.5 m" in the reader's unit. */
	lengthOf(tenths: number): string {
		return lengthText(tenths, this.transloco.translate('unit_m'));
	}

	/** A quick-length button (M5) or "Other". */
	pickLength(tenths: number) {
		this.length.set(tenths);
		this.snapped.set(null);
	}

	/** A typed length, snapped to 0.1 m with a note (M03); below the cut the box turns red (M04). */
	typeLength(box: HTMLInputElement) {
		const read = readLength(box.value);
		if (read) {
			this.length.set(read.tenths);
			this.snapped.set(read.snapped ? { typed: box.value.trim(), length: this.lengthOf(read.tenths) } : null);
		}
		box.value = this.lengthOf(this.length());
	}

	/** True when the length is one of the quick-length buttons, so "Other" is not lit. */
	readonly isQuick = (quick: { tenths: number }): boolean => quick.tenths === this.length();

	focusLength() {
		document.getElementById(`length-${this.product().id}`)?.focus();
	}

	onSummary(summary: IConfiguratorSummary) {
		if (summary.variation !== this.summary()?.variation) this.variationChange.emit(summary.variation);
		this.summary.set(summary);
	}

	/**
	 * The add-on as the buy bar shows it (brief P4): each group's chosen term, and whether the chosen terms need
	 * measurements and have them. Null for a product without add-ons.
	 */
	readonly addonView = computed(() => {
		const groups = this.product().addon_groups ?? [];
		if (!groups.length) return null;
		const state = this.configurator()?.addonState();
		const chosen = groups.map((group) => {
			const code = state?.selections?.[group.code] ?? group.default_term_code ?? group.terms[0]?.code;
			return { group, term: group.terms.find((term) => term.code === code) };
		});
		return {
			chips: chosen.map(({ group, term }) => ({ group: group.label, term: term?.label ?? '' })),
			needs: chosen.some(({ term }) => term?.requires_measurements),
			measured: state?.valid ?? false,
		};
	});

	/** The bar's pencil (`designs`) and Edit add-on (`all`): the page's add-on part in a sheet, written back on Save. */
	async openAddon(mode: 'designs' | 'all'): Promise<void> {
		const configurator = this.configurator();
		const snapshot = configurator?.addonSnapshot();
		if (!configurator || !snapshot) return;
		const popup = this.modals.open(AddonSheet, {
			ariaLabelledBy: 'addon_sheet_title',
			centered: true,
			scrollable: true,
			size: 'lg',
			windowClass: 'theme-modal st-sheet',
		});
		(popup.componentInstance as AddonSheet).start({
			product: this.product(),
			basePrice: configurator.effectiveBase(),
			selections: snapshot.selections,
			measurements: snapshot.measurements,
			mode,
		});
		const result = (await popup.result.catch(() => null)) as AddonSheetResult | null;
		if (result) configurator.applyAddon(result.selections, result.measurements, result.measured);
	}

	/** A set as the bar shows it (brief P4): how many pieces it holds and whether its choices are complete. */
	readonly setView = computed(() => {
		const bundle = this.product().bundle;
		if (!bundle) return null;
		return { pieces: bundle.components?.length ?? 0, ready: this.configurator()?.bundleState()?.valid ?? false };
	});

	/** The bar's Configure set: the page's set part in a sheet, written back on Save. */
	async openSet(): Promise<void> {
		const configurator = this.configurator();
		const snapshot = configurator?.setSnapshot();
		if (!configurator || !snapshot) return;
		let sheet: AddonSheet | undefined;
		const popup = this.modals.open(AddonSheet, {
			ariaLabelledBy: 'addon_sheet_title',
			centered: true,
			scrollable: true,
			size: 'lg',
			windowClass: 'theme-modal st-sheet',
			// Tapping outside or Escape keeps the set's choices too: the sheet is the page's own set (brief P8).
			// A sheet with nothing drawn yet just closes.
			beforeDismiss: () => !sheet?.save(),
		});
		sheet = popup.componentInstance as AddonSheet;
		sheet.start({
			product: this.product(),
			basePrice: configurator.effectiveBase(),
			selections: snapshot.selections,
			measurements: snapshot.measurements,
			mode: 'set',
			buyable: configurator.purchasable(),
		});
		const result = (await popup.result.catch(() => null)) as AddonSheetResult | null;
		if (!result) return;
		configurator.applySet(result.selections, result.measurements, result.measured);
		if (result.add && this.purchasable()) this.addToCart();
	}

	/** The buy bar's chip lists choose through the page's own option buttons (brief P4). */
	chooseValue(value: IAttributeValue) {
		this.configurator()?.chooseValue(value);
	}

	updateQuantity(qty: number) {
		const rule = this.rule();
		if (rule) {
			this.length.set(stepLength(this.length(), qty > 0 ? 1 : -1, rule, this.available()));
			this.snapped.set(null);
			return;
		}
		if (1 > this.productQty + qty) return;
		this.productQty = this.productQty + qty;
	}

	addToCart() {
		if (this.lengthIssue()) return;
		const quantity = this.rule() ? this.length() : this.productQty;
		const params = this.configurator()?.buildParams(quantity, this.cartItem ? this.cartItem.id : null);
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
