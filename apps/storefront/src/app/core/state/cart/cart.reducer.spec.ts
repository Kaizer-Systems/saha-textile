import { describe, expect, it } from 'vitest';

import { ICart } from '@data-access/interfaces/cart.interface';

import { CartActions } from './cart.actions';
import { cartAdapter, initialCartState } from './cart.models';
import { cartReducer } from './cart.reducer';

const item = { id: 'line_1', quantity: 2, sub_total: 200 } as ICart;
const { selectAll } = cartAdapter.getSelectors();

describe('cartReducer', () => {
	it('takes the server cart as it comes, leaving the drawers alone', () => {
		const state = cartReducer(initialCartState, CartActions.loadCartSuccess({ items: [item], total: 200 }));
		expect(selectAll(state)).toEqual([item]);
		expect(state).toMatchObject({ total: 200, stickyCartOpen: false, sidebarCartOpen: false });
		const empty = cartReducer(state, CartActions.loadCartSuccess({ items: [], total: 0 }));
		expect(selectAll(empty)).toEqual([]);
		expect(empty.total).toBe(0);
	});

	it('keeps a zero total when every line is sold out', () => {
		const state = cartReducer(initialCartState, CartActions.loadCartSuccess({ items: [item], total: 0 }));
		expect(state.total).toBe(0);
	});

	it('opens the drawers on an add', () => {
		const state = cartReducer(initialCartState, CartActions.cartLineAdded({ items: [item], total: 200 }));
		expect(state).toMatchObject({ total: 200, stickyCartOpen: true, sidebarCartOpen: true });
		expect(cartReducer(state, CartActions.closeStickyCart()).stickyCartOpen).toBe(false);
		expect(cartReducer(state, CartActions.toggleSidebarCart({ value: false })).sidebarCartOpen).toBe(false);
	});
});
