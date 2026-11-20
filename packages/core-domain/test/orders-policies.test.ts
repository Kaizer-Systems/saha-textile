import type {
	DocumentNumberingSettings,
	OrderBalance,
	ZonePriceList,
	ZonePricingSettings,
} from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	allocateReceipt,
	allowedNextStatuses,
	applyCoupons,
	canMoveTo,
	canSendSms,
	checkAddress,
	checkCredit,
	checkRequestAmount,
	checkSetOff,
	couponRefusal,
	currentRequest,
	derivePaymentStatus,
	manualPaymentEffect,
	manualPaymentPrefill,
	messageForm,
	normalizeForSearch,
	numberingExamples,
	onAccountDueDate,
	orderBalance,
	renderChildNumber,
	renderRandomOrderNumber,
	renderSequencedOrderNumber,
	renderSeriesNumber,
	seriesFormatProblems,
	settingsZoneNeeds,
	statusAfterClose,
	warnIndiaBillingForeignCurrency,
	zonePriceFor,
	type CouponContext,
	type CouponDefinition,
	type CouponLine,
	type StatusMachineOrder,
	type StatusMachineSettings,
} from '../src/index';

/* ---------------------------------------------------------------------------------------------- */
/* Status machine                                                                                  */
/* ---------------------------------------------------------------------------------------------- */

const settings: StatusMachineSettings = {
	outForDeliveryOnlyFromCourier: true,
	eDocumentsBeforeShipped: 'off',
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
	...over,
});

describe('order status machine (st01–st05, K4)', () => {
	it('offers only the next steps; later ones are greyed with the reason', () => {
		const menu = allowedNextStatuses(order({ status: 'processing' }), settings);
		expect(menu.map((row) => [row.to, row.allowed, row.reason])).toEqual([
			['packed', true, null],
			['shipped', false, 'packFirst'],
			['cancelled', true, null],
		]);
	});

	it('keeps Packed off until the invoice address is added (st02)', () => {
		const packed = allowedNextStatuses(order({ status: 'processing', invoiceAddressNeeded: true }), settings).find(
			(row) => row.to === 'packed',
		);
		expect(packed).toMatchObject({ allowed: false, reason: 'addInvoiceAddressFirst' });
	});

	it('needs courier and tracking for Shipped and tells the customer (st03)', () => {
		const shipped = allowedNextStatuses(order({ status: 'packed' }), settings).find((row) => row.to === 'shipped');
		expect(shipped).toMatchObject({
			allowed: true,
			needs: ['courier', 'trackingNumber'],
			tells: ['order_shipped'],
		});
	});

	it('hides Out for delivery while it can only come from a courier and none is connected', () => {
		expect(allowedNextStatuses(order({ status: 'shipped' }), settings).map((row) => row.to)).toEqual([
			'delivered',
			'cancelled',
		]);
		const connected = allowedNextStatuses(order({ status: 'shipped' }), { ...settings, courierConnected: true });
		expect(connected.find((row) => row.to === 'out_for_delivery')?.allowed).toBe(true);
	});

	it('follows OD12: ready pieces cancel until Packed, made-to-order until Processing', () => {
		expect(canMoveTo(order({ status: 'processing' }), 'cancelled', settings)).toEqual({ allowed: true });
		expect(canMoveTo(order({ status: 'packed' }), 'cancelled', settings)).toEqual({
			allowed: false,
			reason: 'readyPastPacked',
		});
		const mto = order({ status: 'processing', lines: [{ madeToOrder: true }] });
		expect(canMoveTo(mto, 'cancelled', settings)).toEqual({ allowed: false, reason: 'madeToOrderPastProcessing' });
		expect(canMoveTo(order({ status: 'placed', lines: [{ madeToOrder: true }] }), 'cancelled', settings)).toEqual({
			allowed: true,
		});
		expect(canMoveTo(order({ status: 'shipped' }), 'cancelled', settings)).toEqual({
			allowed: false,
			reason: 'alreadyShipped',
		});
	});

	it('never jumps to Delivered before Shipped', () => {
		expect(canMoveTo(order({ status: 'packed' }), 'delivered', settings)).toEqual({
			allowed: false,
			reason: 'shipFirst',
		});
	});

	it('places only paid, cash on delivery or on account orders', () => {
		expect(canMoveTo(order({ status: 'awaiting_payment', placeable: false }), 'placed', settings)).toEqual({
			allowed: false,
			reason: 'notPaid',
		});
	});

	it('applies the e-documents gate on business orders only, as the setting says', () => {
		const business = order({ status: 'packed', buyerKind: 'business' });
		expect(canMoveTo(business, 'shipped', settings)).toEqual({ allowed: true });
		expect(canMoveTo(business, 'shipped', { ...settings, eDocumentsBeforeShipped: 'block' })).toEqual({
			allowed: false,
			reason: 'eDocumentsMissing',
		});
		const warn = allowedNextStatuses(business, { ...settings, eDocumentsBeforeShipped: 'warn' }).find(
			(row) => row.to === 'shipped',
		);
		expect(warn).toMatchObject({ allowed: true, warning: 'eDocumentsMissing' });
		expect(
			canMoveTo(order({ status: 'packed' }), 'shipped', { ...settings, eDocumentsBeforeShipped: 'block' }),
		).toEqual({ allowed: true });
	});
});

/* ---------------------------------------------------------------------------------------------- */
/* Money                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

const balance = (over: Partial<OrderBalance> = {}): OrderBalance => ({
	goodsINR: 0,
	couponINR: 0,
	shippingINR: 0,
	totalINR: 0,
	paidINR: 0,
	dueINR: 0,
	paidAheadINR: 0,
	refundedINR: 0,
	...over,
});

describe('balance and payment status (oo02–oo05)', () => {
	it('adds pieces, takes coupons off, adds shipping and counts only received payments', () => {
		const result = orderBalance({
			lineTotalsINR: [40_000, 22_700],
			couponINR: 2_000,
			shippingINR: 0,
			payments: [
				{ amountINR: 20_000, state: 'received' },
				{ amountINR: 13_000, state: 'received' },
				{ amountINR: 5_000, state: 'pending' },
			],
		});
		expect(result).toMatchObject({
			goodsINR: 62_700,
			totalINR: 60_700,
			paidINR: 33_000,
			dueINR: 27_700,
			paidAheadINR: 0,
		});
	});

	it('shows money paid beyond the total as paid ahead', () => {
		const result = orderBalance({
			lineTotalsINR: [10_000],
			couponINR: 0,
			shippingINR: 0,
			payments: [{ amountINR: 12_300, state: 'received' }],
		});
		expect(result).toMatchObject({ dueINR: 0, paidAheadINR: 2_300 });
		expect(
			derivePaymentStatus({
				balance: result,
				cashOnDelivery: false,
				onAccount: false,
				activeRequest: false,
				pendingAtBank: false,
			}),
		).toBe('paid_ahead');
	});

	it('names the payment status from the records', () => {
		const due = balance({ totalINR: 100, dueINR: 100 });
		const base = { cashOnDelivery: false, onAccount: false, activeRequest: false, pendingAtBank: false };
		expect(derivePaymentStatus({ balance: due, ...base })).toBe('unpaid');
		expect(derivePaymentStatus({ balance: due, ...base, activeRequest: true })).toBe('request_sent');
		expect(derivePaymentStatus({ balance: due, ...base, pendingAtBank: true })).toBe('pending_at_bank');
		expect(derivePaymentStatus({ balance: due, ...base, cashOnDelivery: true })).toBe('due_on_delivery');
		expect(derivePaymentStatus({ balance: due, ...base, onAccount: true })).toBe('on_account');
		expect(derivePaymentStatus({ balance: balance({ totalINR: 100, paidINR: 40, dueINR: 60 }), ...base })).toBe(
			'part_paid',
		);
		expect(derivePaymentStatus({ balance: balance({ totalINR: 100, paidINR: 100 }), ...base })).toBe('paid');
		expect(
			derivePaymentStatus({ balance: balance({ totalINR: 100, paidINR: 100, refundedINR: 100 }), ...base }),
		).toBe('refunded');
	});

	it('opens Record payment with the amount due; less leaves it due, more pays ahead (K3)', () => {
		const now = balance({ totalINR: 60_700, paidINR: 33_000, dueINR: 27_700 });
		expect(manualPaymentPrefill(now)).toBe(27_700);
		expect(manualPaymentEffect(now, 27_700)).toEqual({ kind: 'paysUp' });
		expect(manualPaymentEffect(now, 20_000)).toEqual({ kind: 'leavesDue', dueINR: 7_700 });
		expect(manualPaymentEffect(now, 30_000)).toEqual({ kind: 'paysAhead', aheadINR: 2_300 });
	});
});

describe('payment requests (K1, K2, oo07)', () => {
	it('is never for more than is due', () => {
		expect(checkRequestAmount(balance({ dueINR: 27_700 }), 27_700)).toBeNull();
		expect(checkRequestAmount(balance({ dueINR: 27_700 }), 30_000)).toBe('moreThanDue');
		expect(checkRequestAmount(balance({ dueINR: 0 }), 1)).toBe('nothingDue');
	});

	it('forwards our link to the current request after a replacement', () => {
		const now = new Date('2026-11-20T10:00:00Z');
		const old = {
			id: 'q1',
			status: 'replaced' as const,
			expiresAt: '2026-11-27T00:00:00Z',
			createdAt: '2026-11-19',
			replacedBy: 'q2',
		};
		const fresh = {
			id: 'q2',
			status: 'active' as const,
			expiresAt: '2026-11-27T00:00:00Z',
			createdAt: '2026-11-20',
			replacedBy: null,
		};
		expect(currentRequest([old, fresh], old, now)?.id).toBe('q2');
		expect(currentRequest([old, { ...fresh, status: 'expired' as const }], old, now)).toBeNull();
		expect(currentRequest([fresh], { ...fresh, expiresAt: '2026-11-19T00:00:00Z' }, now)).toBeNull();
	});

	it('sends our SMS only to Indian mobile numbers (pr01)', () => {
		expect(canSendSms({ countryCallingCode: '91', number: '9830012345' })).toBe(true);
		expect(canSendSms({ countryCallingCode: '44', number: '7700900123' })).toBe(false);
		expect(canSendSms(null)).toBe(false);
	});

	it('warns before a foreign-currency request to a buyer billed in India (K2)', () => {
		expect(warnIndiaBillingForeignCurrency('IN', 'USD')).toBe(true);
		expect(warnIndiaBillingForeignCurrency('IN', 'INR')).toBe(false);
		expect(warnIndiaBillingForeignCurrency('GB', 'GBP')).toBe(false);
	});
});

describe('credit, set-off and receipts (K5, K9)', () => {
	const credit = {
		standing: 'active' as const,
		limitINR: 200_000,
		outstandingINR: 60_000,
		orderINR: 50_000,
		businessAccounts: true,
	};

	it('allows an order within the limit and refuses one over it, with the numbers', () => {
		expect(checkCredit(credit)).toEqual({ availableINR: 140_000, refusal: null, overByINR: 0 });
		expect(checkCredit({ ...credit, orderINR: 161_500 })).toEqual({
			availableINR: 140_000,
			refusal: 'overLimit',
			overByINR: 21_500,
		});
	});

	it('refuses on account while credit is on hold or the business is blocked', () => {
		expect(checkCredit({ ...credit, standing: 'creditOnHold' }).refusal).toBe('creditOnHold');
		expect(checkCredit({ ...credit, standing: 'blocked' }).refusal).toBe('blocked');
		expect(checkCredit({ ...credit, businessAccounts: false }).refusal).toBe('accountsOff');
	});

	it('dates an order on account by the credit days', () => {
		expect(onAccountDueDate('2026-11-20', 30)).toBe('2026-12-20');
	});

	it('sets off at most the smaller balance, only under an agreement', () => {
		const base = { receivableINR: 50_000, payableINR: 20_000, amountINR: 20_000, today: '2026-11-20' };
		expect(checkSetOff({ ...base, setting: { mode: 'never' }, basis: 'standingAgreement' })).toBe('notAllowed');
		const agreement = { mode: 'agreement' as const, signedOn: '2026-04-01', validUntil: '2027-03-31' };
		expect(checkSetOff({ ...base, setting: agreement, basis: 'standingAgreement' })).toBeNull();
		expect(checkSetOff({ ...base, amountINR: 25_000, setting: agreement, basis: 'standingAgreement' })).toBe(
			'moreThanSmallerBalance',
		);
		expect(
			checkSetOff({ ...base, setting: { ...agreement, validUntil: '2026-10-31' }, basis: 'standingAgreement' }),
		).toBe('agreementExpired');
		expect(checkSetOff({ ...base, setting: { mode: 'never' }, basis: 'oneOff' })).toBeNull();
	});

	it('settles the oldest open orders first (bz06)', () => {
		const result = allocateReceipt(
			[
				{ orderId: 'b', dueINR: 30_000, placedAt: '2026-11-10' },
				{ orderId: 'a', dueINR: 20_000, placedAt: '2026-11-01' },
			],
			35_000,
		);
		expect(result).toEqual({
			allocations: [
				{ orderId: 'a', amountINR: 20_000 },
				{ orderId: 'b', amountINR: 15_000 },
			],
			unallocatedINR: 0,
		});
	});
});

/* ---------------------------------------------------------------------------------------------- */
/* Zones                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

const chosen: ZonePricingSettings = {
	saleMeetsZone: 'lowerOfTheTwo',
	gstInZonePrice: 'included',
	categoryClash: 'lowerPrice',
	couponsOnZoneLines: 'notAllowed',
	revision: 1,
	updatedAt: null,
	updatedBy: null,
};
const unchosen: ZonePricingSettings = {
	...chosen,
	saleMeetsZone: null,
	gstInZonePrice: null,
	categoryClash: null,
	couponsOnZoneLines: null,
};
const list: ZonePriceList = {
	allProducts: { kind: 'percentOffRetail', percent: 10 },
	categories: [
		{
			id: 'r1',
			categoryId: 'cat_silk',
			includeSubcategories: true,
			adjustment: { kind: 'percentOffRetail', percent: 25 },
		},
		{
			id: 'r2',
			categoryId: 'cat_bridal',
			includeSubcategories: true,
			adjustment: { kind: 'flatPrice', amountINR: 9_000 },
		},
	],
	products: [
		{ productId: 'prd_own', mode: 'own', adjustment: { kind: 'flatPrice', amountINR: 5_000 }, skuPrices: {} },
		{ productId: 'prd_off', mode: 'noPrice', adjustment: null, skuPrices: {} },
	],
};
const live = { retail: false, live: true, priceList: list };
const sku = (over: Partial<Parameters<typeof zonePriceFor>[1]> = {}) => ({
	productId: 'prd_1',
	sku: 'S1',
	normalINR: 10_000,
	saleINR: null,
	categoryPaths: [['cat_silk_kanjivaram', 'cat_silk']],
	mainCategoryId: 'cat_silk_kanjivaram',
	...over,
});

describe('zone pricing (DEC-B2B-ZONES)', () => {
	it('gives RETAIL the shop price, sale included', () => {
		const retail = { retail: true, live: true, priceList: { allProducts: null, categories: [], products: [] } };
		expect(zonePriceFor(retail, sku({ saleINR: 8_000 }), unchosen)).toMatchObject({
			kind: 'priced',
			unitPriceINR: 8_000,
			fromSale: true,
		});
	});

	it('prices by product exception, then category (sub-categories included), then all products', () => {
		expect(zonePriceFor(live, sku({ productId: 'prd_own' }), chosen)).toMatchObject({
			unitPriceINR: 5_000,
			rule: { level: 'product' },
		});
		expect(zonePriceFor(live, sku(), chosen)).toMatchObject({
			unitPriceINR: 7_500,
			rule: { level: 'category', categoryId: 'cat_silk' },
		});
		expect(zonePriceFor(live, sku({ categoryPaths: [['cat_cotton']] }), chosen)).toMatchObject({
			unitPriceINR: 9_000,
			rule: { level: 'allProducts' },
		});
	});

	it('shows "Price not set for this zone" for an excluded product or one the list does not cover', () => {
		expect(zonePriceFor(live, sku({ productId: 'prd_off' }), chosen)).toEqual({ kind: 'noPrice' });
		const noAll = { ...live, priceList: { ...list, allProducts: null } };
		expect(zonePriceFor(noAll, sku({ categoryPaths: [['cat_cotton']] }), chosen)).toEqual({ kind: 'noPrice' });
	});

	it('asks for the setting instead of guessing the open questions', () => {
		expect(zonePriceFor(live, sku(), unchosen)).toEqual({ kind: 'settingNeeded', setting: 'gstInZonePrice' });
		const gst = { ...unchosen, gstInZonePrice: 'included' as const };
		expect(zonePriceFor(live, sku({ saleINR: 7_000 }), gst)).toEqual({
			kind: 'settingNeeded',
			setting: 'saleMeetsZone',
		});
		const twoCategories = sku({ categoryPaths: [['cat_silk'], ['cat_bridal']] });
		expect(zonePriceFor(live, twoCategories, gst)).toEqual({ kind: 'settingNeeded', setting: 'categoryClash' });
	});

	it('follows the settings once chosen', () => {
		expect(zonePriceFor(live, sku({ saleINR: 7_000 }), chosen)).toMatchObject({
			unitPriceINR: 7_000,
			fromSale: true,
		});
		expect(zonePriceFor(live, sku({ categoryPaths: [['cat_silk'], ['cat_bridal']] }), chosen)).toMatchObject({
			unitPriceINR: 7_500,
		});
		const higher = { ...chosen, categoryClash: 'higherPrice' as const };
		expect(zonePriceFor(live, sku({ categoryPaths: [['cat_silk'], ['cat_bridal']] }), higher)).toMatchObject({
			unitPriceINR: 9_000,
		});
		expect(zonePriceFor(live, sku(), { ...chosen, gstInZonePrice: 'addedOnTop' })).toMatchObject({
			gstAddedOnTop: true,
		});
	});

	it('prices a business on a draft zone at retail', () => {
		expect(zonePriceFor({ ...live, live: false }, sku(), unchosen)).toMatchObject({
			unitPriceINR: 10_000,
			rule: { level: 'retail' },
		});
	});

	it('lists the settings a zone needs before it can go live', () => {
		expect(settingsZoneNeeds(list, unchosen)).toEqual(['gstInZonePrice', 'saleMeetsZone', 'categoryClash']);
		expect(settingsZoneNeeds(list, chosen)).toEqual([]);
	});
});

/* ---------------------------------------------------------------------------------------------- */
/* Coupons                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

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
	minOrderINR: 0,
	audience: { kind: 'everyone' },
	channels: { shop: true, admin: true },
	usesPerCustomer: 1,
	totalUses: null,
	validFrom: null,
	validUntil: null,
	combines: false,
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
	couponsOnZoneLines: null,
};
const lines: CouponLine[] = [
	{ lineId: 'l1', productId: 'p1', categoryIds: ['cat_silk'], amountINR: 10_000, onSale: false, zonePriced: false },
	{ lineId: 'l2', productId: 'p2', categoryIds: ['cat_cotton'], amountINR: 5_000, onSale: true, zonePriced: false },
];
const contexts = (...ids: string[]) => new Map(ids.map((id) => [id, ctx]));

describe('coupon engine (OD4 + stacking)', () => {
	it('leaves sale pieces out unless the coupon includes them (shop12, shop13)', () => {
		const run = applyCoupons([coupon()], lines, contexts('c1'));
		expect(run.applied[0]?.amountINR).toBe(1_000);
		expect(run.applied[0]?.lines.find((line) => line.lineId === 'l2')?.reason).toBe('onSale');
		const all = applyCoupons([coupon({ includeSaleItems: true })], lines, contexts('c1'));
		expect(all.applied[0]?.amountINR).toBe(1_500);
	});

	it('refuses a coupon when everything in the bag is on sale', () => {
		const run = applyCoupons([coupon()], [lines[1] as CouponLine], contexts('c1'));
		expect(run.refused).toEqual([{ code: 'TEN', refusal: 'nothingEligible' }]);
	});

	it('takes one coupon per order unless every applied coupon combines (cp07)', () => {
		const second = coupon({ id: 'c2', code: 'FLAT500', kind: 'amountOff', value: 500 });
		const one = applyCoupons([coupon(), second], lines, contexts('c1', 'c2'));
		expect(one.applied.map((row) => row.code)).toEqual(['TEN']);
		expect(one.refused).toEqual([{ code: 'FLAT500', refusal: 'doesNotCombine' }]);
		const both = applyCoupons(
			[coupon({ combines: true }), { ...second, combines: true }],
			lines,
			contexts('c1', 'c2'),
		);
		expect(both.applied.map((row) => [row.code, row.amountINR])).toEqual([
			['TEN', 1_000],
			['FLAT500', 500],
		]);
	});

	it('uses % first, then ₹ off, then free delivery, never below ₹0', () => {
		const flat = coupon({ id: 'c2', code: 'BIG', kind: 'amountOff', value: 50_000, combines: true });
		const free = coupon({ id: 'c3', code: 'SHIPFREE', kind: 'freeDelivery', value: 0, combines: true });
		const run = applyCoupons([free, flat, coupon({ combines: true })], lines, contexts('c1', 'c2', 'c3'));
		expect(run.applied.map((row) => row.code)).toEqual(['TEN', 'BIG', 'SHIPFREE']);
		expect(run.applied[1]?.amountINR).toBe(9_000);
		expect(run.remainingByLine.l1).toBe(0);
		expect(run.applied[2]?.deliveryAmountINR).toBe(200);
		expect(run.deliveryLeftINR).toBe(0);
	});

	it('caps a % coupon and checks the minimum order', () => {
		expect(applyCoupons([coupon({ capINR: 300 })], lines, contexts('c1')).applied[0]?.amountINR).toBe(300);
		expect(applyCoupons([coupon({ minOrderINR: 20_000 })], lines, contexts('c1')).refused[0]?.refusal).toBe(
			'belowMinimum',
		);
	});

	it('refuses by dates, channel, audience and uses', () => {
		expect(couponRefusal(coupon({ enabled: false }), ctx)).toBe('off');
		expect(couponRefusal(coupon({ validUntil: '2026-11-01T00:00:00Z' }), ctx)).toBe('expired');
		expect(couponRefusal(coupon({ channels: { shop: false, admin: true } }), ctx)).toBe('wrongChannel');
		expect(couponRefusal(coupon({ audience: { kind: 'firstOrder' } }), ctx)).toBe('firstOrderOnly');
		expect(couponRefusal(coupon(), { ...ctx, usesByThisBuyer: 1 })).toBe('usedUpForCustomer');
		expect(couponRefusal(coupon({ audience: { kind: 'businesses', businessIds: ['b1'] } }), ctx)).toBe(
			'notForThisBuyer',
		);
	});

	it('gives zone-priced lines nothing until the setting is chosen', () => {
		const zone: CouponLine[] = [{ ...(lines[0] as CouponLine), zonePriced: true }];
		expect(applyCoupons([coupon()], zone, contexts('c1')).refused[0]?.refusal).toBe('nothingEligible');
		const allowed = new Map([['c1', { ...ctx, couponsOnZoneLines: 'allowed' as const }]]);
		expect(applyCoupons([coupon()], zone, allowed).applied[0]?.amountINR).toBe(1_000);
	});
});

/* ---------------------------------------------------------------------------------------------- */
/* Numbers                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

describe('document numbering (DEC-NUMBERING)', () => {
	// The accepted table (core may only import contract types, so the defaults are written out here).
	const series = (prefix: string, digits: number) => ({
		prefix,
		separator: '/' as const,
		includeFinancialYear: true,
		digits,
		reset: 'fy' as const,
	});
	const numbering: DocumentNumberingSettings = {
		order: { kind: 'randomGroups', prefix: 'ST', separator: '-', groups: [5, 5] },
		orderFormatChosenByOwner: false,
		parcel: { letter: 'P', separator: '/' },
		return: { letter: 'R', separator: '/' },
		paymentRequest: { letter: 'Q', separator: '/' },
		series: {
			taxInvoice: series('TI', 6),
			creditNote: series('CN', 6),
			debitNote: series('DN', 6),
			receipt: series('RC', 6),
			refundVoucher: series('RF', 6),
			deliveryChallan: series('DC', 6),
			paymentVoucher: series('PV', 6),
			selfInvoice: series('SI', 6),
			purchaseOrder: series('PO', 4),
			purchaseEntry: series('PE', 5),
			purchaseReturnNote: series('PR', 4),
			journal: series('JV', 6),
			stockAdjustment: series('SA', 4),
			stockCount: series('SC', 3),
			openingStock: series('OS', 6),
		},
		lockedTypes: [],
		revision: 0,
		updatedAt: null,
		updatedBy: null,
	};

	it('renders the accepted table', () => {
		const examples = numberingExamples(numbering, '2026-27');
		expect(examples).toMatchObject({
			taxInvoice: 'TI/26-27/000001',
			purchaseEntry: 'PE/26-27/00001',
			stockCount: 'SC/26-27/001',
			journal: 'JV/26-27/000001',
		});
		expect(examples.order).toMatch(/^ST-\d{5}-\d{5}$/);
		expect(examples.parcel).toBe(`${examples.order}/P1`);
	});

	it('gives the SMS form and finds an order by either form (K6)', () => {
		expect(messageForm('ST-48213-90761')).toBe('ST4821390761');
		expect(normalizeForSearch('st 48213 90761')).toBe(normalizeForSearch('ST-48213-90761'));
		expect(renderChildNumber('ST-48213-90761', { letter: 'Q', separator: '/' }, 2)).toBe('ST-48213-90761/Q2');
	});

	it('renders the other order formats from a counter', () => {
		expect(
			renderSequencedOrderNumber(
				{ kind: 'financialYearSequence', prefix: 'SO', separator: '/', digits: 6 },
				'2026-27',
				1,
			),
		).toBe('SO/26-27/000001');
		expect(
			renderSequencedOrderNumber({ kind: 'runningNumber', prefix: 'ST', start: 10_001, digits: 5 }, '2026-27', 1),
		).toBe('ST10001');
		expect(
			renderSeriesNumber(
				{ prefix: 'TI', separator: '-', includeFinancialYear: false, digits: 6, reset: 'never' },
				'2026-27',
				7,
			),
		).toBe('TI-000007');
	});

	it('never starts a random group with 0', () => {
		const zeros = renderRandomOrderNumber(
			{ kind: 'randomGroups', prefix: 'ST', separator: '-', groups: [5, 5] },
			() => 0,
		);
		expect(zeros).toBe('ST-10000-10000');
	});

	it('refuses GST formats over 16 characters, clashing prefixes and changes after the first number', () => {
		const long = {
			prefix: 'TAXINV',
			separator: '/' as const,
			includeFinancialYear: true,
			digits: 8,
			reset: 'fy' as const,
		};
		expect(seriesFormatProblems('taxInvoice', long, numbering, numbering.series.taxInvoice)).toContain(
			'too_long_for_gst',
		);
		const clash = { ...numbering.series.taxInvoice, prefix: 'CN' };
		expect(seriesFormatProblems('taxInvoice', clash, numbering, numbering.series.taxInvoice)).toContain(
			'prefix_clash',
		);
		const near = { ...numbering.series.taxInvoice, prefix: 'TIX' };
		expect(seriesFormatProblems('journal', near, numbering, numbering.series.journal)).toContain(
			'not_unique_without_separators',
		);
		const locked = { ...numbering, lockedTypes: ['taxInvoice' as const] };
		const changed = { ...numbering.series.taxInvoice, digits: 5 };
		expect(seriesFormatProblems('taxInvoice', changed, locked, numbering.series.taxInvoice)).toContain(
			'locked_after_first_issue',
		);
		expect(
			seriesFormatProblems('taxInvoice', numbering.series.taxInvoice, locked, numbering.series.taxInvoice),
		).toEqual([]);
	});
});

/* ---------------------------------------------------------------------------------------------- */
/* Addresses and open orders                                                                       */
/* ---------------------------------------------------------------------------------------------- */

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
const indianAddress = {
	fullName: 'Ananya Sen',
	line1: '12 Lake Road',
	city: 'Kolkata',
	subdivisionCode: 'WB',
	postalCode: '700029',
	countryCode: 'IN',
	mobile: { countryCallingCode: '91', number: '9830012345' },
};
const wb = [{ code: 'WB', name: 'West Bengal', gstStateCode: '19' }];
const pin = {
	pin: '700029',
	found: true,
	city: 'Kolkata',
	subdivisionCode: 'WB',
	state: 'West Bengal',
	gstStateCode: '19',
	deliverable: null,
};

describe('address rules (DEC-ADDRESS)', () => {
	it('accepts a complete Indian address and fills the State and GST code from the data', () => {
		expect(
			checkAddress(indianAddress, { country: india, subdivisions: wb, pin, mobileLengthsForCode: [10] }),
		).toEqual({
			problems: [],
			state: 'West Bengal',
			gstStateCode: '19',
		});
	});

	it('needs 10 digits for an Indian mobile and a State that matches the PIN', () => {
		const result = checkAddress(
			{ ...indianAddress, mobile: { countryCallingCode: '91', number: '98300123' } },
			{ country: india, subdivisions: wb, pin: { ...pin, subdivisionCode: 'OR' }, mobileLengthsForCode: [10] },
		);
		expect(result.problems.map((row) => row.problem)).toEqual(['pin_state_mismatch', 'mobile_india_ten_digits']);
	});

	it('keeps the State list to the chosen country', () => {
		const uk = {
			...india,
			code: 'GB',
			callingCode: '44',
			subdivisionLabel: 'county' as const,
			postalCodeLabel: 'postcode' as const,
			postalCodePattern: null,
		};
		const result = checkAddress(
			{
				...indianAddress,
				countryCode: 'GB',
				postalCode: 'SW1A 1AA',
				subdivisionCode: 'WB',
				mobile: { countryCallingCode: '44', number: '7700900123' },
			},
			{
				country: uk,
				subdivisions: [{ code: 'KEN', name: 'Kent', gstStateCode: null }],
				pin: null,
				mobileLengthsForCode: [10],
			},
		);
		expect(result.problems).toEqual([{ field: 'subdivisionCode', problem: 'state_not_in_country' }]);
	});
});

describe('open orders (oo08)', () => {
	it('places a closed order when nothing is due or it goes on account; otherwise it waits for payment', () => {
		expect(statusAfterClose(0, 'recordLater')).toBe('placed');
		expect(statusAfterClose(500, 'toAccount')).toBe('placed');
		expect(statusAfterClose(500, 'requestOnline')).toBe('awaiting_payment');
	});
});
