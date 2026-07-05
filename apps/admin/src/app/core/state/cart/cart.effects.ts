import { inject, Injectable } from '@angular/core';

import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { EMPTY, of } from 'rxjs';
import { catchError, map, mergeMap, withLatestFrom } from 'rxjs/operators';

import { CartService } from '@data-access/services/cart.service';
import { NotificationService } from '@data-access/services/notification.service';
import { CartActions } from './cart.actions';
import { selectCartItems } from './cart.selectors';

@Injectable()
export class CartEffects {
	private actions$ = inject(Actions);
	private store = inject(Store);
	private cartService = inject(CartService);
	private notification = inject(NotificationService);

	loadCart$ = createEffect(() =>
		this.actions$.pipe(
			ofType(CartActions.loadCart),
			mergeMap(() =>
				this.cartService.getCartItems().pipe(
					map((result) => CartActions.loadCartSuccess({ items: result.items ?? [], total: result.total ?? 0 })),
					catchError(() => of(CartActions.loadCartSuccess({ items: [], total: 0 }))),
				),
			),
		),
	);

	// Mirrors the former NGXS AddToCart: an id means the item is already in the cart → treat as an update.
	addToCart$ = createEffect(() =>
		this.actions$.pipe(
			ofType(CartActions.addToCart),
			map(({ payload }) =>
				payload.id ? CartActions.updateCart({ payload }) : CartActions.addNewItem({ payload }),
			),
		),
	);

	// Mirrors the former NGXS UpdateCart: delta-based quantity change with stock validation.
	updateCart$ = createEffect(() =>
		this.actions$.pipe(
			ofType(CartActions.updateCart),
			withLatestFrom(this.store.select(selectCartItems)),
			mergeMap(([{ payload }, items]) => {
				const item = items.find((i) => i.id === payload.id);
				if (!item) return EMPTY;
				const productQty = item.variation ? item.variation.quantity : item.product?.quantity;
				if (productQty < item.quantity + payload.quantity) {
					this.notification.showError(
						`You can not add more items than available. In stock ${productQty} items.`,
					);
					return EMPTY;
				}
				const newQty = item.quantity + payload.quantity;
				if (newQty < 1) return of(CartActions.deleteCart({ id: payload.id! }));
				return of(CartActions.setQuantity({ id: payload.id!, quantity: newQty }));
			}),
		),
	);
}
