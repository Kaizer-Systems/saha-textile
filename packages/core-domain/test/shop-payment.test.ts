import { describe, expect, it } from 'vitest';

import {
	attemptIdFor,
	holdIsLive,
	holdUntilFrom,
	nextAttemptCheck,
	paymentPopup,
	refusedAsForeignCard,
} from '../src/orders/shop-payment';

const enabled = ['INR', 'USD', 'GBP', 'EUR'];

describe('shop payment rules (OD1, shop04, shop05)', () => {
	it('holds the pieces for 15 minutes from Pay', () => {
		const now = new Date('2026-11-20T10:00:00.000Z');
		const until = holdUntilFrom(now);
		expect(until).toBe('2026-11-20T10:15:00.000Z');
		expect(holdIsLive(until, new Date('2026-11-20T10:14:59.000Z'))).toBe(true);
		expect(holdIsLive(until, new Date('2026-11-20T10:15:00.000Z'))).toBe(false);
		expect(holdIsLive(null, now)).toBe(false);
	});

	it('names each attempt after the order number, within CCAvenue’s 30 letters and digits', () => {
		expect(attemptIdFor('ST-2611-482190', 1)).toBe('ST2611482190-1');
		expect(attemptIdFor('ST-2611-482190', 12)).toBe('ST2611482190-12');
		const long = attemptIdFor('ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789', 3);
		expect(long).toMatch(/^[A-Za-z0-9-]{1,30}$/);
		expect(long.endsWith('-3')).toBe(true);
	});

	it('asks the gateway again at 2, 5, 10, 15, 30, 60 minutes, then hourly for two days, then stops', () => {
		const start = new Date('2026-11-20T10:00:00.000Z');
		const minutesAfter = (checks: number) => {
			const next = nextAttemptCheck(start, checks);
			return next ? (next.getTime() - start.getTime()) / 60_000 : null;
		};
		expect([0, 1, 2, 3, 4, 5].map(minutesAfter)).toEqual([2, 5, 10, 15, 30, 60]);
		expect(minutesAfter(6)).toBe(120);
		expect(minutesAfter(52)).toBe(48 * 60);
		expect(minutesAfter(53)).toBeNull();
	});

	it('PayPal unfinished: choose your currency, ₹ first for buyers billed in India (shop04)', () => {
		const base = { gateway: 'paypal' as const, failureReason: null, homeCountry: 'IN', enabled };
		expect(paymentPopup({ ...base, state: 'failed', billingCountry: 'IN' })).toEqual({
			popup: 'chooseCurrency',
			firstCurrency: 'INR',
		});
		expect(paymentPopup({ ...base, state: 'cancelled', billingCountry: 'GB' })).toEqual({
			popup: 'chooseCurrency',
			firstCurrency: 'GBP',
		});
	});

	it('INR gateway refusing a card from abroad: switch to your region’s currency (shop05); other failures no popup', () => {
		const base = { gateway: 'ccavenue' as const, state: 'failed' as const, homeCountry: 'IN', enabled };
		expect(
			paymentPopup({ ...base, billingCountry: 'DE', failureReason: 'International cards are not enabled' }),
		).toEqual({ popup: 'switchToRegionCurrency', firstCurrency: 'EUR' });
		expect(paymentPopup({ ...base, billingCountry: 'DE', failureReason: 'Insufficient funds' }).popup).toBeNull();
		expect(
			paymentPopup({ ...base, billingCountry: 'IN', failureReason: 'International cards are not enabled' })
				.popup,
		).toBeNull();
		expect(
			paymentPopup({ ...base, state: 'cancelled', billingCountry: 'DE', failureReason: null }).popup,
		).toBeNull();
	});

	it('reads a foreign-card refusal loosely, and nothing else as one', () => {
		expect(refusedAsForeignCard('Foreign card transactions not allowed')).toBe(true);
		expect(refusedAsForeignCard('Card issued outside India is not supported')).toBe(true);
		expect(refusedAsForeignCard('Card BIN not permitted for this merchant')).toBe(true);
		expect(refusedAsForeignCard('Transaction declined by bank')).toBe(false);
		expect(refusedAsForeignCard(null)).toBe(false);
	});
});
