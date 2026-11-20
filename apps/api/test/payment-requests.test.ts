import { Order, OrderSettings, type OrderPayment, type PaymentRequest } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { PaymentRequestsService, hashPayToken } from '../src/admin-orders/payment-requests.service';

const order = Order.parse({
	id: 'ord_1',
	orderNumber: 'ST-2611-482190',
	currency: 'INR',
	lines: [
		{
			lineId: 'l1',
			productId: 'p1',
			title: { en: 'Kanjivaram saree' },
			sku: 'SAR-1',
			quantity: 1,
			unitPriceINR: 30_000,
			unitPricePaid: 30_000,
			lineTotalINR: 30_000,
			lineTotalPaid: 30_000,
		},
	],
	subtotalINR: 30_000,
	subtotalPaid: 30_000,
	totalINR: 30_000,
	totalPaid: 30_000,
	status: 'awaiting_payment',
	buyer: { kind: 'person', customerId: 'cus_1', name: 'Ananya Das', email: 'ananya@example.test' },
	addresses: {
		billing: {
			fullName: 'Ananya Das',
			line1: '12 Lake Road',
			city: 'Kolkata',
			postalCode: '700029',
			country: 'IN',
			countryCode: 'IN',
			mobile: { countryCallingCode: '91', number: '9830012345' },
		},
		delivery: {
			fullName: 'Ananya Das',
			line1: '12 Lake Road',
			city: 'Kolkata',
			postalCode: '700029',
			country: 'IN',
			countryCode: 'IN',
		},
	},
	balance: {
		goodsINR: 30_000,
		couponINR: 0,
		shippingINR: 0,
		totalINR: 30_000,
		paidINR: 0,
		dueINR: 30_000,
		paidAheadINR: 0,
	},
});

function harness(gatewayPayments: Array<{ gatewayReference: string; amountMinor: number }> = []) {
	const requests: PaymentRequest[] = [];
	const payments: OrderPayment[] = [];
	const cancelled: string[] = [];
	const settled: string[] = [];
	const ccavenue = {
		gateway: 'ccavenue',
		createPaymentRequest: async (input: { reference: string; amountMinor: number }) => ({
			gatewayRequestId: `qi_${input.reference}`,
			url: `https://payit.cc/${requests.length + 1}`,
			auditRecord: {},
		}),
		fetchPaymentRequestStatus: async (id: string) => ({
			gatewayRequestId: id,
			state: gatewayPayments.length ? 'paid' : 'open',
			payments: gatewayPayments.map((row) => ({
				...row,
				currency: 'INR',
				at: '2026-11-20T07:00:00.000Z',
				method: 'upi',
			})),
			auditRecord: {},
		}),
		cancelPaymentRequest: async (id: string) => void cancelled.push(id),
	};
	const svc = new PaymentRequestsService(
		{
			get: async () => order,
			settle: async (_o: Order, _r: number, _a: unknown, _at: string, _c: unknown, entry: { kind: string }) => {
				settled.push(entry.kind);
				return order;
			},
		} as never,
		{
			childNumber: async (_k: string, number: string, n: number) => `${number}/Q${n}`,
			issue: async () => 'RC/26-27/000009',
		} as never,
		{
			convert: async (amountINR: number, code: string) => ({
				currency: code,
				amount: amountINR,
				rateFromINR: 1,
				markupPercent: 0,
				amountINR,
			}),
		} as never,
		{
			listByOrder: async () => requests,
			findById: async (id: string) => requests.find((row) => row.id === id) ?? null,
			findByTokenHash: async (hash: string) => requests.find((row) => row.tokenHash === hash) ?? null,
			save: async (request: PaymentRequest) => {
				const index = requests.findIndex((row) => row.id === request.id);
				if (index >= 0) requests[index] = request;
				else requests.push(request);
				return request;
			},
		} as never,
		{
			findByGatewayReference: async (_g: string, ref: string) =>
				payments.find((row) => row.reference === ref) ?? null,
			save: async (payment: OrderPayment) => payments.push(payment),
		} as never,
		{ get: async () => OrderSettings.parse({}) } as never,
		{ get: async () => ({ phone: '+91 33 4000 1234', email: 'wecare@sahatextile.com' }) } as never,
		new Map([['ccavenue', ccavenue]]) as never,
		{ withTransaction: async (work: (context: unknown) => Promise<unknown>) => work({}) } as never,
		{ media: { shopOrigin: 'https://localhost:4200/' } } as never,
	);
	return { svc, requests, payments, cancelled, settled };
}

const actor = { id: 'adm_1', name: null };
const NOW = new Date('2026-11-20T06:00:00.000Z');

describe('payment requests and our pay link (pl01–pl05, oo07, K1)', () => {
	it('asks the INR gateway for no more than is due, and our link shows the current request', async () => {
		const { svc, settled } = harness();
		await expect(
			svc.create('ord_1', { amountINR: 30_001, currency: 'INR', revision: 0 }, actor, NOW),
		).rejects.toMatchObject({
			response: { issues: [{ code: 'more_than_due', params: { dueINR: 30_000 } }] },
		});
		await expect(
			svc.create('ord_1', { amountINR: 100, currency: 'USD', revision: 0 }, actor, NOW),
		).rejects.toMatchObject({
			response: { issues: [{ code: 'gateway_not_configured', params: { gateway: 'paypal' } }] },
		});
		const request = await svc.create('ord_1', { amountINR: 30_000, currency: 'INR', revision: 0 }, actor, NOW);
		expect(request).toMatchObject({
			number: 'ST-2611-482190/Q1',
			gateway: 'ccavenue',
			gatewayUrl: 'https://payit.cc/1',
			sentTo: { email: 'ananya@example.test', mobile: '+91 9830012345' },
			expiresAt: '2026-11-27T06:00:00.000Z',
		});
		expect(request.ourUrl).toMatch(/^https:\/\/localhost:4200\/pay\/[A-Za-z0-9_-]{32}$/);
		expect(settled).toEqual(['paymentRequest']);
		const token = (request.ourUrl as string).split('/pay/')[1] as string;
		expect(await svc.payPage(token, NOW)).toMatchObject({
			state: 'payable',
			amount: 30_000,
			payUrl: 'https://payit.cc/1',
			deliveryCity: 'Kolkata',
		});
	});

	it('replaces and cancels the old request, and the old link forwards to the new one', async () => {
		const { svc, requests, cancelled } = harness();
		const first = await svc.create('ord_1', { amountINR: 30_000, currency: 'INR', revision: 0 }, actor, NOW);
		await svc.create('ord_1', { amountINR: 20_000, currency: 'INR', revision: 1 }, actor, NOW);
		expect(requests.map((row) => row.status)).toEqual(['replaced', 'active']);
		expect(cancelled).toEqual(['qi_ST-2611-482190/Q1']);
		const oldToken = (first.ourUrl as string).split('/pay/')[1] as string;
		expect(await svc.payPage(oldToken, NOW)).toMatchObject({
			state: 'payable',
			amount: 20_000,
			payUrl: 'https://payit.cc/2',
		});
	});

	it('records a captured payment once, however often staff check', async () => {
		const { svc, payments, settled } = harness([{ gatewayReference: '313012345678', amountMinor: 3_000_000 }]);
		const request = await svc.create('ord_1', { amountINR: 30_000, currency: 'INR', revision: 0 }, actor, NOW);
		const first = await svc.check('ord_1', request.id, actor, NOW);
		expect(first).toMatchObject({
			recorded: true,
			request: { status: 'paid' },
			payment: { method: 'gateway', amountINR: 30_000, receiptNumber: 'RC/26-27/000009' },
		});
		const again = await svc.check('ord_1', request.id, actor, NOW);
		expect(again.recorded).toBe(false);
		expect(payments).toHaveLength(1);
		expect(settled).toEqual(['paymentRequest', 'payment']);
	});

	it('shows the expired page with the shop’s contact once a request is cancelled or out of date', async () => {
		const { svc } = harness();
		const request = await svc.create('ord_1', { amountINR: 30_000, currency: 'INR', revision: 0 }, actor, NOW);
		const token = (request.ourUrl as string).split('/pay/')[1] as string;
		expect(await svc.payPage(token, new Date('2026-12-01T00:00:00.000Z'))).toEqual({
			state: 'expired',
			orderNumber: 'ST-2611-482190',
			contactPhone: '+91 33 4000 1234',
			contactEmail: 'wecare@sahatextile.com',
		});
		await svc.cancel('ord_1', request.id, actor, NOW);
		expect((await svc.payPage(token, NOW)).state).toBe('expired');
		await expect(svc.payPage('not-a-token', NOW)).rejects.toThrow('does not exist');
		expect(hashPayToken(token)).toHaveLength(64);
	});
});
