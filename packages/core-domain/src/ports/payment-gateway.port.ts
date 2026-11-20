import type { PaymentGateway } from '@saha-textile/contracts';

/**
 * Where a payment attempt stands, in this project's words. Each gateway maps its own
 * vocabulary onto these, and anything it cannot place becomes `review`.
 *
 * - `authorized`: the customer paid and the money is not yet confirmed for settlement.
 * - `captured`: the money is confirmed for settlement.
 * - `review`: the gateway flagged the attempt, or reported something this code does not
 *   recognise. Never treated as paid.
 */
export type PaymentState = 'pending' | 'authorized' | 'captured' | 'failed' | 'cancelled' | 'refunded' | 'review';

/** How the customer's browser reaches the gateway. A link cannot carry a POST body. */
export type PaymentHandoff =
	{ kind: 'redirect'; url: string } | { kind: 'form-post'; url: string; fields: Readonly<Record<string, string>> };

/**
 * Gateway fields kept for the audit log, already stripped of credentials and customer
 * details. Core stores this and never reads it.
 */
export type PaymentAuditRecord = Readonly<Record<string, string>>;

export interface CreatePaymentInput {
	/** Unique per attempt. One order can have several attempts, and each gets its own id. */
	attemptId: string;
	/** Whole minor units (paise for INR), so 1499.10 and 1499.1 cannot disagree. */
	amountMinor: number;
	currency: string;
	returnUrl: string;
	cancelUrl?: string;
}

export interface PaymentIntent {
	attemptId: string;
	handoff: PaymentHandoff;
	auditRecord: PaymentAuditRecord;
}

/** What a gateway says about one attempt, from a callback or from a direct status enquiry. */
export interface PaymentReport {
	gateway: PaymentGateway;
	attemptId: string;
	/** The gateway's own payment reference, when it has allocated one. */
	gatewayReference: string | null;
	state: PaymentState;
	amountMinor: number;
	currency: string;
	/** The gateway's reason text for a failed attempt. Not for showing to customers. */
	failureReason: string | null;
	auditRecord: PaymentAuditRecord;
	/**
	 * PayPal: its own figures for a captured payment (gross, fee, net, the rupees received and its
	 * exchange rate), kept on the payment for the books only; prices never learn from them.
	 */
	receivable?: {
		grossAmount: number;
		grossCurrency: string;
		fee: number | null;
		net: number | null;
		receivableINR: number | null;
		exchangeRate: { sourceCurrency: string; targetCurrency: string; value: number } | null;
	};
}

export interface PaymentStatusQuery {
	attemptId: string;
	gatewayReference?: string | null;
}

export interface RefundInput {
	gatewayReference: string;
	/** Ours and unique per refund. Retrying with the same value cannot refund twice. */
	refundReference: string;
	amountMinor: number;
	currency: string;
}

export interface RefundResult {
	/**
	 * `accepted`: the gateway took the request. `duplicate`: it already holds this
	 * `refundReference`, so read the outcome with `fetchRefunds`. `refused`: nothing happened.
	 */
	outcome: 'accepted' | 'duplicate' | 'refused';
	refundReference: string;
	/** The gateway's reason text and code for a refusal. Not for showing to customers. */
	refusalReason: string | null;
	refusalCode: string | null;
	auditRecord: PaymentAuditRecord;
}

export type RefundState = 'pending' | 'completed' | 'failed' | 'declined' | 'review';

export interface RefundRecord {
	/** Null for a refund made outside this API, for example in the gateway's own dashboard. */
	refundReference: string | null;
	amountMinor: number;
	state: RefundState;
	auditRecord: PaymentAuditRecord;
}

/**
 * Why a gateway call produced no answer.
 *
 * - `invalid-request`: this code asked for something the gateway must not be sent.
 * - `unavailable`: the gateway did not answer. For a refund the outcome is unknown, so call
 *   `fetchRefunds` before trying again.
 * - `rejected`: the gateway refused the call itself, for example a bad access code.
 * - `unreadable`: the answer could not be authenticated or understood. One code covers every
 *   cause on purpose, so a caller cannot tell an attacker which part of a forgery failed.
 */
export type PaymentGatewayFailure = 'invalid-request' | 'unavailable' | 'rejected' | 'unreadable';

/** The only error a gateway adapter raises. It never carries a credential or a payload. */
export class PaymentGatewayError extends Error {
	constructor(
		readonly failure: PaymentGatewayFailure,
		message: string,
		/** The gateway's own error code, when it gave one. */
		readonly gatewayCode: string | null = null,
	) {
		super(message);
		this.name = 'PaymentGatewayError';
	}
}

/** One online payment gateway. Currency chooses the gateway role, never the browser. */
export interface PaymentGatewayPort {
	readonly gateway: PaymentGateway;
	/** Builds the hand-off to the gateway's hosted payment page. */
	createPayment(input: CreatePaymentInput): Promise<PaymentIntent>;
	/**
	 * Reads what came back through the customer's browser. The result is a claim, never proof
	 * of payment: it reaches `decidePaymentResult` beside a direct status enquiry.
	 */
	verifyCallback(payload: unknown): Promise<PaymentReport>;
	/** Asks the gateway directly. `null` means the gateway has no record of the attempt. */
	fetchPaymentStatus(query: PaymentStatusQuery): Promise<PaymentReport | null>;
	refundPayment(input: RefundInput): Promise<RefundResult>;
	/** Every refund on one payment. Empty when there are none. */
	fetchRefunds(gatewayReference: string): Promise<RefundRecord[]>;
}
