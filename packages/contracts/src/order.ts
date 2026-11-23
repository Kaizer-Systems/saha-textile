import { z } from 'zod';

import { PhoneNumber, PostalAddressFields } from './address-book';
import { AppliedCoupon } from './coupon';
import { I18nString, Id, IsoDateTime, LocaleCode, PriceINR } from './common';
import { OrderZoneSnapshot, ZoneRuleRef } from './price-zone';

/**
 * Orders (orders and checkout brief v2.1, approved 2026-11-20; `DEC-ORDER-SNAPSHOT` A, 2026-11-15).
 *
 * One record for shop orders and admin orders, B2C and B2B. The order keeps its own copy of what
 * was sold and how it was priced (rule set and version, the charge with its explanation, the
 * exchange rate and the PayPal markup, the zone and the rule that priced each line), so later
 * changes to products, rules or rates never change a placed order.
 *
 * Fulfilment status and payment status are separate. Payments, payment requests and shipments are
 * their own records pointing at the order. Refunds and returns will be separate records naming
 * lines (`DEC-RETURNS`, open).
 *
 * Older rows (before 2026-11-20) hold the first status list (`pending`, `paid`, `refunded`); they
 * read as `awaiting_payment`, `placed` and `cancelled` and are never rewritten.
 */

/** Open → Awaiting payment → Placed → Processing → Packed → Shipped → (Out for delivery) → Delivered; or Cancelled. */
export const OrderStatus = z.enum([
	'open',
	'awaiting_payment',
	'placed',
	'processing',
	'packed',
	'shipped',
	'out_for_delivery',
	'delivered',
	'cancelled',
]);
export type OrderStatus = z.infer<typeof OrderStatus>;

/** How rows written with the first status list read today. */
export const LEGACY_ORDER_STATUS: Readonly<Record<string, OrderStatus>> = {
	pending: 'awaiting_payment',
	paid: 'placed',
	refunded: 'cancelled',
};

/** A stored status, older values mapped. */
export const StoredOrderStatus = z.preprocess(
	(value) => (typeof value === 'string' && value in LEGACY_ORDER_STATUS ? LEGACY_ORDER_STATUS[value] : value),
	OrderStatus,
);

/** Orders the shop was actually paid for (or placed on trust: cash on delivery, on account). */
export const PURCHASED_ORDER_STATUSES = [
	'placed',
	'processing',
	'packed',
	'shipped',
	'out_for_delivery',
	'delivered',
] as const satisfies readonly OrderStatus[];

/** The same set as stored values, older rows included: for database filters only. */
export const PURCHASED_STORED_ORDER_STATUSES: readonly string[] = [...PURCHASED_ORDER_STATUSES, 'paid'];

export const PaymentGateway = z.enum(['ccavenue', 'paypal']);
export type PaymentGateway = z.infer<typeof PaymentGateway>;

/** Where the money stands, beside the fulfilment status. Worked out from the payment records. */
export const OrderPaymentStatus = z.enum([
	'unpaid',
	'request_sent',
	'pending_at_bank',
	'paid',
	'part_paid',
	'paid_ahead',
	'due_on_delivery',
	'on_account',
	'refunded',
	'part_refunded',
]);
export type OrderPaymentStatus = z.infer<typeof OrderPaymentStatus>;

export const OrderChannel = z.enum(['shop', 'admin']);
export type OrderChannel = z.infer<typeof OrderChannel>;

export const OrderLineAddon = z.object({
	code: z.string().min(1),
	label: z.string().optional(),
	value: z.union([z.string(), z.number()]),
	/** The add-on's own price on this line, in rupees, when it has one (stitching). */
	priceINR: PriceINR.optional(),
});
export type OrderLineAddon = z.infer<typeof OrderLineAddon>;

/** How the line's unit price was reached (kept on the line). */
export const OrderLinePricing = z.object({
	/** The regular price (MRP or the product's own price) before any sale. */
	regularUnitINR: PriceINR,
	/** The printed MRP when it is above the price charged (od05: "MRP ₹9,800 · ₹8,900"). */
	mrpUnitINR: PriceINR.nullable().default(null),
	/** The sale price when a sale event priced the line; null otherwise. */
	saleUnitINR: PriceINR.nullable().default(null),
	saleEventId: Id.nullable().default(null),
	/** Business orders: the zone rule that priced the line (tier, rule id and name). */
	zoneRule: ZoneRuleRef.nullable().default(null),
	/** Whether the line counts as discounted for shipping rules (selling price below MRP; coupons never count). */
	discounted: z.boolean().default(false),
	/** Business orders: the zone rule also priced the line's stitching and add-ons (DEC-B2B-ZONES). */
	addOnsZonePriced: z.boolean().default(false),
});
export type OrderLinePricing = z.infer<typeof OrderLinePricing>;

/** The tax snapshot of a line. HSN codes and rates wait on the CA (B2.4–B2.6): null until known. */
export const OrderLineTax = z.object({
	hsn: z.string().nullable().default(null),
	ratePercent: z.number().nonnegative().nullable().default(null),
	taxableINR: PriceINR.nullable().default(null),
	taxINR: PriceINR.nullable().default(null),
});
export type OrderLineTax = z.infer<typeof OrderLineTax>;

/** A snapshot of a sold line — prices in INR and in the order's currency. */
export const OrderLine = z.object({
	/** Stable id within the order (payments, coupons, shipments and returns name lines by it). */
	lineId: Id.optional(),
	productId: Id,
	variationId: Id.nullable().default(null),
	title: I18nString,
	sku: z.string().min(1),
	quantity: z.number().int().positive(),
	attributes: z.record(z.string(), z.string()).default({}),
	addons: z.array(OrderLineAddon).default([]),
	/** Primary picture reference at the time of sale. */
	imageAssetId: Id.nullable().optional(),
	/** The card picture's address at the time of sale, for the order page's item rows (od05). */
	imageUrl: z.string().nullable().optional(),
	unitPriceINR: PriceINR,
	unitPricePaid: z.number().nonnegative(),
	lineTotalINR: PriceINR,
	lineTotalPaid: z.number().nonnegative(),
	pricing: OrderLinePricing.optional(),
	/** Coupon money taken off this line, summed over every applied coupon. */
	couponINR: PriceINR.default(0),
	tax: OrderLineTax.optional(),
	categoryIds: z.array(Id).default([]),
	mainCategoryId: Id.nullable().optional(),
	returnable: z.boolean().optional(),
	/** Made to order or stitched: can't be cancelled once the line is Processing (OD12). */
	madeToOrder: z.boolean().optional(),
	returnWindowDays: z.number().int().nonnegative().nullable().optional(),
	/** Cost of goods when known (purchases module). */
	unitCostINR: PriceINR.nullable().optional(),
	/** The shipping rule set (and version) that priced this line's delivery. */
	shippingRuleSet: z.object({ id: Id, version: z.number().int().positive() }).nullable().optional(),
	/** Pieces on admin orders are held from save until removed or the order is cancelled (K7). */
	held: z.boolean().default(false),
	/**
	 * What the line is (bundle builder brief E05–E08, approved 2026-11-22): a product on its own; a set, which holds
	 * no money, stock or tax of its own; or, beneath its parent, a set's piece (at its share of the set price), a
	 * free item (₹0) or an extra. Lines saved before sets existed read as products.
	 */
	role: z.enum(['product', 'bundle', 'piece', 'free', 'extra']).default('product'),
	/** The line this one sits under: a piece's or an extra's set, a free item's piece or product. */
	parentLineId: Id.nullable().default(null),
	/** A set's line only: its heading on the shop, its price and what its pieces cost separately ("You save"). */
	set: z
		.object({
			heading: z.enum(['components', 'choose']),
			priceINR: PriceINR,
			separatelyINR: PriceINR.nullable(),
		})
		.nullable()
		.default(null),
	addedAt: IsoDateTime.optional(),
	addedBy: z.string().nullable().optional(),
});
export type OrderLine = z.infer<typeof OrderLine>;
/** An order line as code builds it (defaults filled when the order is parsed). */
export type OrderLineInput = z.input<typeof OrderLine>;

/** An address kept on the order exactly as typed or picked. */
export const OrderAddress = PostalAddressFields.extend({
	/** The saved address it came from, when picked from the book. */
	savedAddressId: Id.nullable().default(null),
});
export type OrderAddress = z.infer<typeof OrderAddress>;

/**
 * Where the invoice goes (shipping brief od01–od04; export-off path only). `source` names which
 * address it is; `needed` is the staff-only "Invoice address needed" flag that keeps the order from
 * being packed.
 */
export const OrderInvoiceAddress = z.object({
	source: z.enum(['billing', 'delivery', 'addressInIndia', 'staff', 'none']),
	address: OrderAddress.nullable().default(null),
	needed: z.boolean().default(false),
	addedBy: z.string().nullable().default(null),
	/** How staff confirmed it (call, email, chat), when they added it. */
	confirmedHow: z.string().max(200).nullable().default(null),
	at: IsoDateTime.nullable().default(null),
});
export type OrderInvoiceAddress = z.infer<typeof OrderInvoiceAddress>;

export const OrderAddresses = z.object({
	billing: OrderAddress,
	delivery: OrderAddress,
	/** "Same as delivery address" was ticked (B1.2: always both, ticked by default). */
	billingSameAsDelivery: z.boolean().default(true),
	/** The optional "Address in India" given at checkout, as typed, complete or not. */
	addressInIndia: OrderAddress.nullable().default(null),
	invoice: OrderInvoiceAddress.default({
		source: 'none',
		address: null,
		needed: false,
		addedBy: null,
		confirmedHow: null,
		at: null,
	}),
});
export type OrderAddresses = z.infer<typeof OrderAddresses>;

/** Who the order is for. The contact is the billing contact (payment links go here, never to the India address). */
export const OrderBuyer = z.object({
	kind: z.enum(['person', 'business']),
	customerId: Id.nullable().default(null),
	businessId: Id.nullable().default(null),
	name: z.string().min(1),
	email: z.string().nullable().default(null),
	mobile: PhoneNumber.nullable().default(null),
	gstin: z.string().nullable().default(null),
});
export type OrderBuyer = z.infer<typeof OrderBuyer>;

/** The rate an order was priced at, kept for the record (FX5: the active source; never learnt from payments). */
export const OrderCurrencyRecord = z.object({
	code: z.string().length(3),
	/** Multiplier from rupees (1 for INR). */
	rateFromINR: z.number().positive(),
	/** Rupees per unit as staff read it; null for INR. */
	inrPerUnit: z.number().positive().nullable(),
	source: z.enum(['home', 'staff', 'fetch', 'paypalFxaas']),
	rateSetAt: IsoDateTime.nullable(),
	/** The PayPal markup included in foreign prices (6% for Saha Textile); 0 for INR. */
	markupPercent: z.number().nonnegative(),
	pricedAt: IsoDateTime,
});
export type OrderCurrencyRecord = z.infer<typeof OrderCurrencyRecord>;

export const OrderShipping = z.object({
	value: z.number().nonnegative(),
	currency: z.string().length(3),
	provider: z.string().optional(),
	method: z.string().optional(),
	/** Rupee charge (the canonical figure). */
	chargeINR: PriceINR.optional(),
	zone: z.enum(['domestic', 'international']).optional(),
	deliveryCountry: z.string().length(2).optional(),
	/** The engine's explanation, step by step, as the order page shows it. */
	trace: z.array(z.string()).default([]),
	ruleSets: z
		.array(z.object({ id: Id, version: z.number().int().positive(), name: z.string().optional() }))
		.default([]),
	/** Open orders: worked out when the order is closed, for one parcel. */
	pending: z.boolean().default(false),
	/** Each line's units and whether it was discounted, so the order page can word the reason (od05). */
	pieces: z
		.array(z.object({ lineId: z.string(), units: z.number().int().nonnegative(), discounted: z.boolean() }))
		.default([]),
});
export type OrderShipping = z.infer<typeof OrderShipping>;

export const AppliedPromotion = z.object({
	promotionId: Id,
	code: z.string().nullable().default(null),
	amountINR: z.number().nonnegative(),
});
export type AppliedPromotion = z.infer<typeof AppliedPromotion>;

export const OrderStatusEvent = z.object({
	status: StoredOrderStatus,
	at: IsoDateTime,
	note: z.string().optional(),
});
export type OrderStatusEvent = z.infer<typeof OrderStatusEvent>;

/** One line of the order's history: every change, comment and message, with who and when. */
export const OrderHistoryEntry = z.object({
	at: IsoDateTime,
	by: z.string().nullable(),
	byName: z.string().nullable().default(null),
	kind: z.enum([
		'created',
		'status',
		'comment',
		'payment',
		'paymentRequest',
		'message',
		'lineAdded',
		'lineRemoved',
		'invoiceAddress',
		'eDocument',
		'shipment',
		'closed',
		'coupon',
	]),
	from: z.string().nullable().default(null),
	to: z.string().nullable().default(null),
	comment: z.string().max(1000).nullable().default(null),
	/** Messages that went to the customer with this change (email / SMS template names). */
	messages: z.array(z.object({ channel: z.enum(['email', 'sms']), template: z.string() })).default([]),
	detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});
export type OrderHistoryEntry = z.infer<typeof OrderHistoryEntry>;

/** Running money on the order, in rupees (open orders keep their balance in ₹, concern K10). */
export const OrderBalance = z.object({
	goodsINR: PriceINR,
	couponINR: PriceINR,
	shippingINR: PriceINR,
	totalINR: PriceINR,
	paidINR: PriceINR,
	/** Due now (0 when paid up or paid ahead). */
	dueINR: PriceINR,
	/** Paid beyond the total; used first by pieces added later or by shipping at close. */
	paidAheadINR: PriceINR,
	refundedINR: PriceINR.default(0),
});
export type OrderBalance = z.infer<typeof OrderBalance>;

/** E-invoice IRN (business orders; typed by hand until an integration exists). */
export const EInvoiceRecord = z.object({
	irn: z.string().regex(/^[0-9a-fA-F]{64}$/, { message: 'irn_shape' }),
	ackNo: z.string().trim().min(1).max(20),
	ackDate: IsoDateTime,
	signedQr: z.string().max(4000).nullable().default(null),
	source: z.enum(['manual', 'api']),
	by: z.string(),
	at: IsoDateTime,
});
export type EInvoiceRecord = z.infer<typeof EInvoiceRecord>;

/** E-way bill (business orders; typed by hand until an integration exists). */
export const EWayBillRecord = z.object({
	number: z.string().regex(/^(\d{12}|\d{14})$/, { message: 'ewb_shape' }),
	generatedOn: IsoDateTime,
	validUntil: IsoDateTime,
	transporterName: z.string().trim().max(120).nullable().default(null),
	transporterId: z.string().trim().max(20).nullable().default(null),
	vehicleOrDocumentNo: z.string().trim().max(40).nullable().default(null),
	distanceKm: z.number().int().nonnegative().max(4_000).nullable().default(null),
	source: z.enum(['manual', 'api']),
	by: z.string(),
	at: IsoDateTime,
});
export type EWayBillRecord = z.infer<typeof EWayBillRecord>;

export const Order = z.object({
	id: Id,
	orderNumber: z.string().min(1),
	userId: Id.nullable().default(null),
	/** Order currency (INR canonical; non-INR resolved at checkout). */
	currency: z.string().length(3),
	/** The language of the page the order was placed from (BN-13); its emails and order page use it. */
	locale: LocaleCode.optional(),
	lines: z.array(OrderLine),
	subtotalINR: PriceINR,
	subtotalPaid: z.number().nonnegative(),
	shipping: OrderShipping.optional(),
	promotionsApplied: z.array(AppliedPromotion).default([]),
	totalINR: PriceINR,
	totalPaid: z.number().nonnegative(),
	gateway: PaymentGateway.optional(),
	status: StoredOrderStatus.default('awaiting_payment'),
	statusTimeline: z.array(OrderStatusEvent).default([]),

	/* Orders and checkout build (2026-11-20). Optional or defaulted so older rows still read. */
	channel: OrderChannel.default('shop'),
	createdBy: z.string().nullable().default(null),
	buyer: OrderBuyer.optional(),
	addresses: OrderAddresses.optional(),
	currencyRecord: OrderCurrencyRecord.optional(),
	zone: OrderZoneSnapshot.nullable().optional(),
	coupons: z.array(AppliedCoupon).default([]),
	balance: OrderBalance.optional(),
	paymentStatus: OrderPaymentStatus.default('unpaid'),
	/** How the admin checkout chose to take the money (ck01–ck08); null for shop orders and older rows. */
	placedWith: z.enum(['paymentLink', 'manual', 'cashOnDelivery', 'onAccount', 'keepOpen']).nullable().optional(),
	/** On account: the day payment falls due (order day plus the business's credit days), for the list (ol02). */
	onAccountDueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
	/**
	 * Shop orders (OD1, `DEC-STOCK-RESERVE`): the pieces are held from Pay until this time, 15 minutes
	 * later. Null once the hold became a sale or was let go (payment failed, cancelled, or time ran out).
	 */
	holdUntil: IsoDateTime.nullable().optional(),
	/**
	 * A shop payment staff must look at: a gateway answer that didn't add up (core `decidePaymentResult`
	 * review), or a refund the gateway refused. Shown under Needs attention until cleared.
	 */
	paymentReview: z
		.object({ attemptId: z.string(), reason: z.string(), at: IsoDateTime })
		.nullable()
		.optional(),
	/** Open orders: when it was opened and closed. */
	openedAt: IsoDateTime.nullable().optional(),
	closedAt: IsoDateTime.nullable().optional(),
	eInvoice: EInvoiceRecord.nullable().optional(),
	eWayBill: EWayBillRecord.nullable().optional(),
	history: z.array(OrderHistoryEntry).default([]),
	/** The Pack list's ticks (bundle builder brief E08): the lines already in the parcel, by line id. */
	packTicks: z.array(z.string()).default([]),
	/** Raised on every change; a save with an older revision is refused. */
	revision: z.number().int().nonnegative().default(0),
	createdAt: IsoDateTime.optional(),
	updatedAt: IsoDateTime.optional(),
});
export type Order = z.infer<typeof Order>;

/**
 * Request shapes for the order routes. Previously declared inside
 * `apps/api/src/orders/orders.controller.ts`; see the note on the cart requests for why that
 * is a problem rather than a detail.
 */
export const CreateOrderRequest = z.object({
	cartId: z.string().min(1),
	currency: z.string().length(3).optional(),
	gateway: PaymentGateway.optional(),
	couponCode: z.string().min(1).optional(),
});
export type CreateOrderRequest = z.infer<typeof CreateOrderRequest>;

/** Staff-only transition. `status` is the shared enum, so the two cannot drift apart. */
export const UpdateOrderStatusRequest = z.object({
	status: OrderStatus,
	note: z.string().min(1).optional(),
});
export type UpdateOrderStatusRequest = z.infer<typeof UpdateOrderStatusRequest>;
