import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Order, type OrderPayment, type PaymentAttempt } from '@saha-textile/contracts';
import type { PaymentReport } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { ShopPaymentsService } from '../src/shop-checkout/shop-payments.service';

const NOW = new Date('2026-11-20T10:00:00.000Z');
const LATER = new Date('2026-11-20T10:30:00.000Z');

function makeOrder(
	over: { billingCountry?: string; currency?: string; held?: boolean; holdUntil?: string | null } = {},
) {
	const country = over.billingCountry ?? 'IN';
	const held = over.held ?? true;
	return Order.parse({
		id: 'ord_1',
		orderNumber: 'ST-2611-482190',
		userId: 'cus_1',
		currency: over.currency ?? 'INR',
		locale: 'en',
		lines: [
			{
				lineId: 'l1',
				productId: 'p1',
				title: { en: 'Kanjivaram saree' },
				sku: 'SAR-1',
				quantity: 1,
				unitPriceINR: 20_000,
				unitPricePaid: 20_000,
				lineTotalINR: 20_000,
				lineTotalPaid: 20_000,
				held,
			},
		],
		subtotalINR: 20_000,
		subtotalPaid: over.currency === 'USD' ? 240 : 20_000,
		totalINR: 20_000,
		totalPaid: over.currency === 'USD' ? 240 : 20_000,
		status: 'awaiting_payment',
		channel: 'shop',
		holdUntil: over.holdUntil === undefined ? '2026-11-20T10:15:00.000Z' : over.holdUntil,
		buyer: { kind: 'person', customerId: 'cus_1', name: 'Ananya Das' },
		addresses: {
			billing: {
				fullName: 'Ananya Das',
				line1: '1 Road',
				city: 'X',
				postalCode: '1',
				country,
				countryCode: country,
			},
			delivery: {
				fullName: 'Ananya Das',
				line1: '1 Road',
				city: 'X',
				postalCode: '1',
				country,
				countryCode: country,
			},
		},
		balance: {
			goodsINR: 20_000,
			couponINR: 0,
			shippingINR: 0,
			totalINR: 20_000,
			paidINR: 0,
			dueINR: 20_000,
			paidAheadINR: 0,
		},
	});
}

interface Options {
	order?: Order;
	status?: Partial<PaymentReport> | null;
	soldOut?: string[];
	verified?: boolean;
}

function harness(options: Options = {}) {
	const orders = new Map<string, Order>([['ord_1', options.order ?? makeOrder()]]);
	const attempts = new Map<string, PaymentAttempt>();
	const payments: OrderPayment[] = [];
	const calls = {
		reserve: 0,
		release: 0,
		refunds: [] as string[],
		uses: 0,
		flags: [] as string[],
		// What the customer was told: status moves (order_confirmed) and the messages sent directly.
		told: [] as string[],
	};
	const cart = {
		id: 'cart_1',
		userId: 'cus_1',
		lines: [
			{ id: 'c1', productId: 'p1', variationId: null },
			{ id: 'c2', productId: 'p9', variationId: null },
		],
	};
	let status: Partial<PaymentReport> | null = options.status === undefined ? { state: 'captured' } : options.status;

	const orderRepo = {
		findById: async (id: string) => orders.get(id) ?? null,
		update: async (order: Order, revision: number) => {
			const current = orders.get(order.id);
			if (current && current.revision !== revision) throw new Error('stale');
			const saved = { ...order, revision: revision + 1 };
			orders.set(order.id, saved);
			if (order.paymentReview) calls.flags.push(order.paymentReview.reason);
			return saved;
		},
		listHoldsEnded: async (now: Date) =>
			[...orders.values()].filter(
				(order) => order.status === 'awaiting_payment' && order.holdUntil && new Date(order.holdUntil) <= now,
			),
	};
	const adminOrders = {
		get: async (id: string) => orders.get(id) as Order,
		tell: async (before: Order, after: Order) => void calls.told.push(`${before.status}→${after.status}`),
		told: () => [],
		settle: async (order: Order, revision: number) => {
			const paid = payments
				.filter((row) => row.state === 'received')
				.reduce((sum, row) => sum + row.amountINR, 0);
			const placed = order.status === 'awaiting_payment' && paid >= order.totalINR;
			return orderRepo.update(
				{
					...order,
					status: placed ? 'placed' : order.status,
					balance: {
						...(order.balance as NonNullable<Order['balance']>),
						paidINR: paid,
						paidAheadINR: Math.max(0, paid - order.totalINR),
					},
				},
				revision,
			);
		},
	};
	const stock = {
		reserve: async () => {
			calls.reserve += 1;
			if (options.soldOut?.length) throw new ConflictException('out_of_stock');
		},
		release: async () => {
			calls.release += 1;
		},
		unavailableLines: async () => options.soldOut ?? [],
	};
	const report = (attempt: { id: string; amountMinor: number; currency: string }): PaymentReport => ({
		gateway: 'ccavenue',
		attemptId: attempt.id,
		gatewayReference: '313012345678',
		state: 'captured',
		amountMinor: attempt.amountMinor,
		currency: attempt.currency,
		failureReason: null,
		auditRecord: {},
		...status,
	});
	const ccavenue = {
		gateway: 'ccavenue' as const,
		createPayment: async (input: { attemptId: string }) => ({
			attemptId: input.attemptId,
			handoff: {
				kind: 'form-post' as const,
				url: 'https://test.ccavenue.com/pay',
				fields: { encRequest: 'x', access_code: 'y' },
			},
			auditRecord: {},
		}),
		verifyCallback: async (form: { attemptId: string }) => {
			const attempt = attempts.get(form.attemptId);
			if (!attempt) throw new Error('unreadable');
			return report(attempt);
		},
		fetchPaymentStatus: async (query: { attemptId: string }) => {
			const attempt = attempts.get(query.attemptId);
			return status === null || !attempt ? null : report(attempt);
		},
		refundPayment: async (input: { refundReference: string }) => {
			calls.refunds.push(input.refundReference);
			return {
				outcome: 'accepted' as const,
				refundReference: input.refundReference,
				refusalReason: null,
				refusalCode: null,
				auditRecord: {},
			};
		},
		fetchRefunds: async () => [],
	};
	const paypal = {
		...ccavenue,
		gateway: 'paypal' as const,
		createPayment: async (input: { attemptId: string }) => ({
			attemptId: input.attemptId,
			handoff: {
				kind: 'redirect' as const,
				url: 'https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T',
			},
			auditRecord: { paypal_order_id: '5O190127TN364715T' },
		}),
		fetchPaymentStatus: async (query: { attemptId: string; gatewayReference?: string | null }) => {
			const attempt = attempts.get(query.attemptId);
			if (!attempt || query.gatewayReference !== '5O190127TN364715T') return null;
			return {
				...report(attempt),
				gateway: 'paypal' as const,
				gatewayReference: '3C679366HH908993F',
				receivable: {
					grossAmount: 240,
					grossCurrency: 'USD',
					fee: 10.86,
					net: 229.14,
					receivableINR: 21_100.5,
					exchangeRate: { sourceCurrency: 'USD', targetCurrency: 'INR', value: 92.08 },
				},
			};
		},
		verifyWebhook: async () => options.verified ?? false,
	};
	const service = new ShopPaymentsService(
		adminOrders as never,
		stock as never,
		{ issue: async () => 'RC/26-27/000001' } as never,
		{ check: async () => undefined } as never,
		{ listEnabled: async () => [{ code: 'INR' }, { code: 'USD' }, { code: 'EUR' }, { code: 'GBP' }] } as never,
		{
			payments: { ccavenue: { returnUrl: 'https://api.test/payments/ccavenue/return' } },
			media: { shopOrigin: 'https://shop.test' },
		} as never,
		{ inr: ccavenue, paypal } as never,
		orderRepo as never,
		{
			findById: async (id: string) => attempts.get(id) ?? null,
			listByOrder: async (orderId: string) => [...attempts.values()].filter((row) => row.orderId === orderId),
			save: async (attempt: PaymentAttempt) => {
				attempts.set(attempt.id, attempt);
				return attempt;
			},
			listDue: async (now: Date) =>
				[...attempts.values()].filter(
					(row) => row.state === 'pending' && row.nextCheckAt && new Date(row.nextCheckAt) <= now,
				),
		} as never,
		{
			findByGatewayReference: async (gateway: string, reference: string) =>
				payments.find((row) => row.gateway?.id === gateway && row.reference === reference) ?? null,
			save: async (payment: OrderPayment) => {
				const at = payments.findIndex((row) => row.id === payment.id);
				if (at >= 0) payments[at] = payment;
				else payments.push(payment);
				return payment;
			},
		} as never,
		{ findByGatewayRequestId: async () => null } as never,
		{
			findByUserId: async () => cart,
			save: async (next: typeof cart) => Object.assign(cart, next),
		} as never,
		{
			recordUse: async () => {
				calls.uses += 1;
			},
		} as never,
		{ getSettings: async () => null } as never,
		{ withTransaction: async <T>(work: (context: object) => Promise<T>) => work({}) } as never,
		{ send: async (_order: Order, templates: string[]) => void calls.told.push(...templates) } as never,
	);
	const shopper = { userId: 'cus_1', sessionId: 's', audience: 'storefront', role: null, permissions: [] } as never;
	return {
		service,
		ccavenue,
		paypal,
		orders,
		attempts,
		payments,
		calls,
		cart,
		shopper,
		setStatus: (next: Partial<PaymentReport> | null) => {
			status = next;
		},
	};
}

type Harness = ReturnType<typeof harness>;
/** Replaces one of the service's own settings or stores for a test. */
const swap = (h: Harness, field: string, value: unknown) => Object.defineProperty(h.service, field, { value });

describe('shop payments: the remaining cases', () => {
	it('refuses Pay when the currency has no gateway, and says when the INR gateway has no return address', async () => {
		const h = harness();
		swap(h, 'gateways', { inr: null, paypal: null });
		await expect(h.service.start(h.orders.get('ord_1') as Order, 'en', NOW)).rejects.toMatchObject({
			response: { issues: [{ code: 'pay_blocked' }] },
		});
		const noReturn = harness();
		swap(noReturn, 'config', {
			payments: { ccavenue: { returnUrl: null } },
			media: { shopOrigin: 'https://shop.test' },
		});
		await expect(noReturn.service.start(noReturn.orders.get('ord_1') as Order, 'en', NOW)).rejects.toBeInstanceOf(
			ServiceUnavailableException,
		);
	});

	it('marks an attempt failed when the gateway cannot start it, whatever it throws, and needs the shop address for PayPal', async () => {
		const h = harness();
		h.ccavenue.createPayment = async () => Promise.reject('not an error');
		await expect(h.service.start(h.orders.get('ord_1') as Order, 'en', NOW)).rejects.toMatchObject({
			response: { issues: [{ code: 'payment_not_started' }] },
		});
		expect([...h.attempts.values()][0]?.state).toBe('failed');
		const abroad = harness({ order: makeOrder({ currency: 'USD', billingCountry: 'GB' }) });
		swap(abroad, 'config', { payments: { ccavenue: { returnUrl: null } }, media: { shopOrigin: null } });
		await expect(abroad.service.start(abroad.orders.get('ord_1') as Order, 'en', NOW)).rejects.toBeInstanceOf(
			ServiceUnavailableException,
		);
	});

	it('ignores a CCAvenue return with no CCAvenue gateway, one it cannot read, and one for no attempt', async () => {
		const none = harness();
		swap(none, 'gateways', { inr: null, paypal: null });
		expect(await none.service.ccavenueReturn({}, NOW)).toBeNull();
		const other = harness();
		swap(other, 'gateways', { inr: { gateway: 'razorpay' }, paypal: null });
		expect(await other.service.ccavenueReturn({}, NOW)).toBeNull();
		const h = harness();
		expect(await h.service.ccavenueReturn({ attemptId: 'missing' }, NOW)).toBeNull();
		h.ccavenue.verifyCallback = async () => ({ attemptId: 'ST-none-9' }) as never;
		expect(await h.service.ccavenueReturn({}, NOW)).toBeNull();
	});

	it('answers PayPal webhooks it cannot verify, and ignores ones naming nothing of ours', async () => {
		const off = harness();
		swap(off, 'gateways', { inr: null, paypal: null });
		expect(await off.service.paypalWebhook({}, '{}', NOW)).toBe('unverified');
		const throwing = harness({ verified: true });
		throwing.paypal.verifyWebhook = async () => Promise.reject(new Error('cert'));
		expect(await throwing.service.paypalWebhook({}, '{}', NOW)).toBe('unverified');
		const h = harness({ verified: true });
		expect(await h.service.paypalWebhook({}, '{}', NOW)).toBe('ignored');
		expect(
			await h.service.paypalWebhook(
				{},
				JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { custom_id: 'missing' } }),
				NOW,
			),
		).toBe('ignored');
	});

	it('checks a paid PayPal invoice against our payment request, and ignores one we did not send', async () => {
		const h = harness({ verified: true });
		const check = vi.fn(async () => undefined);
		swap(h, 'requests', { check });
		const invoice = JSON.stringify({
			event_type: 'INVOICING.INVOICE.PAID',
			resource: { invoice: { id: 'INV2-1' } },
		});
		expect(await h.service.paypalWebhook({}, invoice, NOW)).toBe('ignored');
		swap(h, 'paymentRequests', { findByGatewayRequestId: async () => ({ id: 'preq_1', orderId: 'ord_1' }) });
		expect(await h.service.paypalWebhook({}, invoice, NOW)).toBe('handled');
		expect(check).toHaveBeenCalledWith('ord_1', 'preq_1', expect.anything(), NOW);
		const noInvoice = JSON.stringify({ event_type: 'INVOICING.INVOICE.PAID', resource: {} });
		expect(await h.service.paypalWebhook({}, noInvoice, NOW)).toBe('ignored');
	});

	it('ignores an approved PayPal order for another order id or another gateway’s attempt', async () => {
		const h = harness({ verified: true, order: makeOrder({ currency: 'USD', billingCountry: 'GB' }) });
		const attempt = await h.service.start(h.orders.get('ord_1') as Order, 'en', NOW);
		const approved = (id: string, customId: string) =>
			JSON.stringify({
				event_type: 'CHECKOUT.ORDER.APPROVED',
				resource: { id, purchase_units: [{ custom_id: customId }] },
			});
		expect(await h.service.paypalWebhook({}, approved('OTHER-ORDER', attempt.id), NOW)).toBe('ignored');
		const inr = harness({ verified: true });
		const card = await inr.service.start(inr.orders.get('ord_1') as Order, 'en', NOW);
		expect(await inr.service.paypalWebhook({}, approved('X', card.id), NOW)).toBe('ignored');
	});

	it('leaves an attempt as it is when its gateway is gone, and counts a check when the status cannot be read', async () => {
		const h = harness();
		const attempt = await h.service.start(h.orders.get('ord_1') as Order, 'en', NOW);
		const gateways = { inr: h.ccavenue, paypal: h.paypal };
		swap(h, 'gateways', { inr: null, paypal: null });
		expect(await h.service.settle(attempt, undefined, LATER)).toBe(attempt);
		swap(h, 'gateways', gateways);
		h.ccavenue.fetchPaymentStatus = async () => Promise.reject('not an error');
		expect((await h.service.settle(attempt, undefined, LATER)).checks).toBeGreaterThan(attempt.checks);
	});
});
