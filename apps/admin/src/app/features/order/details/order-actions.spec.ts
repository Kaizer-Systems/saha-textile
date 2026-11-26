import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { GeoGateway } from '@core/geo/geo.gateway';
import { OrdersGateway } from '@core/orders/orders.gateway';

import { OrderClosePopup } from './order-close-popup';
import { OrderInvoiceAddressPopup } from './order-invoice-address-popup';
import { OrderRequestPopup, rupeesPerUnit } from './order-request-popup';

import type { OpenOrderClosePreview, Order, PaymentRequestPreview } from '@saha-textile/contracts';

vi.mock('@core/geo/geo.gateway', async (original) => ({
	...(await original<typeof import('@core/geo/geo.gateway')>()),
	injectGeoCountryQuery: () => ({
		data: signal({
			code: 'IN',
			subdivisions: [
				{ code: 'WB', name: 'West Bengal', gstStateCode: '19' },
				{ code: 'MH', name: 'Maharashtra', gstStateCode: '27' },
			],
		}),
	}),
}));

const order = (over: Record<string, unknown> = {}): Order =>
	({
		id: 'ord_1',
		orderNumber: 'ST-2611-482190',
		currency: 'INR',
		revision: 3,
		status: 'open',
		lines: [],
		buyer: { kind: 'person', name: 'Arjun Mehta' },
		addresses: {
			billing: {
				fullName: 'Arjun Mehta',
				line1: '22 Belsize Park',
				city: 'London',
				postalCode: 'NW3 4DU',
				country: 'GB',
				countryCode: 'GB',
				mobile: { countryCallingCode: '44', number: '7700900123' },
			},
			delivery: {
				fullName: 'Arjun Mehta',
				line1: '22 Belsize Park',
				city: 'London',
				postalCode: 'NW3 4DU',
				country: 'GB',
				countryCode: 'GB',
				mobile: { countryCallingCode: '44', number: '7700900123' },
			},
			invoice: { source: 'none', address: null, needed: true },
		},
		...over,
	}) as unknown as Order;

const preview = (over: Partial<PaymentRequestPreview> = {}): PaymentRequestPreview => ({
	dueINR: 27_700,
	amountINR: 27_700,
	currency: 'INR',
	gateway: 'ccavenue',
	amount: 27_700,
	rateFromINR: 1,
	markupPercent: 0,
	sendTo: { email: 'nandita@example.test', mobile: '+91 9830012345' },
	smsReachable: true,
	validDays: 7,
	currencies: [
		{ code: 'INR', symbol: '₹', gateway: 'ccavenue', ready: true },
		{ code: 'USD', symbol: 'US$', gateway: 'paypal', ready: true },
	],
	problem: null,
	...over,
});

function setup(gateway: Record<string, unknown>, geo: Record<string, unknown> = {}) {
	const modal = { close: vi.fn(), dismiss: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: modal },
			{ provide: OrdersGateway, useValue: gateway },
			{ provide: GeoGateway, useValue: geo },
			{
				provide: TranslocoService,
				useValue: { translate: (key: string) => key, getActiveLang: () => 'en' },
			},
		],
	});
	return modal;
}

function create<T>(type: new (...args: never[]) => T): T {
	TestBed.overrideComponent(type as never, { set: { imports: [], template: '' } });
	return TestBed.createComponent(type as never).componentInstance as T;
}

describe('Request online payment (oo07, pl05, K2)', () => {
	it('opens at the amount due with the store’s days, and sends exactly that', async () => {
		const gateway = {
			previewRequest: vi.fn(() => of(preview())),
			requestPayment: vi.fn(() => of({ id: 'req_1' })),
		};
		const modal = setup(gateway);
		const popup = create(OrderRequestPopup);
		await popup.start(order(), null, 24);
		expect(gateway.previewRequest).toHaveBeenCalledWith('ord_1', { currency: 'INR' });
		expect(popup.amount()).toBe('27700');
		expect(popup.validDays()).toBe(7);
		expect(popup.canSend()).toBe(true);
		await popup.send();
		expect(gateway.requestPayment).toHaveBeenCalledWith('ord_1', {
			amountINR: 27_700,
			currency: 'INR',
			validDays: 7,
			revision: 3,
		});
		expect(modal.close).toHaveBeenCalledWith({ id: 'req_1' });
	});

	it('keeps Send off while the server names a problem, and warns a customer billed in India off a foreign currency', async () => {
		const gateway = {
			previewRequest: vi.fn((_id: string, query: { currency: string }) =>
				of(
					query.currency === 'USD'
						? preview({ currency: 'USD', gateway: 'paypal', amount: 312.5, rateFromINR: 1 / 94.1 })
						: preview({ problem: 'more_than_due' }),
				),
			),
		};
		setup(gateway);
		const popup = create(OrderRequestPopup);
		const billedInIndia = order({
			addresses: { ...order().addresses, billing: { ...order().addresses?.billing, countryCode: 'IN' } },
		});
		await popup.start(billedInIndia, null, 2);
		expect(popup.canSend()).toBe(false);
		popup.changeCurrency('USD');
		await vi.waitFor(() => expect(popup.preview()?.currency).toBe('USD'));
		expect(popup.warnIndia()).toBe(true);
		expect(popup.newRate()).toBe(94.1);
	});

	it('shows the old request’s rate beside today’s when asking again', async () => {
		setup({ previewRequest: vi.fn(() => of(preview({ currency: 'USD', rateFromINR: 1 / 94.1 }))) });
		const popup = create(OrderRequestPopup);
		await popup.start(order(), { currency: 'USD', rateFromINR: 1 / 93.55, amount: 338.23 } as never, 4);
		expect(popup.currency()).toBe('USD');
		expect(popup.oldRate()).toBe(93.55);
		expect(rupeesPerUnit(null)).toBeNull();
	});
});

describe('Close an open order (oo08)', () => {
	const closing = (over: Partial<OpenOrderClosePreview> = {}): OpenOrderClosePreview => ({
		pieces: 24,
		goodsINR: 127_700,
		shippingINR: 22_700,
		zone: 'international',
		shippingTrace: [],
		shippingPieces: [],
		totalINR: 150_400,
		paidINR: 127_700,
		dueINR: 22_700,
		paidAheadINR: 0,
		toAccount: null,
		problem: null,
		...over,
	});

	it('requests the rest online by default and hands that back to the page', async () => {
		const gateway = { closePreview: vi.fn(() => of(closing())), closeOpen: vi.fn(() => of({})) };
		const modal = setup(gateway);
		const popup = create(OrderClosePopup);
		await popup.start(order());
		expect(popup.then()).toBe('requestOnline');
		await popup.close();
		expect(gateway.closeOpen).toHaveBeenCalledWith('ord_1', {
			then: 'requestOnline',
			currency: 'INR',
			revision: 3,
		});
		expect(modal.close).toHaveBeenCalledWith({ then: 'requestOnline', dueINR: 22_700 });
	});

	it('offers nothing to request when paid ahead, and never closes to an account the server refuses', async () => {
		setup({ closePreview: vi.fn(() => of(closing({ dueINR: 0, paidAheadINR: 500 }))) });
		const paid = create(OrderClosePopup);
		await paid.start(order());
		expect(paid.then()).toBe('recordLater');
		expect(paid.canClose()).toBe(true);
		setup({
			closePreview: vi.fn(() => of(closing({ toAccount: { allowed: false, reason: 'overLimit' } }))),
		});
		const refused = create(OrderClosePopup);
		await refused.start(order());
		refused.then.set('toAccount');
		expect(refused.canClose()).toBe(false);
		setup({ closePreview: vi.fn(() => of(closing({ problem: 'cannot_ship', shippingINR: null }))) });
		const unshippable = create(OrderClosePopup);
		await unshippable.start(order());
		expect(unshippable.canClose()).toBe(false);
	});
});

describe('Add invoice address (od04)', () => {
	it('fills the State and city from the PIN, keeps the order’s mobile, and stores how it was confirmed', async () => {
		const gateway = { setInvoiceAddress: vi.fn(() => of({ id: 'ord_1' })) };
		const geo = {
			pin: vi.fn(() =>
				of({
					pin: '700019',
					found: true,
					city: 'Kolkata',
					subdivisionCode: 'WB',
					state: 'West Bengal',
					gstStateCode: '19',
					deliverable: null,
				}),
			),
		};
		const modal = setup(gateway, geo);
		const popup = create(OrderInvoiceAddressPopup);
		popup.start(order());
		expect(popup.fullName()).toBe('Arjun Mehta');
		popup.line1.set('7B Ballygunge Place');
		await popup.lookUpPin('70001');
		expect(popup.pinShapeWrong()).toBe(true);
		expect(popup.canSave()).toBe(false);
		await popup.lookUpPin('700019');
		expect(popup.subdivisionCode()).toBe('WB');
		expect(popup.city()).toBe('Kolkata');
		expect(popup.canSave()).toBe(true);
		await popup.save();
		expect(gateway.setInvoiceAddress).toHaveBeenCalledWith('ord_1', {
			address: {
				fullName: 'Arjun Mehta',
				line1: '7B Ballygunge Place',
				city: 'Kolkata',
				state: 'West Bengal',
				subdivisionCode: 'WB',
				postalCode: '700019',
				countryCode: 'IN',
				mobile: { countryCallingCode: '44', number: '7700900123' },
			},
			confirmedHow: 'phoneCall',
			revision: 3,
		});
		expect(modal.close).toHaveBeenCalled();
	});

	it('says so when India Post doesn’t list the PIN', async () => {
		setup({}, { pin: vi.fn(() => of({ pin: '999999', found: false })) });
		const popup = create(OrderInvoiceAddressPopup);
		popup.start(order());
		await popup.lookUpPin('999999');
		expect(popup.pinNote()).toBe('unknown');
	});
});
