import { Order, OrderSettings } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
	AdminOrdersService,
	attentionOf,
	attentionTimesOf,
	machineOrder,
	machineSettings,
	metaOf,
	paymentDetailOf,
} from '../src/admin-orders/admin-orders.service';

const NOW = new Date('2026-11-20T10:00:00.000Z');
const order = (over: Record<string, unknown> = {}) =>
	Order.parse({
		id: 'ord_1',
		orderNumber: 'ST-2611-482190',
		currency: 'INR',
		lines: [],
		subtotalINR: 1000,
		subtotalPaid: 1000,
		totalINR: 1000,
		totalPaid: 1000,
		status: 'awaiting_payment',
		paymentStatus: 'unpaid',
		channel: 'admin',
		buyer: { kind: 'person', name: 'Ananya Das' },
		...over,
	});
/** An order as an older row reads: no buyer, addresses, balance or date. */
const bare = (over: Record<string, unknown> = {}) =>
	({
		...order(over),
		buyer: undefined,
		addresses: undefined,
		balance: undefined,
		createdAt: undefined,
	}) as unknown as Order;
const request = (over: Record<string, unknown> = {}) =>
	({ status: 'expired', expiresAt: '2026-11-10T00:00:00.000Z', gateway: 'ccavenue', attempts: [], ...over }) as never;
const payment = (over: Record<string, unknown> = {}) =>
	({
		state: 'received',
		method: 'upi',
		reference: 'UTR123456',
		gateway: null,
		recordedAt: '2026-11-19T00:00:00.000Z',
		...over,
	}) as never;
const settings = (over: Record<string, unknown> = {}) => OrderSettings.parse({ ...over });

describe('the order machine’s view of an order and of the settings', () => {
	it('reads an older order as a person’s, with no invoice address needed and goods from the subtotal', () => {
		expect(machineOrder(bare())).toMatchObject({
			buyerKind: 'person',
			invoiceAddressNeeded: false,
			goodsINR: 1000,
		});
	});

	it('needs an IRN only while e-invoicing is on for the GSTIN', () => {
		expect(machineSettings(settings(), false).eInvoiceRequired).toBe(false);
		expect(machineSettings(settings()).eInvoiceRequired).toBe(settings().eInvoiceRequired);
	});

	it('stores the attention reasons an order carries', () => {
		const flagged = {
			...order({ paymentStatus: 'pending_at_bank' }),
			addresses: { invoice: { needed: true } },
			paymentReview: { at: '2026-11-19T00:00:00.000Z' },
		} as unknown as Order;
		expect(metaOf(flagged)).toEqual({ attention: ['invoiceAddressNeeded', 'pendingAtBank', 'paymentReview'] });
		expect(metaOf(bare())).toEqual({ attention: [] });
	});
});

describe('attention: why an order waits, and since when', () => {
	it('flags a request that ran out unpaid, and not one still live or paid', () => {
		expect(attentionOf(bare(), [request()], settings(), NOW)).toEqual(['requestExpiredUnpaid']);
		expect(
			attentionOf(
				bare(),
				[request({ status: 'active', expiresAt: '2026-12-01T00:00:00.000Z' })],
				settings(),
				NOW,
			),
		).toEqual([]);
		expect(attentionOf(bare(), [request({ status: 'paid' })], settings(), NOW)).toEqual([]);
		expect(attentionOf(bare(), [], settings(), NOW)).toEqual([]);
		expect(attentionOf(bare({ status: 'placed' }), [request()], settings(), NOW)).toEqual([]);
	});

	it('flags an open order kept too long only while the reminder is on', () => {
		const open = bare({ status: 'open', openedAt: '2026-10-01T00:00:00.000Z' });
		const on = settings({ openOrders: { enabled: true, remindAfterDays: 14 } });
		expect(attentionOf(open, [], on, NOW)).toEqual(['openTooLong']);
		expect(attentionOf(open, [], settings({ openOrders: { enabled: false, remindAfterDays: 14 } }), NOW)).toEqual(
			[],
		);
		expect(attentionOf(bare({ status: 'open' }), [], on, NOW)).toEqual([]);
		expect(attentionOf({ ...open, openedAt: '2026-11-19T00:00:00.000Z' } as Order, [], on, NOW)).toEqual([]);
	});

	it('dates each reason from the newest unpaid request, the newest pending payment, the review and the opening', () => {
		const flagged = {
			...bare(),
			paymentReview: { at: '2026-11-18T00:00:00.000Z' },
			openedAt: '2026-10-01T00:00:00.000Z',
		} as unknown as Order;
		const times = attentionTimesOf(
			flagged,
			['requestExpiredUnpaid', 'pendingAtBank', 'paymentReview', 'openTooLong'],
			[payment({ state: 'pending', recordedAt: '2026-11-17T00:00:00.000Z' })],
			[
				request({
					expiresAt: '2026-11-05T00:00:00.000Z',
					attempts: [{ state: 'pending', at: '2026-11-16T00:00:00.000Z' }],
				}),
				request(),
				request({ status: 'paid', expiresAt: '2026-11-15T00:00:00.000Z' }),
			],
		);
		expect(times).toEqual({
			requestExpiredUnpaid: '2026-11-10T00:00:00.000Z',
			pendingAtBank: '2026-11-17T00:00:00.000Z',
			paymentReview: '2026-11-18T00:00:00.000Z',
			openTooLong: '2026-10-01T00:00:00.000Z',
		});
		expect(
			attentionTimesOf(
				bare(),
				['requestExpiredUnpaid', 'pendingAtBank', 'paymentReview', 'openTooLong'],
				[],
				[request({ status: 'paid' })],
			),
		).toEqual({});
	});
});

describe('the payment line under the chip', () => {
	it('names a live request, cash on delivery, an account’s due day or none, and the last payment received', () => {
		const live = request({ status: 'active', expiresAt: '2026-12-01T00:00:00.000Z', gateway: 'paypal' });
		expect(paymentDetailOf([], [live], NOW)).toEqual({
			kind: 'request',
			gateway: 'paypal',
			until: '2026-12-01T00:00:00.000Z',
		});
		expect(
			paymentDetailOf([], [], NOW, { paymentStatus: 'due_on_delivery', onAccountDueOn: null } as never),
		).toEqual({ kind: 'cashOnDelivery' });
		expect(paymentDetailOf([], [], NOW, { paymentStatus: 'on_account' } as never)).toEqual({
			kind: 'onAccount',
			dueOn: null,
		});
		expect(
			paymentDetailOf([], [], NOW, { paymentStatus: 'on_account', onAccountDueOn: '2026-12-20' } as never),
		).toEqual({ kind: 'onAccount', dueOn: '2026-12-20' });
		expect(paymentDetailOf([payment({ state: 'pending' })], [], NOW)).toBeNull();
		expect(paymentDetailOf([payment()], [], NOW)).toEqual({
			kind: 'payment',
			method: 'upi',
			referenceStart: 'UTR1',
			reference: 'UTR123456',
			gateway: null,
		});
		expect(
			paymentDetailOf([payment({ method: 'gateway', reference: null, gateway: { id: 'ccavenue' } })], [], NOW),
		).toEqual({
			kind: 'payment',
			method: 'gateway',
			referenceStart: null,
			reference: null,
			gateway: 'ccavenue',
		});
	});
});

describe('the order list', () => {
	function listService(orders: Order[], counts: Record<string, number>) {
		const nothing = {} as never;
		return new AdminOrdersService(
			{ list: async () => ({ orders, total: orders.length }), counts: async () => counts } as never,
			{ listByOrder: async () => [] } as never,
			{ listByOrder: async () => [] } as never,
			nothing,
			{ get: async () => settings() } as never,
			nothing,
			nothing,
			nothing,
			nothing,
			nothing,
			nothing,
			nothing,
			nothing,
		);
	}

	it('fills older rows’ missing parts, counts missing keys as nothing, and lists only reasons that have orders', async () => {
		const open = {
			...bare({ status: 'open', openedAt: '2026-11-19T00:00:00.000Z', lines: [] }),
			shipping: { deliveryCountry: 'GB' },
		} as unknown as Order;
		const withBalance = order({
			status: 'open',
			openedAt: '2026-11-19T00:00:00.000Z',
			balance: {
				goodsINR: 900,
				couponINR: 0,
				shippingINR: 0,
				totalINR: 900,
				paidINR: 100,
				dueINR: 800,
				paidAheadINR: 0,
			},
		});
		const result = await listService([open, withBalance, bare()], { all: 3, 'attention:pendingAtBank': 2 }).list(
			{ filter: 'all', page: 1, pageSize: 20 } as never,
			NOW,
		);
		expect(result.items[0]).toMatchObject({
			createdAt: NOW.toISOString(),
			buyerName: '',
			buyerKind: 'person',
			deliveryCountry: 'GB',
			open: { goodsINR: 1000, paidINR: 0, dueINR: 0, paidAheadINR: 0, piecesHeld: 0 },
		});
		expect(result.items[1]?.open).toMatchObject({ goodsINR: 900, paidINR: 100, dueINR: 800 });
		expect(result.items[2]).toMatchObject({ deliveryCountry: null, open: null });
		expect(result.counts).toMatchObject({ all: 3, open: 0 });
		expect(result.tiles.attentionBy).toEqual({ pendingAtBank: 2 });
	});

	it('tells nothing and lists no notices without the notices service', async () => {
		const svc = listService([], {});
		await expect(svc.tell(order(), order())).resolves.toBeUndefined();
		expect(svc.told(order(), ['order_confirmed'])).toEqual([]);
	});

	it('reads the list at the current time when none is given', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		const result = await listService([bare()], {}).list({ filter: 'all', page: 1, pageSize: 20 } as never);
		vi.useRealTimers();
		expect(result.items[0]?.createdAt).toBe(NOW.toISOString());
	});
});
