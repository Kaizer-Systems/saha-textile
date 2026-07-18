import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, TemplateRef, computed, inject, input, signal, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { CartFacade } from '@core/state/cart/cart.facade';
import { ICart } from '@data-access/interfaces/cart.interface';
import { IConfiguratorSummary } from '@data-access/interfaces/product-detail.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { Button } from '@shared/ui/button/button';
import { ProductConfigurator } from '@shared/ui/product-config/product-configurator/product-configurator';

/**
 * Quick add / edit modal for configurable products. Hosts the same shared
 * `ProductConfigurator` the PDP uses, so a card's "Add" (defaults) and a cart
 * line's "Edit" (pre-seeded from the saved config) compose exactly like the PDP —
 * measurements editable, live total, Add/Update gated by validity.
 */
@Component({
	selector: 'app-product-config-modal',
	templateUrl: './product-config-modal.html',
	styleUrls: ['./product-config-modal.scss'],
	providers: [CurrencySymbolPipe],
	imports: [Button, ProductConfigurator, CurrencySymbolPipe, TranslocoModule],
})
export class ProductConfigModal {
	private modalService = inject(NgbModal);
	private platformId = inject<Object>(PLATFORM_ID);
	private cartFacade = inject(CartFacade);

	readonly product = input.required<IProduct>();

	readonly configModal = viewChild<TemplateRef<unknown>>('configModal');

	/** The cart line being edited, if any — null/undefined means a fresh add. */
	readonly editLine = signal<ICart | null>(null);
	readonly summary = signal<IConfiguratorSummary | null>(null);
	readonly productQty = signal<number>(1);

	readonly isEdit = computed(() => !!this.editLine());
	/**
	 * A mutable deep-clone of the product for the configurator. Cart-line products
	 * come from the NgRx store frozen; the shared variant swatch mutates
	 * `product.quantity/sku` on selection, which throws on a frozen object and
	 * silently kills the variant-change event. Cloning keeps that path working
	 * without weakening store immutability or touching the shared swatch.
	 */
	readonly configProduct = computed<IProduct>(() => {
		const p = this.product();
		return p ? (JSON.parse(JSON.stringify(p)) as IProduct) : p;
	});
	readonly purchasable = computed(() => this.summary()?.purchasable ?? false);
	readonly soldOut = computed(() => this.summary()?.soldOut ?? false);
	readonly unitPrice = computed(() => this.summary()?.unitPrice ?? this.product().sale_price);

	openModal(line?: ICart | null) {
		if (!isPlatformBrowser(this.platformId)) return;
		this.editLine.set(line ?? null);
		this.productQty.set(line?.quantity ?? 1);
		this.summary.set(null);
		this.modalService.open(this.configModal(), {
			ariaLabelledBy: 'product-config-modal',
			centered: true,
			scrollable: true,
			// Reuse the theme's purpose-built product-configuration modal styling
			// (`.variation-modal` — swatch sizing, package spacing, etc.).
			windowClass: 'theme-modal variation-modal product-config-modal modal-lg',
		});
	}

	onSummary(summary: IConfiguratorSummary) {
		this.summary.set(summary);
	}

	updateQuantity(qty: number) {
		const next = this.productQty() + qty;
		if (next < 1) return;
		this.productQty.set(next);
	}

	confirm(configurator: ProductConfigurator) {
		if (!this.purchasable()) return;
		const line = this.editLine();
		const params = configurator.buildParams(this.productQty(), line ? line.id : null);
		this.cartFacade.addToCart(params);
		this.modalService.dismissAll();
	}
}
