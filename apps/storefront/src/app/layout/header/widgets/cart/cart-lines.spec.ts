import { Component, PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { CartFacade } from '@core/state/cart/cart.facade';
import { SettingStore } from '@core/state/setting.store';
import { SiteConfigStore } from '@core/state/site-config.store';
import { ICart } from '@data-access/interfaces/cart.interface';

import { Cart } from './cart';

/** Stands in for the options popup, which the header draws once a line's Edit is asked for. */
@Component({ selector: 'app-config-popup', template: '' })
class ConfigPopup {
	readonly openModal = vi.fn();
}

const render = () => {
	const facade = {
		cartItems$: of([]),
		cartTotal$: of(0),
		sidebarCartOpen$: of(false),
		getCartItems: vi.fn(),
		toggleSidebarCart: vi.fn(),
		updateCart: vi.fn(),
		deleteCart: vi.fn(),
		editLine: vi.fn(),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: CartFacade, useValue: facade },
			{ provide: SettingStore, useValue: { setting: signal({ general: { min_order_free_shipping: 1000 } }) } },
			{ provide: SiteConfigStore, useValue: { siteConfig: signal(null) } },
			{ provide: AuthStore, useValue: { isAuthenticated: signal(false) } },
			{ provide: PLATFORM_ID, useValue: 'browser' },
		],
	});
	TestBed.overrideComponent(Cart, {
		set: { imports: [ConfigPopup], template: '@if (editing()) { <app-config-popup #configModal /> }' },
	});
	const fixture = TestBed.createComponent(Cart);
	fixture.detectChanges();
	return { fixture, cart: fixture.componentInstance, facade };
};

const line = (over: Record<string, unknown> = {}) =>
	({ id: 'l1', product: { id: 7 }, variation: null, quantity: 2, ...over }) as unknown as ICart;
const metre = (over: Record<string, unknown> = {}) =>
	line({ sold_by: 'metre', shortest_cut_tenths: 10, quantity: 25, available: 40, ...over });

describe('Header cart: lines', () => {
	it('draws the options popup on Edit and opens it with the line once it is there', () => {
		const { fixture, cart } = render();
		const first = line();
		cart.edit(first);
		expect(cart.editing()).toBe(first);
		fixture.detectChanges();
		const popup = cart.configModal() as unknown as ConfigPopup;
		expect(popup.openModal).toHaveBeenCalledWith(first);

		cart.edit(first);
		expect(popup.openModal).toHaveBeenCalledTimes(2);

		const second = line({ id: 'l2' });
		cart.edit(second);
		expect(cart.editing()).toBe(second);
		expect(popup.openModal).toHaveBeenCalledTimes(2);
	});

	it('folds and unfolds a set to show what it holds', () => {
		const { cart } = render();
		cart.toggle(line());
		expect(cart.isOpen(line())).toBe(true);
		cart.toggle(line());
		expect(cart.isOpen(line())).toBe(false);
	});

	it('names a line’s free items on one row, and nothing when it has none', () => {
		const { cart } = render();
		expect(cart.freeNames(line())).toBe('');
		const children = [
			{ role: 'free', title: 'Petticoat' },
			{ role: 'piece', title: 'Saree' },
			{ role: 'free', title: 'Bag' },
		];
		expect(cart.freeNames(line({ children }))).toBe('Petticoat, Bag');
	});

	it('writes pieces as a number and metres as a length', () => {
		const { cart } = render();
		expect(cart.qtyText(line(), 'm')).toBe('2');
		expect(cart.qtyText(metre(), 'm')).toBe('2.5 m');
	});

	it('steps a line, removes it at its floor, and holds at what is free to sell', () => {
		const { cart, facade } = render();
		cart.step(line(), -1);
		expect(facade.updateCart).toHaveBeenLastCalledWith(expect.objectContaining({ quantity: -1 }));
		cart.step(metre({ quantity: 10 }), -1);
		expect(facade.deleteCart).toHaveBeenCalledWith('l1');
		facade.updateCart.mockClear();
		cart.step(metre({ quantity: 40 }), 1);
		expect(facade.updateCart).not.toHaveBeenCalled();
	});

	it('sets a typed length, and puts the box back when nothing changes', () => {
		const { cart, facade } = render();
		const box = { value: '3' } as HTMLInputElement;
		cart.typeLength(metre({ variation_id: 5 }), box, 'm');
		expect(box.value).toBe('2.5 m');
		expect(facade.editLine).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: 'l1', product_id: 7, variation_id: 5, quantity: 30 }),
		);
		cart.typeLength(metre(), { value: '4' } as HTMLInputElement, 'm');
		expect(facade.editLine.mock.lastCall?.[0]).toMatchObject({ variation_id: null, quantity: 40 });
		facade.editLine.mockClear();
		cart.typeLength(metre(), { value: '2.5' } as HTMLInputElement, 'm');
		expect(facade.editLine).not.toHaveBeenCalled();
	});
});
