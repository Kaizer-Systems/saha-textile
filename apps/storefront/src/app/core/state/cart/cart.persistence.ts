import { ActionReducer, INIT, UPDATE } from '@ngrx/store';

import { CartStateModel, cartAdapter, initialCartState } from './cart.models';

const STORAGE_KEY = 'ngrx_cart';
const canUseStorage = (): boolean => typeof localStorage !== 'undefined';

const { selectAll } = cartAdapter.getSelectors();

/**
 * Feature meta-reducer persisting the cart to localStorage (replaces the NGXS
 * storage plugin's 'cart' key). Only the items + total are persisted (denormalized
 * to a plain array so the stored shape is adapter-independent, then rehydrated via
 * adapter.setAll). The sticky/sidebar toggles are transient UI and always start
 * closed on load — what the old CartState.ngxsOnInit did. SSR-safe.
 */
export function cartPersistenceMetaReducer(reducer: ActionReducer<CartStateModel>): ActionReducer<CartStateModel> {
	return (state, action) => {
		if ((action.type === INIT || action.type === UPDATE) && canUseStorage()) {
			const saved = localStorage.getItem(STORAGE_KEY);
			if (saved) {
				try {
					const { items, total } = JSON.parse(saved);
					const rehydrated = { ...cartAdapter.setAll(items ?? [], initialCartState), total: total ?? 0 };
					return reducer(rehydrated, action);
				} catch {
					// ignore corrupt storage
				}
			}
		}

		const nextState = reducer(state, action);
		if (canUseStorage() && nextState) {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({ items: selectAll(nextState), total: nextState.total }),
			);
		}
		return nextState;
	};
}
