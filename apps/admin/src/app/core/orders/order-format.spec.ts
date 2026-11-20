import { describe, expect, it } from 'vitest';

import type { OrderListRow } from '@saha-textile/contracts';

import { isoDay, orderTablePage } from './orders.gateway';
import { paymentLine, toOrderTableRow } from './order-format';

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
	paymentDetail: { kind: 'payment', method: 'upi', referenceStart: '4321' },
	deliveryCountry: 'IN',
	attention: [],
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
