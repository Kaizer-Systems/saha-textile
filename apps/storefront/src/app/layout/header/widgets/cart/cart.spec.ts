import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { BehaviorSubject, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { CartFacade } from '@core/state/cart/cart.facade';
import { SettingStore } from '@core/state/setting.store';
import { SiteConfigStore } from '@core/state/site-config.store';

import { Cart } from './cart';

const render = (freeOver = 1000, platform = 'browser') => {
	const total = new BehaviorSubject(0);
	const siteConfig = signal<unknown>(null);
	const session = signal(false);
	const setting = signal<unknown>({ general: { min_order_free_shipping: freeOver } });
	const facade = {
		cartItems$: of([]),
		cartTotal$: total,
		sidebarCartOpen$: of(false),
		getCartItems: vi.fn(),
		toggleSidebarCart: vi.fn(),
		updateCart: vi.fn(),
		deleteCart: vi.fn(),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: CartFacade, useValue: facade },
			{ provide: SettingStore, useValue: { setting } },
			{ provide: SiteConfigStore, useValue: { siteConfig } },
			{ provide: AuthStore, useValue: { isAuthenticated: session } },
			{ provide: PLATFORM_ID, useValue: platform },
		],
	});
	TestBed.overrideComponent(Cart, { set: { imports: [], template: '' } });
	const cart = TestBed.createComponent(Cart).componentInstance;
	TestBed.tick();
	return { cart, total, siteConfig, setting, facade, session };
};

afterEach(() => vi.useRealTimers());

describe('Header cart', () => {
	it('reads the cart again whenever the session changes', () => {
		const { facade, session } = render();
		expect(facade.getCartItems).toHaveBeenCalledOnce();
		session.set(true);
		TestBed.tick();
		expect(facade.getCartItems).toHaveBeenCalledTimes(2);
	});

	it('never reads the cart on the server, which has no cookies', () => {
		expect(render(undefined, 'server').facade.getCartItems).not.toHaveBeenCalled();
	});

	it('keeps the default style until the config arrives', () => {
		const { cart, siteConfig } = render();
		expect(cart.cartStyle).toBe('cart_sidebar');
		siteConfig.set({ general: { cart_style: 'cart_mini' } });
		TestBed.tick();
		expect(cart.cartStyle).toBe('cart_mini');
		siteConfig.set({ general: {} });
		TestBed.tick();
		expect(cart.cartStyle).toBe('cart_mini');
	});

	it('prefers the composed unit price, then the variation, then the product', () => {
		const { cart } = render();
		expect(cart.unitPrice({ unit_price: 9, product: {} } as never)).toBe(9);
		expect(cart.unitPrice({ variation: { sale_price: 8 }, product: {} } as never)).toBe(8);
		expect(cart.unitPrice({ product: { sale_price: 7 } } as never)).toBe(7);
	});

	it('tracks progress to free shipping', () => {
		const { cart, total } = render();
		total.next(500);
		expect(cart.shippingCal).toBe(50);
		expect(cart.confetti).toBe(0);
	});

	it('celebrates once when free shipping is reached, then calms down', () => {
		vi.useFakeTimers();
		const { cart, total } = render();
		total.next(1500);
		expect(cart.shippingCal).toBe(100);
		expect(cart.confetti).toBe(1);
		total.next(1600);
		expect(cart.confetti).toBe(1);
		vi.advanceTimersByTime(4500);
		expect(cart.confetti).toBe(2);
		total.next(100);
		expect(cart.confetti).toBe(0);
	});

	it('copes with settings not loaded yet', () => {
		const { cart, setting, total } = render();
		setting.set(null);
		TestBed.tick();
		total.next(10);
		expect(cart.shippingFreeAmt).toBeUndefined();
	});

	it('opens and closes the sidebar', () => {
		const { cart, facade } = render();
		cart.cartToggle(true);
		expect(facade.toggleSidebarCart).toHaveBeenCalledWith(true);
	});

	it('updates a line with its variation, or without one', () => {
		const { cart, facade } = render();
		cart.updateQuantity({ id: 1, product: { id: 7 }, variation_id: 3, variation: { id: 3 } } as never, 2);
		expect(facade.updateCart).toHaveBeenLastCalledWith({
			id: 1,
			product_id: 7,
			product: { id: 7 },
			variation_id: 3,
			variation: { id: 3 },
			quantity: 2,
		});
		cart.updateQuantity({ id: 2 } as never, 1);
		expect(facade.updateCart).toHaveBeenLastCalledWith({
			id: 2,
			product_id: undefined,
			product: null,
			variation_id: null,
			variation: null,
			quantity: 1,
		});
	});

	it('deletes a line', () => {
		const { cart, facade } = render();
		cart.delete('l4');
		expect(facade.deleteCart).toHaveBeenCalledWith('l4');
	});
});
