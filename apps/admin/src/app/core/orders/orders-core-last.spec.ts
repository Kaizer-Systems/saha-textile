import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it } from 'vitest';

import { OrderDraftStore, draftLineKey } from './order-draft.store';
import {
	attentionTileLine,
	attentionWhy,
	countryName,
	couponWhy,
	money,
	paymentLine,
	shippingReason,
	toOrderTableRow,
} from './order-format';
import { isoDay, orderTablePage } from './orders.gateway';

import type { OrderListRow } from '@saha-textile/contracts';

const t = (key: string, params?: Record<string, unknown>) =>
	params ? `${key}(${Object.values(params).join(',')})` : key;

const row = (over: Partial<OrderListRow> = {}): OrderListRow =>
	({
		id: 'ord_1',
		orderNumber: 'ST-2611-482190',
		createdAt: '2026-11-20T10:40:00.000Z',
		channel: 'shop',
		buyerName: 'Arjun Mehta',
		buyerKind: 'person',
		currency: 'INR',
		total: 15_800,
		totalINR: 15_800,
		status: 'processing',
		paymentStatus: 'paid',
		paymentDetail: null,
		deliveryCountry: 'IN',
		attention: [],
		attentionAt: null,
		open: null,
		...over,
	}) as unknown as OrderListRow;

const entry = (over: Record<string, unknown>) => JSON.stringify({ lineIds: [], amountINR: 0, ...over });

afterEach(() => sessionStorage.clear());

describe('order helpers: the last cases', () => {
	it('words money in a currency the browser does not know, and a country code it cannot read', () => {
		expect(money(12.5, 'XYZ1')).toBe('XYZ1 12.50');
		expect(countryName(null, 'en')).toBe('—');
		expect(countryName('gb', 'en')).toBe('United Kingdom');
		expect(countryName('not a code', 'en')).toBe('not a code');
	});

	it('words a payment with no detail, and one with neither reference', () => {
		expect(paymentLine(null, t)).toBe('');
		expect(
			paymentLine(
				{ kind: 'payment', method: 'cash', reference: null, referenceStart: null, gateway: null } as never,
				t,
			),
		).toBe('ord_method_cash');
	});

	it('dates a reason today by its time and another day by its date, and counts only reasons with orders', () => {
		const now = new Date('2026-11-20T12:00:00.000Z');
		const today = attentionWhy(
			row({
				attention: ['paymentReview', 'openTooLong'] as never,
				attentionAt: {
					paymentReview: '2026-11-20T10:00:00.000Z',
					openTooLong: '2026-11-01T10:00:00.000Z',
				} as never,
			}),
			t,
			now,
		);
		expect(today).toContain('ord_why_paymentReview_at(');
		expect(today).toContain('ord_why_openTooLong_since(');
		const earlier = attentionWhy(
			row({
				attention: ['paymentReview'] as never,
				attentionAt: { paymentReview: '2026-11-18T10:00:00.000Z' } as never,
			}),
			t,
			now,
		);
		expect(earlier).toContain('Nov');
		expect(attentionTileLine(undefined, t)).toBeNull();
		expect(attentionTileLine({ paymentReview: 0, openTooLong: undefined, pendingAtBank: 2 }, t)).toBe(
			'ord_tile_part_pendingAtBank_other(2)',
		);
	});

	it('draws open orders: on account, money due, paid ahead and paid up', () => {
		const open = (over: Record<string, unknown>) =>
			({
				openedAt: '2026-11-10T00:00:00.000Z',
				dueINR: 0,
				paidAheadINR: 0,
				piecesHeld: 2,
				goodsINR: 900,
				paidINR: 900,
				...over,
			}) as never;
		const now = new Date('2026-11-20T00:00:00.000Z');
		expect(
			toOrderTableRow(row({ paymentStatus: 'on_account' as never, open: open({}) }), t, 'en', now).balance,
		).toContain('ord_balance_on_account');
		expect(toOrderTableRow(row({ open: open({ dueINR: 500 }) }), t, 'en', now).balance).toContain('ord_due_amount');
		expect(toOrderTableRow(row({ open: open({ paidAheadINR: 200 }) }), t, 'en', now).balance).toContain(
			'ord_paid_ahead_amount',
		);
		expect(toOrderTableRow(row({ open: open({}) }), t, 'en', now).balance).toContain('ord_paid_up');
		expect(toOrderTableRow(row(), t, 'en', now).payment).not.toContain('small text-muted');
	});

	it('words the shipping reason from every kind of trace line', () => {
		const pieces = [
			{ lineId: 'a', units: 2, discounted: false },
			{ lineId: 'b', units: 1, discounted: true },
		];
		const abroad = shippingReason({ trace: [entry({ result: 'firstAndFurther', units: 1 })], pieces } as never, t);
		expect(abroad.reason).toBe('Ord_ship_first_only(₹0)');
		expect(abroad.short).toBe('ord_ship_sent_abroad(0)');
		const further = shippingReason(
			{ trace: [entry({ result: 'firstAndFurther', furtherUnits: 2 })], pieces } as never,
			t,
		);
		expect(further.reason).toBe('Ord_ship_first_further(₹0,2,₹0)');
		const charged = shippingReason(
			{
				trace: [
					entry({ result: 'productCharge', amountINR: 100, lineIds: ['a'] }),
					entry({ result: 'productCharge', amountINR: 100, unitAmountINR: 50, lineIds: ['b'], units: 1 }),
					entry({ result: 'free', lineIds: ['a'] }),
				],
				pieces,
			} as never,
			t,
		);
		expect(charged.short).toBe('ord_ship_plain_other(2,₹100)');
		expect(charged.reason).toContain('ord_ship_discounted_one(1,₹50)');
		expect(charged.reason).toContain('ord_ship_full_price_free_other');
		const discountedFree = shippingReason(
			{ trace: [entry({ result: 'free', lineIds: ['b'] })], pieces } as never,
			t,
		);
		expect(discountedFree.reason).toBe('Ord_ship_more_free(1)');
		const nothing = shippingReason(
			{ trace: [entry({ result: 'free', lineIds: ['gone'], units: 0 })], pieces } as never,
			t,
		);
		expect(nothing).toEqual({ reason: '', short: '' });
		const oneFree = shippingReason(
			{
				trace: [
					entry({ result: 'productCharge', amountINR: 80, lineIds: ['b'] }),
					entry({ result: 'free', units: 1, lineIds: ['a'] }),
				],
				pieces,
			} as never,
			t,
		);
		expect(oneFree.reason).toContain('ord_ship_full_price_free_one');
	});

	it('counts a piece it no longer has as none, and words an amount-off coupon', () => {
		const reason = shippingReason(
			{
				trace: [JSON.stringify({ result: 'productCharge', amountINR: 100, lineIds: ['gone'] })],
				pieces: [],
			} as never,
			t,
		);
		expect(reason.short).toBe('ord_ship_plain_other(0,₹100)');
		expect(
			couponWhy(
				{ kind: 'amountOff', value: 200, lines: [{ lineId: 'a', reason: 'applied' }] } as never,
				() => 'Silk',
				t,
			),
		).toBe('ord_coupon_why_amount(₹200,Silk)');
	});

	it('reads a table date only when it is one, and leaves out a blank search and half a range', () => {
		expect(isoDay(5)).toBeUndefined();
		expect(isoDay('5 Nov')).toBeUndefined();
		expect(isoDay('2026-11-5')).toBe('2026-11-05');
		expect(orderTablePage({ search: 4, page: 'x', paginate: 'y', start_date: '2026-11-1' })).toEqual({
			page: 1,
			pageSize: 15,
		});
	});
});

describe('the order being put together: the last cases', () => {
	const store = () => {
		TestBed.resetTestingModule();
		return TestBed.inject(OrderDraftStore);
	};

	it('starts empty from a draft it cannot read, and repairs a draft with odd parts', () => {
		sessionStorage.setItem('st_admin_order_draft', '{not json');
		expect(store().lines()).toEqual([]);
		sessionStorage.setItem('st_admin_order_draft', JSON.stringify({ currency: 5, lines: 'x' }));
		const repaired = store();
		expect([repaired.currency(), repaired.lines()]).toEqual(['INR', []]);
	});

	it('keys a set with free picks only, keeps the same buyer kind, removes a line and sends free picks', () => {
		const draft = store();
		const key = draftLineKey('p1', null, { free: [{ productId: 'f1', variantId: null }] } as never);
		expect(key).toBe('p1:-:{"b":null,"f":[{"productId":"f1","variantId":null}]}');
		draft.setBuyerKind('person');
		expect(draft.buyer()).toBeNull();
		draft.add({
			productId: 'p1',
			variationId: null,
			quantity: 1,
			free: [{ productId: 'f1', variantId: null }],
		} as never);
		expect(draft.cartWrite().lines[0]).toMatchObject({ free: [{ productId: 'f1', variantId: null }] });
		draft.remove(key);
		expect(draft.lines()).toEqual([]);
	});
});
