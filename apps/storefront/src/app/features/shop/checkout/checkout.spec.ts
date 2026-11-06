import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountStore } from '@core/state/account.store';
import { CartFacade } from '@core/state/cart/cart.facade';
import { SettingStore } from '@core/state/setting.store';

import { Checkout } from './checkout';

const render = (platform = 'browser') => {
	const items = new BehaviorSubject<unknown[]>([]);
	const cart = { getCartItems: vi.fn(), cartItems$: items };
	const settings = { loadSettings: vi.fn(), setting: signal(null) };
	const router = { navigateByUrl: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: CartFacade, useValue: cart },
			{ provide: SettingStore, useValue: settings },
			{ provide: AccountStore, useValue: { user: signal(null) } },
			{ provide: Router, useValue: router },
			{ provide: PLATFORM_ID, useValue: platform },
			{ provide: TranslocoService, useValue: { selectTranslate: () => of('Checkout') } },
		],
	});
	TestBed.overrideComponent(Checkout, { set: { imports: [], template: '<input #cpn value="SAVE10" />' } });
	const fixture = TestBed.createComponent(Checkout);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, items, cart, settings, router };
};

const complete = (page: Checkout) => {
	page.selectShippingAddress(1);
	page.selectBillingAddress(2);
	page.selectDelivery({ delivery_description: 'Standard', delivery_interval: null } as never);
	page.selectPaymentMethod('card');
};
const checked = (value: boolean) => ({ target: { checked: value } }) as never;

describe('Checkout', () => {
	it('loads the cart and settings', () => {
		const { cart, settings } = render();
		expect(cart.getCartItems).toHaveBeenCalledOnce();
		expect(settings.loadSettings).toHaveBeenCalledOnce();
	});

	it('mirrors the cart lines into the form, and keeps them when the cart empties', () => {
		const { page, items } = render();
		items.next([
			{ product_id: 1, variation_id: 5, quantity: 2 },
			{ product_id: 2, quantity: 1 },
		]);
		expect(page.productControl.value).toEqual([
			{ product_id: 1, variation_id: 5, quantity: 2 },
			{ product_id: 2, variation_id: '', quantity: 1 },
		]);
		items.next([]);
		expect(page.productControl.length).toBe(2);
	});

	it('ignores an empty address id', () => {
		const { page } = render();
		page.selectShippingAddress(0);
		page.selectBillingAddress(0);
		expect(page.form.value.shipping_address_id).toBe('');
		expect(page.form.value.billing_address_id).toBe('');
	});

	it('totals the order once every section is filled in', () => {
		const { page, items } = render();
		items.next([{ product_id: 1, quantity: 1 }]);
		page.selectShippingAddress(1);
		expect(page.checkoutTotal).toBeUndefined();
		complete(page);
		expect(page.form.valid).toBe(true);
		expect(page.checkoutTotal?.total.total).toBeGreaterThan(0);
		expect(page.loading).toBe(false);
	});

	it('copes with no delivery choice', () => {
		const { page } = render();
		page.selectDelivery(undefined as never);
		expect(page.form.value.delivery_description).toBeUndefined();
	});

	it('records the points and wallet toggles', () => {
		const { page } = render();
		page.togglePoint(checked(true));
		page.toggleWallet(checked(true));
		expect(page.form.value).toMatchObject({ points_amount: true, wallet_balance: true });
		page.togglePoint({ target: null } as never);
		expect(page.form.value.points_amount).toBeUndefined();
		page.toggleWallet({ target: null } as never);
		expect(page.form.value.wallet_balance).toBeUndefined();
	});

	it('applies and removes a coupon', () => {
		const { page } = render();
		page.coupon = false;
		page.showCoupon();
		expect(page.coupon).toBe(true);
		page.setCoupon('SAVE10');
		expect(page.appliedCoupon).toBe(true);
		expect(page.form.value.coupon).toBe('SAVE10');
		page.couponRemove();
		expect(page.appliedCoupon).toBe(false);
		expect(page.form.value.coupon).toBeNull();
	});

	it('clears a coupon error at the next recalculation', () => {
		const { fixture, page } = render();
		page.couponError = 'expired';
		page.form.patchValue({ coupon: 'OLD' });
		page.checkout();
		expect(page.couponError).toBeNull();
		expect(page.form.value.coupon).toBeNull();
		expect((fixture.nativeElement as HTMLElement).querySelector('input')?.value).toBe('');
	});

	it('places nothing while the form is incomplete', () => {
		const { page, router } = render();
		page.placeorder();
		expect(router.navigateByUrl).not.toHaveBeenCalled();
	});

	it('places the order, and drops a coupon whose box was emptied', () => {
		const { fixture, page, items, router } = render();
		items.next([{ product_id: 1, quantity: 1 }]);
		complete(page);
		page.form.patchValue({ coupon: 'KEPT' });
		page.placeorder();
		expect(page.form.value.coupon).toBe('KEPT');
		expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
		(fixture.nativeElement as HTMLElement).querySelector('input')!.value = '';
		page.placeorder();
		expect(page.form.value.coupon).toBeNull();
	});

	it('places the order when the coupon box is not on the page', () => {
		TestBed.resetTestingModule();
		const bare = renderWithoutBox();
		bare.items.next([{ product_id: 1, quantity: 1 }]);
		complete(bare.page);
		bare.page.placeorder();
		expect(bare.router.navigateByUrl).toHaveBeenCalledOnce();
	});

	it('clears the screen when leaving in the browser only', () => {
		const browser = render();
		browser.page.checkoutTotal = {} as never;
		browser.page.form.patchValue({ payment_method: 'card' });
		browser.page.ngOnDestroy();
		expect(browser.page.checkoutTotal).toBeNull();
		expect(browser.page.form.value.payment_method).toBeNull();
		const server = render('server');
		server.page.form.patchValue({ payment_method: 'card' });
		server.page.ngOnDestroy();
		expect(server.page.form.value.payment_method).toBe('card');
	});
});

function renderWithoutBox() {
	const items = new BehaviorSubject<unknown[]>([]);
	const router = { navigateByUrl: vi.fn() };
	TestBed.configureTestingModule({
		providers: [
			{ provide: CartFacade, useValue: { getCartItems: vi.fn(), cartItems$: items } },
			{ provide: SettingStore, useValue: { loadSettings: vi.fn(), setting: signal(null) } },
			{ provide: AccountStore, useValue: { user: signal(null) } },
			{ provide: Router, useValue: router },
			{ provide: TranslocoService, useValue: { selectTranslate: () => of('Checkout') } },
		],
	});
	TestBed.overrideComponent(Checkout, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(Checkout);
	fixture.detectChanges();
	return { page: fixture.componentInstance, items, router };
}
