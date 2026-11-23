import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, TemplateRef, computed, inject, input, signal, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { lengthProblem, lengthText, readLength, stepLength } from '@core/catalog/metre-length';
import { CartFacade } from '@core/state/cart/cart.facade';
import { ICart } from '@data-access/interfaces/cart.interface';
import { IConfiguratorSummary } from '@data-access/interfaces/product-detail.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { ProductService } from '@data-access/services/product.service';
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
	private productService = inject(ProductService);

	readonly product = input.required<IProduct>();
	/** A cart line carries only what its row shows, so an edit reads the whole product first. */
	private readonly fullProduct = signal<IProduct | null>(null);

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
		const p = this.fullProduct() ?? this.product();
		return p ? (JSON.parse(JSON.stringify(p)) as IProduct) : p;
	});
	/** Fabric by the metre: the popup takes a length the same way as the product page (M01). */
	readonly rule = computed(() => {
		const p = this.fullProduct() ?? this.product();
		return p?.sold_by === 'metre' ? (p.metre_rule ?? null) : null;
	});
	/** Read only once `rule()` has found a metre product, so a product is always there. */
	private readonly freeToSell = computed<number | null>(() => {
		const p = this.fullProduct() ?? this.product();
		if (p.made_to_order) return null;
		return this.summary()?.variation?.quantity ?? p.quantity ?? null;
	});
	readonly lengthIssue = computed(() => {
		const rule = this.rule();
		return rule ? lengthProblem(this.productQty(), rule, this.freeToSell()) : null;
	});

	lengthOf(tenths: number, unit: string): string {
		return lengthText(tenths, unit);
	}

	pickLength(tenths: number) {
		this.productQty.set(tenths);
	}

	typeLength(box: HTMLInputElement, unit: string) {
		const read = readLength(box.value);
		if (read) this.productQty.set(read.tenths);
		box.value = this.lengthOf(this.productQty(), unit);
	}

	readonly purchasable = computed(() => (this.summary()?.purchasable ?? false) && !this.lengthIssue());
	readonly soldOut = computed(() => this.summary()?.soldOut ?? false);
	readonly unitPrice = computed(() => this.summary()?.unitPrice ?? this.product().sale_price);

	openModal(line?: ICart | null) {
		if (!isPlatformBrowser(this.platformId)) return;
		if (!line) {
			// A card carries no metre rules: read the product page first for fabric (M01).
			if (this.product().sold_by === 'metre' && !this.product().metre_rule) {
				this.productService.getProductPage(this.product().slug).subscribe((product) => {
					this.fullProduct.set(product);
					this.show(null);
				});
				return;
			}
			this.show(null);
			return;
		}
		this.productService.getProductPage(line.product.slug).subscribe((product) => {
			this.fullProduct.set(product);
			this.show(line);
		});
	}

	private show(line: ICart | null) {
		this.editLine.set(line);
		this.productQty.set(line?.quantity ?? this.rule()?.shortestCutTenths ?? 1);
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
		const rule = this.rule();
		if (rule) {
			this.productQty.set(stepLength(this.productQty(), qty > 0 ? 1 : -1, rule, this.freeToSell()));
			return;
		}
		const next = this.productQty() + qty;
		if (next < 1) return;
		this.productQty.set(next);
	}

	confirm(configurator: ProductConfigurator) {
		if (!this.purchasable()) return;
		const line = this.editLine();
		const params = configurator.buildParams(this.productQty(), line ? line.id : null);
		// Edit = full in-place replace of the line; Add = increment/new line.
		if (line) this.cartFacade.editLine(params);
		else this.cartFacade.addToCart(params);
		this.modalService.dismissAll();
	}
}
