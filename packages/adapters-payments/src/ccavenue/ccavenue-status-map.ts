import type { PaymentState, RefundState } from '@saha-textile/core-domain';

/**
 * The two `order_status` vocabularies stay separate, as CCAvenue prints them. Anything not
 * listed becomes `review`, so a status CCAvenue adds later can never read as paid.
 */
const HOSTED_STATES = new Map<string, PaymentState>([
	['Success', 'authorized'],
	['Failure', 'failed'],
	['Aborted', 'cancelled'],
	['Invalid', 'failed'],
	['Timeout', 'failed'],
]);

const MERCHANT_API_STATES = new Map<string, PaymentState>([
	['Initiated', 'pending'],
	['Awaited', 'pending'],
	['Successful', 'authorized'],
	['Shipped', 'captured'],
	['Aborted', 'cancelled'],
	['Cancelled', 'cancelled'],
	['Auto-Cancelled', 'cancelled'],
	['Unsuccessful', 'failed'],
	['Invalid', 'failed'],
	['Timeout', 'failed'],
	['Refunded', 'refunded'],
	['Systemrefund', 'refunded'],
	['Auto-Reversed', 'refunded'],
	['Fraud', 'review'],
	['Chargeback', 'review'],
]);

const REFUND_STATES = new Map<string, RefundState>([
	['TS-REFC', 'completed'],
	['TS-REFA', 'pending'],
	['TS-REFF', 'failed'],
	['TS-REFD', 'declined'],
]);

export const hostedState = (status: string): PaymentState => HOSTED_STATES.get(status) ?? 'review';

/** A high fraud rating holds the attempt for an operator, whatever the order status says. */
export function merchantApiState(status: string, fraudStatus: string | null | undefined): PaymentState {
	if (fraudStatus === 'High') return 'review';
	return MERCHANT_API_STATES.get(status) ?? 'review';
}

export const refundState = (status: string): RefundState => REFUND_STATES.get(status) ?? 'review';
