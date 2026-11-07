import type { PaymentReport, PaymentState } from '../ports/payment-gateway.port';

/** What this project recorded when the attempt was created, and what it has learned since. */
export interface StoredPaymentAttempt {
	attemptId: string;
	amountMinor: number;
	currency: string;
	state: PaymentState;
	gatewayReference: string | null;
}

export type PaymentReviewReason =
	| 'attempt-mismatch'
	| 'amount-mismatch'
	| 'currency-mismatch'
	| 'reference-mismatch'
	| 'gateway-flagged'
	| 'paid-callback-without-record'
	| 'paid-callback-contradicted'
	| 'state-regression';

/**
 * - `apply`: record this state and reference on the attempt.
 * - `duplicate`: the attempt already says this. Change nothing and answer as before.
 * - `pending`: no verdict yet. Enquire again later.
 * - `review`: change nothing and send it to an operator.
 */
export type PaymentDecision =
	| { kind: 'apply'; state: PaymentState; gatewayReference: string | null }
	| { kind: 'duplicate' }
	| { kind: 'pending' }
	| { kind: 'review'; reason: PaymentReviewReason };

const PAID_STATES: readonly PaymentState[] = ['authorized', 'captured'];
const UNPAID_STATES: readonly PaymentState[] = ['failed', 'cancelled'];

/**
 * The moves an attempt may make. A failed or cancelled attempt can still turn out paid,
 * because money that really moved has to be recorded. Nothing moves backwards from paid to
 * failed, and nothing leaves `refunded` or `review` without an operator.
 */
const ALLOWED_MOVES: Readonly<Record<PaymentState, readonly PaymentState[]>> = {
	pending: ['authorized', 'captured', 'failed', 'cancelled', 'refunded'],
	authorized: ['captured', 'cancelled', 'refunded'],
	captured: ['refunded'],
	failed: ['authorized', 'captured', 'cancelled'],
	cancelled: ['authorized', 'captured', 'refunded'],
	refunded: [],
	review: [],
};

function mismatchWith(attempt: StoredPaymentAttempt, report: PaymentReport): PaymentReviewReason | null {
	if (report.attemptId !== attempt.attemptId) return 'attempt-mismatch';
	if (report.currency !== attempt.currency) return 'currency-mismatch';
	if (report.amountMinor !== attempt.amountMinor) return 'amount-mismatch';
	return null;
}

function referencesAgree(references: readonly (string | null | undefined)[]): boolean {
	return new Set(references.filter(Boolean)).size <= 1;
}

/**
 * The one rule for what a gateway's answers do to a stored attempt, for every gateway.
 *
 * `status` is the direct enquiry, and `null` means the gateway has no record. It is the only
 * evidence that can change an attempt: `callback` came through the customer's browser, so it
 * can only be checked against the stored attempt and against `status`. Replays are safe for
 * that reason. A re-posted callback, or an old failure arriving after a success, meets the
 * same status answer and resolves to `duplicate`.
 */
export function decidePaymentResult(
	attempt: StoredPaymentAttempt,
	status: PaymentReport | null,
	callback?: PaymentReport,
): PaymentDecision {
	for (const report of [status, callback]) {
		const mismatch = report ? mismatchWith(attempt, report) : null;
		if (mismatch) return { kind: 'review', reason: mismatch };
	}
	if (!referencesAgree([attempt.gatewayReference, status?.gatewayReference, callback?.gatewayReference])) {
		return { kind: 'review', reason: 'reference-mismatch' };
	}

	const callbackClaimsPaid = callback !== undefined && PAID_STATES.includes(callback.state);
	if (!status) {
		return callbackClaimsPaid ? { kind: 'review', reason: 'paid-callback-without-record' } : { kind: 'pending' };
	}
	if (status.state === 'review' || callback?.state === 'review') {
		return { kind: 'review', reason: 'gateway-flagged' };
	}
	if (callbackClaimsPaid && UNPAID_STATES.includes(status.state)) {
		return { kind: 'review', reason: 'paid-callback-contradicted' };
	}
	if (status.state === 'pending') {
		return PAID_STATES.includes(attempt.state)
			? { kind: 'review', reason: 'state-regression' }
			: { kind: 'pending' };
	}
	if (status.state === attempt.state) return { kind: 'duplicate' };
	if (!ALLOWED_MOVES[attempt.state].includes(status.state)) {
		return { kind: 'review', reason: 'state-regression' };
	}
	return { kind: 'apply', state: status.state, gatewayReference: status.gatewayReference };
}
