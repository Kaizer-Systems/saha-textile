import { Component, inject, input, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import { CartActions } from '@core/state/cart/cart.actions';
import { selectCartItems } from '@core/state/cart/cart.selectors';
import { ICart, ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

import { Button } from '../button/button';
import { Addtocart } from './modal/addtocart/addtocart';

@Component({
	selector: 'app-product-box',
	templateUrl: './product-box.html',
	styleUrls: ['./product-box.scss'],
	imports: [Button, Addtocart, TranslocoModule, CurrencySymbolPipe],
})
export class ProductBox {
	private store = inject(Store);

	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly product = input<IProduct>(undefined);

	cartItem$: Observable<ICart[]> = this.store.select(selectCartItems);
	readonly addToCartModal = viewChild<Addtocart>('addToCartModal');

	public cartItem: ICart | null;

	ngOnInit() {
		this.cartItem$.subscribe((items) => {
			this.cartItem = items.find((item) => item.product.id == this.product().id)!;
		});
	}

	addToCart(product: IProduct, qty: number) {
		const params: ICartAddOrUpdate = {
			id: this.cartItem ? this.cartItem.id : null,
			product_id: product?.id!,
			product: product,
			variation: null,
			variation_id: null,
			quantity: qty,
		};
		this.store.dispatch(CartActions.addToCart({ payload: params }));
	}
}
