import type { Order } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { harness, makeOrder } from './shop-payments-harness';

const NOW = new Date('2026-11-20T10:00:00.000Z');
const LATER = new Date('2026-11-20T10:30:00.000Z');

describe('shop payments (OD1 hold, shop04/shop05 popups, decidePaymentResult)', () => {
	it('starts one attempt per press, named after the order, and answers a double press with the same hand-off', async () => {
		const h = harness();
		const order = h.orders.get('ord_1') as Order;
		const first = await h.service.start(order, 'en', NOW);
		expect(first).toMatchObject({
			id: 'ST2611482190-1',
			gateway: 'ccavenue',
			amountMinor: 2_000_000,
			state: 'pending',
		});
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
		expect(h.payments[0]).toMatchObject({
			method: 'gateway',
			reference: '313012345678',
			receiptNumber: 'RC/26-27/000001',
		});
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
		const h = harness({
			order: makeOrder({ currency: 'USD', billingCountry: 'IN' }),
			status: { state: 'pending' },
		});
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
		const stranger = {
			userId: 'cus_2',
			sessionId: 's',
			audience: 'storefront',
			role: null,
			permissions: [],
		} as never;
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
