import { ConflictException } from '@nestjs/common';
import { Order, type OrderPayment, type PaymentAttempt } from '@saha-textile/contracts';
import type { PaymentReport } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { ShopPaymentsService } from '../src/shop-checkout/shop-payments.service';

const NOW = new Date('2026-11-20T10:00:00.000Z');
const LATER = new Date('2026-11-20T10:30:00.000Z');

function makeOrder(over: { billingCountry?: string; currency?: string; held?: boolean; holdUntil?: string | null } = {}) {
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
			billing: { fullName: 'Ananya Das', line1: '1 Road', city: 'X', postalCode: '1', country, countryCode: country },
			delivery: { fullName: 'Ananya Das', line1: '1 Road', city: 'X', postalCode: '1', country, countryCode: country },
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
	const cart = { id: 'cart_1', userId: 'cus_1', lines: [{ id: 'c1', productId: 'p1', variationId: null }, { id: 'c2', productId: 'p9', variationId: null }] };
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
			const paid = payments.filter((row) => row.state === 'received').reduce((sum, row) => sum + row.amountINR, 0);
			const placed = order.status === 'awaiting_payment' && paid >= order.totalINR;
			return orderRepo.update(
				{
					...order,
					status: placed ? 'placed' : order.status,
					balance: { ...(order.balance as NonNullable<Order['balance']>), paidINR: paid, paidAheadINR: Math.max(0, paid - order.totalINR) },
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
			handoff: { kind: 'form-post' as const, url: 'https://test.ccavenue.com/pay', fields: { encRequest: 'x', access_code: 'y' } },
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
			return { outcome: 'accepted' as const, refundReference: input.refundReference, refusalReason: null, refusalCode: null, auditRecord: {} };
		},
		fetchRefunds: async () => [],
	};
	const paypal = {
		...ccavenue,
		gateway: 'paypal' as const,
		createPayment: async (input: { attemptId: string }) => ({
			attemptId: input.attemptId,
			handoff: { kind: 'redirect' as const, url: 'https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T' },
			auditRecord: { paypal_order_id: '5O190127TN364715T' },
		}),
		fetchPaymentStatus: async (query: { attemptId: string; gatewayReference?: string | null }) => {
			const attempt = attempts.get(query.attemptId);
			if (!attempt || query.gatewayReference !== '5O190127TN364715T') return null;
			return {
				...report(attempt),
				gateway: 'paypal' as const,
				gatewayReference: '3C679366HH908993F',
				receivable: { grossAmount: 240, grossCurrency: 'USD', fee: 10.86, net: 229.14, receivableINR: 21_100.5, exchangeRate: { sourceCurrency: 'USD', targetCurrency: 'INR', value: 92.08 } },
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
				[...attempts.values()].filter((row) => row.state === 'pending' && row.nextCheckAt && new Date(row.nextCheckAt) <= now),
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

describe('shop payments (OD1 hold, shop04/shop05 popups, decidePaymentResult)', () => {
	it('starts one attempt per press, named after the order, and answers a double press with the same hand-off', async () => {
		const h = harness();
		const order = h.orders.get('ord_1') as Order;
		const first = await h.service.start(order, 'en', NOW);
		expect(first).toMatchObject({ id: 'ST2611482190-1', gateway: 'ccavenue', amountMinor: 2_000_000, state: 'pending' });
		expect(first.handoff?.kind).toBe('form-post');
		const again = await h.service.start(order, 'en', new Date(NOW.getTime() + 20_000));
		expect(again.id).toBe('ST2611482190-1');
		const later = await h.service.start(order, 'en', new Date(NOW.getTime() + 120_000));
		expect(later.id).toBe('ST2611482190-2');
	});

	it('paid within the hold: records the payment once with a receipt, places the order, empties those pieces from the bag', async () => {
		const h = harness();
		const attempt = await h.service.start(h.orders.get('ord_1') as Order, 'en', NOW);
		await h.service.ccavenueReturn({ attemptId: attempt.id }, new Date('2026-11-20T10:05:00.000Z'));
		await h.service.ccavenueReturn({ attemptId: attempt.id }, new Date('2026-11-20T10:06:00.000Z'));
		expect(h.payments).toHaveLength(1);
		expect(h.payments[0]).toMatchObject({ method: 'gateway', reference: '313012345678', receiptNumber: 'RC/26-27/000001' });
		const order = h.orders.get('ord_1') as Order;
		expect(order.status).toBe('placed');
		expect(order.holdUntil).toBeNull();
		expect(h.cart.lines.map((line) => line.productId)).toEqual(['p9']);
		expect(h.attempts.get(attempt.id)?.state).toBe('captured');
		// Order confirmed goes once, for the move that placed it; the repeated return tells nothing.
		expect(h.calls.told).toEqual(['awaiting_payment→placed']);
	});

	it('failed: lets the hold go at once; a card refused as foreign for a buyer billed abroad gets shop05', async () => {
		const h = harness({
			order: makeOrder({ billingCountry: 'DE' }),
			status: { state: 'failed', failureReason: 'International cards are not enabled for this merchant' },
		});
		const attempt = await h.service.start(h.orders.get('ord_1') as Order, 'en', NOW);
		await h.service.ccavenueReturn({ attemptId: attempt.id }, NOW);
		expect(h.calls.release).toBe(1);
		const order = h.orders.get('ord_1') as Order;
		expect(order.lines.every((line) => !line.held)).toBe(true);
		expect(order.holdUntil).toBeNull();
		const outcome = await h.service.outcomeFor(attempt.id, h.shopper);
		expect(outcome).toMatchObject({ result: 'failed', popup: 'switchToRegionCurrency', firstCurrency: 'EUR' });
		expect(h.calls.told).toEqual(['payment_not_completed']);
	});

	it('paid after the hold ended for a piece sold meanwhile: refunded in full, order cancelled, sold lines named', async () => {
		const h = harness({ order: makeOrder({ held: false, holdUntil: null }), soldOut: ['l1'] });
		const attempt = await h.service.start(h.orders.get('ord_1') as Order, 'en', NOW);
		await h.service.ccavenueReturn({ attemptId: attempt.id }, LATER);
		expect(h.calls.refunds).toEqual(['RST26114821901']);
		expect(h.payments[0]?.state).toBe('refunded');
		expect(h.orders.get('ord_1')?.status).toBe('cancelled');
		const outcome = await h.service.outcomeFor(attempt.id, h.shopper);
		expect(outcome).toMatchObject({ result: 'refunded', soldOutLineIds: ['l1'] });
		expect(h.calls.told).toEqual(['order_refunded_sold_out']);
	});

	it('paid after the hold ended with every piece still free: kept again and placed', async () => {
		const h = harness({ order: makeOrder({ held: false, holdUntil: null }) });
		const attempt = await h.service.start(h.orders.get('ord_1') as Order, 'en', NOW);
		await h.service.ccavenueReturn({ attemptId: attempt.id }, LATER);
		expect(h.calls.reserve).toBe(1);
		expect(h.orders.get('ord_1')?.status).toBe('placed');
		expect(h.orders.get('ord_1')?.lines[0]?.held).toBe(true);
	});

	it('an answer that doesn’t add up changes nothing, flags the order and keeps asking', async () => {
		const h = harness({ status: { amountMinor: 100 } });
		const attempt = await h.service.start(h.orders.get('ord_1') as Order, 'en', NOW);
		const after = await h.service.settle(attempt, undefined, NOW);
		expect(after).toMatchObject({ state: 'pending', reviewReason: 'amount-mismatch' });
		expect(after.nextCheckAt).not.toBeNull();
		expect(h.payments).toHaveLength(0);
		expect(h.calls.flags).toContain('amount-mismatch');
		expect(h.orders.get('ord_1')?.status).toBe('awaiting_payment');
	});

	it('PayPal: an unverified webhook is refused; a verified approval captures and keeps PayPal’s own rate', async () => {
		const usd = makeOrder({ currency: 'USD', billingCountry: 'GB' });
		const refused = harness({ order: usd });
		expect(await refused.service.paypalWebhook({}, '{}')).toBe('unverified');

		const h = harness({ order: usd, verified: true });
		const attempt = await h.service.start(h.orders.get('ord_1') as Order, 'en', NOW);
		expect(attempt).toMatchObject({ gateway: 'paypal', gatewayOrderId: '5O190127TN364715T', amountMinor: 24_000 });
		const body = JSON.stringify({
			event_type: 'CHECKOUT.ORDER.APPROVED',
			resource: { id: '5O190127TN364715T', purchase_units: [{ custom_id: attempt.id }] },
		});
		expect(await h.service.paypalWebhook({}, body, new Date('2026-11-20T10:03:00.000Z'))).toBe('handled');
		expect(h.payments[0]?.paypal).toMatchObject({ receivableINR: 21_100.5, exchangeRate: { value: 92.08 } });
		expect(h.orders.get('ord_1')?.status).toBe('placed');
	});

	it('Cancel at PayPal: the hold goes at once and the shopper is asked to choose a currency, ₹ first in India', async () => {
		const h = harness({ order: makeOrder({ currency: 'USD', billingCountry: 'IN' }), status: { state: 'pending' } });
		const attempt = await h.service.start(h.orders.get('ord_1') as Order, 'en', NOW);
		const outcome = await h.service.confirm(attempt.id, { cancelled: true }, h.shopper, NOW);
		expect(outcome).toMatchObject({ result: 'cancelled', popup: 'chooseCurrency', firstCurrency: 'INR' });
		expect(h.calls.release).toBe(1);
		// The shopper pressed Cancel and saw the currency choice: no "didn't go through" email.
		expect(h.calls.told).toEqual([]);
	});

	it('someone else’s payment reads as missing', async () => {
		const h = harness();
		const attempt = await h.service.start(h.orders.get('ord_1') as Order, 'en', NOW);
		const stranger = { userId: 'cus_2', sessionId: 's', audience: 'storefront', role: null, permissions: [] } as never;
		await expect(h.service.outcomeFor(attempt.id, stranger)).rejects.toThrow();
	});

	it('the sweep asks once more, then lets go of a hold whose 15 minutes ran out', async () => {
		const h = harness({ status: { state: 'pending' } });
		await h.service.start(h.orders.get('ord_1') as Order, 'en', NOW);
		const result = await h.service.sweep(new Date('2026-11-20T10:16:00.000Z'));
		expect(result.released).toBe(1);
		expect(h.calls.release).toBe(1);
		expect(h.orders.get('ord_1')?.holdUntil).toBeNull();
	});
});
