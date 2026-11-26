import { describe, expect, it } from 'vitest';

import { decidePaymentResult, type StoredPaymentAttempt } from '../src/payments/decide-payment-result';
import type { PaymentReport, PaymentState } from '../src/ports/payment-gateway.port';
import { PaymentGatewayError } from '../src/ports/payment-gateway.port';

const attempt = (overrides: Partial<StoredPaymentAttempt> = {}): StoredPaymentAttempt => ({
	attemptId: 'attempt-1',
	amountMinor: 149_900,
	currency: 'INR',
	state: 'pending',
	gatewayReference: null,
	...overrides,
});

const report = (overrides: Partial<PaymentReport> = {}): PaymentReport => ({
	gateway: 'ccavenue',
	attemptId: 'attempt-1',
	gatewayReference: '311008298114',
	state: 'authorized',
	amountMinor: 149_900,
	currency: 'INR',
	failureReason: null,
	auditRecord: {},
	...overrides,
});

describe('decidePaymentResult', () => {
	it('applies a status answer that matches the stored attempt', () => {
		expect(decidePaymentResult(attempt(), report(), report())).toEqual({
			kind: 'apply',
			state: 'authorized',
			gatewayReference: '311008298114',
		});
	});

	it('applies a status answer when no callback ever arrived', () => {
		expect(decidePaymentResult(attempt(), report({ state: 'captured' }))).toEqual({
			kind: 'apply',
			state: 'captured',
			gatewayReference: '311008298114',
		});
	});

	describe.each([
		['status', (r: PaymentReport) => [r, report()] as const],
		['callback', (r: PaymentReport) => [report(), r] as const],
	])('tampering seen in the %s', (_source, place) => {
		it.each([
			['amount-mismatch', { amountMinor: 100 }],
			['currency-mismatch', { currency: 'USD' }],
			['attempt-mismatch', { attemptId: 'attempt-2' }],
			['reference-mismatch', { gatewayReference: '999999999999' }],
		] as const)('sends %s to review', (reason, change) => {
			const [status, callback] = place(report(change));
			expect(decidePaymentResult(attempt(), status, callback)).toEqual({ kind: 'review', reason });
		});
	});

	it('treats a second gateway reference on a settled attempt as a review, not a new payment', () => {
		const settled = attempt({ state: 'authorized', gatewayReference: '311008298114' });
		expect(decidePaymentResult(settled, report({ gatewayReference: '311008298115' }))).toEqual({
			kind: 'review',
			reason: 'reference-mismatch',
		});
	});

	describe('replays', () => {
		const settled = attempt({ state: 'authorized', gatewayReference: '311008298114' });

		it('does nothing for a repeated success', () => {
			expect(decidePaymentResult(settled, report(), report())).toEqual({ kind: 'duplicate' });
		});

		it('does nothing for an old failure arriving after a success', () => {
			expect(decidePaymentResult(settled, report(), report({ state: 'failed' }))).toEqual({ kind: 'duplicate' });
		});

		it('does nothing for a repeated failure', () => {
			const failed = attempt({ state: 'failed', gatewayReference: '311008298114' });
			const answer = report({ state: 'failed' });
			expect(decidePaymentResult(failed, answer, answer)).toEqual({ kind: 'duplicate' });
		});

		it('does not alert on a replayed success after a refund has been applied', () => {
			const refunded = attempt({ state: 'refunded', gatewayReference: '311008298114' });
			expect(decidePaymentResult(refunded, report({ state: 'refunded' }), report())).toEqual({
				kind: 'duplicate',
			});
		});
	});

	describe('when the status answer and the callback disagree', () => {
		it('never takes a paid callback over a failed status', () => {
			expect(decidePaymentResult(attempt(), report({ state: 'failed' }), report())).toEqual({
				kind: 'review',
				reason: 'paid-callback-contradicted',
			});
		});

		it('flags a paid callback even when the attempt already recorded the failure', () => {
			const failed = attempt({ state: 'failed', gatewayReference: '311008298114' });
			expect(decidePaymentResult(failed, report({ state: 'cancelled' }), report())).toEqual({
				kind: 'review',
				reason: 'paid-callback-contradicted',
			});
		});

		it('records a real payment when the callback said failed', () => {
			expect(decidePaymentResult(attempt(), report(), report({ state: 'failed' }))).toMatchObject({
				kind: 'apply',
				state: 'authorized',
			});
		});

		it('waits while the gateway has not finished, whatever the callback claims', () => {
			expect(decidePaymentResult(attempt(), report({ state: 'pending' }), report())).toEqual({ kind: 'pending' });
		});
	});

	describe('when the gateway has no record', () => {
		it('sends a paid callback to review', () => {
			expect(decidePaymentResult(attempt(), null, report({ state: 'captured' }))).toEqual({
				kind: 'review',
				reason: 'paid-callback-without-record',
			});
		});

		it('waits when a callback reports a failure', () => {
			expect(decidePaymentResult(attempt(), null, report({ state: 'failed' }))).toEqual({ kind: 'pending' });
		});

		it('waits when there is no callback either', () => {
			expect(decidePaymentResult(attempt(), null)).toEqual({ kind: 'pending' });
		});
	});

	it.each([
		['status', report({ state: 'review' }), undefined],
		['callback', report(), report({ state: 'review' })],
	])('sends a %s flagged by the gateway to review', (_source, status, callback) => {
		expect(decidePaymentResult(attempt(), status, callback)).toEqual({ kind: 'review', reason: 'gateway-flagged' });
	});

	describe('state moves', () => {
		const from = (state: PaymentState) => attempt({ state, gatewayReference: '311008298114' });

		it.each([
			['authorized', 'captured'],
			['authorized', 'cancelled'],
			['authorized', 'refunded'],
			['captured', 'refunded'],
			['failed', 'authorized'],
			['cancelled', 'captured'],
		] as const)('allows %s to %s', (before, after) => {
			expect(decidePaymentResult(from(before), report({ state: after }))).toMatchObject({
				kind: 'apply',
				state: after,
			});
		});

		it.each([
			['authorized', 'failed'],
			['captured', 'authorized'],
			['captured', 'failed'],
			['captured', 'pending'],
			['authorized', 'pending'],
			['refunded', 'captured'],
			['review', 'captured'],
		] as const)('refuses %s to %s', (before, after) => {
			expect(decidePaymentResult(from(before), report({ state: after }))).toEqual({
				kind: 'review',
				reason: 'state-regression',
			});
		});
	});
});

describe('PaymentGatewayError', () => {
	it('carries the failure kind and the gateway code', () => {
		const error = new PaymentGatewayError('rejected', 'Gateway refused the call', '51407');
		expect(error).toMatchObject({ name: 'PaymentGatewayError', failure: 'rejected', gatewayCode: '51407' });
	});

	it('has no gateway code unless one was given', () => {
		expect(new PaymentGatewayError('unavailable', 'No answer').gatewayCode).toBeNull();
	});
});
