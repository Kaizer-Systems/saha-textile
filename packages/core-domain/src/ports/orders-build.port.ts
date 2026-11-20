import type {
	Business,
	BusinessListQuery,
	Coupon,
	CouponListQuery,
	CouponListResponse,
	DocumentNumberingSettings,
	EInvoiceRecord,
	EWayBillRecord,
	GeoCountry,
	GeoCountryDetail,
	LedgerEntry,
	LedgerSide,
	Order,
	OrderListQuery,
	OrderPayment,
	OrderSettings,
	PaymentAttempt,
	PaymentRequest,
	PinLookup,
	PriceZone,
	Shipment,
} from '@saha-textile/contracts';

import type { TransactionContext } from './transaction-manager.port';

/**
 * Ports for the orders and checkout build (brief v2.1, approved 2026-11-20). Repositories persist
 * the records; the e-invoice and e-way bill ports have no adapter yet, so the admin falls back to
 * typing the details by hand; `InvoiceDocumentPolicy` is a seam with no implementation chosen (D8.6).
 */

/** Refused because another save changed the record first (revision check). */
export class StaleRevisionError extends Error {
	constructor(
		readonly entity: string,
		readonly id: string,
		readonly changedBy: string | null = null,
		readonly changedAt: string | null = null,
	) {
		super(`${entity} ${id} was changed by another save`);
		this.name = 'StaleRevisionError';
	}
}

/** Thrown when an order number (or its stripped form) or an idempotency key already exists. */
export class DuplicateOrderKeyError extends Error {
	constructor(readonly key: 'orderNumber' | 'idempotencyKey') {
		super(`Duplicate order ${key}`);
		this.name = 'DuplicateOrderKeyError';
	}
}

/** Thrown when a coupon has reached its total uses. */
export class CouponUsedUpError extends Error {
	constructor(readonly couponId: string) {
		super(`Coupon ${couponId} has no uses left`);
		this.name = 'CouponUsedUpError';
	}
}

/** Thrown when a coupon code is already taken by another coupon. */
export class DuplicateCouponCodeError extends Error {
	constructor(readonly code: string) {
		super(`Coupon code ${code} is taken`);
		this.name = 'DuplicateCouponCodeError';
	}
}

/** Extra search words and staff attention reasons kept beside an order (never part of the record). */
export interface OrderWriteMeta {
	/** References found elsewhere (tracking numbers, payment references) the order is found by. */
	searchExtras?: readonly string[];
	attention?: readonly string[];
}

/** Orders as the admin works with them (the shop's reads stay on `OrderRepository`). */
export interface AdminOrderRepository {
	findById(id: string): Promise<Order | null>;
	/** Exact or message form (`ST-48213-90761` or `ST4821390761`). */
	findByNumber(number: string): Promise<Order | null>;
	findByIdempotencyKey(key: string): Promise<Order | null>;
	/** Saves a new order; refuses a number that already exists (stripped form included). */
	create(
		order: Order,
		idempotencyKey: string | null,
		context?: TransactionContext,
		meta?: OrderWriteMeta,
	): Promise<Order>;
	/** Saves a change when `expectedRevision` still matches, raising the revision. */
	update(order: Order, expectedRevision: number, context?: TransactionContext, meta?: OrderWriteMeta): Promise<Order>;
	/** Newest first; the list's filter, search and date range applied on the server. */
	list(query: OrderListQuery): Promise<{ orders: Order[]; total: number }>;
	/** Count per list filter (and `toPack`) for the same search and range. */
	counts(query: OrderListQuery): Promise<Record<string, number>>;
	/** Orders a business has on account and not settled, oldest first. */
	listOpenOnAccount(businessId: string): Promise<Array<{ orderId: string; dueINR: number; placedAt: string }>>;
	/** How many orders a customer has placed (first-order coupons). */
	countPlacedByCustomer(customerId: string): Promise<number>;
	/** Shop orders still waiting for payment whose 15-minute hold has run out (OD1), oldest first. */
	listHoldsEnded(now: Date, limit: number): Promise<Order[]>;
}

/** The shop's payment attempts (one per press of Pay); see `PaymentAttempt`. */
export interface PaymentAttemptRepository {
	findById(id: string): Promise<PaymentAttempt | null>;
	listByOrder(orderId: string): Promise<PaymentAttempt[]>;
	save(attempt: PaymentAttempt, context?: TransactionContext): Promise<PaymentAttempt>;
	/** Pending attempts whose next status enquiry is due, oldest first. */
	listDue(now: Date, limit: number): Promise<PaymentAttempt[]>;
}

export interface OrderPaymentRepository {
	listByOrder(orderId: string): Promise<OrderPayment[]>;
	findById(id: string): Promise<OrderPayment | null>;
	/** By the gateway's own payment id: a captured payment is recorded once, however often it is reported. */
	findByGatewayReference(gateway: string, reference: string): Promise<OrderPayment | null>;
	save(payment: OrderPayment, context?: TransactionContext): Promise<OrderPayment>;
}

export interface PaymentRequestRepository {
	listByOrder(orderId: string): Promise<PaymentRequest[]>;
	findById(id: string): Promise<PaymentRequest | null>;
	/** Our forwarding link: looked up by the token's hash, never the token. */
	findByTokenHash(tokenHash: string): Promise<PaymentRequest | null>;
	findByGatewayRequestId(gateway: string, gatewayRequestId: string): Promise<PaymentRequest | null>;
	save(request: PaymentRequest, context?: TransactionContext): Promise<PaymentRequest>;
	/** Active requests whose expiry has passed, for the sweep that marks them expired. */
	listExpired(now: Date, limit: number): Promise<PaymentRequest[]>;
}

export interface ShipmentRepository {
	listByOrder(orderId: string): Promise<Shipment[]>;
	save(shipment: Shipment, context?: TransactionContext): Promise<Shipment>;
	/** Courier names used before, for the Shipped popup's suggestions. */
	courierNames(limit: number): Promise<string[]>;
}

/** Businesses: the supplier record of the purchases module with the customer side added. */
export interface BusinessRepository {
	findById(id: string): Promise<Business | null>;
	list(query: BusinessListQuery): Promise<{ items: Business[]; total: number; counts: Record<string, number> }>;
	/** Name, trade name, phone or GSTIN (the Create order picker). */
	searchBuyers(q: string, limit: number): Promise<Business[]>;
	save(business: Business, expectedRevision: number | null, context?: TransactionContext): Promise<Business>;
	countByZone(zoneId: string): Promise<number>;
}

/** The two accounts of a business. Append-only: a mistake is undone by a reversing entry. */
export interface LedgerRepository {
	append(entry: LedgerEntry, context?: TransactionContext): Promise<LedgerEntry>;
	balance(businessId: string, side: LedgerSide): Promise<number>;
	list(
		businessId: string,
		side: LedgerSide,
		range: { from?: string; to?: string; page: number; pageSize: number },
	): Promise<{ rows: LedgerEntry[]; total: number; openingINR: number }>;
	findById(id: string): Promise<LedgerEntry | null>;
}

export interface PriceZoneRepository {
	list(): Promise<PriceZone[]>;
	findById(id: string): Promise<PriceZone | null>;
	/** Saves with a revision check; a change of the rules raises the version. */
	save(zone: PriceZone, expectedRevision: number | null): Promise<PriceZone>;
	delete(id: string): Promise<void>;
}

export interface CouponRepository {
	list(query: CouponListQuery, now: Date): Promise<CouponListResponse>;
	findById(id: string): Promise<Coupon | null>;
	findByCode(code: string): Promise<Coupon | null>;
	/** Coupons this channel can offer now (the admin checkout's popup). */
	listUsable(channel: 'shop' | 'admin', now: Date): Promise<Coupon[]>;
	save(coupon: Coupon, expectedRevision: number | null): Promise<Coupon>;
	setEnabled(ids: readonly string[], enabled: boolean, by: string): Promise<string[]>;
	delete(ids: readonly string[]): Promise<string[]>;
	/** Counts a use when an order is placed; refuses past the total limit atomically. */
	recordUse(couponId: string, buyerKey: string, orderId: string, context?: TransactionContext): Promise<void>;
	usesBy(couponId: string, buyerKey: string): Promise<number>;
	usedOnOrders(couponId: string): Promise<boolean>;
}

export interface DocumentNumberingRepository {
	get(): Promise<DocumentNumberingSettings>;
	save(settings: DocumentNumberingSettings, expectedRevision: number): Promise<DocumentNumberingSettings>;
	/** Marks a type locked the first time it issues a number (inside the posting transaction). */
	lock(type: string, context?: TransactionContext): Promise<void>;
}

export interface OrderSettingsRepository {
	get(): Promise<OrderSettings>;
	save(settings: OrderSettings, expectedRevision: number): Promise<OrderSettings>;
}

/** Country, State and phone data from the repository's own data file. */
export interface GeoDataPort {
	countries(): Promise<GeoCountry[]>;
	country(code: string): Promise<GeoCountryDetail | null>;
	/**
	 * India Post directory; `deliverable` is null while no courier is connected. Null when the PIN
	 * directory is not loaded yet (no data.gov.in key): address checks then skip the PIN checks.
	 */
	pin(pin: string): Promise<PinLookup | null>;
	/** Mobile number lengths for a calling code (from libphonenumber's data). */
	mobileLengths(callingCode: string): Promise<number[] | null>;
	/** Full check of a phone number with libphonenumber's rules. */
	isValidMobile(callingCode: string, number: string): Promise<boolean>;
}

/* ---------------------------------------------------------------------------------------------- */
/* E-invoice and e-way bill (no adapter yet: the admin types the details)                          */
/* ---------------------------------------------------------------------------------------------- */

export type EDocumentOutcome<T> =
	{ kind: 'notConnected' } | { kind: 'raised'; record: T } | { kind: 'refused'; message: string };

export interface EInvoicePort {
	readonly connected: boolean;
	raise(order: Order): Promise<EDocumentOutcome<Omit<EInvoiceRecord, 'by' | 'at'>>>;
}

export interface EWayBillPort {
	readonly connected: boolean;
	raise(order: Order): Promise<EDocumentOutcome<Omit<EWayBillRecord, 'by' | 'at'>>>;
}

/** The ports with nothing connected: Raise falls back to the manual popup. */
export const NOT_CONNECTED_EINVOICE: EInvoicePort = { connected: false, raise: async () => ({ kind: 'notConnected' }) };
export const NOT_CONNECTED_EWAYBILL: EWayBillPort = { connected: false, raise: async () => ({ kind: 'notConnected' }) };

/* ---------------------------------------------------------------------------------------------- */
/* Invoice documents (D8.6 open: seam only)                                                        */
/* ---------------------------------------------------------------------------------------------- */

/**
 * How an order paid in a foreign currency with an Indian invoice address is invoiced: which
 * currency, and how many documents (D8.6, open with the owner and the CA). No implementation is
 * chosen: the order keeps both currency records, so any answer can be applied later.
 */
export interface InvoiceDocumentPolicy {
	readonly key: string;
	documentsFor(order: Order): Array<{ kind: 'taxInvoice' | 'receipt'; currency: string }>;
}

/* ---------------------------------------------------------------------------------------------- */
/* Payment requests: the gateway's own (CCAvenue Quick Invoice, PayPal Invoicing v2)              */
/* ---------------------------------------------------------------------------------------------- */

export interface CreatePaymentRequestInput {
	/** Ours, unique per request (`ST-48213-90761/Q1`); sent as the invoice / merchant reference. */
	reference: string;
	orderNumber: string;
	currency: string;
	/** Whole minor units. */
	amountMinor: number;
	customer: { name: string; email: string | null; mobile: { countryCallingCode: string; number: string } | null };
	validDays: number;
	/** The gateway's own message wording (CCAvenue lets us pass the SMS text and email subject). */
	emailSubject: string;
	smsText: string | null;
	items: ReadonlyArray<{ name: string; quantity: number; unitAmountMinor: number }>;
}

export interface CreatedPaymentRequest {
	gatewayRequestId: string;
	/** The gateway's own link (payit.cc/…, paypal.com/invoice/…). */
	url: string;
	auditRecord: Readonly<Record<string, string>>;
}

export interface PaymentRequestStatusReport {
	gatewayRequestId: string;
	state: 'open' | 'paid' | 'partlyPaid' | 'cancelled' | 'expired' | 'unknown';
	payments: ReadonlyArray<{
		gatewayReference: string;
		amountMinor: number;
		currency: string;
		at: string;
		method: string | null;
	}>;
	auditRecord: Readonly<Record<string, string>>;
}

/** A gateway that sends its own payment requests. */
export interface PaymentRequestPort {
	readonly gateway: 'ccavenue' | 'paypal';
	createPaymentRequest(input: CreatePaymentRequestInput): Promise<CreatedPaymentRequest>;
	fetchPaymentRequestStatus(gatewayRequestId: string): Promise<PaymentRequestStatusReport>;
	cancelPaymentRequest(gatewayRequestId: string): Promise<void>;
}
