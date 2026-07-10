import { inject, Injectable } from '@angular/core';

import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, delay, EMPTY, map, switchMap, withLatestFrom } from 'rxjs';

import { ICart } from '@data-access/interfaces/cart.interface';
import { CartService } from '@data-access/services/cart.service';
import { NotificationService } from '@data-access/services/notification.service';
import { CartActions } from './cart.actions';
import { selectCartState } from './cart.selectors';

const variationLabel = (variation: ICart['variation'] | undefined | null): string =>
  variation?.attribute_values?.map(values => values.value).join('/') ?? '';

const recomputeTotal = (items: ICart[]): number =>
  items.reduce((prev, curr) => prev + Number(curr.sub_total), 0);

/**
 * Cart effects — a near-verbatim port of the old NGXS @Action methods (which were
 * already effect-like: dispatching, calling the service, showing toasts). Working
 * copies are constructed immutably so NgRx's strict-immutability runtime checks
 * don't trip on the shared/frozen state objects.
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
          map(result => {
            const items = (result?.items ?? []).map(item =>
              item?.variation
                ? { ...item, variation: { ...item.variation, selected_variation: variationLabel(item.variation) } }
                : item,
            );
            return CartActions.loadCartSuccess({ items, total: result?.total ?? recomputeTotal(items) });
          }),
          catchError(() => EMPTY),
        ),
      ),
    ),
  );

  // '[Cart] Add' routed to update (existing id) or a fresh local-storage add.
  addToCart$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CartActions.addToCart),
      map(({ payload }) =>
        payload.id
          ? CartActions.updateCart({ payload })
          : CartActions.addToCartLocalStorage({ payload }),
      ),
    ),
  );

  addToCartLocalStorage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CartActions.addToCartLocalStorage),
      withLatestFrom(this.store.select(selectCartState)),
      map(([{ payload }, state]) => {
        const salePrice = payload.variation
          ? payload.variation.sale_price
          : payload.product?.sale_price;
        let newItem: ICart = {
          id: Number(
            Math.floor(Math.random() * 10000)
              .toString()
              .padStart(4, '0'),
          ),
          quantity: payload.quantity,
          sub_total: salePrice ? salePrice * payload.quantity : 0,
          product: payload.product!,
          product_id: payload.product_id,
          variation: payload.variation!,
          variation_id: payload.variation_id,
        } as ICart;
        if (newItem.variation) {
          newItem = {
            ...newItem,
            variation: { ...newItem.variation, selected_variation: variationLabel(newItem.variation) },
          };
        }
        const items = [...state.items, newItem];
        return CartActions.patchCart({
          changes: {
            items,
            total: recomputeTotal(items),
            stickyCartOpen: true,
            sidebarCartOpen: true,
          },
        });
      }),
    ),
  );

  // Sticky cart auto-closes 1.5s after a local add (was a setTimeout in the reducer).
  closeStickyAfterAdd$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CartActions.addToCartLocalStorage),
      delay(1500),
      map(() => CartActions.closeStickyCart()),
    ),
  );

  updateCart$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CartActions.updateCart),
      withLatestFrom(this.store.select(selectCartState)),
      map(([{ payload }, state]) => {
        const cart = state.items.map(item => ({ ...item }));
        const index = cart.findIndex(item => Number(item.id) === Number(payload.id));
        const target = cart[index];

        // Same cart line but a different variation → replace instead of increment.
        if (
          target?.variation &&
          payload.variation_id &&
          Number(target.id) === Number(payload.id) &&
          Number(target.variation_id) != Number(payload.variation_id)
        ) {
          return CartActions.replaceCart({ payload });
        }

        const productQty = target?.variation ? target.variation.quantity : target?.product?.quantity;
        if (productQty < target?.quantity + payload.quantity) {
          this.notificationService.showError(
            `You can not add more items than available. In stock ${productQty} items.`,
          );
          return CartActions.noop();
        }

        const variation = target?.variation
          ? { ...target.variation, selected_variation: variationLabel(target.variation) }
          : target?.variation;
        const quantity = target.quantity + payload.quantity;
        const sub_total = quantity * (variation ? variation.sale_price : target.product.sale_price);
        cart[index] = { ...target, variation, quantity, sub_total };

        if (quantity < 1) {
          return CartActions.deleteCart({ id: payload.id! });
        }
        return CartActions.patchCart({ changes: { items: cart, total: recomputeTotal(cart) } });
      }),
    ),
  );

  replaceCart$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CartActions.replaceCart),
      withLatestFrom(this.store.select(selectCartState)),
      map(([{ payload }, state]) => {
        const cart = state.items.map(item => ({ ...item }));
        const index = cart.findIndex(item => Number(item.id) === Number(payload.id));
        let target = { ...cart[index] };

        // Swap in the new variation when the cart id matches but variation differs.
        if (
          target?.variation &&
          payload.variation_id &&
          Number(target.id) === Number(payload.id) &&
          Number(target.variation_id) != Number(payload.variation_id)
        ) {
          const variation = {
            ...payload.variation!,
            selected_variation: variationLabel(payload.variation),
          };
          target = { ...target, variation, variation_id: payload.variation_id };
        }

        target.quantity = 0;

        const productQty = target?.variation ? target.variation.quantity : target?.product?.quantity;
        if (productQty < target.quantity + payload.quantity) {
          this.notificationService.showError(
            `You can not add more items than available. In stock ${productQty} items.`,
          );
          return CartActions.noop();
        }

        target.quantity = target.quantity + payload.quantity;
        target.sub_total =
          target.quantity * (target.variation ? target.variation.sale_price : target.product.sale_price);
        cart[index] = target;

        if (target.quantity < 1) {
          return CartActions.deleteCart({ id: payload.id! });
        }
        return CartActions.patchCart({ changes: { items: cart, total: recomputeTotal(cart) } });
      }),
    ),
  );
}
