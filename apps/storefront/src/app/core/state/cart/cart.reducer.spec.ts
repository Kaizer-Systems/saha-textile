import { describe, expect, it, vi } from 'vitest';

import { CartActions } from './cart.actions';
import { initialCartState } from './cart.models';
import { cartReducer } from './cart.reducer';

const line = (id: number, price = 100, overrides: Record<string, unknown> = {}) =>
	({ id, quantity: 1, sub_total: price, product: { id, sale_price: price }, ...overrides }) as never;

describe('cartReducer', () => {
	it('loads lines, with a given total or a calculated one', () => {
		const given = cartReducer(initialCartState, CartActions.loadCartSuccess({ items: [line(1)], total: 500 }));
		expect(given.total).toBe(500);
		const counted = cartReducer(initialCartState, CartActions.loadCartSuccess({ items: [line(1)], total: 0 }));
		expect(counted.ids).toEqual([1]);
		expect(counted.total).toBeGreaterThan(0);
	});

	it('labels the chosen variation', () => {
		const variation = { name: 'Red', attribute_values: [{ value: 'Red' }] };
		const state = cartReducer(
			initialCartState,
			CartActions.loadCartSuccess({ items: [line(1, 100, { variation })], total: 1 }),
		);
		expect(state.entities[1]?.variation).toHaveProperty('selected_variation');
	});

	it('adds a new line and opens both cart panels', () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		const payload = { quantity: 2, product: { id: 7, sale_price: 100 }, product_id: 7 } as never;
		const state = cartReducer(initialCartState, CartActions.addNewItem({ payload }));
		expect(state.ids).toEqual([5000]);
		expect(state.entities[5000]?.sub_total).toBe(200);
		expect(state).toMatchObject({ stickyCartOpen: true, sidebarCartOpen: true });
		vi.restoreAllMocks();
	});

	it('prices a new line from its variation', () => {
		const payload = { quantity: 2, product: { id: 7 }, variation: { sale_price: 50 }, product_id: 7 } as never;
		const state = cartReducer(initialCartState, CartActions.addNewItem({ payload }));
		expect(Object.values(state.entities)[0]?.sub_total).toBe(100);
	});

	it('sets a zero sub-total for a product with no price', () => {
		const payload = { quantity: 2, product: { id: 7 }, product_id: 7 } as never;
		const state = cartReducer(initialCartState, CartActions.addNewItem({ payload }));
		expect(Object.values(state.entities)[0]?.sub_total).toBe(0);
	});

	it('updates and deletes a line, recounting the total', () => {
		const loaded = cartReducer(
			initialCartState,
			CartActions.loadCartSuccess({ items: [line(1), line(2)], total: 0 }),
		);
		const updated = cartReducer(loaded, CartActions.updateItem({ id: 1, changes: { sub_total: 300 } as never }));
		expect(updated.total).toBeGreaterThan(loaded.total);
		const removed = cartReducer(updated, CartActions.deleteCart({ id: 1 }));
		expect(removed.ids).toEqual([2]);
	});

	it('closes the panels and clears the cart', () => {
		const loaded = cartReducer(initialCartState, CartActions.loadCartSuccess({ items: [line(1)], total: 0 }));
		expect(cartReducer(loaded, CartActions.closeStickyCart()).stickyCartOpen).toBe(false);
		expect(cartReducer(loaded, CartActions.toggleSidebarCart({ value: true })).sidebarCartOpen).toBe(true);
		expect(cartReducer(loaded, CartActions.clearCart())).toMatchObject({ ids: [], total: 0 });
	});
});
