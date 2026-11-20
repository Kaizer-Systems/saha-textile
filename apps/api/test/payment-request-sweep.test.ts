import { Order, OrderSettings, type PaymentRequest } from '@saha-textile/contracts';
import { NOT_CONNECTED_EINVOICE, NOT_CONNECTED_EWAYBILL } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { AdminOrdersService } from '../src/admin-orders/admin-orders.service';
import { PaymentRequestSweep } from '../src/admin-orders/payment-request-sweep';

const order = Order.parse({
	id: 'ord_1',
	orderNumber: 'ST-2611-482190',
	currency: 'INR',
	lines: [
		{
			lineId: 'l1',
			productId: 'p1',
			title: { en: 'Saree' },
			sku: 'S',
			quantity: 1,
			unitPriceINR: 5_000,
			unitPricePaid: 5_000,
			lineTotalINR: 5_000,
			lineTotalPaid: 5_000,
		},
	],
	subtotalINR: 5_000,
	subtotalPaid: 5_000,
	totalINR: 5_000,
	totalPaid: 5_000,
	status: 'awaiting_payment',
	paymentStatus: 'request_sent',
	balance: {
		goodsINR: 5_000,
		couponINR: 0,
		shippingINR: 0,
		totalINR: 5_000,
		paidINR: 0,
		dueINR: 5_000,
		paidAheadINR: 0,
	},
});
const request = {
	id: 'req_1',
	orderId: 'ord_1',
	number: 'ST-2611-482190/Q1',
	gateway: 'ccavenue',
	status: 'active',
	expiresAt: '2026-11-19T06:00:00.000Z',
} as PaymentRequest;

describe('the payment request expiry sweep (pl05, ol03)', () => {
	it('marks a request that ran out as expired, and the order is stored as needing attention', async () => {
		const saved: PaymentRequest[] = [];
		const metas: unknown[] = [];
		let stored = order;
		const orders = new AdminOrdersService(
			{
				findById: async () => stored,
				update: async (next: Order, _rev: number, _ctx: unknown, meta: unknown) => {
					metas.push(meta);
					stored = next;
					return next;
				},
			} as never,
			{ listByOrder: async () => [] } as never,
			{ listByOrder: async () => [{ ...request, status: 'expired' }] } as never,
			{} as never,
			{ get: async () => OrderSettings.parse({}) } as never,
			{} as never,
			{} as never,
			NOT_CONNECTED_EINVOICE,
			NOT_CONNECTED_EWAYBILL,
			{} as never,
			{} as never,
			{ withTransaction: async (work: (context: unknown) => Promise<unknown>) => work({}) } as never,
			{} as never,
		);
		const sweep = new PaymentRequestSweep(
			orders,
			{
				listExpired: async () => [request],
				save: async (row: PaymentRequest) => saved.push(row),
			} as never,
			{ withTransaction: async (work: (context: unknown) => Promise<unknown>) => work({}) } as never,
		);
		expect(await sweep.sweep(new Date('2026-11-20T06:00:00.000Z'))).toBe(1);
		expect(saved[0]?.status).toBe('expired');
		expect(stored).toMatchObject({ paymentStatus: 'unpaid', status: 'awaiting_payment' });
		expect(metas[0]).toEqual({ attention: ['requestExpiredUnpaid'] });
		expect(stored.history.at(-1)).toMatchObject({ kind: 'paymentRequest', detail: { expired: true } });
	});
});
