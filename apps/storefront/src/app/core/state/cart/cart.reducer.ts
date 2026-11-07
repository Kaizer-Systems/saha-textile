import { createReducer, on } from '@ngrx/store';

import { CartActions } from './cart.actions';
import { cartAdapter, initialCartState } from './cart.models';

/** The server's answer replaces the cart. An add also opens the drawers to show it. */
export const cartReducer = createReducer(
	initialCartState,
	on(CartActions.loadCartSuccess, (state, { items, total }) => ({ ...cartAdapter.setAll(items, state), total })),
	on(CartActions.cartLineAdded, (state, { items, total }) => ({
		...cartAdapter.setAll(items, state),
		total,
		stickyCartOpen: true,
		sidebarCartOpen: true,
	})),
	on(CartActions.closeStickyCart, (state) => ({ ...state, stickyCartOpen: false })),
	on(CartActions.toggleSidebarCart, (state, { value }) => ({ ...state, sidebarCartOpen: value })),
);
