import {
	CheckoutPaymentIntent,
	Client,
	Environment,
	OrdersController,
	PaymentsController,
	PaypalExperienceUserAction,
	type CapturedPayment,
	type Order as PayPalOrder,
} from '@paypal/paypal-server-sdk';
import {
	PaymentGatewayError,
	type CreatedPaymentRequest,
	type CreatePaymentInput,
	type CreatePaymentRequestInput,
	type PaymentGatewayPort,
	type PaymentIntent,
	type PaymentReport,
	type PaymentRequestPort,
	type PaymentRequestStatusReport,
	type PaymentState,
	type PaymentStatusQuery,
	type RefundInput,
	type RefundRecord,
	type RefundResult,
} from '@saha-textile/core-domain';

import type { PayPalConfig } from './paypal-config';

/**
 * PayPal behind `PaymentGatewayPort` and `PaymentRequestPort` (orders brief; latest APIs as the owner
 * asked: Orders v2 through `@paypal/paypal-server-sdk` 2.5.0, Invoicing v2 and webhook checks over
 * REST because the SDK does not cover them).
 *
 * - A payment is a PayPal order (intent CAPTURE). The buyer approves on PayPal; the server captures.
 *   `fetchPaymentStatus` captures an approved order (idempotent by our attempt id), so "Check payment
 *   status" and the return page both finish a payment the buyer approved.
 * - A captured payment carries PayPal's own figures (gross, fee, net, rupees received, exchange
 *   rate) from `seller_receivable_breakdown`, kept for the books only.
 * - A payment request is a PayPal invoice: drafted, then sent by PayPal by email (PayPal sends no SMS
 *   and its wording is its own).
 * Credentials live in ES private fields, so logging this object prints none of them.
 */

type Configured = Extract<PayPalConfig, { configured: true }>;

/** What the adapter uses of the SDK's controllers (tests hand in their own). */
export interface PayPalOrdersApi {
	createOrder(args: { body: unknown; paypalRequestId?: string; prefer?: string }): Promise<{ result: PayPalOrder }>;
	getOrder(args: { id: string }): Promise<{ result: PayPalOrder }>;
	captureOrder(args: { id: string; paypalRequestId?: string; prefer?: string }): Promise<{ result: PayPalOrder }>;
}

export interface PayPalPaymentsApi {
	refundCapturedPayment(args: { captureId: string; paypalRequestId?: string; body?: unknown }): Promise<{
		result: { id?: string; status?: string };
	}>;
}

export interface PayPalGatewayOptions {
	config: Configured;
	fetch?: typeof fetch;
	timeoutMs?: number;
	orders?: PayPalOrdersApi;
	payments?: PayPalPaymentsApi;
}

/** Minor units to PayPal's decimal string (launch currencies all have two decimals). */
export const paypalValue = (minor: number): string => (minor / 100).toFixed(2);
const minorOf = (value: string | undefined): number => Math.round(Number(value ?? '0') * 100);
const numberOrNull = (value: string | undefined): number | null => (value === undefined ? null : Number(value));

function captureState(status: string | undefined): PaymentState {
	switch (status) {
		case 'COMPLETED':
			return 'captured';
		case 'PENDING':
			return 'pending';
		case 'DECLINED':
		case 'FAILED':
			return 'failed';
		case 'REFUNDED':
		case 'PARTIALLY_REFUNDED':
			return 'refunded';
		default:
			return 'review';
	}
}

function firstCapture(order: PayPalOrder): CapturedPayment | null {
	return order.purchaseUnits?.[0]?.payments?.captures?.[0] ?? null;
}

export class PayPalPaymentGateway implements PaymentGatewayPort, PaymentRequestPort {
	readonly gateway = 'paypal' as const;

	readonly #config: Configured;
	readonly #fetch: typeof fetch;
	readonly #timeoutMs: number;
	readonly #orders: PayPalOrdersApi;
	readonly #payments: PayPalPaymentsApi;
	#token: { value: string; expiresAt: number } | null = null;

	constructor(options: PayPalGatewayOptions) {
		this.#config = options.config;
		this.#fetch = options.fetch ?? fetch;
		this.#timeoutMs = options.timeoutMs ?? 15_000;
		if (options.orders && options.payments) {
			this.#orders = options.orders;
			this.#payments = options.payments;
		} else {
			const client = new Client({
				clientCredentialsAuthCredentials: {
					oAuthClientId: this.#config.clientId,
					oAuthClientSecret: this.#config.clientSecret,
				},
				environment: this.#config.environment === 'live' ? Environment.Production : Environment.Sandbox,
				timeout: this.#timeoutMs,
			});
			this.#orders = options.orders ?? (new OrdersController(client) as unknown as PayPalOrdersApi);
			this.#payments = options.payments ?? (new PaymentsController(client) as unknown as PayPalPaymentsApi);
		}
	}

	/** A PayPal order the buyer approves on PayPal's page; the attempt id rides as custom id. */
	async createPayment(input: CreatePaymentInput): Promise<PaymentIntent> {
		const body = {
			intent: CheckoutPaymentIntent.Capture,
			purchaseUnits: [
				{
					referenceId: input.attemptId,
					customId: input.attemptId,
					amount: { currencyCode: input.currency, value: paypalValue(input.amountMinor) },
				},
			],
			paymentSource: {
				paypal: {
					experienceContext: {
						userAction: PaypalExperienceUserAction.PayNow,
						shippingPreference: 'NO_SHIPPING',
						returnUrl: input.returnUrl,
						cancelUrl: input.cancelUrl ?? input.returnUrl,
					},
				},
			},
		};
		const result = await this.#call(() =>
			this.#orders.createOrder({ body, paypalRequestId: input.attemptId, prefer: 'return=minimal' }),
		);
		const approve = result.links?.find((link) => link.rel === 'payer-action' || link.rel === 'approve')?.href;
		if (!result.id || !approve)
			throw new PaymentGatewayError('unreadable', 'PayPal order answer could not be read');
		return {
			attemptId: input.attemptId,
			handoff: { kind: 'redirect', url: approve },
			auditRecord: {
				paypal_order_id: result.id,
				currency: input.currency,
				amount: paypalValue(input.amountMinor),
			},
		};
	}

	/** The return from PayPal: `{ attempt, token }` (our attempt id and PayPal's order id). A claim only. */
	async verifyCallback(payload: unknown): Promise<PaymentReport> {
		const body = (payload ?? {}) as Record<string, unknown>;
		const attemptId = typeof body.attempt === 'string' ? body.attempt : '';
		const orderId = typeof body.token === 'string' ? body.token : '';
		if (!/^[\w-]{1,80}$/.test(attemptId) || !/^[A-Z0-9]{5,40}$/.test(orderId)) {
			throw new PaymentGatewayError('unreadable', 'PayPal return could not be read');
		}
		return {
			gateway: this.gateway,
			attemptId,
			gatewayReference: orderId,
			state: 'pending',
			amountMinor: 0,
			currency: '',
			failureReason: null,
			auditRecord: { paypal_order_id: orderId },
		};
	}

	/**
	 * Asks PayPal about an order (`gatewayReference` = PayPal's order id, or a capture id once known).
	 * An approved order is captured here, idempotently, so an approved payment is never left behind.
	 */
	async fetchPaymentStatus(query: PaymentStatusQuery): Promise<PaymentReport | null> {
		const orderId = query.gatewayReference;
		if (!orderId) return null;
		let order = await this.#call(() => this.#orders.getOrder({ id: orderId }));
		if (order.status === 'APPROVED') {
			order = await this.#call(() =>
				this.#orders.captureOrder({
					id: orderId,
					paypalRequestId: `${query.attemptId}-capture`,
					prefer: 'return=representation',
				}),
			);
		}
		const unit = order.purchaseUnits?.[0];
		const attemptId = unit?.customId ?? query.attemptId;
		const capture = firstCapture(order);
		if (!capture) {
			const state: PaymentState = order.status === 'VOIDED' ? 'cancelled' : 'pending';
			return {
				gateway: this.gateway,
				attemptId,
				gatewayReference: orderId,
				state,
				amountMinor: minorOf(unit?.amount?.value),
				currency: unit?.amount?.currencyCode ?? '',
				failureReason: null,
				auditRecord: { paypal_order_id: orderId, status: String(order.status ?? '') },
			};
		}
		const breakdown = capture.sellerReceivableBreakdown;
		return {
			gateway: this.gateway,
			attemptId,
			gatewayReference: capture.id ?? orderId,
			state: captureState(capture.status),
			amountMinor: minorOf(capture.amount?.value),
			currency: capture.amount?.currencyCode ?? '',
			failureReason: capture.statusDetails?.reason ? String(capture.statusDetails.reason) : null,
			auditRecord: {
				paypal_order_id: orderId,
				capture_id: capture.id ?? '',
				status: String(capture.status ?? ''),
			},
			receivable: breakdown
				? {
						grossAmount: Number(breakdown.grossAmount.value),
						grossCurrency: breakdown.grossAmount.currencyCode,
						fee: numberOrNull(breakdown.paypalFee?.value),
						net: numberOrNull(breakdown.netAmount?.value),
						receivableINR:
							breakdown.receivableAmount?.currencyCode === 'INR'
								? Number(breakdown.receivableAmount.value)
								: null,
						exchangeRate: breakdown.exchangeRate?.value
							? {
									sourceCurrency:
										breakdown.exchangeRate.sourceCurrency ?? breakdown.grossAmount.currencyCode,
									targetCurrency: breakdown.exchangeRate.targetCurrency ?? 'INR',
									value: Number(breakdown.exchangeRate.value),
								}
							: null,
					}
				: undefined,
		};
	}

	/** Refunds a capture; our refund reference is PayPal's request id, so a retry can't refund twice. */
	async refundPayment(input: RefundInput): Promise<RefundResult> {
		try {
			const { result } = await this.#payments.refundCapturedPayment({
				captureId: input.gatewayReference,
				paypalRequestId: input.refundReference,
				body: { amount: { currencyCode: input.currency, value: paypalValue(input.amountMinor) } },
			});
			return {
				outcome: 'accepted',
				refundReference: input.refundReference,
				refusalReason: null,
				refusalCode: null,
				auditRecord: { refund_id: result.id ?? '', status: result.status ?? '' },
			};
		} catch (error) {
			const status = (error as { statusCode?: number }).statusCode;
			if (status === 422 || status === 400) {
				return {
					outcome: 'refused',
					refundReference: input.refundReference,
					refusalReason: 'PayPal refused the refund',
					refusalCode: String(status),
					auditRecord: { status: String(status) },
				};
			}
			throw new PaymentGatewayError('unavailable', 'PayPal refund request failed');
		}
	}

	/** PayPal lists refunds on the order, not the capture; refunds are read from our own records. */
	async fetchRefunds(gatewayReference: string): Promise<RefundRecord[]> {
		void gatewayReference;
		return [];
	}

	/* ------------------------------------------------------------------ invoicing v2 (REST) */

	async createPaymentRequest(input: CreatePaymentRequestInput): Promise<CreatedPaymentRequest> {
		if (!input.customer.email)
			throw new PaymentGatewayError('invalid-request', 'PayPal invoices need an email address');
		const due = new Date(Date.now() + input.validDays * 86_400_000).toISOString().slice(0, 10);
		const draft = await this.#rest<{ id?: string }>('POST', '/v2/invoicing/invoices', {
			detail: {
				invoice_number: input.reference,
				reference: input.orderNumber,
				currency_code: input.currency,
				note: `Order ${input.orderNumber}`,
				payment_term: { due_date: due },
			},
			primary_recipients: [
				{ billing_info: { name: { full_name: input.customer.name }, email_address: input.customer.email } },
			],
			items: input.items.map((item) => ({
				name: item.name.slice(0, 200),
				quantity: String(item.quantity),
				unit_amount: { currency_code: input.currency, value: paypalValue(item.unitAmountMinor) },
			})),
			configuration: { allow_tip: false, tax_calculated_after_discount: true, tax_inclusive: true },
		});
		if (!draft.id) throw new PaymentGatewayError('unreadable', 'PayPal invoice answer could not be read');
		await this.#rest('POST', `/v2/invoicing/invoices/${encodeURIComponent(draft.id)}/send`, {
			send_to_recipient: true,
			send_to_invoicer: false,
		});
		const sent = await this.#rest<{ detail?: { metadata?: { recipient_view_url?: string } } }>(
			'GET',
			`/v2/invoicing/invoices/${encodeURIComponent(draft.id)}`,
		);
		const url = sent.detail?.metadata?.recipient_view_url;
		if (!url) throw new PaymentGatewayError('unreadable', 'PayPal invoice link could not be read');
		return {
			gatewayRequestId: draft.id,
			url,
			auditRecord: { invoice_id: draft.id, invoice_number: input.reference },
		};
	}

	async fetchPaymentRequestStatus(gatewayRequestId: string): Promise<PaymentRequestStatusReport> {
		const invoice = await this.#rest<{
			status?: string;
			payments?: {
				transactions?: Array<{
					payment_id?: string;
					amount?: { value?: string; currency_code?: string };
					payment_date?: string;
					method?: string;
				}>;
			};
		}>('GET', `/v2/invoicing/invoices/${encodeURIComponent(gatewayRequestId)}`);
		const states: Record<string, PaymentRequestStatusReport['state']> = {
			PAID: 'paid',
			MARKED_AS_PAID: 'paid',
			PARTIALLY_PAID: 'partlyPaid',
			MARKED_AS_PARTIALLY_PAID: 'partlyPaid',
			CANCELLED: 'cancelled',
			SENT: 'open',
			UNPAID: 'open',
			SCHEDULED: 'open',
			DRAFT: 'open',
			PAYMENT_PENDING: 'open',
		};
		return {
			gatewayRequestId,
			state: states[invoice.status ?? ''] ?? 'unknown',
			payments: (invoice.payments?.transactions ?? [])
				.filter((row) => row.payment_id)
				.map((row) => ({
					gatewayReference: String(row.payment_id),
					amountMinor: minorOf(row.amount?.value),
					currency: row.amount?.currency_code ?? '',
					at: row.payment_date ?? '',
					method: row.method ?? null,
				})),
			auditRecord: { invoice_id: gatewayRequestId, status: invoice.status ?? '' },
		};
	}

	async cancelPaymentRequest(gatewayRequestId: string): Promise<void> {
		await this.#rest('POST', `/v2/invoicing/invoices/${encodeURIComponent(gatewayRequestId)}/cancel`, {
			send_to_recipient: false,
			send_to_invoicer: false,
		});
	}

	/** Webhook check with PayPal (verify-webhook-signature). False when no webhook id is set. */
	async verifyWebhook(headers: Readonly<Record<string, string | undefined>>, event: unknown): Promise<boolean> {
		if (!this.#config.webhookId) return false;
		const answer = await this.#rest<{ verification_status?: string }>(
			'POST',
			'/v1/notifications/verify-webhook-signature',
			{
				auth_algo: headers['paypal-auth-algo'],
				cert_url: headers['paypal-cert-url'],
				transmission_id: headers['paypal-transmission-id'],
				transmission_sig: headers['paypal-transmission-sig'],
				transmission_time: headers['paypal-transmission-time'],
				webhook_id: this.#config.webhookId,
				webhook_event: event,
			},
		);
		return answer.verification_status === 'SUCCESS';
	}

	/* ------------------------------------------------------------------ plumbing */

	async #call<T>(work: () => Promise<{ result: T }>): Promise<T> {
		try {
			return (await work()).result;
		} catch (error) {
			const status = (error as { statusCode?: number }).statusCode;
			if (status && status >= 400 && status < 500)
				throw new PaymentGatewayError('rejected', `PayPal refused the call (${status})`);
			throw new PaymentGatewayError('unavailable', 'PayPal did not answer');
		}
	}

	async #accessToken(): Promise<string> {
		if (this.#token && this.#token.expiresAt > Date.now() + 60_000) return this.#token.value;
		let response: Response;
		try {
			response = await this.#fetch(`${this.#config.apiBase}/v1/oauth2/token`, {
				method: 'POST',
				headers: {
					authorization: `Basic ${Buffer.from(`${this.#config.clientId}:${this.#config.clientSecret}`).toString('base64')}`,
					'content-type': 'application/x-www-form-urlencoded',
				},
				body: 'grant_type=client_credentials',
				signal: AbortSignal.timeout(this.#timeoutMs),
			});
		} catch {
			throw new PaymentGatewayError('unavailable', 'PayPal sign-in did not answer');
		}
		if (!response.ok) throw new PaymentGatewayError('rejected', `PayPal sign-in refused (${response.status})`);
		const body = (await response.json()) as { access_token?: string; expires_in?: number };
		if (!body.access_token) throw new PaymentGatewayError('unreadable', 'PayPal sign-in answer could not be read');
		this.#token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 300) * 1000 };
		return this.#token.value;
	}

	async #rest<T = Record<string, unknown>>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
		const token = await this.#accessToken();
		let response: Response;
		try {
			response = await this.#fetch(`${this.#config.apiBase}${path}`, {
				method,
				headers: {
					authorization: `Bearer ${token}`,
					'content-type': 'application/json',
					prefer: 'return=representation',
				},
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(this.#timeoutMs),
			});
		} catch {
			throw new PaymentGatewayError('unavailable', 'PayPal did not answer');
		}
		if (!response.ok) {
			throw new PaymentGatewayError(
				response.status >= 500 ? 'unavailable' : 'rejected',
				`PayPal refused the call (${response.status})`,
			);
		}
		const text = await response.text();
		try {
			return (text ? JSON.parse(text) : {}) as T;
		} catch {
			throw new PaymentGatewayError('unreadable', 'PayPal answer could not be read');
		}
	}
}
