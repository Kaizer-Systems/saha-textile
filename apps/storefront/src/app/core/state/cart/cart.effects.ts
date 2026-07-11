import { inject, Injectable } from '@angular/core';

import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { delay, EMPTY, map, mergeMap, of, switchMap, withLatestFrom } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { ICart } from '@data-access/interfaces/cart.interface';
import { CartService } from '@data-access/services/cart.service';
import { NotificationService } from '@data-access/services/notification.service';
import { variationLabel } from './cart.models';
import { CartActions } from './cart.actions';
import { selectCartItems } from './cart.selectors';

/**
 * Cart effects — the imperative logic (routing add→update/new, stock validation,
 * variation replace, the sticky-cart timer) that the old NGXS @Action methods held.
 * They read the current items via the adapter's selectAll selector and dispatch the
 * pure entity write actions (addNewItem / updateItem / deleteCart). Out-of-stock and
 * "item not found" branches return EMPTY (no state change) instead of a noop action.
 */
@Injectable()
export class CartEffects {
	private actions$ = inject(Actions);
	private store = inject(Store);
	private cartService = inject(CartService);
	private notificationService = inject(NotificationService);

	getCartItems$ = createEffect(() =>
		this.actions$.pipe(
			ofType(CartActions.getCartItems),
			switchMap(() =>
				this.cartService.getCartItems().pipe(
					map((result) =>
						CartActions.loadCartSuccess({ items: result?.items ?? [], total: result?.total ?? 0 }),
					),
					catchError(() => EMPTY),
				),
			),
		),
	);

	// '[Cart] Add' → update an existing line (has id) or add a new one.
	addToCart$ = createEffect(() =>
		this.actions$.pipe(
			ofType(CartActions.addToCart),
			map(({ payload }) =>
				payload.id ? CartActions.updateCart({ payload }) : CartActions.addNewItem({ payload }),
			),
		),
	);

	// Sticky cart auto-closes 1.5s after a new item is added (was a setTimeout).
	closeStickyAfterAdd$ = createEffect(() =>
		this.actions$.pipe(
			ofType(CartActions.addNewItem),
			delay(1500),
			map(() => CartActions.closeStickyCart()),
		),
	);

	// Delta quantity change with stock validation; a variation change routes to replace.
	updateCart$ = createEffect(() =>
		this.actions$.pipe(
			ofType(CartActions.updateCart),
			withLatestFrom(this.store.select(selectCartItems)),
			mergeMap(([{ payload }, items]) => {
				const item = items.find((i) => Number(i.id) === Number(payload.id));
				if (!item) return EMPTY;

				// Same cart line but a different variation → replace instead of increment.
				if (
					item.variation &&
					payload.variation_id &&
					Number(item.id) === Number(payload.id) &&
					Number(item.variation_id) != Number(payload.variation_id)
				) {
					return of(CartActions.replaceCart({ payload }));
				}

				const productQty = item.variation ? item.variation.quantity : item.product?.quantity;
				if (productQty < item.quantity + payload.quantity) {
					this.notificationService.showError(
						`You can not add more items than available. In stock ${productQty} items.`,
					);
					return EMPTY;
				}

				const quantity = item.quantity + payload.quantity;
				if (quantity < 1) return of(CartActions.deleteCart({ id: payload.id! }));

				const price = item.variation ? item.variation.sale_price : item.product.sale_price;
				const changes: Partial<ICart> = { quantity, sub_total: quantity * price };
				if (item.variation) {
					changes.variation = { ...item.variation, selected_variation: variationLabel(item.variation) };
				}
				return of(CartActions.updateItem({ id: payload.id!, changes }));
			}),
		),
	);

	// Swap the variation on an existing line — quantity resets to 0 then adds the delta.
	replaceCart$ = createEffect(() =>
		this.actions$.pipe(
			ofType(CartActions.replaceCart),
			withLatestFrom(this.store.select(selectCartItems)),
			mergeMap(([{ payload }, items]) => {
				const item = items.find((i) => Number(i.id) === Number(payload.id));
				if (!item) return EMPTY;

				let variation = item.variation;
				let variation_id = item.variation_id;
				if (
					item.variation &&
					payload.variation_id &&
					Number(item.id) === Number(payload.id) &&
					Number(item.variation_id) != Number(payload.variation_id)
				) {
					variation = { ...payload.variation!, selected_variation: variationLabel(payload.variation) };
					variation_id = payload.variation_id;
				}

				const quantity = 0 + payload.quantity;
				const productQty = variation ? variation.quantity : item.product?.quantity;
				if (productQty < quantity) {
					this.notificationService.showError(
						`You can not add more items than available. In stock ${productQty} items.`,
					);
					return EMPTY;
				}
				if (quantity < 1) return of(CartActions.deleteCart({ id: payload.id! }));

				const price = variation ? variation.sale_price : item.product.sale_price;
				const changes: Partial<ICart> = { variation, variation_id, quantity, sub_total: quantity * price };
				return of(CartActions.updateItem({ id: payload.id!, changes }));
			}),
		),
	);
}
