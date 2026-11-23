import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CartFacade } from '@core/state/cart/cart.facade';
import { OnlineStatus } from '@core/state/online-status';
import { WishlistStore } from '@core/state/wishlist/wishlist.store';
import { ICart } from '@data-access/interfaces/cart.interface';

import { Cart } from './cart';

const t = (key: string, params?: Record<string, unknown>) =>
	params ? `${key}(${Object.values(params).join(',')})` : key;

const render = () => {
	const facade = {
		cartItems$: of([]),
		cartTotal$: of(0),
		getCartItems: vi.fn(),
		updateCart: vi.fn(),
		deleteCart: vi.fn(),
		editLine: vi.fn(),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: CartFacade, useValue: facade },
			{ provide: OnlineStatus, useValue: { online: signal(true) } },
			{ provide: WishlistStore, useValue: { has: () => false, toggle: vi.fn() } },
			{ provide: TranslocoService, useValue: { selectTranslate: () => of(''), translate: t } },
		],
	});
	TestBed.overrideComponent(Cart, { set: { imports: [], template: '' } });
	return { page: TestBed.createComponent(Cart).componentInstance, facade };
};

const line = (over: Record<string, unknown> = {}) =>
	({ id: 'l1', product: { id: 7 }, variation: null, quantity: 2, ...over }) as unknown as ICart;
const metre = (over: Record<string, unknown> = {}) =>
	line({ sold_by: 'metre', shortest_cut_tenths: 10, quantity: 25, available: 40, ...over });
const box = (value: string) => ({ value }) as HTMLInputElement;

describe('Cart page: lines', () => {
	it('writes pieces as a number and metre lines as a length', () => {
		const { page } = render();
		expect(page.qtyText(line())).toBe('2');
		expect(page.qtyText(metre())).toBe('2.5 unit_m');
		expect(page.lengthOf(10)).toBe('1.0 unit_m');
		expect(page.hasMetre([line()])).toBe(false);
		expect(page.hasMetre([line(), metre()])).toBe(true);
	});

	it('steps pieces by one, metres by half a metre, and removes a line at its floor', () => {
		const { page, facade } = render();
		page.step(line(), 1);
		expect(facade.updateCart).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'l1', quantity: 1 }));
		page.step(metre(), -1);
		expect(facade.updateCart).toHaveBeenLastCalledWith(expect.objectContaining({ quantity: -5 }));
		page.step(metre({ quantity: 10 }), -1);
		expect(facade.deleteCart).toHaveBeenCalledWith('l1');
		facade.updateCart.mockClear();
		page.step(metre({ quantity: 40 }), 1);
		expect(facade.updateCart).not.toHaveBeenCalled();
	});

	it('sets a typed length outright, and puts the box back when it reads nothing new', () => {
		const { page, facade } = render();
		const typed = box('3');
		page.typeLength(metre({ variation_id: 4 }), typed);
		expect(typed.value).toBe('2.5 unit_m');
		expect(facade.editLine).toHaveBeenCalledWith({
			id: 'l1',
			product: { id: 7 },
			product_id: 7,
			variation: null,
			variation_id: 4,
			quantity: 30,
			line_config: undefined,
		});

		facade.editLine.mockClear();
		const unreadable = box('lots');
		page.typeLength(metre(), unreadable);
		expect(unreadable.value).toBe('2.5 unit_m');
		page.typeLength(metre(), box('2.5'));
		expect(facade.editLine).not.toHaveBeenCalled();
	});

	it('sends no variation for a typed length on a line without one', () => {
		const { page, facade } = render();
		page.typeLength(metre(), box('3.5'));
		expect(facade.editLine.mock.lastCall?.[0]).toMatchObject({ variation_id: null, quantity: 35 });
	});

	it('folds and unfolds a set’s rows on phones', () => {
		const { page } = render();
		const set = line({ id: 's1' });
		expect(page.isOpen(set)).toBe(false);
		page.toggle(set);
		expect(page.isOpen(set)).toBe(true);
		page.toggle(set);
		expect(page.isOpen(set)).toBe(false);
	});

	it('counts a set’s pieces and extras', () => {
		const { page } = render();
		expect(page.countText({ pieces: 1, extras: 0 } as never)).toBe('cart_set_pieces_one(1)');
		expect(page.countText({ pieces: 3, extras: 1 } as never)).toBe('cart_set_pieces(3) cart_set_extras(1)');
	});

	it('takes one extra out of a set and keeps every other choice', () => {
		const { page, facade } = render();
		page.removeExtra(line(), 'blouse');
		page.removeExtra(line({ line_config: { raw: {} } }), 'blouse');
		expect(facade.editLine).not.toHaveBeenCalled();

		const config = {
			summary: [],
			raw: { selections: { fall: 'yes' }, set_choice: { picks: { saree: ['a'] }, extras: ['blouse', 'bag'] } },
		};
		page.removeExtra(line({ variation_id: 3, line_config: config }), 'blouse');
		page.removeExtra(line({ line_config: config }), 'bag');
		expect(facade.editLine.mock.calls.map(([call]) => call)).toEqual([
			expect.objectContaining({
				variation_id: 3,
				quantity: 2,
				line_config: {
					summary: [],
					raw: { selections: { fall: 'yes' }, set_choice: { picks: { saree: ['a'] }, extras: ['bag'] } },
				},
			}),
			expect.objectContaining({ variation_id: null }),
		]);
	});
});
