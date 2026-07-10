import { createReducer, on } from '@ngrx/store';

import { ICart } from '@data-access/interfaces/cart.interface';
import { CartActions } from './cart.actions';
import { CartStateModel, initialCartState } from './cart.models';

const recomputeTotal = (items: ICart[]): number =>
  items.reduce((prev, curr) => prev + Number(curr.sub_total), 0);

/**
 * Pure reducer — the effects do the heavy add/update/replace computation and feed
 * the result in via `patchCart` / `loadCartSuccess`. Delete + the toggles + clear
 * are pure, so they're handled directly here.
 */
export const cartReducer = createReducer(
  initialCartState,
  on(CartActions.loadCartSuccess, (state, { items, total }) => ({ ...state, items, total })),
  on(CartActions.patchCart, (state, { changes }) => ({ ...state, ...changes })),
  on(CartActions.deleteCart, (state, { id }) => {
    const items = state.items.filter(value => value.id !== id);
    return { ...state, items, total: recomputeTotal(items) };
  }),
  on(CartActions.closeStickyCart, state => ({ ...state, stickyCartOpen: false })),
  on(CartActions.toggleSidebarCart, (state, { value }) => ({ ...state, sidebarCartOpen: value })),
  on(CartActions.clearCart, state => ({ ...state, items: [], total: 0 })),
);
