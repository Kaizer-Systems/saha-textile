import { Component, inject, Input, SimpleChanges } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { lengthText, stepLength } from '@core/catalog/metre-length';
import { CartFacade } from '@core/state/cart/cart.facade';
import { ICart, ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';
import { IProduct, IVariation } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { Button } from '@shared/ui/button/button';
import { VariantAttributes } from '@shared/ui/variant-attributes/variant-attributes';

@Component({
	selector: 'app-sticky-checkout',
	templateUrl: './sticky-checkout.html',
	styleUrls: ['./sticky-checkout.scss'],
	providers: [CurrencySymbolPipe],
	imports: [VariantAttributes, Button, CurrencySymbolPipe, TranslocoModule],
})
export class StickyCheckout {
	private cartFacade = inject(CartFacade);

	@Input() product: IProduct;

	cartItem$: Observable<ICart[]> = this.cartFacade.cartItems$;

	public cartItem: ICart | null;
	public productQty: number = 1;
	public selectedVariation: IVariation | null;

	ngOnChanges(changes: SimpleChanges) {
		if (changes['product'] && changes['product'].currentValue) {
			this.product = changes['product']?.currentValue;
			// M07: a metre product's bar starts at its shortest cut; the count is tenths of a metre.
			const rule = this.product.sold_by === 'metre' ? this.product.metre_rule : null;
			this.productQty = rule?.shortestCutTenths ?? 1;
		}
		this.cartItem$.subscribe((items) => {
			this.cartItem = items.find((item) => item?.product?.id == this.product?.id)!;
		});
	}

	selectVariation(variation: IVariation) {
		this.selectedVariation = variation;
	}

	/** The bar's box: a count, or "2.5 m" for fabric (shown in lower case, M07). */
	qtyText(unit: string): string {
		return this.product?.sold_by === 'metre' ? lengthText(this.productQty, unit) : String(this.productQty);
	}

	updateQuantity(qty: number) {
		const rule = this.product?.sold_by === 'metre' ? this.product.metre_rule : null;
		if (rule) {
			const free = this.product.made_to_order
				? null
				: (this.selectedVariation?.quantity ?? this.product.quantity);
			this.productQty = stepLength(this.productQty, qty > 0 ? 1 : -1, rule, free ?? null);
			this.checkStockAvailable();
			return;
		}
		if (1 > this.productQty + qty) return;
		this.productQty = this.productQty + qty;
		this.checkStockAvailable();
	}

	checkStockAvailable() {
		if (this.selectedVariation) {
			this.selectedVariation['stock_status'] =
				this.selectedVariation?.quantity < this.productQty ? 'out_of_stock' : 'in_stock';
		} else {
			this.product['stock_status'] = this.product.quantity < this.productQty ? 'out_of_stock' : 'in_stock';
		}
	}

	addToCart(product: IProduct) {
		if (product) {
			const params: ICartAddOrUpdate = {
				id: this.cartItem ? this.cartItem.id : null,
				product_id: product?.id!,
				product,
				variation: this.selectedVariation ? this.selectedVariation : null,
				variation_id: this.selectedVariation?.id ? this.selectedVariation?.id! : null,
				quantity: this.productQty,
			};
			this.cartFacade.addToCart(params);
		}
	}
}
