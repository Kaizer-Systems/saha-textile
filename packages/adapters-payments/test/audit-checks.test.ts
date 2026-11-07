import { decidePaymentResult, type StoredPaymentAttempt } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { answering, apiSuccess, callbackForm, hostedResponse, statusRecord, testGateway } from './support';

/**
 * HDFC's security-audit checks, run through the real adapter and the real decision rule, with
 * only the network answered locally. Nothing here has touched CCAvenue's test system.
 */
const stored = (overrides: Partial<StoredPaymentAttempt> = {}): StoredPaymentAttempt => ({
	attemptId: 'attempt-1',
	amountMinor: 149_900,
	currency: 'INR',
	state: 'pending',
	gatewayReference: null,
	...overrides,
});

async function decide(
	attempt: StoredPaymentAttempt,
	plainCallback: string,
	record: Record<string, unknown>,
): Promise<ReturnType<typeof decidePaymentResult>> {
	const gateway = testGateway(answering(apiSuccess(record)).fetch);
	const callback = await gateway.verifyCallback(callbackForm(plainCallback));
	const status = await gateway.fetchPaymentStatus({
		attemptId: callback.attemptId,
		gatewayReference: callback.gatewayReference,
	});
	return decidePaymentResult(attempt, status, callback);
}

describe('HDFC audit checks', () => {
	it('settles a genuine payment on the status answer', async () => {
		await expect(decide(stored(), hostedResponse(), statusRecord())).resolves.toEqual({
			kind: 'apply',
			state: 'authorized',
			gatewayReference: '311008298114',
		});
	});

	describe('request tampering: the amount paid must be the amount stored', () => {
		it('refuses a payment for less than the stored amount', async () => {
			const callback = hostedResponse({ amount: '1.00' });
			await expect(decide(stored(), callback, statusRecord({ order_amt: 1.0 }))).resolves.toEqual({
				kind: 'review',
				reason: 'amount-mismatch',
			});
		});
	});

	describe('response tampering', () => {
		it('refuses a callback amount that the status answer does not back', async () => {
			await expect(decide(stored(), hostedResponse({ amount: '1.00' }), statusRecord())).resolves.toEqual({
				kind: 'review',
				reason: 'amount-mismatch',
			});
		});

		it('refuses another currency', async () => {
			const callback = hostedResponse({ currency: 'USD' });
			await expect(decide(stored(), callback, statusRecord())).resolves.toEqual({
				kind: 'review',
				reason: 'currency-mismatch',
			});
		});

		it('refuses the response of another order', async () => {
			const callback = hostedResponse({ order_id: 'attempt-2' });
			const gateway = testGateway(answering(apiSuccess(statusRecord({ order_no: 'attempt-2' }))).fetch);
			const claim = await gateway.verifyCallback(callbackForm(callback, 'attempt-2'));
			const status = await gateway.fetchPaymentStatus({ attemptId: claim.attemptId });
			expect(decidePaymentResult(stored(), status, claim)).toEqual({
				kind: 'review',
				reason: 'attempt-mismatch',
			});
		});

		it('refuses a success callback when the gateway says the payment failed', async () => {
			const failed = statusRecord({ order_status: 'Unsuccessful' });
			await expect(decide(stored(), hostedResponse(), failed)).resolves.toEqual({
				kind: 'review',
				reason: 'paid-callback-contradicted',
			});
		});
	});

	describe('URL redirection: the outcome comes from the data, not the path it was posted to', () => {
		it('records a real failure even when posted to a success path', async () => {
			const callback = hostedResponse({ order_status: 'Failure' });
			const failed = statusRecord({ order_status: 'Unsuccessful' });
			await expect(decide(stored(), callback, failed)).resolves.toMatchObject({ kind: 'apply', state: 'failed' });
		});
	});

	describe('duplicate entry: replayed responses change nothing', () => {
		const settled = stored({ state: 'authorized', gatewayReference: '311008298114' });

		it('treats a re-posted success as a duplicate', async () => {
			await expect(decide(settled, hostedResponse(), statusRecord())).resolves.toEqual({ kind: 'duplicate' });
		});

		it('treats an old failure replayed after success as a duplicate', async () => {
			const replay = hostedResponse({ order_status: 'Failure' });
			await expect(decide(settled, replay, statusRecord())).resolves.toEqual({ kind: 'duplicate' });
		});

		it('sends a second payment reference on the same order to review', async () => {
			const second = hostedResponse({ tracking_id: '311008298115' });
			const record = statusRecord({ reference_no: '311008298115' });
			await expect(decide(settled, second, record)).resolves.toEqual({
				kind: 'review',
				reason: 'reference-mismatch',
			});
		});
	});

	describe('dual enquiry', () => {
		it('confirms a payment whose browser return never arrived', async () => {
			const gateway = testGateway(answering(apiSuccess(statusRecord())).fetch);
			const status = await gateway.fetchPaymentStatus({ attemptId: 'attempt-1' });
			expect(decidePaymentResult(stored(), status)).toMatchObject({ kind: 'apply', state: 'authorized' });
		});

		it('never treats a callback alone as proof of payment', async () => {
			const gateway = testGateway();
			const callback = await gateway.verifyCallback(callbackForm(hostedResponse()));
			expect(decidePaymentResult(stored(), null, callback)).toEqual({
				kind: 'review',
				reason: 'paid-callback-without-record',
			});
		});
	});
});
