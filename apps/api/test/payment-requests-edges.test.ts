import { ConflictException } from '@nestjs/common';
import { Order, OrderSettings, type PaymentRequest } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { PaymentRequestsService } from '../src/admin-orders/payment-requests.service';

const NOW = new Date('2026-11-20T06:00:00.000Z');
const balance = {
	goodsINR: 30_000,
	couponINR: 0,
	shippingINR: 0,
	totalINR: 30_000,
	paidINR: 0,
	dueINR: 30_000,
	paidAheadINR: 0,
};
const order = (over: Record<string, unknown> = {}) =>
	Order.parse({
		id: 'ord_1',
		orderNumber: 'ST-2611-482190',
		currency: 'INR',
		lines: [],
		subtotalINR: 30_000,
		subtotalPaid: 30_000,
		totalINR: 30_000,
		totalPaid: 30_000,
		status: 'awaiting_payment',
		buyer: { kind: 'person', customerId: 'cus_1', name: 'Ananya Das', email: 'ananya@example.test' },
		balance,
		...over,
	});
const allMethods = { paymentLink: true, upi: true, bankTransfer: true, cashOnDelivery: true, onAccount: true };

interface Options {
	order?: Order;
	paymentLink?: boolean;
	enabled?: Array<{ code: string; symbol: string }>;
	shopOrigin?: string | null;
	requests?: PaymentRequest[];
}

function harness(options: Options = {}) {
	const saved: PaymentRequest[] = [];
	const ccavenue = {
		gateway: 'ccavenue',
		createPaymentRequest: async () => ({ gatewayRequestId: 'qi_1', url: 'https://payit.cc/1', auditRecord: {} }),
	};
	const svc = new PaymentRequestsService(
		{ get: async () => options.order ?? order(), settle: async () => options.order ?? order() } as never,
		{ childNumber: async (_k: string, number: string, n: number) => `${number}/Q${n}` } as never,
		{
			listEnabled: async () => options.enabled ?? [{ code: 'INR', symbol: '₹' }],
			convert: async (amountINR: number, code: string) => ({
				currency: code,
				amount: amountINR,
				rateFromINR: 1,
				markupPercent: 0,
				amountINR,
			}),
		} as never,
		{
			listByOrder: async () => options.requests ?? [],
			findById: async (id: string) => (options.requests ?? []).find((row) => row.id === id) ?? null,
			save: async (request: PaymentRequest) => void saved.push(request),
		} as never,
		{} as never,
		{
			get: async () =>
				OrderSettings.parse({
					adminPaymentMethods: { ...allMethods, paymentLink: options.paymentLink ?? true },
				}),
		} as never,
		{ get: async () => null } as never,
		new Map([['ccavenue', ccavenue]]) as never,
		{ withTransaction: async (work: (context: unknown) => Promise<unknown>) => work({}) } as never,
		{
			media: { shopOrigin: options.shopOrigin === undefined ? 'https://shop.example/' : options.shopOrigin },
		} as never,
		null as never,
	);
	return { svc, saved };
}

const preview = (options: Options, query: Record<string, unknown> = {}) =>
	harness(options).svc.preview('ord_1', { currency: 'INR', ...query } as never);

describe('payment request preview: the problems, in order', () => {
	it('lists rupees first, then the other currencies by code', async () => {
		const result = await preview({
			enabled: [
				{ code: 'USD', symbol: '$' },
				{ code: 'INR', symbol: '₹' },
				{ code: 'EUR', symbol: '€' },
			],
		});
		expect(result.currencies.map((row) => row.code)).toEqual(['INR', 'EUR', 'USD']);
		expect(result.problem).toBeNull();
	});

	it('says links are off, nothing is due, the currency is unknown, the gateway is missing, or nobody can be reached', async () => {
		expect((await preview({ paymentLink: false })).problem).toBe('method_off');
		expect((await preview({ order: { ...order(), balance: undefined } as unknown as Order })).problem).toBe(
			'nothing_due',
		);
		expect((await preview({}, { currency: 'jpy' })).problem).toBe('currency_unknown');
		expect(
			(
				await preview(
					{
						enabled: [
							{ code: 'INR', symbol: '₹' },
							{ code: 'EUR', symbol: '€' },
						],
					},
					{ currency: 'EUR' },
				)
			).problem,
		).toBe('gateway_not_configured');
		const unreachable = order({ buyer: { kind: 'person', name: 'Ananya Das' } });
		const result = await preview({ order: unreachable });
		expect(result).toMatchObject({
			problem: 'no_contact',
			sendTo: { email: null, mobile: null },
			smsReachable: false,
		});
	});

	it('shows a mobile from the buyer when the billing address has none, and SMS only for an Indian one', async () => {
		const abroad = order({
			buyer: { kind: 'person', name: 'Ananya', mobile: { countryCallingCode: '44', number: '7700900123' } },
		});
		expect(await preview({ order: abroad })).toMatchObject({
			sendTo: { email: null, mobile: '+44 7700900123' },
			smsReachable: false,
		});
	});
});

describe('creating a payment request: the refusals and missing parts', () => {
	const write = (over: Record<string, unknown> = {}) =>
		({ currency: 'INR', amountINR: 1000, revision: 0, validDays: null, ...over }) as never;
	const actor = { id: null, name: null };

	it('refuses when links are off, nothing is due, the amount is wrong, the gateway is missing or nobody can be reached', async () => {
		await expect(harness({ paymentLink: false }).svc.create('ord_1', write(), actor, NOW)).rejects.toBeInstanceOf(
			ConflictException,
		);
		await expect(
			harness({ order: { ...order(), balance: undefined } as unknown as Order }).svc.create(
				'ord_1',
				write(),
				actor,
				NOW,
			),
		).rejects.toBeInstanceOf(ConflictException);
		const nothingDue = order({ balance: { ...balance, paidINR: 30_000, dueINR: 0 } });
		await expect(harness({ order: nothingDue }).svc.create('ord_1', write(), actor, NOW)).rejects.toMatchObject({
			response: { issues: [{ code: 'nothing_due' }] },
		});
		await expect(harness().svc.create('ord_1', write({ amountINR: 99_000 }), actor, NOW)).rejects.toMatchObject({
			response: { issues: [{ code: 'more_than_due' }] },
		});
		await expect(harness().svc.create('ord_1', write({ currency: 'usd' }), actor, NOW)).rejects.toBeInstanceOf(
			ConflictException,
		);
		const unreachable = order({ buyer: { kind: 'person', name: 'Ananya Das' } });
		await expect(harness({ order: unreachable }).svc.create('ord_1', write(), actor, NOW)).rejects.toBeInstanceOf(
			ConflictException,
		);
	});

	it('makes a request with no link of ours when the shop’s address is unknown, by an unknown staff member', async () => {
		const { svc, saved } = harness({ shopOrigin: null });
		const request = await svc.create('ord_1', write(), actor, NOW);
		expect(request).toMatchObject({
			ourUrl: null,
			createdBy: 'unknown',
			sentTo: { email: 'ananya@example.test', mobile: null },
		});
		expect(saved.map((row) => row.id)).toEqual([request.id]);
	});

	it('can’t check a request the gateway never took', async () => {
		const request = {
			id: 'req_1',
			orderId: 'ord_1',
			gateway: 'ccavenue',
			gatewayRequestId: null,
			status: 'active',
			expiresAt: '2026-12-01T00:00:00.000Z',
		} as never;
		await expect(
			harness({ requests: [request] }).svc.check('ord_1', 'req_1', { id: 'adm_1', name: null }, NOW),
		).rejects.toBeInstanceOf(ConflictException);
	});
});
