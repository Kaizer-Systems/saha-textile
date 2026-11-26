import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderDraftStore } from '@core/orders/order-draft.store';
import { OrdersGateway } from '@core/orders/orders.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { OrderCheckout } from './order-checkout';

import type { AdminCheckoutQuote, SavedAddressRow } from '@saha-textile/contracts';

/** Stand-in queries: the quote, the buyer's addresses and India's states are set by each test. */
const h = vi.hoisted(() => ({ india: undefined as unknown }));
const quote = signal<AdminCheckoutQuote | undefined>(undefined);
const addresses = signal<SavedAddressRow[] | undefined>(undefined);
vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<typeof import('@tanstack/angular-query-experimental')>()),
	injectQuery: (options: () => { queryKey: unknown[] }) => {
		const key = () => String(options().queryKey[1]);
		return {
			data: () => (key() === 'buyer-addresses' ? addresses() : quote()),
			isPending: () => false,
			isFetching: () => false,
			isError: () => false,
		};
	},
}));
vi.mock('@core/geo/geo.gateway', async (original) => ({
	...(await original<typeof import('@core/geo/geo.gateway')>()),
	injectGeoCountryQuery: () => ({ data: () => h.india }),
}));

const t = (key: string, params?: Record<string, unknown>) =>
	params && Object.keys(params).length ? `${key}(${Object.values(params).join('|')})` : key;

const home = {
	id: 'addr_home',
	label: 'Home',
	isDefault: false,
	fullName: 'Kavita Iyer',
	line1: '12 Rash Behari Avenue',
	city: 'Kolkata',
	state: 'West Bengal',
	postalCode: '700026',
	country: 'IN',
	countryCode: 'IN',
	mobile: { countryCallingCode: '91', number: '9831122334' },
} as SavedAddressRow;

function render() {
	const instance = { start: vi.fn(async () => undefined) };
	const modals = {
		open: vi.fn(() => {
			const result = Promise.reject(new Error('closed'));
			result.catch(() => undefined);
			return { componentInstance: instance, result };
		}),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: OrdersGateway, useValue: { buyerAddresses: vi.fn(() => of([])) } },
			{
				provide: Router,
				useValue: { navigate: vi.fn(async () => true), navigateByUrl: vi.fn(async () => true) },
			},
			{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
			{ provide: NgbModal, useValue: modals },
			{ provide: TranslocoService, useValue: { translate: t, getActiveLang: () => 'en' } },
		],
	});
	TestBed.overrideComponent(OrderCheckout, { set: { imports: [], template: '' } });
	const draft = TestBed.inject(OrderDraftStore);
	draft.clear();
	draft.setBuyer({
		kind: 'person',
		customer: { id: 'cus_1', name: 'Kavita Iyer', email: 'k@x.test', phone: null },
	} as never);
	draft.add({ productId: 'p1', variationId: null, quantity: 1, soldBy: 'piece' });
	const fixture = TestBed.createComponent(OrderCheckout);
	fixture.detectChanges();
	return { page: fixture.componentInstance, draft, modals, instance };
}

afterEach(() => {
	quote.set(undefined);
	addresses.set(undefined);
	h.india = undefined;
	sessionStorage.clear();
});

describe('admin checkout: the last cases', () => {
	it('before the quote and the addresses arrive: no saved addresses, no methods off, nothing to add up', () => {
		const { page } = render();
		expect(page.saved()).toEqual([]);
		expect([...page.methodOff().keys()]).toEqual(['onAccount']);
		expect(page.subtotal()).toBe(0);
		expect(page.bothAbroad()).toBe(false);
		page.deliveryPick.set({ kind: 'new' });
		expect(page.bothAbroad()).toBe(false);
		expect(page.countryName('GB')).toBe('United Kingdom');
		page.billingSame.set(false);
		expect(page.bothAbroad()).toBe(false);
	});

	it('with no buyer left, the buyer’s words, link line and first name are empty', () => {
		const { page, draft } = render();
		draft.setBuyer(null);
		expect([page.buyerWords(), page.linkGoesTo(), page.buyerName()]).toEqual(['', '', '']);
	});

	it('the payment link goes to the saved billing contact, or the buyer when billing follows delivery', () => {
		addresses.set([home]);
		const { page } = render();
		expect(page.linkGoesTo()).toContain('ord_billing_contact(Kavita Iyer)');
		page.billingSame.set(false);
		page.billingPick.set({ kind: 'saved', id: 'addr_home' });
		expect(page.linkGoesTo()).toContain('ord_billing_contact(Kavita Iyer)');
		page.billingPick.set({ kind: 'saved', id: 'addr_gone' });
		expect(page.linkGoesTo()).toContain('ord_billing_contact(Kavita Iyer)');
	});

	it('abroad with no states of India read yet, or no mobile, there is no invoice address', () => {
		const { page } = render();
		page.deliveryPick.set({ kind: 'new' });
		page.newDelivery.set({
			fullName: 'Ann',
			line1: '1 High St',
			city: 'London',
			countryCode: 'GB',
			mobile: null,
		} as never);
		for (const field of ['fullName', 'line1', 'city'] as const) page.setInvoice(field, 'x');
		page.setInvoice('subdivisionCode', 'WB');
		page.setInvoice('postalCode', '700026');
		expect(page.bothAbroad()).toBe(true);
		expect(page.invoiceAddress()).toBeNull();
		h.india = { subdivisions: [{ code: 'WB', name: 'West Bengal' }] };
		expect(page.invoiceAddress()).toBeNull();
	});

	it('words a person’s credit with no credit days, a coupon by its lines, and an address abroad by its country', () => {
		quote.set({
			currency: 'INR',
			lines: [{ lineId: 'l1', title: 'Silk saree', lineTotal: 6_800, problem: null }],
			coupons: [],
			couponRefusals: [],
			shipping: {
				chargeINR: 0,
				charge: 0,
				zone: 'domestic',
				trace: [],
				pieces: [],
				ruleSets: [],
				cannotShip: [],
			},
			totals: { goodsINR: 6_800, couponINR: 0, shippingINR: 0, totalINR: 6_800, total: 6_800 },
			gateway: 'ccavenue',
			warnings: [],
			invoiceAddress: { source: 'billing', needed: false },
			credit: { limitINR: 10_000, usedINR: 2_000, thisOrderINR: 1_000, dueOn: '2026-12-01T00:00:00.000Z' },
			methodsOff: [],
			linkValidDays: 7,
		} as unknown as AdminCheckoutQuote);
		const { page } = render();
		expect(page.creditView()?.due).toContain('|0)');
		expect(
			page.couponWhyOf({
				code: 'A',
				kind: 'percentOff',
				value: 10,
				lines: [{ lineId: 'l1', reason: 'applied' }],
			} as never),
		).toBe('ord_coupon_why_percent(10|Silk saree)');
		expect(page.addressLine({ ...home, countryCode: null, country: 'gb' } as unknown as SavedAddressRow)).toContain(
			'United Kingdom',
		);
	});

	it('a coupon popup closed without a choice adds no coupon', async () => {
		addresses.set([home]);
		const { page, modals } = render();
		page.deliveryPick.set({ kind: 'saved', id: 'addr_home' });
		await page.openCoupons();
		expect(modals.open).toHaveBeenCalledTimes(1);
		expect(page.couponCodes()).toEqual([]);
	});
});
