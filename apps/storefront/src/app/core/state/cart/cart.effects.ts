import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { concatMap, delay, EMPTY, filter, map, Observable, switchMap, withLatestFrom } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { CartService } from '@data-access/services/cart.service';
import { NotificationService } from '@data-access/services/notification.service';

import { ApiCartView, cartItem, lineChoice } from './cart-view';
import { CartActions } from './cart.actions';
import { selectCartItems } from './cart.selectors';

const loaded = (view: ApiCartView) => ({ items: view.lines.map(cartItem), total: view.subtotalINR });

/**
 * Every change goes to the API and the whole priced cart comes back, so nothing here works out a
 * price or a stock limit. Writes run one at a time, because each builds on the last.
 */
@Injectable()
export class CartEffects {
	private actions$ = inject(Actions);
	private store = inject(Store);
	private cartService = inject(CartService);
	private notificationService = inject(NotificationService);
	private transloco = inject(TranslocoService);

	/** Says why, then leaves the cart as the server last described it. */
	private refused = (error: HttpErrorResponse): Observable<never> => {
		const key = error.status === 409 ? 'cart_stock_limit' : 'cart_update_failed';
		this.notificationService.showError(this.transloco.translate(key));
		return EMPTY;
	};

	private saved(request: Observable<ApiCartView>) {
		return request.pipe(
			map((view) => CartActions.loadCartSuccess(loaded(view))),
			catchError(this.refused),
		);
	}

	getCartItems$ = createEffect(() =>
		this.actions$.pipe(
			ofType(CartActions.getCartItems),
			switchMap(() =>
				this.cartService.current().pipe(
					map((view) => CartActions.loadCartSuccess(loaded(view))),
					// Keep what is on screen. The next read will correct it.
					catchError(() => EMPTY),
				),
			),
		),
	);

	/** A negative quantity is the stepper on a card, which lowers the line it belongs to. */
	lowerFromCard$ = createEffect(() =>
		this.actions$.pipe(
			ofType(CartActions.addToCart),
			filter(({ payload }) => payload.quantity < 0),
			map(({ payload }) => CartActions.updateCart({ payload })),
		),
	);

	addToCart$ = createEffect(() =>
		this.actions$.pipe(
			ofType(CartActions.addToCart),
			filter(({ payload }) => payload.quantity > 0),
			concatMap(({ payload }) =>
				this.cartService
					.add({ productId: String(payload.product_id), quantity: payload.quantity, ...lineChoice(payload) })
					.pipe(
						map((view) => CartActions.cartLineAdded(loaded(view))),
						catchError(this.refused),
					),
			),
		),
	);

	// Sticky cart closes 1.5s after a line is added.
	closeStickyAfterAdd$ = createEffect(() =>
		this.actions$.pipe(
			ofType(CartActions.cartLineAdded),
			delay(1500),
			map(() => CartActions.closeStickyCart()),
		),
	);

	/** The steppers send a change of one. At zero the line goes. */
	updateCart$ = createEffect(() =>
		this.actions$.pipe(
			ofType(CartActions.updateCart),
			withLatestFrom(this.store.select(selectCartItems)),
			concatMap(([{ payload }, items]) => {
				const item = items.find((row) => row.id === payload.id);
				if (!item) return EMPTY;
				const quantity = item.quantity + payload.quantity;
				return this.saved(
					quantity < 1 ? this.cartService.remove(item.id) : this.cartService.update(item.id, { quantity }),
				);
			}),
		),
	);

	/** The edit modal replaces a line's choices and sets its quantity outright. */
	editLine$ = createEffect(() =>
		this.actions$.pipe(
			ofType(CartActions.editLine),
			filter(({ payload }) => payload.id !== null),
			concatMap(({ payload }) =>
				this.saved(
					this.cartService.update(payload.id as string, {
						quantity: payload.quantity,
						...lineChoice(payload),
					}),
				),
			),
		),
	);

	deleteCart$ = createEffect(() =>
		this.actions$.pipe(
			ofType(CartActions.deleteCart),
			concatMap(({ id }) => this.saved(this.cartService.remove(id))),
		),
	);
}
