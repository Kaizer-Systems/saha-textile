import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { BehaviorSubject, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { CartFacade } from '@core/state/cart/cart.facade';
import { CompareStore } from '@core/state/compare/compare.store';
import { WishlistStore } from '@core/state/wishlist/wishlist.store';
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
	const wishlist = { saved: signal(new Set(['7'])), has: vi.fn(() => false), toggle: vi.fn(async () => {}) };
	const compare = { chosen: signal(new Set(['red-saree'])), toggle: vi.fn() };
	const toast = { showSuccess: vi.fn() };
	const router = { navigate: vi.fn() };
	const http = { post: vi.fn(() => of({})) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: CartFacade, useValue: cart },
			{ provide: WishlistStore, useValue: wishlist },
			{ provide: CompareStore, useValue: compare },
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

	it('toggles the wishlist and compare, and shows their state', () => {
		const { box, wishlist, compare } = render();
		expect(box.saved()).toBe(true);
		expect(box.compared()).toBe(false);
		box.toggleWishlist();
		box.toggleCompare();
		expect(wishlist.toggle).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
		expect(compare.toggle).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
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

describe('BuyBox fabric by the metre (M02–M04)', () => {
	const fabric = {
		sale_price: 180,
		price: 180,
		discount: 0,
		quantity: 45,
		sold_by: 'metre',
		metre_rule: {
			shortestCutTenths: 10,
			stepTenths: 5,
			quickLengths: [{ tenths: 25, label: 'suit' }],
			widthInches: 44,
		},
	};

	it('starts at the shortest cut, steps by 0.5 m and stops at what is left', () => {
		const { box } = render(true, fabric);
		expect(box.length()).toBe(10);
		box.updateQuantity(1);
		expect(box.length()).toBe(15);
		box.updateQuantity(-1);
		box.updateQuantity(-1);
		expect(box.length()).toBe(10);
		box.pickLength(43);
		box.updateQuantity(1);
		expect(box.length()).toBe(45);
		expect(box.lineTotal()).toBe(810);
	});

	it('snaps a typed length and says so, and turns buying off below the cut', () => {
		const { box } = render(true, fabric);
		const input = document.createElement('input');
		input.value = '2.55';
		box.typeLength(input);
		expect(box.length()).toBe(26);
		expect(box.snapped()).toEqual({ typed: '2.55', length: '2.6 unit_m' });
		expect(input.value).toBe('2.6 unit_m');
		input.value = '0.5';
		box.typeLength(input);
		expect(box.lengthIssue()).toBe('below_cut');
		expect(box.purchasable()).toBe(false);
		input.value = '60';
		box.typeLength(input);
		expect(box.lengthIssue()).toBe('over_stock');
		input.value = 'two';
		box.typeLength(input);
		expect(box.length()).toBe(600);
	});

	it('sends the length in tenths to the cart, and nothing while it cannot be bought', () => {
		const { box, cart } = render(true, fabric);
		const build = configured(box, { quantity: 25 });
		box.pickLength(25);
		box.addToCart();
		expect(build).toHaveBeenCalledWith(25, null);
		expect(cart.addToCart).toHaveBeenCalled();
		build.mockClear();
		box.pickLength(5);
		box.addToCart();
		expect(build).not.toHaveBeenCalled();
	});

	it('has no length limit for made to order', () => {
		const { box } = render(true, { ...fabric, made_to_order: true });
		box.pickLength(900);
		expect(box.lengthIssue()).toBeNull();
	});
});

describe('BuyBox price line stock', () => {
	const variant = (quantity: number, stock_status = 'in_stock') => ({ sku: 'V', quantity, stock_status });
	const withVariants = { attributes: [{ id: 1 }], variations: [variant(3)] };

	it('counts a plain product, amber at two or fewer, red when sold out', () => {
		expect(render(true, { quantity: 9 }).box.stockChip()).toEqual({ kind: 'in', count: 9 });
		expect(render(true, { quantity: 2 }).box.stockChip()).toEqual({ kind: 'low', count: 2 });
		expect(render(true, { stock_status: 'out_of_stock' }).box.stockChip()).toEqual({ kind: 'out', count: 0 });
		expect(render(true).box.stockChip()).toEqual({ kind: 'in', count: null });
	});

	it('says nothing where a count would mislead', () => {
		expect(render(true, { made_to_order: true, quantity: 4 }).box.stockChip()).toBeNull();
		expect(render(true, { bundle: { bundle_price: 1 }, quantity: 4 }).box.stockChip()).toBeNull();
		expect(render(true, { sold_by: 'metre', metre_rule: { shortestCutTenths: 10 } }).box.stockChip()).toBeNull();
		expect(render(true, { stock_status: 'on_backorder' }).box.stockChip()).toBeNull();
	});

	it('follows the chosen option once there is one, and draws the option table from the data', () => {
		const { box } = render(true, withVariants);
		expect(box.hasVariation()).toBe(true);
		expect(box.stockChip()).toBeNull();
		box.onSummary({ variation: variant(1) } as never);
		expect(box.stockChip()).toEqual({ kind: 'low', count: 1 });
		box.onSummary({ variation: variant(0, 'out_of_stock') } as never);
		expect(box.stockChip()).toEqual({ kind: 'out', count: 0 });
		expect(render(true, { attributes: [{ id: 1 }], variations: [] }).box.hasVariation()).toBe(false);
	});
});

describe('BuyBox and the buy bar', () => {
	it('chooses a value the bar asks for through the configurator', () => {
		const { box } = render();
		const chooseValue = vi.fn();
		Object.defineProperty(box, 'configurator', { value: () => ({ chooseValue }) });
		box.chooseValue({ id: 3 } as never);
		expect(chooseValue).toHaveBeenCalledWith({ id: 3 });
	});

	it('shows the add-on’s chosen terms and opens the sheet, writing back only what is saved', async () => {
		const groups = [
			{
				code: 'blouse',
				label: 'Blouse',
				default_term_code: 'none',
				terms: [
					{ code: 'none', label: 'None' },
					{ code: 'boat', label: 'Boat Neck', requires_measurements: true },
				],
			},
		];
		const { box } = render(true, { addon_groups: groups });
		const applyAddon = vi.fn();
		const addonState = signal<{ selections: Record<string, string>; valid: boolean } | null>({
			selections: { blouse: 'boat' },
			valid: false,
		});
		Object.defineProperty(box, 'configurator', {
			value: () => ({
				addonState,
				applyAddon,
				effectiveBase: () => 1500,
				addonSnapshot: () => ({ selections: { blouse: 'boat' }, measurements: {}, measured: false }),
			}),
		});
		expect(box.addonView()).toEqual({
			chips: [{ group: 'Blouse', term: 'Boat Neck' }],
			needs: true,
			measured: false,
		});
		const start = vi.fn();
		const modals = TestBed.inject(NgbModal);
		const open = vi.spyOn(modals, 'open');
		open.mockReturnValueOnce({ componentInstance: { start }, result: Promise.reject('closed') } as never);
		await box.openAddon('designs');
		expect(start).toHaveBeenCalledWith(
			expect.objectContaining({ mode: 'designs', basePrice: 1500, selections: { blouse: 'boat' } }),
		);
		expect(applyAddon).not.toHaveBeenCalled();
		open.mockReturnValueOnce({
			componentInstance: { start },
			result: Promise.resolve({ selections: { blouse: 'none' }, measurements: {}, measured: false }),
		} as never);
		await box.openAddon('all');
		expect(applyAddon).toHaveBeenCalledWith({ blouse: 'none' }, {}, false);
		expect(render().box.addonView()).toBeNull();
	});
});
