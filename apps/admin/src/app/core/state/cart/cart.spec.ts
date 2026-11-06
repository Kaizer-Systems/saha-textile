import { TestBed } from '@angular/core/testing';

import { provideMockActions } from '@ngrx/effects/testing';
import { Store } from '@ngrx/store';
import { Observable, firstValueFrom, of, throwError, toArray } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CartService } from '@data-access/services/cart.service';
import { NotificationService } from '@data-access/services/notification.service';

import { CartActions } from './cart.actions';
import { CartEffects } from './cart.effects';
import { cartReducer, initialCartState } from './cart.reducer';
import { selectCartItems, selectCartTotal } from './cart.selectors';

const line = (id: number, overrides: Record<string, unknown> = {}) =>
	({ id, quantity: 1, sub_total: 100, product: { id, sale_price: 100, quantity: 5 }, ...overrides }) as never;

const setup = (actions: Observable<unknown>, items: unknown[] = [], answer: Observable<unknown> = of({})) => {
	const notification = { showError: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			CartEffects,
			provideMockActions(() => actions),
			{ provide: Store, useValue: { select: () => of(items) } },
			{ provide: CartService, useValue: { getCartItems: () => answer } },
			{ provide: NotificationService, useValue: notification },
		],
	});
	return { effects: TestBed.inject(CartEffects), notification };
};
const run = (stream: Observable<unknown>) => firstValueFrom(stream.pipe(toArray()));

describe('CartEffects.loadCart', () => {
	it('reads the items', async () => {
		const { effects } = setup(of(CartActions.loadCart()), [], of({ items: [line(1)], total: 9 }));
		await expect(firstValueFrom(effects.loadCart$)).resolves.toMatchObject({ total: 9 });
	});

	it('defaults a bare answer, and a failure', async () => {
		const bare = setup(of(CartActions.loadCart()));
		await expect(firstValueFrom(bare.effects.loadCart$)).resolves.toMatchObject({ items: [], total: 0 });
		const failed = setup(
			of(CartActions.loadCart()),
			[],
			throwError(() => new Error('down')),
		);
		await expect(firstValueFrom(failed.effects.loadCart$)).resolves.toMatchObject({ items: [], total: 0 });
	});
});

describe('CartEffects.addToCart', () => {
	it('updates a line it knows and adds a new one otherwise', async () => {
		const known = setup(of(CartActions.addToCart({ payload: { id: 1 } as never })));
		await expect(firstValueFrom(known.effects.addToCart$)).resolves.toMatchObject({
			type: CartActions.updateCart.type,
		});
		const fresh = setup(of(CartActions.addToCart({ payload: {} as never })));
		await expect(firstValueFrom(fresh.effects.addToCart$)).resolves.toMatchObject({
			type: CartActions.addNewItem.type,
		});
	});
});

describe('CartEffects.updateCart', () => {
	const update = (id: number, quantity: number) => of(CartActions.updateCart({ payload: { id, quantity } as never }));

	it('ignores an unknown line', async () => {
		await expect(run(setup(update(9, 1), [line(1)]).effects.updateCart$)).resolves.toEqual([]);
	});

	it('refuses more than the stock', async () => {
		const { effects, notification } = setup(update(1, 9), [line(1)]);
		await expect(run(effects.updateCart$)).resolves.toEqual([]);
		expect(notification.showError).toHaveBeenCalledOnce();
	});

	it('uses the stock of the variation when there is one', async () => {
		const { effects, notification } = setup(update(1, 3), [line(1, { variation: { quantity: 2 } })]);
		await run(effects.updateCart$);
		expect(notification.showError).toHaveBeenCalledOnce();
	});

	it('deletes a line that reaches zero', async () => {
		await expect(firstValueFrom(setup(update(1, -1), [line(1)]).effects.updateCart$)).resolves.toMatchObject({
			type: CartActions.deleteCart.type,
		});
	});

	it('sets the new quantity', async () => {
		await expect(firstValueFrom(setup(update(1, 1), [line(1)]).effects.updateCart$)).resolves.toMatchObject({
			type: CartActions.setQuantity.type,
			quantity: 2,
		});
	});
});

describe('cartReducer', () => {
	it('loads lines, with a given or a counted total', () => {
		expect(cartReducer(initialCartState, CartActions.loadCartSuccess({ items: [line(1)], total: 5 })).total).toBe(
			5,
		);
		expect(cartReducer(initialCartState, CartActions.loadCartSuccess({ items: [line(1)], total: 0 })).total).toBe(
			100,
		);
	});

	it('adds a line priced from its variation, its product, or nothing', () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.1);
		const fromVariation = cartReducer(
			initialCartState,
			CartActions.addNewItem({ payload: { quantity: 2, variation: { sale_price: 10 } } as never }),
		);
		expect(fromVariation.total).toBe(20);
		const fromProduct = cartReducer(
			initialCartState,
			CartActions.addNewItem({ payload: { quantity: 2, product: { sale_price: 5 } } as never }),
		);
		expect(fromProduct.total).toBe(10);
		const unpriced = cartReducer(initialCartState, CartActions.addNewItem({ payload: { quantity: 2 } as never }));
		expect(unpriced.total).toBe(0);
		vi.restoreAllMocks();
	});

	it('sets a quantity from either price, and ignores an unknown line', () => {
		const loaded = cartReducer(
			initialCartState,
			CartActions.loadCartSuccess({ items: [line(1), line(2, { variation: { sale_price: 7 } })], total: 0 }),
		);
		expect(cartReducer(loaded, CartActions.setQuantity({ id: 1, quantity: 3 })).entities[1]?.sub_total).toBe(300);
		expect(cartReducer(loaded, CartActions.setQuantity({ id: 2, quantity: 3 })).entities[2]?.sub_total).toBe(21);
		expect(cartReducer(loaded, CartActions.setQuantity({ id: 9, quantity: 3 }))).toBe(loaded);
	});

	it('deletes a line and clears the cart', () => {
		const loaded = cartReducer(initialCartState, CartActions.loadCartSuccess({ items: [line(1)], total: 0 }));
		expect(cartReducer(loaded, CartActions.deleteCart({ id: 1 })).total).toBe(0);
		expect(cartReducer(loaded, CartActions.clearCart())).toMatchObject({ ids: [], total: 0 });
	});
});

describe('cart selectors', () => {
	it('read the state', () => {
		const state = { ids: [1], entities: { 1: { id: 1 } }, total: 5 } as never;
		expect(selectCartItems.projector(state)).toEqual([{ id: 1 }]);
		expect(selectCartTotal.projector(state)).toBe(5);
	});
});
