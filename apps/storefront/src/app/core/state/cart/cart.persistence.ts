import { ActionReducer, INIT, UPDATE } from '@ngrx/store';

import { CartStateModel, initialCartState } from './cart.models';

const STORAGE_KEY = 'ngrx_cart';
const canUseStorage = (): boolean => typeof localStorage !== 'undefined';

/**
 * Feature meta-reducer persisting the cart to localStorage (replaces the NGXS
 * storage plugin's 'cart' key). Only `items`/`total` are persisted — the
 * sticky/sidebar toggles are transient UI and always start closed on load, which
 * is what the old CartState.ngxsOnInit did. SSR-safe (guards on localStorage).
 */
export function cartPersistenceMetaReducer(
  reducer: ActionReducer<CartStateModel>,
): ActionReducer<CartStateModel> {
  return (state, action) => {
    if ((action.type === INIT || action.type === UPDATE) && canUseStorage()) {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const { items, total } = JSON.parse(saved);
          return reducer({ ...initialCartState, items, total }, action);
        } catch {
          // ignore corrupt storage
        }
      }
    }

    const nextState = reducer(state, action);
    if (canUseStorage() && nextState) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ items: nextState.items, total: nextState.total }),
      );
    }
    return nextState;
  };
}
