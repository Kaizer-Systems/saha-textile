import { ConflictException } from '@nestjs/common';
import { Order, type OrderPayment, type PaymentAttempt } from '@saha-textile/contracts';
import type { PaymentReport } from '@saha-textile/core-domain';

import { ShopPaymentsService } from '../src/shop-checkout/shop-payments.service';

/** The shop payments service over in-memory stores (shared by its tests). */

export function makeOrder(
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

export interface Options {
	order?: Order;
	status?: Partial<PaymentReport> | null;
	soldOut?: string[];
	verified?: boolean;
	/** The books posting service, passed last (Postings and Convert brief P1). */
	books?: unknown;
	/** Replaces the gateways ({ inr, paypal }) built here; a function receives the built ones. */
	gateways?: (built: { inr: unknown; paypal: unknown }) => unknown;
	config?: unknown;
	/** What PayPal's invoice webhook finds among our payment requests. */
	request?: unknown;
	/** Reading this order fails (a database blip). */
	failGet?: string;
	/** Saving an order fails (another save came first). */
	updateFails?: boolean;
	/** Free when checked, sold the moment the pieces are kept (a race), or keeping fails outright. */
	race?: 'soldOut' | 'error';
	/** Settling returns the order with no balance. */
	noBalanceAfter?: boolean;
	/** The shopper has no bag. */
	noCart?: boolean;
	/** Recording a coupon's use fails with this. */
	couponFails?: unknown;
}

export function harness(options: Options = {}) {
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
		checked: [] as unknown[],
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
			if (options.updateFails) throw new Error('stale');
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
		get: async (id: string) => {
			if (options.failGet === id) throw new Error('db down');
			return orders.get(id) as Order;
		},
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
					balance: options.noBalanceAfter
						? undefined
						: {
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
			if (options.race === 'soldOut') throw new ConflictException('out_of_stock');
			if (options.race === 'error') throw new Error('db down');
			if (options.soldOut?.length) throw new ConflictException('out_of_stock');
		},
		release: async () => {
			calls.release += 1;
		},
		unavailableLines: async () =>
			options.race === 'soldOut' && calls.reserve > 0 ? ['l1'] : (options.soldOut ?? []),
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
		{ check: async (...args: unknown[]) => void calls.checked.push(args) } as never,
		{ listEnabled: async () => [{ code: 'INR' }, { code: 'USD' }, { code: 'EUR' }, { code: 'GBP' }] } as never,
		(options.config ?? {
			payments: { ccavenue: { returnUrl: 'https://api.test/payments/ccavenue/return' } },
			media: { shopOrigin: 'https://shop.test' },
		}) as never,
		(options.gateways ? options.gateways({ inr: ccavenue, paypal }) : { inr: ccavenue, paypal }) as never,
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
		{ findByGatewayRequestId: async () => options.request ?? null } as never,
		{
			findByUserId: async () => (options.noCart ? null : cart),
			save: async (next: typeof cart) => Object.assign(cart, next),
		} as never,
		{
			recordUse: async () => {
				if (options.couponFails) throw options.couponFails;
				calls.uses += 1;
			},
		} as never,
		{ getSettings: async () => null } as never,
		{ withTransaction: async <T>(work: (context: object) => Promise<T>) => work({}) } as never,
		{ send: async (_order: Order, templates: string[]) => void calls.told.push(...templates) } as never,
		(options.books ?? null) as never,
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
