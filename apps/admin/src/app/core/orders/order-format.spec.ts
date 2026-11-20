import { describe, expect, it } from 'vitest';

import { attentionTileLine, attentionWhy, couponWhy, paymentLine, shippingReason, toOrderTableRow } from './order-format';
import { isoDay, orderTablePage } from './orders.gateway';

import type { OrderListRow } from '@saha-textile/contracts';

const t = (key: string, params?: Record<string, unknown>) =>
	params ? `${key}(${Object.values(params).join(',')})` : key;

const row = (over: Partial<OrderListRow> = {}): OrderListRow => ({
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
	paymentDetail: { kind: 'payment', method: 'upi', referenceStart: '4321', reference: null, gateway: null },
	deliveryCountry: 'IN',
	attention: [],
	attentionAt: {},
	open: null,
	...over,
});

describe('orders list rows (ol02–ol04, oo01)', () => {
	it('draws the number with where it came from, the status pill and the payment line', () => {
		const out = toOrderTableRow(row(), t, 'en-IN');
		expect(out.number).toContain('ST-2611-482190');
		expect(out.number).toContain('ord_channel_shop');
		expect(out.status).toContain('status-processing');
		expect(out.payment).toContain('status-success');
		expect(out.payment).toContain('ord_method_upi · 4321…');
		expect(out.deliversTo).toBe('India');
		expect(out.rowTone).toBeUndefined();
	});

	it('an order waiting for its invoice address is red, with the red badge under its status', () => {
		const out = toOrderTableRow(row({ attention: ['invoiceAddressNeeded'] }), t, 'en-IN');
		expect(out.rowTone).toBe('danger');
		expect(out.status).toContain('ord_attention_invoiceAddressNeeded');
	});

	it('a foreign total shows its rupees under it; a business gets its chip', () => {
		const out = toOrderTableRow(
			row({
				currency: 'GBP',
				total: 280.97,
				totalINR: 31_000,
				buyerKind: 'business',
				buyerName: 'Bose Boutique',
			}),
			t,
			'en-GB',
		);
		expect(out.total).toContain('£280.97');
		expect(out.total).toContain('31,000');
		expect(out.buyer).toContain('ord_business_chip');
	});

	it('words a live request by gateway and date, and escapes what people typed', () => {
		expect(paymentLine({ kind: 'request', gateway: 'paypal', until: '2026-11-27T09:30:00.000Z' }, t)).toContain(
			'ord_link_sent_until(ord_gateway_paypal,',
		);
		expect(toOrderTableRow(row({ buyerName: '<b>x</b>' }), t, 'en-IN').buyer).toContain('&lt;b&gt;');
	});

	it('words each payment line as ol02 draws it', () => {
		expect(
			paymentLine({ kind: 'payment', method: 'upi', referenceStart: '4321', reference: '432198765012', gateway: null }, t),
		).toBe('ord_pay_line_ref(ord_method_upi,432198765012)');
		expect(
			paymentLine({ kind: 'payment', method: 'gateway', referenceStart: null, reference: null, gateway: 'paypal' }, t),
		).toBe('ord_gateway_paypal');
		expect(paymentLine({ kind: 'cashOnDelivery' }, t)).toBe('ord_method_cashOnDelivery');
		expect(paymentLine({ kind: 'onAccount', dueOn: '2026-12-20' }, t)).toContain('ord_pay_line_due(');
		expect(paymentLine({ kind: 'onAccount', dueOn: null }, t)).toBe('ord_method_onAccount');
	});

	it('dates the reasons under Needs attention when the server knows when (ol03)', () => {
		const now = new Date('2026-11-19T15:00:00.000Z');
		const why = attentionWhy(
			{
				attention: ['requestExpiredUnpaid', 'pendingAtBank', 'invoiceAddressNeeded'],
				attentionAt: { requestExpiredUnpaid: '2026-11-17T04:45:00.000Z', pendingAtBank: '2026-11-19T13:14:00.000Z' },
			},
			t,
			now,
		);
		expect(why).toContain('ord_why_requestExpiredUnpaid_on(');
		expect(why).toContain('ord_why_pendingAtBank_at(18:44)');
		expect(why).toContain('<b class="text-danger">ord_why_lead_invoiceAddressNeeded</b> ord_why_invoiceAddressNeeded');
	});

	it('builds the Needs attention tile line from the counts per reason (ol02)', () => {
		expect(attentionTileLine({ invoiceAddressNeeded: 1, requestExpiredUnpaid: 2, pendingAtBank: 0 }, t)).toBe(
			'ord_tile_part_invoiceAddressNeeded_one(1) · ord_tile_part_requestExpiredUnpaid_other(2)',
		);
		expect(attentionTileLine({}, t)).toBeNull();
	});

	it('open orders show their age and where the money stands', () => {
		const out = toOrderTableRow(
			row({
				status: 'open',
				open: {
					openedAt: '2026-11-06T10:00:00.000Z',
					piecesHeld: 7,
					goodsINR: 41_600,
					paidINR: 45_600,
					dueINR: 0,
					paidAheadINR: 4_000,
				},
			}),
			t,
			'en-IN',
			new Date('2026-11-20T10:00:00.000Z'),
		);
		expect(out.openSince).toContain('ord_days(14)');
		expect(out.pieces).toBe('7');
		expect(out.balance).toContain('ord_paid_ahead_amount');
	});

	it('pads the table’s date range for the API', () => {
		expect(isoDay('2026-11-5')).toBe('2026-11-05');
		expect(
			orderTablePage({
				page: 2,
				paginate: 15,
				search: ' 4821 ',
				start_date: '2026-11-1',
				end_date: '2026-11-20',
			}),
		).toEqual({
			page: 2,
			pageSize: 15,
			q: '4821',
			from: '2026-11-01',
			to: '2026-11-20',
		});
	});
});

describe('shipping reason (ck01–ck06)', () => {
	const tr = (key: string, params?: Record<string, unknown>) =>
		params ? `${key}(${Object.values(params).join('|')})` : key;
	const base = {
		chargeINR: 100,
		charge: 100,
		zone: 'domestic' as const,
		ruleSets: [],
		cannotShip: [],
	};
	const entry = (lineIds: string[], result: string, extra: Record<string, unknown> = {}) =>
		JSON.stringify({ stepId: 's', lineIds, path: [], result, amountINR: 0, ...extra });

	it('says the discounted pieces charged and the full-price piece free', () => {
		const why = shippingReason(
			{
				...base,
				trace: [
					entry(['a'], 'productCharge', { amountINR: 100, units: 1, unitAmountINR: 100 }),
					entry(['b'], 'free'),
					'not json',
				],
				pieces: [
					{ lineId: 'a', units: 1, discounted: true },
					{ lineId: 'b', units: 1, discounted: false },
				],
			},
			tr,
		);
		expect(why.reason).toBe('Ord_ship_discounted_one(1|₹100); ord_ship_full_price_free_one');
		expect(why.short).toBe('ord_ship_discounted_one(1|₹100)');
	});

	it('every piece at full price, and abroad the first piece then the rest', () => {
		expect(
			shippingReason(
				{
					...base,
					trace: [entry(['a', 'b'], 'free')],
					pieces: [
						{ lineId: 'a', units: 2, discounted: false },
						{ lineId: 'b', units: 1, discounted: false },
					],
				},
				tr,
			).reason,
		).toBe('Ord_ship_every_full_price');
		const abroad = shippingReason(
			{
				...base,
				trace: [
					entry(['a'], 'firstAndFurther', {
						amountINR: 3800,
						firstINR: 2000,
						furtherUnits: 2,
						furtherINR: 900,
					}),
				],
				pieces: [{ lineId: 'a', units: 3, discounted: false }],
			},
			tr,
		);
		expect(abroad.reason).toBe('Ord_ship_first_further(₹2,000|2|₹900)');
		expect(abroad.short).toBe('ord_ship_sent_abroad(2)');
	});
});

describe('coupon line (cp07)', () => {
	const tr = (key: string, params?: Record<string, unknown>) =>
		params ? `${key}(${Object.values(params).join('|')})` : key;
	it('names what got money off and what was on sale', () => {
		const coupon = {
			couponId: 'c',
			code: 'WEDDING10',
			kind: 'percentOff' as const,
			amountINR: 680,
			deliveryAmountINR: 0,
			combines: true,
			value: 10,
			lines: [
				{ lineId: 'a', reason: 'applied' as const, amountINR: 680 },
				{ lineId: 'b', reason: 'onSale' as const, amountINR: 0 },
			],
		};
		const title = (id: string) => (id === 'a' ? 'Blush Pink Georgette Saree' : 'Maroon Temple Border Silk');
		expect(couponWhy(coupon, title, tr)).toBe(
			'ord_coupon_why_percent(10|Blush Pink Georgette Saree); ord_coupon_why_on_sale(Maroon Temple Border Silk)',
		);
		expect(couponWhy({ ...coupon, kind: 'freeDelivery' }, title, tr)).toBe('ord_coupon_why_free_delivery');
	});
});
