import { ICart } from '@data-access/interfaces/cart.interface';

/**
 * Classic-NgRx cart feature state (replaces NGXS CartState). Cart is heavily
 * client-mutated (optimistic add/update/replace/delete with per-item totals),
 * which is why it moves to classic NgRx Store/Effects rather than a query or a
 * SignalStore. The intricate mutation logic lives in the effects (the old NGXS
 * @Action methods were already effect-like — they dispatched, called services and
 * showed toasts); the reducer just applies the resulting state.
 */
export interface CartStateModel {
  items: ICart[];
  total: number;
  stickyCartOpen: boolean;
  sidebarCartOpen: boolean;
}

export const CART_FEATURE_KEY = 'cart';

export const initialCartState: CartStateModel = {
  items: [],
  total: 0,
  stickyCartOpen: false,
  sidebarCartOpen: false,
};
