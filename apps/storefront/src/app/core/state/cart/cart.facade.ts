import { inject, Injectable } from '@angular/core';

import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import { ICart, ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';
import { CartActions } from './cart.actions';
import {
  selectCartItems,
  selectCartTotal,
  selectSidebarCartOpen,
  selectStickyCart,
} from './cart.selectors';

/**
 * Thin facade over the classic-NgRx cart store. Consumers inject this instead of
 * the NgRx Store, which keeps them decoupled from the store wiring and avoids a
 * naming clash with the NGXS `Store` still used for wishlist/compare in a few of
 * the same components.
 */
@Injectable({ providedIn: 'root' })
export class CartFacade {
  private store = inject(Store);

  readonly cartItems$: Observable<ICart[]> = this.store.select(selectCartItems);
  readonly cartTotal$: Observable<number> = this.store.select(selectCartTotal);
  readonly stickyCart$: Observable<boolean> = this.store.select(selectStickyCart);
  readonly sidebarCartOpen$: Observable<boolean> = this.store.select(selectSidebarCartOpen);

  getCartItems(): void {
    this.store.dispatch(CartActions.getCartItems());
  }

  addToCart(payload: ICartAddOrUpdate): void {
    this.store.dispatch(CartActions.addToCart({ payload }));
  }

  updateCart(payload: ICartAddOrUpdate): void {
    this.store.dispatch(CartActions.updateCart({ payload }));
  }

  replaceCart(payload: ICartAddOrUpdate): void {
    this.store.dispatch(CartActions.replaceCart({ payload }));
  }

  deleteCart(id: number): void {
    this.store.dispatch(CartActions.deleteCart({ id }));
  }

  toggleSidebarCart(value: boolean): void {
    this.store.dispatch(CartActions.toggleSidebarCart({ value }));
  }
}
