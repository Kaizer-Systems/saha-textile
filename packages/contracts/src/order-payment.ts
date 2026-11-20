import { z } from 'zod';

import { Id, IsoDateTime, PriceINR } from './common';
import { PaymentGateway } from './order';
import { IsoDate } from './purchasing';

/**
 * Payments on an order (brief ck01–ck08, pl01–pl05, pr01–pr03, oo01–oo08; owner 2026-11-20).
 *
 * - An order can take several payments, each its own record with its own reference.
 * - Payments typed by staff (UPI, bank transfer, cash on delivery) are in rupees at the order's ₹
 *   total without the PayPal markup (concern K3); the dialog opens with the amount due filled in.
 *   Less leaves the rest due; more leaves the order paid ahead.
 * - A gateway payment fills its reference from the gateway, locked. PayPal payments keep PayPal's
 *   own rate, fee and the rupees received from its payment record, for the books only.
 * - Payment requests are the gateway's own (CCAvenue Quick Invoice, PayPal Invoicing v2). Our link
 *   `sahatextile.com/pay/<token>` forwards to the current request, so our SMS and email can carry it
 *   (DLT whitelist) and it survives a replaced request. A request is never for more than is due.
 */

export const PaymentMethod = z.enum(['gateway', 'upi', 'bankTransfer', 'cashOnDelivery', 'onAccount', 'setOff']);
export type PaymentMethod = z.infer<typeof PaymentMethod>;

/** Payment methods staff type in by hand (each needs a reference the customer gave). */
export const ManualPaymentMethod = z.enum(['upi', 'bankTransfer', 'cashOnDelivery']);
export type ManualPaymentMethod = z.infer<typeof ManualPaymentMethod>;

export const PaymentRecordState = z.enum(['received', 'pending', 'failed', 'refunded', 'partRefunded', 'void']);
export type PaymentRecordState = z.infer<typeof PaymentRecordState>;

/** PayPal's own figures for one captured payment (seller_receivable_breakdown). */
export const PayPalReceivable = z.object({
	grossAmount: z.number().nonnegative(),
	grossCurrency: z.string().length(3),
	paypalFee: z.number().nonnegative().nullable(),
	netAmount: z.number().nonnegative().nullable(),
	/** Rupees PayPal credits us, when it converts at payment. */
	receivableINR: z.number().nonnegative().nullable(),
	exchangeRate: z
		.object({
			sourceCurrency: z.string().length(3),
			targetCurrency: z.string().length(3),
			value: z.number().positive(),
		})
		.nullable(),
	/** `capture`: from the payment record; `report`: attached later from PayPal's transaction report. */
	source: z.enum(['capture', 'report']),
});
export type PayPalReceivable = z.infer<typeof PayPalReceivable>;

export const OrderPayment = z.object({
	id: Id,
	orderId: Id,
	method: PaymentMethod,
	state: PaymentRecordState,
	/** Rupees this payment counts for on the order. */
	amountINR: PriceINR,
	/** The currency the money moved in, and the amount in it. */
	currency: z.string().length(3),
	amount: z.number().nonnegative(),
	/** UPI UTR, bank UTR, receipt number: typed by staff. Gateway payments: the gateway's id (locked). */
	reference: z.string().max(120).nullable(),
	gateway: z
		.object({
			id: PaymentGateway,
			attemptId: z.string(),
			reference: z.string().nullable(),
			requestId: Id.nullable().default(null),
		})
		.nullable()
		.default(null),
	paypal: PayPalReceivable.nullable().default(null),
	/** Cash on delivery: who collects (our staff now; a courier's COD service later). */
	collector: z.enum(['staff', 'courier']).nullable().default(null),
	receivedOn: IsoDate.nullable(),
	/** RC series number, once issued (receipt). */
	receiptNumber: z.string().nullable().default(null),
	note: z.string().max(500).nullable().default(null),
	proofMediaId: Id.nullable().default(null),
	recordedBy: z.string().nullable(),
	recordedAt: IsoDateTime,
});
export type OrderPayment = z.infer<typeof OrderPayment>;

/** Record payment (manual methods, rupees only). */
export const ManualPaymentWrite = z.object({
	method: ManualPaymentMethod,
	amountINR: PriceINR.positive().max(100_000_000),
	reference: z.string().trim().min(1).max(120),
	receivedOn: IsoDate,
	/** Bank transfer not yet arrived: recorded as pending, marked received from the order later. */
	received: z.boolean().default(true),
	note: z.string().trim().max(500).nullable().default(null),
	proofMediaId: Id.nullable().default(null),
	collector: z.enum(['staff', 'courier']).nullable().default(null),
	revision: z.number().int().nonnegative(),
});
export type ManualPaymentWrite = z.infer<typeof ManualPaymentWrite>;

export const MarkPaymentReceivedWrite = z.object({
	reference: z.string().trim().min(1).max(120),
	receivedOn: IsoDate,
	revision: z.number().int().nonnegative(),
});
export type MarkPaymentReceivedWrite = z.infer<typeof MarkPaymentReceivedWrite>;

/* ---------------------------------------------------------------------------------------------- */
/* Payment requests                                                                               */
/* ---------------------------------------------------------------------------------------------- */

export const PaymentRequestStatus = z.enum(['active', 'paid', 'expired', 'cancelled', 'replaced', 'failed']);
export type PaymentRequestStatus = z.infer<typeof PaymentRequestStatus>;

export const PaymentRequestAttempt = z.object({
	at: IsoDateTime,
	/** What the gateway said, in our words. */
	state: z.enum(['pending', 'failed', 'captured', 'cancelled']),
	method: z.string().nullable().default(null),
	/** The bank's or gateway's reason, for staff only. */
	reason: z.string().max(300).nullable().default(null),
	gatewayReference: z.string().nullable().default(null),
});
export type PaymentRequestAttempt = z.infer<typeof PaymentRequestAttempt>;

export const PaymentRequestSend = z.object({
	channel: z.enum(['sms', 'email']),
	to: z.string(),
	at: IsoDateTime,
	by: z.string(),
});
export type PaymentRequestSend = z.infer<typeof PaymentRequestSend>;

export const PaymentRequest = z.object({
	id: Id,
	orderId: Id,
	/** `ST-48213-90761/Q1`. */
	number: z.string(),
	gateway: PaymentGateway,
	currency: z.string().length(3),
	/** In the request's currency (minor units avoided: two decimals at most). */
	amount: z.number().positive(),
	amountINR: PriceINR,
	/** The rate and markup a foreign request was priced at (each PayPal request at that day's rate, K10). */
	rateFromINR: z.number().positive(),
	markupPercent: z.number().nonnegative(),
	/** The gateway's own request id and link (payit.cc/…, paypal.com/invoice/…). */
	gatewayRequestId: z.string().nullable(),
	gatewayUrl: z.string().nullable(),
	/** Hash of the opaque token in our forwarding link; the token itself is shown once to staff. */
	tokenHash: z.string(),
	/** Our forwarding link (sahatextile.com/pay/<token>), for copy and for our own messages. */
	ourUrl: z.string().nullable().default(null),
	sentTo: z.object({ email: z.string().nullable(), mobile: z.string().nullable() }),
	expiresAt: IsoDateTime,
	status: PaymentRequestStatus,
	attempts: z.array(PaymentRequestAttempt).default([]),
	sends: z.array(PaymentRequestSend).default([]),
	replacedBy: Id.nullable().default(null),
	lastCheckedAt: IsoDateTime.nullable().default(null),
	createdBy: z.string(),
	createdAt: IsoDateTime,
});
export type PaymentRequest = z.infer<typeof PaymentRequest>;

/** Request online payment: never more than is due (oo07). */
export const PaymentRequestWrite = z.object({
	amountINR: PriceINR.positive(),
	/** The currency picks the gateway: ₹ → the INR gateway, any other → PayPal. */
	currency: z.string().length(3),
	validDays: z.number().int().min(1).max(30).optional(),
	revision: z.number().int().nonnegative(),
});
export type PaymentRequestWrite = z.infer<typeof PaymentRequestWrite>;

/** What a status check found (pl02, pl03). */
export const PaymentRequestCheck = z.object({
	request: PaymentRequest,
	/** True when this check recorded the payment on the order. */
	recorded: z.boolean(),
	payment: OrderPayment.nullable(),
});
export type PaymentRequestCheck = z.infer<typeof PaymentRequestCheck>;

/** The exact message before Send as SMS / Send as email (pr01, pr02). */
export const PaymentRequestMessagePreview = z.object({
	channel: z.enum(['sms', 'email']),
	to: z.string().nullable(),
	/** Why the button is off (an SMS only goes to Indian mobile numbers; no address on file). */
	unavailable: z.enum(['not_indian_mobile', 'no_mobile', 'no_email', 'sms_off', 'email_off']).nullable(),
	text: z.string(),
});
export type PaymentRequestMessagePreview = z.infer<typeof PaymentRequestMessagePreview>;

export const PaymentRequestSendWrite = z.object({ channel: z.enum(['sms', 'email']) });
export type PaymentRequestSendWrite = z.infer<typeof PaymentRequestSendWrite>;

/** What the shop's pay page shows for a link (shop10, shop11). */
export const PayPageView = z.discriminatedUnion('state', [
	z.object({
		state: z.literal('payable'),
		orderNumber: z.string(),
		currency: z.string().length(3),
		amount: z.number().positive(),
		items: z.array(z.object({ title: z.string(), quantity: z.number().int(), imageUrl: z.string().nullable() })),
		deliveryCity: z.string().nullable(),
		deliveryCountry: z.string().nullable(),
		expiresAt: IsoDateTime,
	}),
	z.object({ state: z.literal('paid'), orderNumber: z.string() }),
	/** Expired, cancelled or replaced without a newer request: nothing is charged. */
	z.object({
		state: z.literal('expired'),
		orderNumber: z.string(),
		/** From the store's contact settings, for the Call us / Email us anchors. */
		contactPhone: z.string().nullable(),
		contactEmail: z.string().nullable(),
	}),
]);
export type PayPageView = z.infer<typeof PayPageView>;

/* ---------------------------------------------------------------------------------------------- */
/* Shipments                                                                                       */
/* ---------------------------------------------------------------------------------------------- */

export const ProofOfDelivery = z.object({
	source: z.enum(['staff', 'courier']),
	reference: z.string().max(120).nullable().default(null),
	receivedBy: z.string().max(120).nullable().default(null),
	url: z.string().url().nullable().default(null),
	note: z.string().max(500).nullable().default(null),
});
export type ProofOfDelivery = z.infer<typeof ProofOfDelivery>;

export const Shipment = z.object({
	id: Id,
	orderId: Id,
	/** `ST-48213-90761/P1`. */
	number: z.string(),
	lineIds: z.array(Id),
	/** `manual`: courier details typed in; `provider`: a connected courier (none connected yet). */
	mode: z.enum(['manual', 'provider']),
	provider: z.string().nullable().default(null),
	courierName: z.string(),
	trackingNumber: z.string(),
	trackingUrl: z.string().url().nullable().default(null),
	shippedOn: IsoDate,
	deliveredOn: IsoDate.nullable().default(null),
	pod: ProofOfDelivery.nullable().default(null),
	events: z.array(z.object({ at: IsoDateTime, status: z.string(), note: z.string().nullable() })).default([]),
	createdBy: z.string().nullable(),
	createdAt: IsoDateTime,
});
export type Shipment = z.infer<typeof Shipment>;
