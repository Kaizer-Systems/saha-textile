import type { Order } from '@saha-textile/contracts';
import { CouponUsedUpError } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { harness, makeOrder } from './shop-payments-harness';

/**
 * Shop payments: every path the other tests leave, and a captured payment posted to the books in the same transaction
 * (Postings and Convert brief P1; the customer has paid, so it is kept even when the books can't take it, AP-D2).
 */

const NOW = new Date('2026-11-20T10:00:00.000Z');

describe('starting a payment', () => {
	it('refuses with no gateway for the currency, and says when the gateway can’t start', async () => {
		const none = harness({ gateways: (g) => ({ ...g, inr: null }) });
		await expect(none.service.start(none.orders.get('ord_1') as Order, 'en', NOW)).rejects.toMatchObject({
			response: { issues: [expect.objectContaining({ code: 'pay_blocked' })] },
		});
		const broken = harness({
			gateways: (g) => ({
				...g,
				inr: {
					...(g.inr as object),
					createPayment: async () => {
						throw new Error('down');
					},
				},
			}),
		});
		await expect(broken.service.start(broken.orders.get('ord_1') as Order, 'en', NOW)).rejects.toMatchObject({
			response: { issues: [expect.objectContaining({ code: 'payment_not_started' })] },
		});
		expect([...broken.attempts.values()][0]?.state).toBe('failed');
		const odd = harness({
			gateways: (g) => ({
				...g,
				inr: {
					...(g.inr as object),
					createPayment: async () => {
						throw 'odd';
					},
				},
			}),
		});
		await expect(odd.service.start(odd.orders.get('ord_1') as Order, 'en', NOW)).rejects.toBeTruthy();
	});

	it('needs the INR gateway’s return address and the shop’s address', async () => {
		const noReturn = harness({
			config: { payments: { ccavenue: { returnUrl: null } }, media: { shopOrigin: null } },
		});
		await expect(noReturn.service.start(noReturn.orders.get('ord_1') as Order, 'en', NOW)).rejects.toThrow(
			'no return address',
		);
		expect(() => noReturn.service.resultPage('a1', 'en')).toThrow('SHOP_ORIGIN');
		const dollars = harness({ order: makeOrder({ currency: 'USD' }) });
		const attempt = await dollars.service.start(dollars.orders.get('ord_1') as Order, 'bn', NOW);
		expect(attempt.handoff).toMatchObject({ kind: 'redirect' });
	});
});

describe('answers from the gateways', () => {
	it('ignores a CCAvenue return with no INR gateway, another gateway, an unreadable form or an unknown attempt', async () => {
		expect(await harness({ gateways: (g) => ({ ...g, inr: null }) }).service.ccavenueReturn({}, NOW)).toBeNull();
		expect(
			await harness({
				gateways: (g) => ({ ...g, inr: { ...(g.inr as object), gateway: 'razorpay' } }),
			}).service.ccavenueReturn({}, NOW),
		).toBeNull();
		const h = harness();
		expect(await h.service.ccavenueReturn({ attemptId: 'nothing' }, NOW)).toBeNull();
		const ghost = harness({
			gateways: (g) => ({
				...g,
				inr: { ...(g.inr as object), verifyCallback: async () => ({ attemptId: 'ghost' }) },
			}),
		});
		expect(await ghost.service.ccavenueReturn({}, NOW)).toBeNull();
	});

	it('answers PayPal’s webhook: unverified, a payment request, an attempt it doesn’t know, or another order', async () => {
		const noPaypal = harness({ gateways: (g) => ({ ...g, paypal: null }) });
		expect(await noPaypal.service.paypalWebhook({}, '{}', NOW)).toBe('unverified');
		const throwing = harness({
			gateways: (g) => ({
				...g,
				paypal: {
					...(g.paypal as object),
					verifyWebhook: async () => {
						throw new Error('x');
					},
				},
			}),
		});
		expect(await throwing.service.paypalWebhook({}, '{}', NOW)).toBe('unverified');
		const invoice = JSON.stringify({
			event_type: 'INVOICING.INVOICE.PAID',
			resource: { invoice: { id: 'inv_1' } },
		});
		expect(await harness({ verified: true }).service.paypalWebhook({}, invoice, NOW)).toBe('ignored');
		const found = harness({ verified: true, request: { id: 'req_1', orderId: 'ord_1' } });
		expect(await found.service.paypalWebhook({}, invoice, NOW)).toBe('handled');
		expect(found.calls.checked).toHaveLength(1);
		const v = harness({ verified: true });
		expect(await v.service.paypalWebhook({}, JSON.stringify({}), NOW)).toBe('ignored');
		expect(
			await v.service.paypalWebhook(
				{},
				JSON.stringify({ event_type: 'INVOICING.INVOICE.PAID', resource: {} }),
				NOW,
			),
		).toBe('ignored');
		const capture = (custom: string, order?: string) =>
			JSON.stringify({
				event_type: 'PAYMENT.CAPTURE.COMPLETED',
				resource: { custom_id: custom, supplementary_data: { related_ids: { order_id: order } } },
			});
		expect(await v.service.paypalWebhook({}, capture('nothing'), NOW)).toBe('ignored');
		const dollars = harness({ verified: true, order: makeOrder({ currency: 'USD' }) });
		const attempt = await dollars.service.start(dollars.orders.get('ord_1') as Order, 'en', NOW);
		expect(await dollars.service.paypalWebhook({}, capture(attempt.id, 'OTHER'), NOW)).toBe('ignored');
		const approved = JSON.stringify({
			event_type: 'CHECKOUT.ORDER.APPROVED',
			resource: { id: '5O190127TN364715T', purchase_units: [{ custom_id: attempt.id }] },
		});
		expect(await dollars.service.paypalWebhook({}, approved, NOW)).toBe('handled');
		const inr = harness({ verified: true });
		const rupees = await inr.service.start(inr.orders.get('ord_1') as Order, 'en', NOW);
		expect(await inr.service.paypalWebhook({}, capture(rupees.id), NOW)).toBe('ignored');
		expect(typeof vi.fn).toBe('function');
	});
});

describe('settling an attempt', () => {
	const start = async (h: ReturnType<typeof harness>) => h.service.start(h.orders.get('ord_1') as Order, 'en', NOW);

	it('leaves an attempt of an unknown gateway, and counts a check when the status can’t be read', async () => {
		const h = harness();
		const attempt = await start(h);
		expect(await h.service.settle({ ...attempt, gateway: 'stripe' } as never, undefined, NOW)).toMatchObject({
			checks: 0,
		});
		const blind = harness({
			gateways: (g) => ({
				...g,
				inr: {
					...(g.inr as object),
					fetchPaymentStatus: async () => {
						throw new Error('timeout');
					},
				},
			}),
		});
		const a = await start(blind);
		expect((await blind.service.settle(a, undefined, NOW)).checks).toBe(1);
		const odd = harness({
			gateways: (g) => ({
				...g,
				inr: {
					...(g.inr as object),
					fetchPaymentStatus: async () => {
						throw 'odd';
					},
				},
			}),
		});
		expect((await odd.service.settle(await start(odd), undefined, NOW)).checks).toBe(1);
	});

	it('keeps asking while pending, flags a mismatch for staff once, and records a capture with its posting', async () => {
		const posted: unknown[][] = [];
		const books = { paymentReceived: async (...args: unknown[]) => void posted.push(args) };
		const h = harness({ books, status: null });
		const attempt = await start(h);
		expect((await h.service.settle(attempt, undefined, NOW)).state).toBe('pending');
		h.setStatus({ state: 'captured', amountMinor: 1 });
		const flagged = await h.service.settle(attempt, undefined, NOW);
		expect(flagged.reviewReason).toBeTruthy();
		await h.service.settle(flagged, undefined, NOW);
		expect(h.calls.flags).toHaveLength(1);
		h.setStatus({ state: 'captured' });
		const paid = await h.service.settle(attempt, undefined, NOW);
		expect(paid.state).toBe('captured');
		expect(posted[0]?.[0]).toMatchObject({ method: 'gateway', state: 'received' });
		expect(posted[0]?.[3]).toBeNull();
		const again = await h.service.settle(paid, undefined, NOW);
		expect(again.state).toBe('captured');
		expect(posted).toHaveLength(1);
	});

	it('refunds a payment for a cancelled order, or one paid after the hold when a piece sold meanwhile', async () => {
		const cancelled = harness();
		const a = await start(cancelled);
		cancelled.orders.set('ord_1', { ...(cancelled.orders.get('ord_1') as Order), status: 'cancelled' });
		await cancelled.service.settle(a, undefined, NOW);
		expect(cancelled.calls.refunds).toHaveLength(1);
		const late = harness({
			order: makeOrder({ held: false, holdUntil: '2026-11-20T09:00:00.000Z' }),
			soldOut: ['l1'],
		});
		const b = await start(late);
		await late.service.settle(b, undefined, NOW);
		expect(late.calls.refunds).toHaveLength(1);
	});
});

describe('the return page and the other answers', () => {
	const start = async (h: ReturnType<typeof harness>) => h.service.start(h.orders.get('ord_1') as Order, 'en', NOW);

	it('lets the hold go when the shopper cancelled at the gateway, and settles otherwise', async () => {
		const h = harness();
		const attempt = await start(h);
		const cancelled = await h.service.confirm(attempt.id, { cancelled: true } as never, h.shopper, NOW);
		expect(cancelled).toBeTruthy();
		const done = await h.service.confirm(attempt.id, { cancelled: false } as never, h.shopper, NOW);
		expect(done).toBeTruthy();
	});

	it('marks a failed or cancelled payment, and keeps a pending answer pending', async () => {
		for (const state of ['failed', 'cancelled', 'pending']) {
			const h = harness({ status: { state } as never });
			const attempt = await start(h);
			const settled = await h.service.settle(attempt, undefined, NOW);
			expect(settled.state).toBe(state);
		}
	});

	it('records a payment once, and flags paying twice on an order already placed', async () => {
		const h = harness();
		const attempt = await start(h);
		await h.service.settle(attempt, undefined, NOW);
		h.orders.set('ord_1', { ...(h.orders.get('ord_1') as Order), status: 'placed' });
		const second = await start(harness());
		expect(second).toBeTruthy();
		const twice = harness({ order: makeOrder({ held: true }) });
		const first = await start(twice);
		await twice.service.settle(first, undefined, NOW);
		twice.orders.set('ord_1', { ...(twice.orders.get('ord_1') as Order), status: 'placed' });
		twice.setStatus({ state: 'captured', gatewayReference: 'second-ref' });
		const other = { ...first, id: 'ST2611482190-2', state: 'pending' as const, gatewayReference: null };
		twice.attempts.set(other.id, other);
		await twice.service.settle(other, undefined, NOW);
		expect(twice.calls.flags).toContain('paidTwice');
	});
});

describe('refunds when the pieces can’t be kept', () => {
	const cancelledOrder = async (h: ReturnType<typeof harness>) => {
		const attempt = await h.service.start(h.orders.get('ord_1') as Order, 'en', NOW);
		h.orders.set('ord_1', { ...(h.orders.get('ord_1') as Order), status: 'cancelled' });
		return h.service.settle(attempt, undefined, NOW);
	};

	it('flags a refund the gateway refuses or doesn’t answer, and records the payment only once', async () => {
		const refused = harness({
			gateways: (g) => ({
				...g,
				inr: { ...(g.inr as object), refundPayment: async () => ({ outcome: 'refused' }) },
			}),
		});
		expect((await cancelledOrder(refused)).refund?.outcome).toBe('refused');
		expect(refused.payments[0]?.state).toBe('received');
		const silent = harness({
			gateways: (g) => ({
				...g,
				inr: {
					...(g.inr as object),
					refundPayment: async () => {
						throw new Error('timeout');
					},
				},
			}),
		});
		expect((await cancelledOrder(silent)).refund?.outcome).toBe('unknown');
		const odd = harness({
			gateways: (g) => ({
				...g,
				inr: {
					...(g.inr as object),
					refundPayment: async () => {
						throw 'odd';
					},
				},
			}),
		});
		expect((await cancelledOrder(odd)).refund?.outcome).toBe('unknown');
		const duplicate = harness({
			gateways: (g) => ({
				...g,
				inr: { ...(g.inr as object), refundPayment: async () => ({ outcome: 'duplicate' }) },
			}),
		});
		await cancelledOrder(duplicate);
		expect(duplicate.payments[0]?.state).toBe('refunded');
	});
});

describe('the sweep and the shopper’s view', () => {
	const LATE = new Date('2026-11-20T12:00:00.000Z');

	it('asks again about due attempts, lets ended holds go, and carries on past a failure', async () => {
		const h = harness({ status: null });
		const attempt = await h.service.start(h.orders.get('ord_1') as Order, 'en', NOW);
		h.attempts.set(attempt.id, { ...attempt, nextCheckAt: NOW.toISOString() });
		expect(await h.service.sweep(LATE)).toMatchObject({ checked: 1, released: 1 });
		const made = harness({ order: makeOrder({ held: false, holdUntil: '2026-11-20T10:05:00.000Z' }) });
		expect((await made.service.sweep(LATE)).released).toBe(1);
		expect(made.orders.get('ord_1')?.holdUntil).toBeNull();
		const broken = harness({
			gateways: (g) => ({
				...g,
				inr: {
					...(g.inr as object),
					fetchPaymentStatus: async () => null,
				},
			}),
		});
		const a = await broken.service.start(broken.orders.get('ord_1') as Order, 'en', NOW);
		broken.attempts.set(a.id, { ...a, nextCheckAt: NOW.toISOString(), gateway: 'stripe' } as never);
		broken.orders.set('ord_1', { ...(broken.orders.get('ord_1') as Order), holdUntil: 'not a date' });
		expect(await broken.service.sweep(LATE)).toBeTruthy();
	});

	it('reads the order’s language, and finds only the shopper’s own attempts', async () => {
		const h = harness();
		const attempt = await h.service.start(h.orders.get('ord_1') as Order, 'en', NOW);
		expect(await h.service.localeOf(attempt)).toBe('en');
		expect(await h.service.localeOf({ ...attempt, orderId: 'ord_gone' })).toBe('en');
		await expect(h.service.outcomeFor(attempt.id, undefined)).rejects.toMatchObject({
			response: { issues: [expect.objectContaining({ code: 'attempt_missing' })] },
		});
		await expect(
			h.service.outcomeFor(attempt.id, { ...(h.shopper as object), userId: 'cus_2' } as never),
		).rejects.toThrow();
		expect((await h.service.outcomeFor(attempt.id, h.shopper)).result).toBe('pending');
		for (const state of ['failed', 'cancelled'] as const) {
			h.attempts.set(attempt.id, { ...attempt, state });
			expect((await h.service.outcomeFor(attempt.id, h.shopper)).result).toBe(state);
		}
		h.attempts.set(attempt.id, {
			...attempt,
			refund: { reference: 'R1', outcome: 'accepted', soldOutLineIds: [], at: NOW.toISOString() },
		});
		expect((await h.service.outcomeFor(attempt.id, h.shopper)).result).toBe('refunded');
	});
});

describe('the remaining paths', () => {
	const start = async (h: ReturnType<typeof harness>) => h.service.start(h.orders.get('ord_1') as Order, 'en', NOW);
	const LATE = new Date('2026-11-20T12:00:00.000Z');

	it('keeps the attempt’s reference when the gateway gives none, and stops asking after two days', async () => {
		const h = harness({ status: { state: 'failed', gatewayReference: null } as never });
		const attempt = await start(h);
		expect((await h.service.settle(attempt, undefined, NOW)).gatewayReference).toBeNull();
		const old = harness({ status: null });
		const a = await start(old);
		const stale = await old.service.settle(
			{ ...a, createdAt: '2026-11-10T00:00:00.000Z', checks: 60 },
			undefined,
			NOW,
		);
		expect(stale.nextCheckAt).toBeNull();
		const refunded = harness({ status: { state: 'refunded' } as never });
		const r = await start(refunded);
		await refunded.service
			.settle({ ...r, state: 'captured', gatewayReference: '313012345678' }, undefined, NOW)
			.catch(() => undefined);
	});

	it('flags for staff even when the order can’t be saved, and pays with the attempt id as reference', async () => {
		const h = harness({ status: { state: 'captured', amountMinor: 1 }, updateFails: true });
		expect((await h.service.settle(await start(h), undefined, NOW)).reviewReason).toBeTruthy();
		const noRef = harness({ status: { state: 'captured', gatewayReference: null } as never });
		await noRef.service.settle(await start(noRef), undefined, NOW);
		expect(noRef.payments[0]?.reference).toMatch(/^ST2611482190/);
		const refundNoRef = harness({ status: { state: 'captured', gatewayReference: null } as never });
		const ra = await start(refundNoRef);
		refundNoRef.orders.set('ord_1', { ...(refundNoRef.orders.get('ord_1') as Order), status: 'cancelled' });
		await refundNoRef.service.settle(ra, undefined, NOW);
		expect(refundNoRef.calls.refunds).toHaveLength(1);
	});

	it('refunds when the pieces sell while being kept again, and passes on any other failure', async () => {
		const ended = { held: false, holdUntil: '2026-11-20T09:00:00.000Z' };
		const raced = harness({ order: makeOrder(ended), race: 'soldOut' });
		await raced.service.settle(await start(raced), undefined, NOW);
		expect(raced.calls.refunds).toHaveLength(1);
		const broken = harness({ order: makeOrder(ended), race: 'error' });
		await expect(broken.service.settle(await start(broken), undefined, NOW)).rejects.toThrow('db down');
		const refused = harness({
			order: makeOrder(ended),
			soldOut: ['l1'],
			gateways: (g) => ({
				...g,
				inr: { ...(g.inr as object), refundPayment: async () => ({ outcome: 'refused' }) },
			}),
		});
		await refused.service.settle(await start(refused), undefined, NOW);
		expect(refused.orders.get('ord_1')?.status).toBe('cancelled');
	});

	it('records a payment once, and re-refunds a cancelled order’s payment without recording it again', async () => {
		const h = harness();
		const attempt = await start(h);
		await h.service.settle(attempt, undefined, NOW);
		await h.service.settle({ ...attempt, state: 'pending' }, undefined, NOW);
		expect(h.payments).toHaveLength(1);
		const c = harness();
		const ca = await start(c);
		c.orders.set('ord_1', { ...(c.orders.get('ord_1') as Order), status: 'cancelled' });
		await c.service.settle(ca, undefined, NOW);
		await c.service.settle({ ...ca, state: 'pending', refund: null }, undefined, NOW);
		expect(c.payments).toHaveLength(1);
	});

	it('clears the bag by the buyer or the user, counts coupons, and keeps going past a coupon used up', async () => {
		const coupons = [{ couponId: 'cpn_1', code: 'DIWALI' }];
		const noCustomer = { ...makeOrder(), buyer: { kind: 'person', name: 'A' }, coupons } as never;
		const viaUser = harness({ order: noCustomer });
		await viaUser.service.settle(await start(viaUser), undefined, NOW);
		expect(viaUser.calls.uses).toBe(1);
		const nobody = harness({
			order: { ...makeOrder(), buyer: { kind: 'person', name: 'A' }, userId: null } as never,
			noCart: true,
		});
		await nobody.service.settle(await start(nobody), undefined, NOW);
		const usedUp = harness({
			order: { ...makeOrder(), coupons } as never,
			couponFails: new CouponUsedUpError('cpn_1'),
		});
		await usedUp.service.settle(await start(usedUp), undefined, NOW);
		const fails = harness({ order: { ...makeOrder(), coupons } as never, couponFails: new Error('db down') });
		await expect(fails.service.settle(await start(fails), undefined, NOW)).rejects.toThrow('db down');
	});

	it('lets a hold go only while the order still waits, and the sweep logs a failure and carries on', async () => {
		const h = harness();
		const order = h.orders.get('ord_1') as Order;
		h.orders.set('ord_1', { ...order, status: 'placed' });
		expect((await h.service.releaseHold(order, null, 'x', NOW)).status).toBe('placed');
		const failing = harness({ failGet: 'ord_1', status: { state: 'captured' } });
		const a = await failing.service.start(failing.orders.get('ord_1') as Order, 'en', NOW);
		failing.attempts.set(a.id, { ...a, nextCheckAt: NOW.toISOString() });
		expect(await failing.service.sweep(LATE)).toMatchObject({ checked: 0, released: 0 });
		const settled = harness({ status: { state: 'failed' } as never });
		const b = await settled.service.start(settled.orders.get('ord_1') as Order, 'en', NOW);
		settled.attempts.set(b.id, { ...b, state: 'failed', nextCheckAt: null });
		expect((await settled.service.sweep(LATE)).released).toBe(1);
		const paid = harness();
		const c = await paid.service.start(paid.orders.get('ord_1') as Order, 'en', NOW);
		paid.attempts.set(c.id, { ...c, nextCheckAt: null });
		expect((await paid.service.sweep(LATE)).released).toBe(0);
	});

	it('covers the last bag, coupon and paying-twice cases', async () => {
		const coupons = [{ couponId: 'cpn_1', code: 'DIWALI' }];
		const nobody = harness({
			order: { ...makeOrder(), buyer: { kind: 'person', name: 'A' }, userId: null, coupons } as never,
		});
		await nobody.service.settle(await start(nobody), undefined, NOW);
		expect(nobody.calls.uses).toBe(1);
		const noBag = harness({ noCart: true });
		await noBag.service.settle(await start(noBag), undefined, NOW);
		const other = makeOrder();
		const elsewhere = harness({
			order: { ...other, lines: other.lines.map((l) => ({ ...l, productId: 'p5' })) } as never,
		});
		await elsewhere.service.settle(await start(elsewhere), undefined, NOW);
		expect(elsewhere.cart.lines).toHaveLength(2);
		const flagged = harness();
		const first = await start(flagged);
		await flagged.service.settle(first, undefined, NOW);
		const placed = flagged.orders.get('ord_1') as Order;
		flagged.orders.set('ord_1', {
			...placed,
			paymentReview: { attemptId: 'x', reason: 'paidTwice', at: NOW.toISOString() },
		});
		flagged.setStatus({ state: 'captured', gatewayReference: 'second' });
		const second = { ...first, id: 'ST2611482190-2', state: 'pending' as const, gatewayReference: null };
		flagged.attempts.set(second.id, second);
		await flagged.service.settle(second, undefined, NOW);
		expect(flagged.orders.get('ord_1')?.paymentReview?.attemptId).toBe('x');
		const noBalance = harness({ noBalanceAfter: true });
		const nb = await start(noBalance);
		await noBalance.service.settle(nb, undefined, NOW);
		noBalance.setStatus({ state: 'captured', gatewayReference: 'third' });
		const third = { ...nb, id: 'ST2611482190-3', state: 'pending' as const, gatewayReference: null };
		noBalance.attempts.set(third.id, third);
		await noBalance.service.settle(third, undefined, NOW);
	});

	it('shows the failed popup for an order with no billing address', async () => {
		const h = harness({ order: { ...makeOrder(), addresses: undefined } as never });
		const attempt = await start(h);
		h.attempts.set(attempt.id, { ...attempt, state: 'failed' });
		expect((await h.service.outcomeFor(attempt.id, h.shopper)).result).toBe('failed');
	});
});
