import type {
	CreatedPaymentRequest,
	CreatePaymentInput,
	CreatePaymentRequestInput,
	PaymentAuditRecord,
	PaymentGatewayPort,
	PaymentIntent,
	PaymentReport,
	PaymentRequestPort,
	PaymentRequestStatusReport,
	PaymentStatusQuery,
	RefundInput,
	RefundRecord,
	RefundResult,
} from '@saha-textile/core-domain';
import { PaymentGatewayError } from '@saha-textile/core-domain';
import type { z } from 'zod';

import { CcavenueCipher } from './ccavenue-cipher';
import { type CcavenueGatewayOptions, parseCcavenueConfig } from './ccavenue-config';
import { CcavenueMerchantApi } from './ccavenue-merchant-api';
import { generateQuickInvoice, quickInvoiceStatus } from './ccavenue-quick-invoice';
import {
	AttemptId,
	CallbackForm,
	GatewayReference,
	HostedResponse,
	OrderStatusRecord,
	RefundDetails,
	RefundReference,
	RefundResponse,
} from './ccavenue-schemas';
import { hostedState, merchantApiState, refundState } from './ccavenue-status-map';
import { formatAmount, joinPairs, parsePairs, presentOrNull } from './ccavenue-wire';

const INITIATE_PATH = '/transaction/transaction.do?command=initiateTransaction';

/** Only INR reaches this gateway. Non-INR goes to the PayPal role. */
const CURRENCY = 'INR';

/** 51309: this refund reference has been used before. */
const DUPLICATE_REFUND_CODE = '51309';

/**
 * What the audit log keeps. An allow-list, so billing and delivery details, and any field
 * CCAvenue adds later, stay out by default.
 */
const CALLBACK_AUDIT_FIELDS = [
	'order_id',
	'tracking_id',
	'bank_ref_no',
	'order_status',
	'failure_message',
	'payment_mode',
	'card_name',
	'status_code',
	'status_message',
	'currency',
	'amount',
	'Amount',
	'mer_amount',
	'retry',
	'response_code',
	'eci_value',
	'trans_date',
] as const;

const STATUS_AUDIT_FIELDS = [
	'reference_no',
	'order_no',
	'order_status',
	'order_status_date_time',
	'order_date_time',
	'order_amt',
	'order_gross_amt',
	'order_capt_amt',
	'order_currncy',
	'order_curr',
	'order_bank_ref_no',
	'order_bank_response',
	'order_gtw_id',
	'order_option_type',
	'order_card_name',
	'order_fraud_status',
] as const;

const REFUND_AUDIT_FIELDS = ['refund_status', 'reason', 'error_code'] as const;

const REFUND_RECORD_AUDIT_FIELDS = [
	'refund_amt',
	'refund_status',
	'refund_mer_ref_no',
	'refund_bank_ref_no',
	'refund_issue_date',
	'refund_processed_on',
	'refund_completion_date',
] as const;

function pickAudit(source: Readonly<Record<string, unknown>>, fields: readonly string[]): PaymentAuditRecord {
	const kept = fields.flatMap((field) => {
		const value = source[field];
		return typeof value === 'string' || typeof value === 'number' ? [[field, String(value)]] : [];
	});
	return Object.fromEntries(kept);
}

function checked<T>(schema: z.ZodType<T>, value: unknown, field: string): T {
	const parsed = schema.safeParse(value);
	if (!parsed.success) throw new PaymentGatewayError('invalid-request', `CCAvenue ${field} is not acceptable`);
	return parsed.data;
}

function checkedAmount(amountMinor: number, currency: string): string {
	const amount = formatAmount(amountMinor);
	if (amount === null) throw new PaymentGatewayError('invalid-request', 'CCAvenue amount is not acceptable');
	if (currency !== CURRENCY) throw new PaymentGatewayError('invalid-request', 'CCAvenue only takes INR here');
	return amount;
}

/** One message for every cause, so a forged callback learns nothing about how far it got. */
const unreadableCallback = (): PaymentGatewayError =>
	new PaymentGatewayError('unreadable', 'CCAvenue callback could not be read');

const unreadableAnswer = (command: string): PaymentGatewayError =>
	new PaymentGatewayError('unreadable', `CCAvenue ${command} answer could not be read`);

/**
 * CCAvenue's non-seamless hosted flow behind `PaymentGatewayPort`. The customer's card details
 * go to CCAvenue's billing page and never reach this server.
 *
 * Holds no state. Duplicate, replay and stored-amount checks need the stored attempt, so they
 * live in `decidePaymentResult`. Everything held here is in ES private fields, so logging this
 * object cannot print a credential.
 */
export class CcavenuePaymentGateway implements PaymentGatewayPort, PaymentRequestPort {
	readonly gateway = 'ccavenue' as const;

	readonly #cipher: CcavenueCipher;
	readonly #api: CcavenueMerchantApi;
	readonly #merchantId: string;
	readonly #accessCode: string;
	readonly #paymentPageUrl: string;
	readonly #returnUrl: string;

	constructor(options: CcavenueGatewayOptions) {
		const config = parseCcavenueConfig(options);
		this.#cipher = new CcavenueCipher(config.workingKey);
		this.#api = new CcavenueMerchantApi(this.#cipher, {
			apiUrl: config.apiUrl,
			accessCode: config.accessCode,
			timeoutMs: config.timeoutMs,
			fetch: options.fetch ?? fetch,
		});
		this.#merchantId = config.merchantId;
		this.#accessCode = config.accessCode;
		this.#paymentPageUrl = `${config.baseUrl}${INITIATE_PATH}`;
		this.#returnUrl = config.returnUrl;
	}

	/**
	 * `amountMinor` must come from the stored attempt, never from the browser. The return
	 * addresses must equal the registered one, and every field is strictly checked because
	 * values travel unescaped: an `&` in one would add a field of its own.
	 */
	async createPayment(input: CreatePaymentInput): Promise<PaymentIntent> {
		const orderId = checked(AttemptId, input.attemptId, 'order id');
		const amount = checkedAmount(input.amountMinor, input.currency);
		const cancelUrl = input.cancelUrl ?? input.returnUrl;
		if (input.returnUrl !== this.#returnUrl || cancelUrl !== this.#returnUrl) {
			throw new PaymentGatewayError('invalid-request', 'CCAvenue return URL is not the registered one');
		}
		const request = {
			order_id: orderId,
			currency: CURRENCY,
			amount,
			redirect_url: this.#returnUrl,
			cancel_url: this.#returnUrl,
			language: 'EN',
		};
		return {
			attemptId: orderId,
			handoff: {
				kind: 'form-post',
				url: this.#paymentPageUrl,
				fields: {
					encRequest: this.#cipher.encrypt(joinPairs({ merchant_id: this.#merchantId, ...request })),
					access_code: this.#accessCode,
				},
			},
			auditRecord: request,
		};
	}

	/**
	 * Decrypts and validates the browser's return and compares its order id with the clear
	 * `orderNo`. This cipher has no authentication tag, so the route that calls this must answer
	 * every failure identically and be rate limited, and the result stays a claim until
	 * `decidePaymentResult` has seen it beside a status enquiry.
	 */
	async verifyCallback(payload: unknown): Promise<PaymentReport> {
		const form = CallbackForm.safeParse(payload);
		if (!form.success) throw unreadableCallback();
		const pairs = parsePairs(this.#decryptCallback(form.data.encResp.trim()));
		if (!pairs) throw unreadableCallback();
		const response = HostedResponse.safeParse(pairs);
		if (!response.success) throw unreadableCallback();
		const { orderNo } = form.data;
		if (orderNo !== undefined && orderNo !== response.data.order_id) throw unreadableCallback();

		return {
			gateway: this.gateway,
			attemptId: response.data.order_id,
			gatewayReference: response.data.tracking_id,
			state: hostedState(response.data.order_status),
			amountMinor: response.data.amountMinor,
			currency: response.data.currency,
			failureReason: presentOrNull(response.data.failure_message),
			auditRecord: pickAudit(pairs, CALLBACK_AUDIT_FIELDS),
		};
	}

	/** HDFC's mandatory dual enquiry. Read-only, so it is safe to repeat. */
	async fetchPaymentStatus(query: PaymentStatusQuery): Promise<PaymentReport | null> {
		const request: Record<string, string> = { order_no: checked(AttemptId, query.attemptId, 'order id') };
		if (query.gatewayReference) {
			request.reference_no = checked(GatewayReference, query.gatewayReference, 'reference');
		}
		const result = await this.#api.call('orderStatusTracker', request);
		if (result.kind === 'no-record') return null;

		const record = OrderStatusRecord.safeParse(result.body);
		if (!record.success) throw unreadableAnswer('orderStatusTracker');
		const state = merchantApiState(record.data.order_status, record.data.order_fraud_status);
		return {
			gateway: this.gateway,
			attemptId: record.data.order_no,
			gatewayReference: record.data.reference_no,
			state,
			amountMinor: record.data.order_amt,
			currency: record.data.currency,
			failureReason:
				state === 'failed' || state === 'cancelled' ? presentOrNull(record.data.order_bank_response) : null,
			auditRecord: pickAudit(result.body, STATUS_AUDIT_FIELDS),
		};
	}

	/**
	 * `refundReference` is the idempotency handle: CCAvenue refuses a repeat with 51309, which
	 * becomes `duplicate`. If this throws `unavailable` or `unreadable`, the outcome is unknown,
	 * so read `fetchRefunds` before trying again.
	 */
	async refundPayment(input: RefundInput): Promise<RefundResult> {
		const refundReference = checked(RefundReference, input.refundReference, 'refund reference');
		const request = {
			reference_no: checked(GatewayReference, input.gatewayReference, 'reference'),
			refund_amount: checkedAmount(input.amountMinor, input.currency),
			refund_ref_no: refundReference,
		};
		const result = await this.#api.call('refundOrder', request);
		if (result.kind === 'no-record') {
			return {
				outcome: 'refused',
				refundReference,
				refusalReason: null,
				refusalCode: result.code,
				auditRecord: { error_code: result.code },
			};
		}
		const response = RefundResponse.safeParse(result.body);
		if (!response.success) throw unreadableAnswer('refundOrder');
		return {
			...refundOutcome(response.data),
			refundReference,
			auditRecord: pickAudit(response.data, REFUND_AUDIT_FIELDS),
		};
	}

	async fetchRefunds(gatewayReference: string): Promise<RefundRecord[]> {
		const reference = checked(GatewayReference, gatewayReference, 'reference');
		const result = await this.#api.call('getRefundDetails', { reference_no: reference });
		if (result.kind === 'no-record') return [];

		const details = RefundDetails.safeParse(result.body);
		if (!details.success || details.data.reference_no !== reference) throw unreadableAnswer('getRefundDetails');
		return details.data.refund_list.map((refund) => ({
			refundReference: presentOrNull(refund.refund_mer_ref_no),
			amountMinor: refund.amountMinor,
			state: refundState(refund.refund_status),
			auditRecord: pickAudit(refund, REFUND_RECORD_AUDIT_FIELDS),
		}));
	}

	/** The gateway's own payment request (Quick Invoice): CCAvenue emails and texts the customer itself. */
	async createPaymentRequest(input: CreatePaymentRequestInput): Promise<CreatedPaymentRequest> {
		return generateQuickInvoice(this.#api, input);
	}

	async fetchPaymentRequestStatus(gatewayRequestId: string): Promise<PaymentRequestStatusReport> {
		return quickInvoiceStatus(this.#api, gatewayRequestId);
	}

	/** HDFC's document prints no cancel call: the request stops being forwarded to and runs out by its validity. */
	async cancelPaymentRequest(gatewayRequestId: string): Promise<void> {
		void gatewayRequestId;
	}

	#decryptCallback(cipherHex: string): string {
		try {
			return this.#cipher.decrypt(cipherHex);
		} catch {
			throw unreadableCallback();
		}
	}
}

function refundOutcome(
	response: z.infer<typeof RefundResponse>,
): Pick<RefundResult, 'outcome' | 'refusalReason' | 'refusalCode'> {
	if (response.refund_status === '0') return { outcome: 'accepted', refusalReason: null, refusalCode: null };
	const code = presentOrNull(response.error_code);
	return {
		outcome: code === DUPLICATE_REFUND_CODE ? 'duplicate' : 'refused',
		refusalReason: presentOrNull(response.reason),
		refusalCode: code,
	};
}
