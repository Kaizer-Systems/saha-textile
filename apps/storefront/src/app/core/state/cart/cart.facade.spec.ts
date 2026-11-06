import { TestBed } from '@angular/core/testing';

import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CartActions } from './cart.actions';
import { CartFacade } from './cart.facade';
import { selectCartItems, selectCartTotal, selectSidebarCartOpen, selectStickyCart } from './cart.selectors';

const setup = () => {
	const store = { select: vi.fn(() => of([])), dispatch: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: Store, useValue: store }] });
	return { store, facade: TestBed.inject(CartFacade) };
};

describe('CartFacade', () => {
	it('dispatches each action', () => {
		const { store, facade } = setup();
		const payload = { id: 1 } as never;
		facade.getCartItems();
		facade.addToCart(payload);
		facade.updateCart(payload);
		facade.replaceCart(payload);
		facade.editLine(payload);
		facade.deleteCart(1);
		facade.toggleSidebarCart(true);
		expect(store.dispatch.mock.calls.map(([action]) => action.type)).toEqual([
			CartActions.getCartItems.type,
			CartActions.addToCart.type,
			CartActions.updateCart.type,
			CartActions.replaceCart.type,
			CartActions.editLine.type,
			CartActions.deleteCart.type,
			CartActions.toggleSidebarCart.type,
		]);
	});

	it('sends a copy, so a frozen store never holds the caller object', () => {
		const { store, facade } = setup();
		const payload = { id: 1 } as never;
		facade.addToCart(payload);
		expect(store.dispatch.mock.lastCall?.[0].payload).not.toBe(payload);
		expect(store.dispatch.mock.lastCall?.[0].payload).toEqual({ id: 1 });
	});
});

describe('cart selectors', () => {
	const state = {
		ids: [1],
		entities: { 1: { id: 1 } },
		total: 5,
		stickyCartOpen: true,
		sidebarCartOpen: false,
	} as never;

	it('read the state', () => {
		expect(selectCartItems.projector(state)).toEqual([{ id: 1 }]);
		expect(selectCartTotal.projector(state)).toBe(5);
		expect(selectStickyCart.projector(state)).toBe(true);
		expect(selectSidebarCartOpen.projector(state)).toBe(false);
	});
});
