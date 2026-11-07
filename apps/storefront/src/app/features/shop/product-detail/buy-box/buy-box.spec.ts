import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { BehaviorSubject, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { CartFacade } from '@core/state/cart/cart.facade';
import { CompareFacade } from '@core/state/compare/compare.store';
import { WishlistFacade } from '@core/state/wishlist/wishlist.store';
import { NotificationService } from '@data-access/services/notification.service';

import { BuyBox } from './buy-box';

const product = {
	id: 7,
	slug: 'red saree',
	sku: 'SKU-7',
	price: 2000,
	sale_price: 1500,
	discount: 25,
	stock_status: 'in_stock',
};

const render = (signedIn = true, overrides: Record<string, unknown> = {}) => {
	const items = new BehaviorSubject<unknown[]>([]);
	const cart = { cartItems$: items, addToCart: vi.fn() };
	const wishlist = { addToWishlist: vi.fn() };
	const compare = { addToCompare: vi.fn() };
	const toast = { showSuccess: vi.fn() };
	const router = { navigate: vi.fn() };
	const http = { post: vi.fn(() => of({})) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: CartFacade, useValue: cart },
			{ provide: WishlistFacade, useValue: wishlist },
			{ provide: CompareFacade, useValue: compare },
			{ provide: NotificationService, useValue: toast },
			{ provide: Router, useValue: router },
			{ provide: HttpClient, useValue: http },
			{ provide: AuthStore, useValue: { isAuthenticated: signal(signedIn) } },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(BuyBox, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(BuyBox);
	fixture.componentRef.setInput('product', { ...product, ...overrides });
	fixture.detectChanges();
	const box = fixture.componentInstance;
	const emitted: unknown[] = [];
	box.variationChange.subscribe((value) => emitted.push(value));
	return { box, items, cart, wishlist, compare, toast, router, http, emitted };
};
const configured = (box: BuyBox, params: unknown) => {
	const buildParams = vi.fn(() => params);
	Object.defineProperty(box, 'configurator', { value: () => ({ buildParams }) });
	return buildParams;
};
const summary = {
	displayPrice: 900,
	comparePrice: 1000,
	discount: 10,
	purchasable: false,
	soldOut: true,
	variation: { sku: 'VAR-1' },
} as never;

afterEach(() => sessionStorage.clear());

describe('BuyBox display', () => {
	it('falls back to the plain product until the configurator reports', () => {
		const { box } = render();
		expect([box.displayPrice(), box.comparePrice(), box.discount()]).toEqual([1500, 2000, 25]);
		expect(box.purchasable()).toBe(true);
		expect(box.soldOut()).toBe(false);
	});

	it('follows the configurator, and tells the page only when the variation changes', () => {
		const { box, emitted } = render();
		box.onSummary(summary);
		box.onSummary(summary);
		expect(emitted).toHaveLength(1);
		expect([box.displayPrice(), box.comparePrice(), box.discount()]).toEqual([900, 1000, 10]);
		expect(box.purchasable()).toBe(false);
		expect(box.soldOut()).toBe(true);
	});

	it('finds this product in the cart', () => {
		const { box, items } = render();
		expect(box.cartItem).toBeNull();
		items.next([{ id: 'line', product: { id: 7 } }]);
		expect(box.cartItem).toMatchObject({ id: 'line' });
	});

	it('never lets the quantity fall below one', () => {
		const { box } = render();
		box.updateQuantity(-1);
		expect(box.productQty).toBe(1);
		box.updateQuantity(2);
		expect(box.productQty).toBe(3);
	});
});

describe('BuyBox buying', () => {
	it('adds what the configurator composed', () => {
		const { box, cart } = render();
		const buildParams = configured(box, { product_id: 7 });
		box.addToCart();
		expect(buildParams).toHaveBeenCalledWith(1, null);
		expect(cart.addToCart).toHaveBeenCalledWith({ product_id: 7 });
	});

	it('updates the existing line when the product is already in the cart', () => {
		const { box, items } = render();
		items.next([{ id: 'line', product: { id: 7 } }]);
		const buildParams = configured(box, null);
		box.addToCart();
		expect(buildParams).toHaveBeenCalledWith(1, 'line');
	});

	it('adds nothing when the configurator refuses, or is not there', () => {
		const { box, cart } = render();
		box.addToCart();
		configured(box, null);
		box.addToCart();
		expect(cart.addToCart).not.toHaveBeenCalled();
	});

	it('goes straight to checkout on Buy Now', () => {
		const { box, router } = render();
		box.buyNow();
		expect(router.navigate).toHaveBeenCalledWith(['/checkout']);
	});

	it('adds to the wishlist and compare', () => {
		const { box, wishlist, compare } = render();
		box.addToWishlist();
		box.addToCompare();
		expect(wishlist.addToWishlist).toHaveBeenCalledWith({ product_id: 7 });
		expect(compare.addToCompare).toHaveBeenCalledWith({ product_id: 7 });
	});
});

describe('BuyBox stock alerts', () => {
	it('sends a guest to log in and remembers what they wanted', () => {
		const { box, router, http } = render(false);
		box.notify();
		expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
		expect(sessionStorage.getItem('st_notify_intent')).toContain('SKU-7');
		expect(http.post).not.toHaveBeenCalled();
	});

	it('saves the alert for a signed-in customer, for the chosen variant', () => {
		const { box, http, toast } = render();
		box.onSummary(summary);
		box.notify();
		expect(http.post).toHaveBeenCalledWith(
			expect.stringContaining('/catalog/products/red%20saree/stock-alerts'),
			{ variantSku: 'VAR-1' },
			{ withCredentials: true },
		);
		expect(toast.showSuccess).toHaveBeenCalledWith('stock_alert_saved');
	});

	it('uses the product SKU when no variant is chosen', () => {
		const { box, http } = render();
		box.notify();
		expect(http.post.mock.calls[0]).toBeDefined();
		expect((http.post.mock.calls[0] as unknown[])[1]).toEqual({ variantSku: 'SKU-7' });
	});
});
