import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderDraftStore } from '@core/orders/order-draft.store';
import { OrdersGateway } from '@core/orders/orders.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { OrderCheckout } from './order-checkout';

import type { AdminCheckoutQuote, SavedAddressRow } from '@saha-textile/contracts';

/** The same stand-in queries as order-checkout.spec.ts, with "asking again" settable. */
const h = vi.hoisted(() => ({ fetching: false, queryFns: [] as Array<() => unknown> }));
const quote = signal<AdminCheckoutQuote | undefined>(undefined);
const addresses = signal<SavedAddressRow[] | undefined>(undefined);
vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<typeof import('@tanstack/angular-query-experimental')>()),
	injectQuery: (
		options: () => { queryKey: unknown[]; queryFn: () => unknown; placeholderData?: (x: unknown) => unknown },
	) => {
		const key = () => String(options().queryKey[1]);
		h.queryFns.push(() => {
			options().placeholderData?.('previous');
			return options().queryFn();
		});
		return {
			data: () => (key() === 'buyer-addresses' ? addresses() : quote()),
			isPending: () => key() === 'buyer-addresses' && addresses() === undefined,
			isFetching: () => h.fetching,
			isError: () => false,
		};
	},
}));
vi.mock('@core/geo/geo.gateway', async (original) => ({
	...(await original<typeof import('@core/geo/geo.gateway')>()),
	injectGeoCountryQuery: (code: () => string) => {
		code();
		return { data: signal({ subdivisions: [{ code: 'WB', name: 'West Bengal' }] }) };
	},
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
const london = {
	...home,
	id: 'addr_london',
	countryCode: null,
	country: 'gb',
	mobile: null,
	phone: '+44 20 1234',
} as unknown as SavedAddressRow;

const priced = (over: Partial<AdminCheckoutQuote> = {}): AdminCheckoutQuote =>
	({
		currency: 'INR',
		lines: [
			{ lineId: 'l1', title: 'Silk saree', lineTotal: 6_800, problem: null },
			{ lineId: 'l2', title: 'Blouse', lineTotal: 500, problem: 'limited' },
			{ lineId: 'l3', title: 'Gone', lineTotal: 900, problem: 'soldOut' },
		],
		coupons: [],
		couponRefusals: [],
		shipping: {
			chargeINR: 100,
			charge: 100,
			zone: 'domestic',
			trace: [],
			pieces: [],
			ruleSets: [],
			cannotShip: [],
		},
		totals: { goodsINR: 7_300, couponINR: 0, shippingINR: 100, totalINR: 7_400, total: 7_400 },
		gateway: 'ccavenue',
		warnings: [],
		invoiceAddress: { source: 'billing', needed: false },
		credit: null,
		methodsOff: [],
		linkValidDays: 7,
		...over,
	}) as AdminCheckoutQuote;

const business = (over: Record<string, unknown> = {}) => ({
	id: 'biz_1',
	legalName: 'Roy Textiles LLP',
	tradeName: '',
	phone: '033 1234',
	standing: 'active',
	standingAt: null,
	standingBy: null,
	standingReason: null,
	creditDays: 30,
	...over,
});

function render(options: { buyer?: unknown; empty?: boolean; lang?: string } = {}) {
	const gateway = {
		create: vi.fn(() =>
			of({
				order: {
					id: 'ord_9',
					orderNumber: 'ST-1',
					currency: 'INR',
					revision: 2,
					totalINR: 7_400,
					balance: { dueINR: 7_400 },
				},
			}),
		),
		requestPayment: vi.fn(() => of({ id: 'req_1' })),
		buyerAddresses: vi.fn(() => of([])),
		checkoutQuote: vi.fn(() => of(priced())),
	};
	const router = { navigate: vi.fn(async () => true), navigateByUrl: vi.fn(async () => true) };
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	let couponAnswer: unknown = null;
	const instance = { start: vi.fn(async () => undefined) };
	const modals = {
		open: vi.fn(() => {
			const result = Promise.resolve(couponAnswer);
			return { componentInstance: instance, result };
		}),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: OrdersGateway, useValue: gateway },
			{ provide: Router, useValue: router },
			{ provide: NotificationService, useValue: notifier },
			{ provide: NgbModal, useValue: modals },
			{ provide: TranslocoService, useValue: { translate: t, getActiveLang: () => options.lang ?? 'en' } },
		],
	});
	TestBed.overrideComponent(OrderCheckout, { set: { imports: [], template: '' } });
	const draft = TestBed.inject(OrderDraftStore);
	draft.clear();
	if (!options.empty) {
		draft.setBuyer(
			(options.buyer ?? {
				kind: 'person',
				customer: { id: 'cus_1', name: ' Kavita Iyer ', email: 'k@x.test', phone: null },
			}) as never,
		);
		draft.add({ productId: 'p1', variationId: null, quantity: 1, soldBy: 'piece' });
	}
	const fixture = TestBed.createComponent(OrderCheckout);
	fixture.detectChanges();
	return {
		page: fixture.componentInstance,
		fixture,
		gateway,
		router,
		notifier,
		draft,
		modals,
		answer: (value: unknown) => (couponAnswer = value),
	};
}

afterEach(() => {
	quote.set(undefined);
	addresses.set(undefined);
	h.fetching = false;
	sessionStorage.clear();
	vi.unstubAllGlobals();
});

describe('admin checkout: opening (ck01)', () => {
	it('makes a key even where the browser has no random ids, and goes back with nothing to check out', () => {
		vi.stubGlobal('crypto', {});
		expect(render().page.key).toMatch(/^admin-order-\d+-/);
		vi.stubGlobal('crypto', undefined);
		expect(render().page.key).toMatch(/^admin-order-\d+-/);
		vi.unstubAllGlobals();
		const { router } = render({ empty: true });
		expect(router.navigateByUrl).toHaveBeenCalledWith('/order/create');
	});

	it('types a new delivery address when the buyer has none saved, and asks for the addresses', async () => {
		addresses.set([]);
		const { page, fixture, gateway } = render();
		fixture.detectChanges();
		expect(page.deliveryPick()).toEqual({ kind: 'new' });
		expect(page.deliveryChoice()).toBeNull();
		for (const run of h.queryFns) await run();
		expect(gateway.buyerAddresses).toHaveBeenCalledWith('person', 'cus_1');
		expect(page.buyerWords()).not.toBe('');
		page.switchToRupees();
		expect(page.money(10)).toContain('10');
	});
});

describe('admin checkout: addresses (ck02, ad07)', () => {
	it('builds the delivery and billing choices, saved or typed, and the Indian invoice address when both are abroad', () => {
		addresses.set([home, london]);
		const { page, fixture } = render();
		fixture.detectChanges();
		expect(page.deliveryPick()).toEqual({ kind: 'saved', id: 'addr_home' });
		page.deliveryPick.set({ kind: 'new' });
		page.newDelivery.set({
			fullName: 'A',
			line1: 'x',
			city: 'London',
			postalCode: 'SW1',
			countryCode: 'GB',
			mobile: { countryCallingCode: '44', number: '7700' },
		} as never);
		page.saveDelivery.set(true);
		page.saveDeliveryAs.set('  London flat ');
		expect(page.deliveryChoice()).toMatchObject({ kind: 'new', saveAs: 'London flat' });
		page.saveDeliveryAs.set('  ');
		expect(page.deliveryChoice()).toMatchObject({ saveAs: null });
		expect(page.bothAbroad()).toBe(true);
		expect(page.invoiceAddress()).toBeNull();
		page.setInvoice('fullName', 'Kavita Iyer');
		page.setInvoice('line1', '12 Rash Behari Avenue');
		page.setInvoice('city', 'Kolkata');
		page.setInvoice('subdivisionCode', 'WB');
		page.setInvoice('postalCode', '7000');
		expect(page.invoiceAddress()).toBeNull();
		page.setInvoice('postalCode', '700026');
		expect(page.invoiceAddress()).toMatchObject({
			state: 'West Bengal',
			countryCode: 'IN',
			mobile: { number: '7700' },
		});
		page.billingSame.set(false);
		expect(page.body()).toBeNull();
		page.billingPick.set({ kind: 'saved', id: 'addr_london' });
		expect(page.billingChoice()).toEqual({ kind: 'saved', savedAddressId: 'addr_london' });
		expect(page.bothAbroad()).toBe(true);
		page.billingPick.set({ kind: 'saved', id: 'addr_home' });
		expect(page.bothAbroad()).toBe(false);
		expect(page.invoiceAddress()).toBeNull();
		page.billingPick.set({ kind: 'new' });
		expect(page.billingChoice()).toBeNull();
		page.newBilling.set({ fullName: 'Billing Name', countryCode: 'US' } as never);
		expect(page.linkGoesTo()).toContain('ord_billing_contact(Billing Name)');
		page.billingPick.set({ kind: 'saved', id: 'gone' });
		expect(page.bothAbroad()).toBe(false);
		page.billingPick.set(null);
		expect(page.billingChoice()).toBeNull();
	});

	it('uses a saved delivery address’s mobile for the invoice address, and needs one', () => {
		addresses.set([
			london,
			{
				...london,
				id: 'addr_ny',
				countryCode: 'US',
				mobile: { countryCallingCode: '1', number: '555' },
			} as SavedAddressRow,
		]);
		const { page, fixture } = render();
		fixture.detectChanges();
		for (const [field, value] of [
			['fullName', 'K'],
			['line1', 'x'],
			['city', 'Kolkata'],
			['subdivisionCode', 'WB'],
			['postalCode', '700026'],
		] as const)
			page.setInvoice(field, value);
		page.deliveryPick.set({ kind: 'saved', id: 'addr_london' });
		expect(page.invoiceAddress()).toBeNull();
		page.deliveryPick.set({ kind: 'saved', id: 'addr_ny' });
		expect(page.invoiceAddress()?.mobile).toEqual({ countryCallingCode: '1', number: '555' });
		page.setInvoice('subdivisionCode', 'XX');
		expect(page.invoiceAddress()).toBeNull();
	});

	it('reads saved addresses for the cards', () => {
		const { page } = render({ lang: 'bn' });
		expect(page.addressLine({ ...home, line2: ' ', landmark: null } as never)).toContain('ভারত');
		expect(page.postalKey(home)).toBe('addr_postal_pin');
		expect(page.postalKey({ ...home, countryCode: 'GB' })).toBe('addr_postal_postcode');
		expect(page.postalKey({ ...home, countryCode: 'US' })).toBe('addr_postal_zip');
		expect(page.postalKey(london)).toBe('addr_postal_postal');
		expect(page.phoneOf(home)).toBe('+91 9831122334');
		expect(page.phoneOf(london)).toBe('+44 20 1234');
		expect(page.phoneOf({ ...london, phone: undefined } as never)).toBe('');
		expect(page.countryName(null)).toBe('');
		expect(page.countryName('not a code')).toBe('not a code');
		expect(page.money(1500)).toContain('1,500');
		expect(page.buyerName()).toBe('Kavita');
	});
});

describe('admin checkout: paying (ck03–ck07, K9)', () => {
	it('builds each way of paying, and what the quote asks with', async () => {
		addresses.set([home]);
		const { page, fixture } = render();
		fixture.detectChanges();
		page.method.set('keepOpen');
		expect(page.payment()).toEqual({ method: 'keepOpen' });
		page.method.set('cashOnDelivery');
		page.collector.set('courier');
		page.note.set('  Ring twice ');
		expect(page.payment()).toEqual({ method: 'cashOnDelivery', collector: 'courier' });
		expect(page.body()?.comment).toBe('Ring twice');
		page.method.set('onAccount');
		page.overrideReason.set('ok');
		page.allowOnce();
		expect(page.overrideAllowed()).toBe(false);
		page.overrideReason.set('Known buyer');
		expect(page.payment()).toEqual({ method: 'onAccount', creditOverrideReason: null });
		page.allowOnce();
		expect(page.payment()).toEqual({ method: 'onAccount', creditOverrideReason: 'Known buyer' });
		page.method.set('bankTransfer');
		page.amount.set('');
		page.received.set(false);
		page.transferType.set('RTGS');
		expect(page.payment()).toMatchObject({
			method: 'manual',
			payment: { method: 'bankTransfer', amountINR: 0, reference: '—', received: false, note: 'RTGS' },
		});
		expect(page.placeWords()).toBe('ord_place_bank_waiting');
		page.received.set(true);
		expect(page.placeWords()).toBe('ord_place_bank_received(RTGS)');
		page.method.set('cash' as never);
		page.note.set('');
		expect(page.payment()).toMatchObject({ payment: { received: true, note: null } });
		page.method.set('upi');
		for (const run of h.queryFns) await run();
		expect(page.placeWords()).toBe('ord_place_upi');
	});

	it('reads the quote: methods off, shipping, MRP, coupons, link and totals', () => {
		addresses.set([home]);
		quote.set(
			priced({
				methodsOff: [{ method: 'keepOpen', reason: 'switchedOff' }],
				coupons: [
					{ code: 'A', kind: 'percentOff', lines: [] },
					{ code: 'B', kind: 'percentOff', lines: [] },
				] as never,
			}),
		);
		const { page, fixture } = render();
		fixture.detectChanges();
		expect(page.shownMethods()).not.toContain('keepOpen');
		expect(page.shownMethods()).not.toContain('onAccount');
		expect(page.methodOff().get('onAccount')).toBe('notABusiness');
		expect(page.shipWhy()).not.toBeNull();
		expect(page.subtotal()).toBe(7_300);
		expect(page.lineTitle('l2')).toBe('Blouse');
		expect(page.lineTitle('gone')).toBe('');
		expect(page.mrpLine({ mrpINR: null, unitPriceINR: 100 } as never)).toBeNull();
		expect(page.mrpLine({ mrpINR: 100, unitPriceINR: 100 } as never)).toBeNull();
		expect(page.mrpLine({ mrpINR: 9_800, unitPriceINR: 6_800, unitPrice: 6_800 } as never)).toBe(
			'ord_mrp_discounted(₹9,800)',
		);
		expect(page.mrpLine({ mrpINR: 9_800, unitPriceINR: 0, unitPrice: 0 } as never)).toBe(
			'ord_mrp_discounted(₹9,800)',
		);
		expect(page.couponWhyOf({ code: 'A', kind: 'percentOff', lines: [] } as never)).toBeTypeOf('string');
		expect(page.refusalWords({ code: 'C', refusal: 'doesNotCombine' })).toBe(
			'ord_coupon_refused_combine(C|A and B)',
		);
		expect(page.refusalWords({ code: 'C', refusal: 'expired' })).toBe(
			'ord_coupon_refused(C) · ord_coupon_refusal_expired',
		);
		expect(page.linkValidUntil()).toContain('ord_valid_until_inr');
		expect(page.creditView()).toBeNull();
		expect(page.amount()).toBe('7400');
		quote.set(priced({ currency: 'GBP', totals: { totalINR: 7_400, total: 66 } } as never));
		expect(page.linkValidUntil()).toContain('ord_valid_until_foreign');
		expect(page.mrpLine({ mrpINR: 9_800, unitPriceINR: 6_800, unitPrice: 61 } as never)).toContain('£');
		quote.set(undefined);
		expect(page.linkValidUntil()).toBe('');
		expect(page.shipWhy()).toBeNull();
		expect(page.refusalWords({ code: 'C', refusal: 'doesNotCombine' })).toBe(
			'ord_coupon_refused(C) · ord_coupon_refusal_doesNotCombine',
		);
		expect(page.mrpLine({ mrpINR: 9_800, unitPriceINR: 6_800, unitPrice: 6_800 } as never)).toContain('₹');
	});

	it('shows a business’s credit, standing and on-account limits', () => {
		addresses.set([home]);
		quote.set(
			priced({
				credit: { limitINR: 100_000, usedINR: 98_000, thisOrderINR: 7_400, dueOn: '2026-12-24' },
				methodsOff: [{ method: 'onAccount', reason: 'overLimit' }],
			} as never),
		);
		const buyer = {
			kind: 'business',
			business: business({
				standing: 'creditOnHold',
				standingAt: '2026-11-12T05:00:00.000Z',
				standingBy: 'Asha',
				standingReason: 'Two invoices overdue',
			}),
		};
		const { page, fixture } = render({ buyer });
		fixture.detectChanges();
		expect(page.shownMethods()).toContain('onAccount');
		expect(page.overLimit()).toBe(true);
		expect(page.creditView()).toMatchObject({ available: '₹2,000', name: 'Roy Textiles LLP' });
		expect(page.creditView()?.due).toContain('ord_payment_due_line');
		expect(page.standingNotice()).toMatchObject({ kind: 'creditOnHold', since: '12 Nov' });
		expect(page.standingNotice()?.line).toBe(
			'ord_standing_since(12 Nov), ord_standing_by(Asha): “Two invoices overdue”',
		);
		expect(page.methodOffWords('onAccount', 'creditOnHold')).toBe('ord_method_off_creditOnHold_since(12 Nov)');
		expect(page.methodOffWords('onAccount', 'overLimit')).toBe('ord_method_off_overLimit');
		expect(page.linkGoesTo()).toBe('Roy Textiles LLP · 033 1234');
		expect(page.buyerName()).toBe('Roy Textiles LLP');
		page.method.set('onAccount');
		expect(page.canPlace()).toBe(false);
		page.overrideReason.set('Known buyer');
		page.allowOnce();
		expect(page.canPlace()).toBe(true);
	});

	it('words a standing with only some of its parts, and credit for a shop customer', () => {
		addresses.set([home]);
		quote.set(priced({ credit: { limitINR: 1_000, usedINR: 0, thisOrderINR: 100, dueOn: null } } as never));
		const blocked = render({
			buyer: {
				kind: 'business',
				business: business({ standing: 'blocked', tradeName: 'Roy', standingReason: 'Bounced cheque' }),
			},
		});
		expect(blocked.page.standingNotice()?.line).toBe('“Bounced cheque”');
		expect(blocked.page.methodOffWords('x', 'creditOnHold')).toBe('ord_method_off_creditOnHold');
		expect(blocked.page.creditView()?.name).toBe('Roy');
		expect(blocked.page.buyerName()).toBe('Roy');
		const byOnly = render({
			buyer: { kind: 'business', business: business({ standing: 'blocked', standingBy: 'Asha' }) },
		});
		expect(byOnly.page.standingNotice()?.line).toBe('ord_standing_by(Asha)');
		const bare = render({ buyer: { kind: 'business', business: business({ standing: 'blocked' }) } });
		expect(bare.page.standingNotice()?.line).toBe('');
		const person = render();
		expect(person.page.standingNotice()).toBeNull();
		expect(person.page.creditView()).toMatchObject({ due: null, name: '' });
		expect(render({ buyer: { kind: 'business', business: business() } }).page.standingNotice()).toBeNull();
	});
});

describe('admin checkout: placing (ck01–ck08, cp06)', () => {
	it('places only a complete, priced order a server would take', () => {
		addresses.set([home]);
		const { page, fixture } = render();
		fixture.detectChanges();
		expect(page.canPlace()).toBe(false);
		quote.set(priced());
		expect(page.canPlace()).toBe(true);
		h.fetching = true;
		expect(page.canPlace()).toBe(false);
		h.fetching = false;
		page.busy.set(true);
		expect(page.canPlace()).toBe(false);
		page.busy.set(false);
		quote.set(priced({ shipping: { cannotShip: [{ lineId: 'l1' }] } } as never));
		expect(page.canPlace()).toBe(false);
		quote.set(priced({ methodsOff: [{ method: 'paymentLink', reason: 'gatewayDown' }] }));
		expect(page.canPlace()).toBe(false);
		quote.set(priced());
		page.method.set('upi');
		page.amount.set('0');
		expect(page.canPlace()).toBe(false);
		page.amount.set('7400');
		expect(page.canPlace()).toBe(false);
		page.reference.set('UTR1');
		expect(page.canPlace()).toBe(true);
		page.method.set('bankTransfer');
		page.reference.set('');
		expect(page.canPlace()).toBe(false);
		page.received.set(false);
		expect(page.canPlace()).toBe(true);
	});

	it('applies coupons by code or from the popup, once each, and removes them', async () => {
		addresses.set([home]);
		const { page, fixture, modals, answer } = render();
		page.couponText.set('  ');
		page.applyCoupon();
		page.couponText.set(' diwali ');
		page.applyCoupon();
		page.couponText.set('DIWALI');
		page.applyCoupon();
		expect(page.couponCodes()).toEqual(['DIWALI']);
		page.deliveryPick.set(null);
		await page.openCoupons();
		expect(modals.open).not.toHaveBeenCalled();
		fixture.detectChanges();
		page.deliveryPick.set({ kind: 'saved', id: 'addr_home' });
		answer('STACK');
		await page.openCoupons();
		answer('STACK');
		await page.openCoupons();
		answer(null);
		await page.openCoupons();
		expect(page.couponCodes()).toEqual(['DIWALI', 'STACK']);
		page.removeCoupon('DIWALI');
		expect(page.couponCodes()).toEqual(['STACK']);
	});

	it('places without a request when nothing is due, says when the request failed, and shows a refusal', async () => {
		addresses.set([home]);
		quote.set(priced());
		const { page, fixture, gateway, notifier, router } = render();
		fixture.detectChanges();
		gateway.create.mockReturnValueOnce(
			of({
				order: { id: 'ord_1', orderNumber: 'ST-2', currency: 'INR', revision: 1, totalINR: 0, balance: null },
			}) as never,
		);
		await page.place();
		expect(gateway.requestPayment).not.toHaveBeenCalled();
		expect(notifier.showSuccess).toHaveBeenCalledWith('ord_order_placed(ST-2)');
		expect(router.navigate).toHaveBeenCalledWith(['/order/details', 'ord_1']);
		const again = render();
		again.fixture.detectChanges();
		again.gateway.requestPayment.mockReturnValueOnce(throwError(() => new Error('down')));
		await again.page.place();
		expect(again.notifier.showError).toHaveBeenCalledWith('ord_request_not_sent');
		expect(again.notifier.showSuccess).toHaveBeenCalledWith('ord_order_placed(ST-1)');
		const refused = render();
		refused.fixture.detectChanges();
		refused.gateway.create.mockReturnValueOnce(throwError(() => new Error('down')));
		await refused.page.place();
		expect(refused.page.error()).toBe('ord_action_failed');
		const cash = render();
		cash.fixture.detectChanges();
		cash.page.method.set('keepOpen');
		quote.set(priced());
		await cash.page.place();
		expect(cash.gateway.requestPayment).not.toHaveBeenCalled();
		quote.set(undefined);
		await cash.page.place();
		expect(cash.gateway.create).toHaveBeenCalledTimes(1);
	});
});
