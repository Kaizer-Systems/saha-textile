import { TestBed } from '@angular/core/testing';

import { provideMockActions } from '@ngrx/effects/testing';
import { Store } from '@ngrx/store';
import { firstValueFrom, Observable, of, throwError, toArray } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CartService } from '@data-access/services/cart.service';
import { NotificationService } from '@data-access/services/notification.service';

import { CartActions } from './cart.actions';
import { CartEffects } from './cart.effects';
import { CART_FEATURE_KEY, initialCartState } from './cart.models';
import { cartPersistenceMetaReducer } from './cart.persistence';

const line = (overrides: Record<string, unknown> = {}) => ({
	id: 1,
	quantity: 2,
	sub_total: 200,
	product: { quantity: 5, sale_price: 100 },
	variation: null,
	variation_id: null,
	unit_price: 100,
	line_config: undefined,
	...overrides,
});

const variant = (overrides: Record<string, unknown> = {}) => ({
	id: 'v1',
	quantity: 5,
	sale_price: 80,
	name: 'Red',
	...overrides,
});

const setup = (action: unknown, items: unknown[] = [line()], cart: unknown = { getCartItems: () => of(null) }) => {
	const showError = vi.fn();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			CartEffects,
			provideMockActions(of(action) as Observable<never>),
			{ provide: Store, useValue: { select: () => of(items) } },
			{ provide: CartService, useValue: cart },
			{ provide: NotificationService, useValue: { showError } },
		],
	});
	return { effects: TestBed.inject(CartEffects), showError };
};

const all = (stream: Observable<unknown>) => firstValueFrom(stream.pipe(toArray()));
const update = (payload: Record<string, unknown>) => CartActions.updateCart({ payload: payload as never });
const edit = (payload: Record<string, unknown>) => CartActions.editLine({ payload: payload as never });
const replace = (payload: Record<string, unknown>) => CartActions.replaceCart({ payload: payload as never });

describe('loading the cart', () => {
	it('fills in an empty answer, keeps a real one, and ignores a failure', async () => {
		const empty = setup(CartActions.getCartItems());
		expect(await all(empty.effects.getCartItems$)).toEqual([CartActions.loadCartSuccess({ items: [], total: 0 })]);
		const real = setup(CartActions.getCartItems(), [], { getCartItems: () => of({ items: ['x'], total: 9 }) });
		expect(await all(real.effects.getCartItems$)).toEqual([
			CartActions.loadCartSuccess({ items: ['x'] as never, total: 9 }),
		]);
		const broken = setup(CartActions.getCartItems(), [], {
			getCartItems: () => throwError(() => new Error('down')),
		});
		expect(await all(broken.effects.getCartItems$)).toEqual([]);
	});
});

describe('adding', () => {
	it('updates a line it knows and adds one it does not', async () => {
		const known = setup(CartActions.addToCart({ payload: { id: 1 } as never }));
		expect(await all(known.effects.addToCart$)).toEqual([CartActions.updateCart({ payload: { id: 1 } as never })]);
		const fresh = setup(CartActions.addToCart({ payload: { id: null } as never }));
		expect(await all(fresh.effects.addToCart$)).toEqual([
			CartActions.addNewItem({ payload: { id: null } as never }),
		]);
	});

	it('closes the sticky cart after an add', async () => {
		vi.useFakeTimers();
		const { effects } = setup(CartActions.addNewItem({ payload: {} as never }));
		const result = all(effects.closeStickyAfterAdd$);
		await vi.advanceTimersByTimeAsync(1500);
		expect(await result).toEqual([CartActions.closeStickyCart()]);
		vi.useRealTimers();
	});
});

describe('changing a quantity', () => {
	it('ignores a line that is gone', async () => {
		expect(await all(setup(update({ id: 9, quantity: 1 })).effects.updateCart$)).toEqual([]);
	});

	it('routes a different variation to a replace', async () => {
		const payload = { id: 1, variation_id: 'v2', quantity: 1 };
		const { effects } = setup(update(payload), [line({ variation: variant(), variation_id: 'v1' })]);
		expect(await all(effects.updateCart$)).toEqual([CartActions.replaceCart({ payload: payload as never })]);
	});

	it('refuses more than is in stock, by product or by variant', async () => {
		const product = setup(update({ id: 1, quantity: 10 }));
		expect(await all(product.effects.updateCart$)).toEqual([]);
		expect(product.showError).toHaveBeenCalledTimes(1);
		const chosen = setup(update({ id: 1, quantity: 10, variation_id: 'v1' }), [
			line({ variation: variant({ quantity: 3 }), variation_id: 'v1' }),
		]);
		expect(await all(chosen.effects.updateCart$)).toEqual([]);
		expect(chosen.showError).toHaveBeenCalledTimes(1);
	});

	it('deletes a line that reaches zero', async () => {
		expect(await all(setup(update({ id: 1, quantity: -2 })).effects.updateCart$)).toEqual([
			CartActions.deleteCart({ id: 1 }),
		]);
	});

	it('updates the quantity and the subtotal', async () => {
		const [action] = (await all(setup(update({ id: 1, quantity: 1 })).effects.updateCart$)) as Array<{
			changes: Record<string, unknown>;
		}>;
		expect(action?.changes).toEqual({ quantity: 3, sub_total: 300 });
		const chosen = setup(update({ id: 1, quantity: 1, variation_id: 'v1' }), [
			line({ variation: variant(), variation_id: 'v1' }),
		]);
		const [next] = (await all(chosen.effects.updateCart$)) as Array<{
			changes: { variation: { selected_variation: unknown } };
		}>;
		expect(next?.changes.variation).toHaveProperty('selected_variation');
		const without = setup(update({ id: 1, quantity: 1 }), [line({ variation: variant(), variation_id: 'v1' })]);
		expect(await all(without.effects.updateCart$)).toHaveLength(1);
	});
});

describe('editing a line', () => {
	it('ignores a line that is gone', async () => {
		expect(await all(setup(edit({ id: 9, quantity: 1 })).effects.editLine$)).toEqual([]);
	});

	it('overwrites with what was sent', async () => {
		const payload = {
			id: 1,
			quantity: 3,
			unit_price: 150,
			variation: variant(),
			variation_id: 'v1',
			line_config: { base_price: 1 },
		};
		const [action] = (await all(setup(edit(payload)).effects.editLine$)) as Array<{
			changes: Record<string, unknown>;
		}>;
		expect(action?.changes).toMatchObject({
			quantity: 3,
			unit_price: 150,
			sub_total: 450,
			variation_id: 'v1',
			line_config: { base_price: 1 },
		});
	});

	it('keeps what was not sent', async () => {
		const held = line({ variation: variant(), variation_id: 'v1', line_config: { base_price: 2 } });
		const [action] = (await all(setup(edit({ id: 1, quantity: 0 }), [held]).effects.editLine$)) as Array<{
			changes: Record<string, unknown>;
		}>;
		expect(action?.changes).toMatchObject({ quantity: 2, variation_id: 'v1', line_config: { base_price: 2 } });
	});

	it('refuses more than is in stock', async () => {
		const short = setup(edit({ id: 1, quantity: 9, variation: variant({ quantity: 1 }) }));
		expect(await all(short.effects.editLine$)).toEqual([]);
		expect(short.showError).toHaveBeenCalledTimes(1);
		const product = setup(edit({ id: 1, quantity: 9 }));
		expect(await all(product.effects.editLine$)).toEqual([]);
	});

	it('skips the check when no stock figure is known', async () => {
		const unknown = setup(edit({ id: 1, quantity: 9 }), [line({ product: undefined })]);
		expect(await all(unknown.effects.editLine$)).toHaveLength(1);
	});
});

describe('swapping a variation', () => {
	const held = (overrides: Record<string, unknown> = {}) =>
		line({ variation: variant(), variation_id: 'v1', ...overrides });

	it('ignores a line that is gone', async () => {
		expect(await all(setup(replace({ id: 9, quantity: 1 })).effects.replaceCart$)).toEqual([]);
	});

	it('moves to the new variant, keeping add-on deltas', async () => {
		const payload = { id: 1, quantity: 2, variation_id: 'v2', variation: variant({ id: 'v2', sale_price: 90 }) };
		const { effects } = setup(replace(payload), [held({ line_config: { delta_total: 10 } })]);
		const [action] = (await all(effects.replaceCart$)) as Array<{ changes: Record<string, unknown> }>;
		expect(action?.changes).toMatchObject({ variation_id: 'v2', quantity: 2, unit_price: 100, sub_total: 200 });
	});

	it('keeps the variant when it has not changed, or the line has none', async () => {
		const same = setup(replace({ id: 1, quantity: 1, variation_id: 'v1' }), [held()]);
		const [kept] = (await all(same.effects.replaceCart$)) as Array<{ changes: Record<string, unknown> }>;
		expect(kept?.changes).toMatchObject({ variation_id: 'v1', unit_price: 80 });
		const none = setup(replace({ id: 1, quantity: 1 }), [held()]);
		expect(await all(none.effects.replaceCart$)).toHaveLength(1);
		const plain = setup(replace({ id: 1, quantity: 1, variation_id: 'v2' }));
		const [base] = (await all(plain.effects.replaceCart$)) as Array<{ changes: Record<string, unknown> }>;
		expect(base?.changes).toMatchObject({ unit_price: 100 });
	});

	it('refuses more than is in stock, and deletes at zero', async () => {
		const short = setup(replace({ id: 1, quantity: 9 }));
		expect(await all(short.effects.replaceCart$)).toEqual([]);
		expect(short.showError).toHaveBeenCalledTimes(1);
		expect(await all(setup(replace({ id: 1, quantity: 0 })).effects.replaceCart$)).toEqual([
			CartActions.deleteCart({ id: 1 }),
		]);
	});
});

describe('cart persistence', () => {
	const reducer = vi.fn((state: unknown) => state ?? initialCartState);
	const wrapped = cartPersistenceMetaReducer(reducer as never);
	const seed = (value: string | null) => {
		if (value === null) localStorage.removeItem('ngrx_cart');
		else localStorage.setItem('ngrx_cart', value);
	};

	it('rehydrates on start, with defaults for a thin saved cart', () => {
		seed(JSON.stringify({ items: [{ id: 1 }], total: 5 }));
		expect(wrapped(undefined, { type: '@ngrx/store/init' })).toMatchObject({ total: 5, ids: [1] });
		seed('{}');
		expect(wrapped(undefined, { type: '@ngrx/store/update-reducers' })).toMatchObject({ total: 0, ids: [] });
	});

	it('survives corrupt storage, and stores the next state', () => {
		seed('not json');
		expect(wrapped(undefined, { type: '@ngrx/store/init' })).toBeDefined();
		seed(null);
		wrapped(undefined, { type: '@ngrx/store/init' });
		expect(localStorage.getItem('ngrx_cart')).toContain('"total"');
		seed(null);
		wrapped(initialCartState, { type: 'other' });
		expect(localStorage.getItem('ngrx_cart')).not.toBeNull();
	});

	it('stores nothing when the reducer gives nothing back', () => {
		seed(null);
		const empty = cartPersistenceMetaReducer((() => undefined) as never);
		expect(empty(undefined, { type: 'other' })).toBeUndefined();
		expect(localStorage.getItem('ngrx_cart')).toBeNull();
		expect(CART_FEATURE_KEY).toBeDefined();
	});

	it('does nothing without browser storage', () => {
		const storage = globalThis.localStorage;
		vi.stubGlobal('localStorage', undefined);
		expect(wrapped(undefined, { type: '@ngrx/store/init' })).toBeDefined();
		vi.stubGlobal('localStorage', storage);
		vi.unstubAllGlobals();
	});
});
