import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderDraftStore } from '@core/orders/order-draft.store';
import { OrdersGateway } from '@core/orders/orders.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { OrderCheckout } from './order-checkout';

import type { AdminCheckoutQuote, SavedAddressRow } from '@saha-textile/contracts';

const quote = signal<AdminCheckoutQuote | undefined>(undefined);
const addresses = signal<SavedAddressRow[] | undefined>(undefined);

vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<typeof import('@tanstack/angular-query-experimental')>()),
	injectQuery: (options: () => { queryKey: unknown[] }) => {
		const key = () => String(options().queryKey[1]);
		return {
			data: () => (key() === 'buyer-addresses' ? addresses() : quote()),
			isPending: () => key() === 'buyer-addresses' && addresses() === undefined,
			isFetching: () => false,
			isError: () => false,
		};
	},
}));
vi.mock('@core/geo/geo.gateway', async (original) => ({
	...(await original<typeof import('@core/geo/geo.gateway')>()),
	injectGeoCountryQuery: () => ({ data: signal({ subdivisions: [{ code: 'WB', name: 'West Bengal' }] }) }),
}));

const home: SavedAddressRow = {
	id: 'addr_home',
	label: 'Home',
	isDefault: true,
	fullName: 'Kavita Iyer',
	line1: '12 Rash Behari Avenue',
	city: 'Kolkata',
	state: 'West Bengal',
	postalCode: '700026',
	country: 'IN',
	countryCode: 'IN',
	mobile: { countryCallingCode: '91', number: '9831122334' },
} as SavedAddressRow;

const priced = (over: Partial<AdminCheckoutQuote> = {}): AdminCheckoutQuote =>
	({
		currency: 'INR',
		lines: [{ lineId: 'l1', title: 'Blush Pink Georgette Saree', lineTotal: 6_800, problem: null }],
		coupons: [],
		couponRefusals: [],
		shipping: { chargeINR: 100, charge: 100, zone: 'domestic', trace: [], ruleSets: [], cannotShip: [] },
		totals: { goodsINR: 6_800, couponINR: 0, shippingINR: 100, totalINR: 6_900, total: 6_900 },
		gateway: 'ccavenue',
		warnings: [],
		invoiceAddress: { source: 'billing', needed: false },
		credit: null,
		methodsOff: [{ method: 'onAccount', reason: 'notABusiness' }],
		...over,
	}) as AdminCheckoutQuote;

function render() {
	const gateway = {
		create: vi.fn(() =>
			of({
				order: {
					id: 'ord_9',
					orderNumber: 'ST-2611-482190',
					currency: 'INR',
					revision: 2,
					totalINR: 6_900,
					balance: { dueINR: 6_900 },
				},
			}),
		),
		requestPayment: vi.fn(() => of({ id: 'req_1' })),
	};
	const router = { navigate: vi.fn(async () => true), navigateByUrl: vi.fn(async () => true) };
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: OrdersGateway, useValue: gateway },
			{ provide: Router, useValue: router },
			{ provide: NotificationService, useValue: notifier },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key, getActiveLang: () => 'en' } },
		],
	});
	TestBed.overrideComponent(OrderCheckout, { set: { imports: [], template: '' } });
	const draft = TestBed.inject(OrderDraftStore);
	draft.clear();
	draft.setBuyer({ kind: 'person', customer: { id: 'cus_1', name: 'Kavita Iyer' } as never });
	draft.add({ productId: 'p1', variationId: null, quantity: 1, soldBy: 'piece' });
	const fixture = TestBed.createComponent(OrderCheckout);
	fixture.detectChanges();
	return { page: fixture.componentInstance, gateway, router, notifier, draft, fixture };
}

afterEach(() => {
	quote.set(undefined);
	addresses.set(undefined);
	sessionStorage.clear();
});

describe('admin checkout (ck01–ck08, ad07)', () => {
	it('picks the default saved address and asks the server for the quote', () => {
		addresses.set([home]);
		const { page, fixture } = render();
		fixture.detectChanges();
		expect(page.deliveryPick()).toEqual({ kind: 'saved', id: 'addr_home' });
		expect(page.body()).toMatchObject({
			cart: { buyer: { kind: 'person', customerId: 'cus_1' } },
			delivery: { kind: 'saved', savedAddressId: 'addr_home' },
			billing: null,
			payment: { method: 'paymentLink' },
		});
		expect(page.bothAbroad()).toBe(false);
	});

	it('places with a payment link: saves the order, asks the gateway for the request, clears the draft, opens the order', async () => {
		addresses.set([home]);
		quote.set(priced());
		const { page, fixture, gateway, router, draft } = render();
		fixture.detectChanges();
		expect(page.placeWords()).toBe('ord_place_paymentLink');
		expect(page.canPlace()).toBe(true);
		await page.place();
		expect(gateway.create).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: page.key }));
		expect(gateway.requestPayment).toHaveBeenCalledWith('ord_9', {
			amountINR: 6_900,
			currency: 'INR',
			revision: 2,
		});
		expect(draft.count()).toBe(0);
		expect(router.navigate).toHaveBeenCalledWith(['/order/details', 'ord_9']);
		expect(router.navigateByUrl).not.toHaveBeenCalled();
	});

	it('takes UPI by hand in rupees, needing the reference, and keeps on-account off for a shop customer', () => {
		addresses.set([home]);
		quote.set(priced());
		const { page, fixture } = render();
		fixture.detectChanges();
		page.method.set('upi');
		expect(page.amount()).toBe('6900');
		expect(page.canPlace()).toBe(false);
		page.reference.set('432198765012');
		expect(page.canPlace()).toBe(true);
		expect(page.payment()).toMatchObject({
			method: 'manual',
			payment: { method: 'upi', amountINR: 6_900, reference: '432198765012', received: true },
		});
		expect(page.shownMethods()).not.toContain('onAccount');
		page.method.set('bankTransfer');
		page.received.set(false);
		page.transferType.set('RTGS');
		expect(page.placeWords()).toBe('ord_place_bank_waiting');
		expect(page.payment()).toMatchObject({ payment: { received: false, note: 'RTGS' } });
	});

	it('asks for a quote the server accepts while the amount box is empty or changing (UPI chosen early)', () => {
		addresses.set([home]);
		const { page, fixture } = render();
		fixture.detectChanges();
		const quoteBody = () =>
			(page as unknown as { quoteBody: () => { payment: { payment?: { amountINR: number } } } }).quoteBody();
		page.method.set('upi');
		// No quote has come back yet, so the typed amount is still empty.
		expect(page.amount()).toBe('');
		expect(quoteBody().payment.payment?.amountINR).toBe(1);
		page.amount.set('2500');
		expect(quoteBody().payment.payment?.amountINR).toBe(1);
		// What is placed still carries the typed amount.
		expect(page.payment()).toMatchObject({ payment: { amountINR: 2_500 } });
	});

	it('asks for the Indian invoice address only when both addresses are abroad, and sends it once complete', () => {
		addresses.set([{ ...home, id: 'addr_uk', countryCode: 'GB', country: 'GB', postalCode: 'NW3 4DU' }]);
		const { page, fixture } = render();
		fixture.detectChanges();
		expect(page.bothAbroad()).toBe(true);
		expect(page.invoiceAddress()).toBeNull();
		page.setInvoice('fullName', 'Arjun Mehta');
		page.setInvoice('line1', '7B Ballygunge Place');
		page.setInvoice('city', 'Kolkata');
		page.setInvoice('subdivisionCode', 'WB');
		page.setInvoice('postalCode', '700019');
		expect(page.invoiceAddress()).toMatchObject({ countryCode: 'IN', state: 'West Bengal', postalCode: '700019' });
		expect(page.body()?.indianInvoiceAddress).toMatchObject({ fullName: 'Arjun Mehta' });
	});

	it('stops on a piece that can’t be sent, and lists coupons once each', () => {
		addresses.set([home]);
		quote.set(
			priced({ shipping: { ...priced().shipping, cannotShip: [{ lineId: 'l1', reason: 'zoneRefused' }] } }),
		);
		const { page, fixture } = render();
		fixture.detectChanges();
		expect(page.canPlace()).toBe(false);
		expect(page.lineTitle('l1')).toBe('Blush Pink Georgette Saree');
		page.couponText.set(' diwali10 ');
		page.applyCoupon();
		page.couponText.set('DIWALI10');
		page.applyCoupon();
		expect(page.couponCodes()).toEqual(['DIWALI10']);
		page.removeCoupon('DIWALI10');
		expect(page.couponCodes()).toEqual([]);
	});
});
