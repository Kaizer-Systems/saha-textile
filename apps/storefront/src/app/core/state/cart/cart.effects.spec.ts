import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action, Store } from '@ngrx/store';
import { firstValueFrom, of, Subject, throwError, toArray } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CartService } from '@data-access/services/cart.service';
import { NotificationService } from '@data-access/services/notification.service';

import { CartActions } from './cart.actions';
import { CartEffects } from './cart.effects';

const view = { id: 'c1', lines: [], subtotalINR: 300, count: 1 };
const loaded = CartActions.loadCartSuccess({ items: [], total: 300 });

const setup = (items: unknown[] = []) => {
	const actions$ = new Subject<Action>();
	const service = {
		current: vi.fn(() => of(view)),
		add: vi.fn(() => of(view)),
		update: vi.fn(() => of(view)),
		remove: vi.fn(() => of(view)),
	};
	const toasts = { showError: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			CartEffects,
			provideMockActions(() => actions$),
			{ provide: Store, useValue: { select: () => of(items) } },
			{ provide: CartService, useValue: service },
			{ provide: NotificationService, useValue: toasts },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	return { actions$, service, toasts, effects: TestBed.inject(CartEffects) };
};

const run = async (source: { pipe: never } | unknown, actions$: Subject<Action>, action: Action) => {
	const seen = firstValueFrom((source as Subject<Action>).pipe(toArray()));
	actions$.next(action);
	actions$.complete();
	return seen;
};

const payload = (over: Record<string, unknown> = {}) =>
	({ id: null, product_id: 'p1', variation_id: null, quantity: 1, ...over }) as never;

afterEach(() => vi.useRealTimers());

describe('CartEffects', () => {
	it('reads the cart, and keeps the screen quietly when the read fails', async () => {
		const { effects, actions$, service, toasts } = setup();
		expect(await run(effects.getCartItems$, actions$, CartActions.getCartItems())).toEqual([loaded]);
		expect(service.current).toHaveBeenCalledOnce();

		const failed = setup();
		failed.service.current.mockReturnValue(throwError(() => new Error('down')));
		expect(await run(failed.effects.getCartItems$, failed.actions$, CartActions.getCartItems())).toEqual([]);
		expect(failed.toasts.showError).not.toHaveBeenCalled();
		expect(toasts.showError).not.toHaveBeenCalled();
	});

	it('adds the choice and no price', async () => {
		const { effects, actions$, service } = setup();
		const add = CartActions.addToCart({ payload: payload({ unit_price: 1, quantity: 2 }) });
		expect(await run(effects.addToCart$, actions$, add)).toEqual([
			CartActions.cartLineAdded({ items: [], total: 300 }),
		]);
		expect(service.add).toHaveBeenCalledWith({ productId: 'p1', quantity: 2, variationId: null, addons: [] });
	});

	it('says when there is not enough stock, and when anything else fails', async () => {
		const stock = setup();
		stock.service.add.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
		const add = CartActions.addToCart({ payload: payload() });
		expect(await run(stock.effects.addToCart$, stock.actions$, add)).toEqual([]);
		expect(stock.toasts.showError).toHaveBeenCalledWith('cart_stock_limit');

		const down = setup();
		down.service.add.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
		await run(down.effects.addToCart$, down.actions$, add);
		expect(down.toasts.showError).toHaveBeenCalledWith('cart_update_failed');
	});

	it('sends a card stepper going down to the line, not the add route', async () => {
		const { effects, actions$, service } = setup();
		const lower = CartActions.addToCart({ payload: payload({ id: 'l1', quantity: -1 }) });
		const seen = firstValueFrom(effects.lowerFromCard$.pipe(toArray()));
		const adds = firstValueFrom(effects.addToCart$.pipe(toArray()));
		actions$.next(lower);
		actions$.next(CartActions.addToCart({ payload: payload({ quantity: 0 }) }));
		actions$.complete();
		expect(await seen).toEqual([CartActions.updateCart({ payload: payload({ id: 'l1', quantity: -1 }) })]);
		expect(await adds).toEqual([]);
		expect(service.add).not.toHaveBeenCalled();
	});

	it('closes the sticky cart after a moment', async () => {
		vi.useFakeTimers();
		const { effects, actions$ } = setup();
		const seen = firstValueFrom(effects.closeStickyAfterAdd$);
		actions$.next(CartActions.cartLineAdded({ items: [], total: 0 }));
		await vi.advanceTimersByTimeAsync(1500);
		expect(await seen).toEqual(CartActions.closeStickyCart());
	});

	it('sets the new quantity, removes at zero, and ignores an unknown line', async () => {
		const items = [{ id: 'l1', quantity: 2 }];
		const up = setup(items);
		const change = (quantity: number, id = 'l1') => CartActions.updateCart({ payload: payload({ id, quantity }) });
		expect(await run(up.effects.updateCart$, up.actions$, change(1))).toEqual([loaded]);
		expect(up.service.update).toHaveBeenCalledWith('l1', { quantity: 3 });

		const down = setup(items);
		await run(down.effects.updateCart$, down.actions$, change(-2));
		expect(down.service.remove).toHaveBeenCalledWith('l1');

		const none = setup(items);
		expect(await run(none.effects.updateCart$, none.actions$, change(1, 'nope'))).toEqual([]);
		expect(none.service.update).not.toHaveBeenCalled();
	});

	it('replaces the choices on an edit, and needs a line to edit', async () => {
		const { effects, actions$, service } = setup();
		const edit = CartActions.editLine({ payload: payload({ id: 'l1', quantity: 3, variation_id: 'v2' }) });
		expect(await run(effects.editLine$, actions$, edit)).toEqual([loaded]);
		expect(service.update).toHaveBeenCalledWith('l1', { quantity: 3, variationId: 'v2', addons: [] });

		const none = setup();
		await run(none.effects.editLine$, none.actions$, CartActions.editLine({ payload: payload() }));
		expect(none.service.update).not.toHaveBeenCalled();
	});

	it('removes a line, and keeps going after a refusal', async () => {
		const { effects, actions$, service, toasts } = setup();
		service.remove.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })));
		const seen = firstValueFrom(effects.deleteCart$.pipe(toArray()));
		actions$.next(CartActions.deleteCart({ id: 'l1' }));
		actions$.next(CartActions.deleteCart({ id: 'l2' }));
		actions$.complete();
		expect(await seen).toEqual([loaded]);
		expect(toasts.showError).toHaveBeenCalledOnce();
	});
});
