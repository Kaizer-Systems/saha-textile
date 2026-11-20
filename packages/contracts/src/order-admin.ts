import { z } from 'zod';

import { PostalAddressInput } from './address-book';
import { CartAddonValue } from './cart';
import { Id, IsoDateTime, PriceINR } from './common';
import { AppliedCoupon } from './coupon';
import { Order, OrderChannel, OrderPaymentStatus, OrderStatus } from './order';
import { ManualPaymentWrite, OrderPayment, PaymentRequest, Shipment } from './order-payment';
import { ZoneLinePrice } from './price-zone';
import { IsoDate } from './purchasing';

/**
 * Admin ordering (brief ol02–ol04, oc01–oc03, ck01–ck08, od05–od08, st01–st05, oo01–oo08; owner
 * 2026-11-16 to 2026-11-20). Shapes for the orders list, the admin cart, creating an order, moving
 * it along the status machine, and the order page's own actions.
 */

/* ---------------------------------------------------------------------------------------------- */
/* Orders list                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

export const OrderListFilter = z.enum([
	'all',
	'needsAttention',
	'open',
	'awaitingPayment',
	'placed',
	'processing',
	'packed',
	'shipped',
	'delivered',
	'cancelled',
]);
export type OrderListFilter = z.infer<typeof OrderListFilter>;

export const OrderListQuery = z.object({
	/** Order number with or without separators, name, email, phone, tracking number, payment reference. */
	q: z.string().trim().max(100).optional(),
	filter: OrderListFilter.default('all'),
	payment: OrderPaymentStatus.optional(),
	channel: OrderChannel.optional(),
	buyerKind: z.enum(['person', 'business']).optional(),
	currency: z.string().length(3).optional(),
	/** Date range on the order date (India days, inclusive). Owner, 2026-11-20. */
	from: IsoDate.optional(),
	to: IsoDate.optional(),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(15),
});
export type OrderListQuery = z.infer<typeof OrderListQuery>;

/** Why an order needs staff (ol03). */
export const AttentionReason = z.enum(['invoiceAddressNeeded', 'requestExpiredUnpaid', 'pendingAtBank', 'openTooLong']);
export type AttentionReason = z.infer<typeof AttentionReason>;

export const OrderListRow = z.object({
	id: Id,
	orderNumber: z.string(),
	createdAt: IsoDateTime,
	channel: OrderChannel,
	buyerName: z.string(),
	buyerKind: z.enum(['person', 'business']),
	currency: z.string().length(3),
	total: z.number().nonnegative(),
	totalINR: PriceINR,
	status: OrderStatus,
	paymentStatus: OrderPaymentStatus,
	/** The payment line under the chip: "UPI · 4021…", "Link sent · PayPal · until 27 Nov". */
	paymentDetail: z.string().nullable(),
	attention: z.array(AttentionReason),
	/** Open orders: pieces held, goods so far, paid, balance. */
	open: z
		.object({
			openedAt: IsoDateTime,
			piecesHeld: z.number().int().nonnegative(),
			goodsINR: PriceINR,
			paidINR: PriceINR,
			dueINR: PriceINR,
			paidAheadINR: PriceINR,
		})
		.nullable(),
});
export type OrderListRow = z.infer<typeof OrderListRow>;

export const OrderListResponse = z.object({
	items: z.array(OrderListRow),
	total: z.number().int().nonnegative(),
	counts: z.record(OrderListFilter, z.number().int().nonnegative()),
	/** The four tiles: needs attention, awaiting payment, to pack, shipped not delivered. */
	tiles: z.object({
		needsAttention: z.number().int().nonnegative(),
		awaitingPayment: z.number().int().nonnegative(),
		toPack: z.number().int().nonnegative(),
		shippedNotDelivered: z.number().int().nonnegative(),
	}),
});
export type OrderListResponse = z.infer<typeof OrderListResponse>;

/* ---------------------------------------------------------------------------------------------- */
/* Admin cart and create order                                                                     */
/* ---------------------------------------------------------------------------------------------- */

export const AdminOrderBuyerRef = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('person'), customerId: Id }),
	z.object({ kind: z.literal('business'), businessId: Id }),
]);
export type AdminOrderBuyerRef = z.infer<typeof AdminOrderBuyerRef>;

export const AdminCartLineWrite = z.object({
	productId: Id,
	variationId: Id.nullable().default(null),
	quantity: z.number().int().positive().max(9999),
	addons: z.array(CartAddonValue).max(40).default([]),
});
export type AdminCartLineWrite = z.infer<typeof AdminCartLineWrite>;

/** The create-order screen's cart, priced by the server (the same engine as the shop's cart). */
export const AdminCartWrite = z.object({
	buyer: AdminOrderBuyerRef.nullable(),
	/** The currency can be switched at any time; the cart is priced again. */
	currency: z.string().length(3),
	lines: z.array(AdminCartLineWrite).max(500),
});
export type AdminCartWrite = z.infer<typeof AdminCartWrite>;

export const AdminCartLine = z.object({
	lineId: Id,
	productId: Id,
	variationId: Id.nullable(),
	title: z.string(),
	sku: z.string(),
	quantity: z.number().int().positive(),
	imageUrl: z.string().nullable(),
	unitPriceINR: PriceINR,
	unitPrice: z.number().nonnegative(),
	lineTotal: z.number().nonnegative(),
	/** Business orders: how the zone priced the line. */
	zonePrice: ZoneLinePrice.nullable(),
	problem: z.enum(['out_of_stock', 'limited', 'unavailable', 'noZonePrice']).nullable(),
});
export type AdminCartLine = z.infer<typeof AdminCartLine>;

export const AdminCartView = z.object({
	currency: z.string().length(3),
	/** US$ prices include the PayPal markup; manual payments are always ₹ at ₹ prices (K3). */
	markupPercent: z.number().nonnegative(),
	lines: z.array(AdminCartLine),
	subtotal: z.number().nonnegative(),
	subtotalINR: PriceINR,
});
export type AdminCartView = z.infer<typeof AdminCartView>;

/** One product card on the create-order screen, priced for the chosen buyer (zone cards). */
export const AdminProductCard = z.object({
	productId: Id,
	title: z.string(),
	imageUrl: z.string().nullable(),
	categoryIds: z.array(Id),
	hasVariants: z.boolean(),
	stock: z.number().int().nonnegative().nullable(),
	/** Retail price in rupees (what a shop customer pays now, sale included). */
	retailINR: PriceINR,
	/** The buyer's price in the chosen currency; null when the zone has no price for it. */
	price: z.number().nonnegative().nullable(),
	/** `noPrice` greys the card: "Price not set for this zone" in red, no click, no quantity. */
	zonePrice: ZoneLinePrice.nullable(),
});
export type AdminProductCard = z.infer<typeof AdminProductCard>;

export const AdminProductCardQuery = z.object({
	q: z.string().trim().max(100).optional(),
	categoryId: Id.optional(),
	businessId: Id.optional(),
	currency: z.string().length(3).default('INR'),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(60).default(24),
});
export type AdminProductCardQuery = z.infer<typeof AdminProductCardQuery>;

/** How the admin checkout takes the money (ck01–ck08). */
export const AdminCheckoutPayment = z.discriminatedUnion('method', [
	/** A payment request through the gateway the currency picks; the order waits for payment. */
	z.object({ method: z.literal('paymentLink'), validDays: z.number().int().min(1).max(30).optional() }),
	z.object({ method: z.literal('manual'), payment: ManualPaymentWrite.omit({ revision: true }) }),
	z.object({ method: z.literal('cashOnDelivery'), collector: z.enum(['staff', 'courier']).default('staff') }),
	z.object({
		method: z.literal('onAccount'),
		creditOverrideReason: z.string().trim().min(3).max(500).nullable().default(null),
	}),
	/** An open order: no payment yet; pieces held, payments any time. */
	z.object({ method: z.literal('keepOpen') }),
]);
export type AdminCheckoutPayment = z.infer<typeof AdminCheckoutPayment>;

export const AdminOrderAddressChoice = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('saved'), savedAddressId: Id }),
	z.object({
		kind: z.literal('new'),
		address: PostalAddressInput,
		/** "Save to the customer's addresses", with its name. */
		saveAs: z.string().trim().min(1).max(80).nullable().default(null),
	}),
]);
export type AdminOrderAddressChoice = z.infer<typeof AdminOrderAddressChoice>;

export const AdminOrderCreate = z.object({
	cart: AdminCartWrite.extend({ buyer: AdminOrderBuyerRef }),
	delivery: AdminOrderAddressChoice,
	/** Null when "Same as delivery address" stays ticked. */
	billing: AdminOrderAddressChoice.nullable(),
	/** Export-off path only: the optional Indian invoice address (ck02). */
	indianInvoiceAddress: PostalAddressInput.nullable().default(null),
	couponCodes: z.array(z.string().trim().min(1).max(24)).max(5).default([]),
	payment: AdminCheckoutPayment,
	comment: z.string().trim().max(1000).nullable().default(null),
	/** Sent by the screen so a double click can't create two orders. */
	idempotencyKey: z.string().min(16).max(80),
});
export type AdminOrderCreate = z.infer<typeof AdminOrderCreate>;

/** The checkout summary the admin sees before placing (totals in both currencies, shipping with its reason). */
export const AdminCheckoutQuote = z.object({
	currency: z.string().length(3),
	lines: z.array(AdminCartLine),
	coupons: z.array(AppliedCoupon),
	couponRefusals: z.array(z.object({ code: z.string(), refusal: z.string() })),
	shipping: z.object({
		chargeINR: PriceINR,
		charge: z.number().nonnegative(),
		zone: z.enum(['domestic', 'international']),
		trace: z.array(z.string()),
		ruleSets: z.array(z.object({ id: Id, version: z.number().int(), name: z.string() })),
		cannotShip: z.array(z.object({ lineId: Id, reason: z.string() })),
	}),
	totals: z.object({
		goodsINR: PriceINR,
		couponINR: PriceINR,
		shippingINR: PriceINR,
		totalINR: PriceINR,
		total: z.number(),
	}),
	/** ₹ → INR gateway; anything else → PayPal. Null when the routing setting has no gateway for it. */
	gateway: z.enum(['ccavenue', 'razorpay', 'paypal']).nullable(),
	/** K2: billing in India with a foreign currency. */
	warnings: z.array(z.enum(['indiaBillingForeignCurrency', 'inrGatewayForeignCards', 'smsNotIndianMobile'])),
	invoiceAddress: z.object({ source: z.string(), needed: z.boolean() }),
	credit: z
		.object({
			limitINR: PriceINR,
			usedINR: PriceINR,
			thisOrderINR: PriceINR,
			availableINR: z.number(),
			dueOn: IsoDate.nullable(),
		})
		.nullable(),
	/** Methods that can't be used for this order, with the reason. */
	methodsOff: z.array(z.object({ method: z.string(), reason: z.string() })),
});
export type AdminCheckoutQuote = z.infer<typeof AdminCheckoutQuote>;

/* ---------------------------------------------------------------------------------------------- */
/* Status machine                                                                                  */
/* ---------------------------------------------------------------------------------------------- */

/** Fields a status needs (st01–st05). */
export const StatusNeed = z.enum([
	'courier',
	'trackingNumber',
	'deliveredOn',
	'cancelReason',
	'invoiceAddress',
	'eDocuments',
]);
export type StatusNeed = z.infer<typeof StatusNeed>;

export const StatusBlockReason = z.enum([
	'packFirst',
	'shipFirst',
	'addInvoiceAddressFirst',
	'madeToOrderPastProcessing',
	'readyPastPacked',
	'alreadyShipped',
	'notPaid',
	'onlyFromCourier',
	'closeOpenOrderFirst',
	'eDocumentsMissing',
]);
export type StatusBlockReason = z.infer<typeof StatusBlockReason>;

export const AllowedNextStatus = z.object({
	to: OrderStatus,
	allowed: z.boolean(),
	reason: StatusBlockReason.nullable(),
	needs: z.array(StatusNeed),
	/** Shown when allowed with a warning (e-documents set to `warn`). */
	warning: StatusBlockReason.nullable().default(null),
	/** What the customer will be told (template names). */
	tells: z.array(z.string()),
});
export type AllowedNextStatus = z.infer<typeof AllowedNextStatus>;

export const StatusChangeWrite = z.object({
	to: OrderStatus,
	comment: z.string().trim().max(1000).nullable().default(null),
	shipped: z
		.object({
			mode: z.enum(['manual', 'provider']).default('manual'),
			courierName: z.string().trim().min(1).max(80),
			trackingNumber: z.string().trim().min(1).max(60),
			trackingUrl: z.string().trim().url().max(500).nullable().default(null),
			shippedOn: IsoDate,
			lineIds: z.array(Id).optional(),
		})
		.nullable()
		.default(null),
	delivered: z
		.object({
			deliveredOn: IsoDate,
			receivedBy: z.string().trim().max(120).nullable().default(null),
			podReference: z.string().trim().max(120).nullable().default(null),
		})
		.nullable()
		.default(null),
	cancel: z
		.object({
			reason: z.enum(['customerAsked', 'outOfStock', 'paymentNotReceived', 'fraudSuspected', 'other']),
			note: z.string().trim().max(500).nullable().default(null),
		})
		.nullable()
		.default(null),
	/** Per-line Processing: the lines it covers; empty = the whole order. */
	lineIds: z.array(Id).default([]),
	revision: z.number().int().nonnegative(),
});
export type StatusChangeWrite = z.infer<typeof StatusChangeWrite>;

export const InvoiceAddressWrite = z.object({
	address: PostalAddressInput,
	confirmedHow: z.string().trim().min(2).max(200),
	revision: z.number().int().nonnegative(),
});
export type InvoiceAddressWrite = z.infer<typeof InvoiceAddressWrite>;

export const OrderCommentWrite = z.object({
	comment: z.string().trim().min(1).max(1000),
	revision: z.number().int().nonnegative(),
});
export type OrderCommentWrite = z.infer<typeof OrderCommentWrite>;

/* ---------------------------------------------------------------------------------------------- */
/* Open orders                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

export const OpenOrderAddLines = z.object({
	lines: z.array(AdminCartLineWrite).min(1).max(100),
	revision: z.number().int().nonnegative(),
});
export type OpenOrderAddLines = z.infer<typeof OpenOrderAddLines>;

export const OpenOrderRemoveLine = z.object({
	lineId: Id,
	reason: z.string().trim().max(300).nullable().default(null),
	revision: z.number().int().nonnegative(),
});
export type OpenOrderRemoveLine = z.infer<typeof OpenOrderRemoveLine>;

/** Close (oo08): stop adding, price shipping for one parcel, then request the rest or record later. */
export const OpenOrderClose = z.object({
	then: z.enum(['requestOnline', 'recordLater', 'toAccount']),
	currency: z.string().length(3).default('INR'),
	revision: z.number().int().nonnegative(),
});
export type OpenOrderClose = z.infer<typeof OpenOrderClose>;

/* ---------------------------------------------------------------------------------------------- */
/* E-invoice and e-way bill                                                                        */
/* ---------------------------------------------------------------------------------------------- */

export const EInvoiceWrite = z.object({
	irn: z
		.string()
		.trim()
		.regex(/^[0-9a-fA-F]{64}$/, { message: 'irn_shape' }),
	ackNo: z.string().trim().min(1).max(20),
	ackDate: IsoDateTime,
	signedQr: z.string().trim().max(4000).nullable().default(null),
	revision: z.number().int().nonnegative(),
});
export type EInvoiceWrite = z.infer<typeof EInvoiceWrite>;

export const EWayBillWrite = z.object({
	number: z
		.string()
		.trim()
		.regex(/^\d{12}$/, { message: 'ewb_shape' }),
	generatedOn: IsoDateTime,
	validUntil: IsoDateTime,
	transporterName: z.string().trim().max(120).nullable().default(null),
	transporterId: z.string().trim().max(20).nullable().default(null),
	vehicleOrDocumentNo: z.string().trim().max(40).nullable().default(null),
	distanceKm: z.number().int().nonnegative().max(4_000).nullable().default(null),
	revision: z.number().int().nonnegative(),
});
export type EWayBillWrite = z.infer<typeof EWayBillWrite>;

/** Raise e-invoice / Raise e-way bill: the integration's answer, or "not connected" → manual popup. */
export const RaiseEDocumentResult = z.discriminatedUnion('outcome', [
	z.object({ outcome: z.literal('notConnected') }),
	z.object({ outcome: z.literal('raised'), order: Order }),
	z.object({ outcome: z.literal('refused'), message: z.string() }),
]);
export type RaiseEDocumentResult = z.infer<typeof RaiseEDocumentResult>;

/* ---------------------------------------------------------------------------------------------- */
/* Order page                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

/** Everything the order page shows, in one read. */
export const AdminOrderDetail = z.object({
	order: Order,
	payments: z.array(OrderPayment),
	requests: z.array(PaymentRequest),
	shipments: z.array(Shipment),
	allowedNext: z.array(AllowedNextStatus),
	attention: z.array(AttentionReason),
	/** Business orders: the credit picture and standing at a glance. */
	credit: z
		.object({
			limitINR: PriceINR,
			usedINR: PriceINR,
			availableINR: z.number(),
			standing: z.string(),
			creditDays: z.number().int(),
		})
		.nullable(),
	/** Whether the e-invoice / e-way bill block shows (business orders) and the gate setting. */
	eDocuments: z.object({ shown: z.boolean(), gate: z.enum(['off', 'warn', 'block']), connected: z.boolean() }),
});
export type AdminOrderDetail = z.infer<typeof AdminOrderDetail>;
