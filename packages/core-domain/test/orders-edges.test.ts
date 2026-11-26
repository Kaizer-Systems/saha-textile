import type { DocumentNumberingSettings, OrderBalance, SeriesFormat } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { checkAddress, defaultCallingCode } from '../src/orders/address-rules';
import { derivePaymentStatus, isPlaceable, orderBalance } from '../src/orders/balance';
import {
	applyCoupons,
	couponLineReason,
	couponRefusal,
	type CouponContext,
	type CouponDefinition,
	type CouponLine,
} from '../src/orders/coupon-engine';
import { numberingExamples, orderSeriesKey, renderSeriesNumber, seriesKey } from '../src/orders/numbering';
import { canChangeLines, daysOpen, openTooLong } from '../src/orders/open-orders';
import { packListIncomplete } from '../src/orders/pack-list';
import { allocateReceipt, canOrderAtAll, checkSetOff, requestExpiry } from '../src/orders/payment-policies';
import { orderChildMoney } from '../src/orders/set-lines';
import {
	canMoveTo,
	isPastStatus,
	type StatusMachineOrder,
	type StatusMachineSettings,
} from '../src/orders/status-machine';

/* Coupons */

const coupon = (over: Partial<CouponDefinition> = {}): CouponDefinition => ({
	id: 'c1',
	code: 'TEN',
	title: 'Ten',
	kind: 'percentOff',
	value: 10,
	capINR: null,
	scope: { kind: 'wholeOrder' },
	excludedProductIds: [],
	includeSaleItems: false,
	includeSets: true,
	minOrderINR: 0,
	audience: { kind: 'everyone' },
	channels: { shop: true, admin: true },
	usesPerCustomer: 1,
	totalUses: null,
	validFrom: null,
	validUntil: null,
	combines: false,
	usableOnZonePrices: false,
	enabled: true,
	...over,
});
const ctx: CouponContext = {
	channel: 'shop',
	now: '2026-11-20T10:00:00Z',
	buyer: { kind: 'person', customerId: 'cus_1', isFirstOrder: false },
	usesByThisBuyer: 0,
	usesInAll: 0,
	deliveryINR: 200,
};
const business: CouponContext = { ...ctx, buyer: { kind: 'business', businessId: 'biz_1' } };
const line = (lineId: string, productId: string, amountINR: number): CouponLine => ({
	lineId,
	productId,
	categoryIds: [],
	amountINR,
	onSale: false,
	zonePriced: false,
});

describe('coupons: who and when, the remaining cases', () => {
	it('waits for its start, and opens once started', () => {
		expect(couponRefusal(coupon({ validFrom: '2026-12-01T00:00:00Z' }), ctx)).toBe('notStarted');
		expect(couponRefusal(coupon({ validFrom: '2026-11-01T00:00:00Z' }), ctx)).toBeNull();
	});

	it('keeps a first-order coupon for a person’s first order', () => {
		const first = coupon({ audience: { kind: 'firstOrder' } });
		expect(couponRefusal(first, business)).toBe('firstOrderOnly');
		expect(
			couponRefusal(first, { ...ctx, buyer: { kind: 'person', customerId: null, isFirstOrder: true } }),
		).toBeNull();
	});

	it('keeps a customers’ coupon for the listed people', () => {
		const listed = coupon({ audience: { kind: 'customers', customerIds: ['cus_1'] } });
		expect(couponRefusal(listed, business)).toBe('notForThisBuyer');
		expect(
			couponRefusal(listed, { ...ctx, buyer: { kind: 'person', customerId: null, isFirstOrder: false } }),
		).toBe('notForThisBuyer');
		expect(
			couponRefusal(listed, { ...ctx, buyer: { kind: 'person', customerId: 'cus_2', isFirstOrder: false } }),
		).toBe('notForThisBuyer');
		expect(couponRefusal(listed, ctx)).toBeNull();
	});

	it('keeps a businesses’ coupon for the listed businesses', () => {
		const listed = coupon({ audience: { kind: 'businesses', businessIds: ['biz_1'] } });
		expect(couponRefusal(listed, ctx)).toBe('notForThisBuyer');
		expect(couponRefusal(listed, { ...ctx, buyer: { kind: 'business', businessId: 'biz_2' } })).toBe(
			'notForThisBuyer',
		);
		expect(couponRefusal(listed, business)).toBeNull();
	});

	it('stops once every use is taken', () => {
		expect(couponRefusal(coupon({ totalUses: 5 }), { ...ctx, usesInAll: 5 })).toBe('usedUp');
		expect(couponRefusal(coupon({ totalUses: 5 }), { ...ctx, usesInAll: 4 })).toBeNull();
	});

	it('leaves out excluded products and products outside the list', () => {
		expect(couponLineReason(coupon({ excludedProductIds: ['p1'] }), line('l1', 'p1', 100))).toBe('excluded');
		const products = coupon({ scope: { kind: 'products', productIds: ['p1'] } });
		expect(couponLineReason(products, line('l2', 'p2', 100))).toBe('notInScope');
		expect(couponLineReason(products, line('l1', 'p1', 100))).toBe('applied');
	});
});

describe('coupons: applying them, the remaining cases', () => {
	const lines = [line('l1', 'p1', 100), line('l2', 'p2', 100)];

	it('refuses an unknown coupon, one typed twice and one that is switched off', () => {
		const run = applyCoupons(
			[coupon({ id: 'x', code: 'NOPE' }), coupon(), coupon(), coupon({ id: 'off', code: 'OFF', enabled: false })],
			lines,
			new Map([
				['c1', ctx],
				['off', ctx],
			]),
		);
		expect(run.refused).toEqual([
			{ code: 'NOPE', refusal: 'unknown' },
			{ code: 'TEN', refusal: 'alreadyApplied' },
			{ code: 'OFF', refusal: 'off' },
		]);
	});

	it('leaves delivery at nothing when no coupon has a context', () => {
		expect(applyCoupons([], lines, new Map()).deliveryLeftINR).toBe(0);
	});

	it('refuses free delivery below its minimum', () => {
		const free = coupon({ kind: 'freeDelivery', value: 0, minOrderINR: 500 });
		expect(applyCoupons([free], lines, new Map([['c1', ctx]])).refused).toEqual([
			{ code: 'TEN', refusal: 'belowMinimum' },
		]);
	});

	it('marks a line a stacked coupon finds already at nothing', () => {
		const all = coupon({
			id: 'a',
			code: 'ALL',
			value: 100,
			combines: true,
			scope: { kind: 'products', productIds: ['p1'] },
		});
		const fifty = coupon({ id: 'b', code: 'FIFTY', kind: 'amountOff', value: 50, combines: true });
		const run = applyCoupons(
			[all, fifty],
			lines,
			new Map([
				['a', ctx],
				['b', ctx],
			]),
		);
		expect(run.applied[1]?.lines).toEqual([
			{ lineId: 'l1', reason: 'nothingLeft', amountINR: 0 },
			{ lineId: 'l2', reason: 'applied', amountINR: 50 },
		]);
	});
});

/* Addresses */

const india = {
	code: 'IN',
	name: 'India',
	callingCode: '91',
	subdivisionLabel: 'state' as const,
	postalCodeLabel: 'pin' as const,
	postalCodeRequired: true,
	postalCodePattern: '\\d{6}',
	mobileLengths: [10],
	hasSubdivisions: true,
};
const singapore = {
	...india,
	code: 'SG',
	name: 'Singapore',
	callingCode: '65',
	hasSubdivisions: false,
	mobileLengths: [8],
};
type AddressInput = Parameters<typeof checkAddress>[0];
const address = (over: Partial<AddressInput> = {}): AddressInput =>
	({
		fullName: 'Ananya Sen',
		line1: '12 Lake Road',
		city: 'Kolkata',
		subdivisionCode: 'WB',
		postalCode: '700029',
		countryCode: 'IN',
		mobile: { countryCallingCode: '91', number: '9830012345' },
		...over,
	}) as AddressInput;
const wb = [{ code: 'WB', name: 'West Bengal', gstStateCode: '19' }];
const problems = (a: AddressInput, data: Partial<Parameters<typeof checkAddress>[1]> = {}) =>
	checkAddress(a, { country: india, subdivisions: wb, pin: null, mobileLengthsForCode: [10], ...data }).problems.map(
		(p) => p.problem,
	);

describe('address rules: the remaining cases', () => {
	it('refuses an unknown country outright', () => {
		expect(
			checkAddress(address(), { country: null, subdivisions: [], pin: null, mobileLengthsForCode: null }),
		).toEqual({
			problems: [{ field: 'countryCode', problem: 'unknown_country' }],
			state: null,
			gstStateCode: null,
		});
	});

	it('needs a State, a postcode of the right shape, and a known PIN', () => {
		expect(problems(address({ subdivisionCode: ' ' }))).toEqual(['state_required']);
		const sg = (a: AddressInput) =>
			problems(a, { country: singapore, subdivisions: [], mobileLengthsForCode: [8] });
		const sgPhone = { countryCallingCode: '65', number: '81234567' };
		expect(sg(address({ countryCode: 'SG', postalCode: '', mobile: sgPhone }))).toEqual(['postal_code_required']);
		expect(sg(address({ countryCode: 'SG', postalCode: 'ABC', mobile: sgPhone }))).toEqual(['postal_code_shape']);
		expect(
			sg(
				address({
					countryCode: 'SG',
					postalCode: '123456',
					mobile: { countryCallingCode: '65', number: '8123' },
				}),
			),
		).toEqual(['mobile_invalid']);
		const unknownPin = {
			pin: '700029',
			found: false,
			city: null,
			subdivisionCode: null,
			state: null,
			gstStateCode: null,
			deliverable: null,
		};
		expect(problems(address(), { pin: unknownPin } as never)).toEqual(['pin_unknown']);
	});

	it('checks a second mobile, Indian or not', () => {
		const alt = (countryCallingCode: string, number: string) =>
			problems(address({ altMobile: { countryCallingCode, number } }));
		expect(alt('91', '12345')).toEqual(['alt_mobile_invalid']);
		expect(alt('91', '9830012345')).toEqual([]);
		expect(alt('65', '81234567')).toEqual([]);
		expect(alt('65', '812')).toEqual(['alt_mobile_invalid']);
		expect(alt('65', '8123456789012345')).toEqual(['alt_mobile_invalid']);
	});

	it('starts a form with the country’s own calling code', () => {
		expect(defaultCallingCode(india)).toBe('91');
	});
});

/* Status machine */

const settings: StatusMachineSettings = {
	outForDeliveryOnlyFromCourier: true,
	eInvoiceRequired: true,
	eWayBillThresholdINR: 50_000,
	courierConnected: false,
};
const order = (over: Partial<StatusMachineOrder> = {}): StatusMachineOrder => ({
	status: 'placed',
	buyerKind: 'person',
	invoiceAddressNeeded: false,
	lines: [{ madeToOrder: false }],
	placeable: true,
	hasEInvoice: false,
	hasEWayBill: false,
	goodsINR: 10_000,
	...over,
});
const reason = (over: Partial<StatusMachineOrder>, to: StatusMachineOrder['status'], s = settings) => {
	const move = canMoveTo(order(over), to, s);
	return move.allowed ? null : move.reason;
};

describe('order status moves: the remaining cases', () => {
	it('names why a status that does not follow can’t be chosen', () => {
		expect(reason({ status: 'open' }, 'packed')).toBe('notPaid');
		expect(reason({ status: 'placed' }, 'packed')).toBe('packFirst');
		expect(reason({ status: 'shipped' }, 'cancelled')).toBe('alreadyShipped');
		expect(reason({ status: 'packed' }, 'delivered')).toBe('shipFirst');
		expect(reason({ status: 'delivered' }, 'placed')).toBe('packFirst');
	});

	it('keeps an empty open order open, and out for delivery for a connected courier', () => {
		expect(reason({ status: 'open', lines: [] }, 'placed')).toBe('closeOpenOrderFirst');
		expect(reason({ status: 'open' }, 'placed')).toBeNull();
		expect(reason({ status: 'shipped' }, 'out_for_delivery')).toBe('onlyFromCourier');
		expect(reason({ status: 'shipped' }, 'out_for_delivery', { ...settings, courierConnected: true })).toBeNull();
	});

	it('knows which statuses come after another, a cancelled order never', () => {
		expect(isPastStatus('cancelled', 'placed')).toBe(false);
		expect(isPastStatus('packed', 'placed')).toBe(true);
		expect(isPastStatus('open', 'placed')).toBe(false);
	});
});

/* Numbering */

const series = (prefix: string, reset: 'fy' | 'never' = 'fy'): SeriesFormat => ({
	prefix,
	separator: '/',
	includeFinancialYear: true,
	digits: 6,
	reset,
});
const numbering = (order: DocumentNumberingSettings['order']): DocumentNumberingSettings => ({
	order,
	parcel: { letter: 'P', separator: '/' },
	return: { letter: 'R', separator: '/' },
	paymentRequest: { letter: 'Q', separator: '/' },
	series: {
		taxInvoice: series('TI'),
		creditNote: series('CN'),
		debitNote: series('DN'),
		receipt: series('RC'),
		refundVoucher: series('RF'),
		deliveryChallan: series('DC'),
		paymentVoucher: series('PV'),
		selfInvoice: series('SI'),
		purchaseOrder: series('PO'),
		purchaseEntry: series('PE'),
		purchaseReturnNote: series('PR'),
		journal: series('JV'),
		stockAdjustment: series('SA'),
		stockCount: series('SC'),
		openingStock: series('OS'),
		pettyExpense: series('PC'),
		expenseClaim: series('EC'),
		stockTransfer: series('TR'),
		payslip: series('PS'),
		expenseBill: series('EB'),
	},
	lockedTypes: [],
	revision: 0,
	updatedAt: null,
	updatedBy: null,
});

describe('document numbers: the remaining cases', () => {
	it('keeps one counter a year, or one for ever', () => {
		expect(seriesKey('taxInvoice', series('TI'), '2026-27')).toEqual({
			series: 'doc:taxInvoice',
			period: '2026-27',
		});
		expect(seriesKey('journal', series('JV', 'never'), '2026-27')).toEqual({
			series: 'doc:journal',
			period: 'all',
		});
	});

	it('counts sequenced order numbers, and none for random ones', () => {
		expect(
			orderSeriesKey({ kind: 'yearMonthRandom', prefix: 'ST', separator: '-', randomDigits: 6 }, '2026-27'),
		).toBeNull();
		expect(
			orderSeriesKey({ kind: 'randomGroups', prefix: 'ST', separator: '-', groups: [4, 4] }, '2026-27'),
		).toBeNull();
		expect(
			orderSeriesKey({ kind: 'financialYearSequence', prefix: 'SO', separator: '/', digits: 5 }, '2026-27'),
		).toEqual({ series: 'doc:order', period: '2026-27' });
		expect(orderSeriesKey({ kind: 'runningNumber', prefix: 'SO', start: 1, digits: 5 }, '2026-27')).toEqual({
			series: 'doc:order',
			period: 'all',
		});
	});

	it('shows examples for random-group and running order numbers', () => {
		expect(
			numberingExamples(
				numbering({ kind: 'randomGroups', prefix: 'ST', separator: '-', groups: [4, 4] }),
				'2026-27',
			).order,
		).toMatch(/^ST-\d{4}-\d{4}$/);
		expect(
			numberingExamples(numbering({ kind: 'runningNumber', prefix: 'SO', start: 1, digits: 5 }), '2026-27').order,
		).toBe('SO00001');
	});

	it('prints a year with no second part as it is', () => {
		expect(renderSeriesNumber(series('TI'), '2026', 1)).toBe('TI/26-/000001');
	});
});

/* Open orders, balances and payment policies */

describe('open orders: the remaining cases', () => {
	it('changes lines only on an open order while open orders are on', () => {
		expect(canChangeLines('open', false)).toBe('openOrdersOff');
		expect(canChangeLines('placed', true)).toBe('notOpen');
		expect(canChangeLines('open', true)).toBeNull();
	});

	it('counts whole days open, never below nothing, and reminds only when asked', () => {
		const now = new Date('2026-11-11T12:00:00Z');
		expect(daysOpen('2026-11-01T00:00:00Z', now)).toBe(10);
		expect(daysOpen('2026-12-01T00:00:00Z', now)).toBe(0);
		expect(openTooLong('2026-11-01T00:00:00Z', now, null)).toBe(false);
		expect(openTooLong('2026-11-01T00:00:00Z', now, 10)).toBe(true);
		expect(openTooLong('2026-11-01T00:00:00Z', now, 11)).toBe(false);
	});
});

const balance = (over: Partial<OrderBalance>): OrderBalance => ({
	goodsINR: 1000,
	couponINR: 0,
	shippingINR: 0,
	totalINR: 1000,
	paidINR: 0,
	dueINR: 1000,
	paidAheadINR: 0,
	refundedINR: 0,
	...over,
});
const status = (b: OrderBalance) =>
	derivePaymentStatus({
		balance: b,
		cashOnDelivery: false,
		onAccount: false,
		activeRequest: false,
		pendingAtBank: false,
	});

describe('order balance and payment status: the remaining cases', () => {
	it('counts a refunded payment in full unless it says how much went back', () => {
		const refunded = (payment: { amountINR: number; state: 'received' | 'refunded'; refundedINR?: number }) =>
			orderBalance({ lineTotalsINR: [1000], couponINR: 0, shippingINR: 0, payments: [payment] }).refundedINR;
		expect(refunded({ amountINR: 500, state: 'refunded' })).toBe(500);
		expect(refunded({ amountINR: 500, state: 'received' })).toBe(0);
		expect(refunded({ amountINR: 500, state: 'refunded', refundedINR: 200 })).toBe(200);
	});

	it('tells part refunds and money paid ahead on a free order', () => {
		expect(status(balance({ paidINR: 1000, refundedINR: 400, dueINR: 400 }))).toBe('part_refunded');
		expect(status(balance({ totalINR: 0, dueINR: 0, paidINR: 50, paidAheadINR: 50 }))).toBe('paid_ahead');
		expect(status(balance({ totalINR: 0, dueINR: 0 }))).toBe('unpaid');
	});

	it('places paid, paid-ahead, cash-on-delivery and on-account orders only', () => {
		expect(
			['paid', 'paid_ahead', 'due_on_delivery', 'on_account', 'unpaid', 'part_paid'].map((s) =>
				isPlaceable(s as never),
			),
		).toEqual([true, true, true, true, false, false]);
	});
});

describe('payment policies: the remaining cases', () => {
	it('dates a request’s expiry and lets only blocked businesses not order', () => {
		expect(requestExpiry(new Date('2026-11-01T00:00:00Z'), 7)).toBe('2026-11-08T00:00:00.000Z');
		expect(canOrderAtAll('blocked')).toBe(false);
		expect(canOrderAtAll('creditOnHold')).toBe(true);
	});

	it('sets off nothing without two balances, or before the agreement is signed', () => {
		const setOff = (over: Partial<Parameters<typeof checkSetOff>[0]>) =>
			checkSetOff({
				setting: { mode: 'agreement', signedOn: '2026-12-01', validUntil: null },
				basis: 'standingAgreement',
				receivableINR: 500,
				payableINR: 300,
				amountINR: 100,
				today: '2026-11-20',
				...over,
			});
		expect(setOff({ payableINR: 0 })).toBe('nothingToSetOff');
		expect(setOff({})).toBe('agreementNotYetSigned');
	});

	it('settles the oldest orders first, skipping ones that owe nothing, and stops when the money runs out', () => {
		const orders = [
			{ orderId: 'o3', dueINR: 50, placedAt: '2026-01-03' },
			{ orderId: 'o1', dueINR: 100, placedAt: '2026-01-01' },
			{ orderId: 'o2', dueINR: 0, placedAt: '2026-01-02' },
		];
		expect(allocateReceipt(orders, 100)).toEqual({
			allocations: [{ orderId: 'o1', amountINR: 100 }],
			unallocatedINR: 0,
		});
		expect(allocateReceipt(orders, 120)).toEqual({
			allocations: [
				{ orderId: 'o1', amountINR: 100 },
				{ orderId: 'o3', amountINR: 20 },
			],
			unallocatedINR: 0,
		});
	});
});

describe('set lines and the pack list: the remaining cases', () => {
	it('prices a child of no quantity at nothing a unit', () => {
		expect(orderChildMoney([{ role: 'free', key: 'f', quantity: 0, priceINR: 0 }], 2)).toEqual([
			{ key: 'f', quantity: 0, unitPriceINR: 0, lineTotalINR: 0, couponINR: 0 },
		]);
	});

	it('waits only on parcel lines that have an id and no tick', () => {
		expect(packListIncomplete({ lines: [{ role: 'product' }], packTicks: [] })).toBe(false);
		expect(packListIncomplete({ lines: [{ lineId: 'l1', role: 'product' }] })).toBe(true);
		expect(packListIncomplete({ lines: [{ lineId: 'l1', role: 'product' }], packTicks: ['l1'] })).toBe(false);
	});
});
