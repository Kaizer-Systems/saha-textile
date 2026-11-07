import { INIT, UPDATE } from '@ngrx/store';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ICart } from '@data-access/interfaces/cart.interface';

import { CartActions } from './cart.actions';
import { cartAdapter, initialCartState } from './cart.models';
import { cartPersistenceMetaReducer } from './cart.persistence';
import { cartReducer } from './cart.reducer';

const KEY = 'ngrx_cart';
const item = { id: 'l1', quantity: 1 } as ICart;
const reduce = cartPersistenceMetaReducer(cartReducer);
const { selectAll } = cartAdapter.getSelectors();

const fakeStorage = () => {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value),
	};
};

afterEach(() => vi.unstubAllGlobals());

describe('cartPersistenceMetaReducer', () => {
	it('keeps the lines and total, and leaves the drawers closed', () => {
		const storage = fakeStorage();
		vi.stubGlobal('localStorage', storage);
		reduce(initialCartState, CartActions.cartLineAdded({ items: [item], total: 500 }));
		expect(JSON.parse(storage.getItem(KEY) as string)).toEqual({ items: [item], total: 500 });

		for (const type of [INIT, UPDATE]) {
			const state = reduce(undefined, { type } as never);
			expect(selectAll(state)).toEqual([item]);
			expect(state).toMatchObject({ total: 500, stickyCartOpen: false, sidebarCartOpen: false });
		}
	});

	it('copes with an empty save', () => {
		const storage = fakeStorage();
		vi.stubGlobal('localStorage', storage);
		storage.setItem(KEY, '{}');
		const state = reduce(undefined, { type: INIT } as never);
		expect(selectAll(state)).toEqual([]);
		expect(state.total).toBe(0);
	});

	it('ignores a damaged save', () => {
		const storage = fakeStorage();
		vi.stubGlobal('localStorage', storage);
		storage.setItem(KEY, 'not json');
		expect(selectAll(reduce(undefined, { type: INIT } as never))).toEqual([]);
	});

	it('starts clean when nothing was saved', () => {
		vi.stubGlobal('localStorage', fakeStorage());
		expect(selectAll(reduce(undefined, { type: INIT } as never))).toEqual([]);
	});

	it('works on the server, where there is no storage', () => {
		vi.stubGlobal('localStorage', undefined);
		expect(selectAll(reduce(initialCartState, CartActions.cartLineAdded({ items: [item], total: 1 })))).toEqual([item]);
		expect(selectAll(reduce(undefined, { type: INIT } as never))).toEqual([]);
	});

	it('writes nothing when a reducer gives nothing back', () => {
		const storage = fakeStorage();
		vi.stubGlobal('localStorage', storage);
		const nothing = cartPersistenceMetaReducer(() => undefined as never);
		expect(nothing(initialCartState, { type: 'x' })).toBeUndefined();
		expect(storage.getItem(KEY)).toBeNull();
	});
});
