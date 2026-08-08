import { z } from 'zod';

import { I18nString, Id, IsoDateTime, PriceINR } from './common';

export const OrderStatus = z.enum(['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded']);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const PaymentGateway = z.enum(['ccavenue', 'paypal']);
export type PaymentGateway = z.infer<typeof PaymentGateway>;

export const OrderLineAddon = z.object({
	code: z.string().min(1),
	label: z.string().optional(),
	value: z.union([z.string(), z.number()]),
});
export type OrderLineAddon = z.infer<typeof OrderLineAddon>;

/** A snapshot of a purchased line — prices captured in BOTH INR and paid currency. */
export const OrderLine = z.object({
	productId: Id,
	variationId: Id.nullable().default(null),
	title: I18nString,
	sku: z.string().min(1),
	quantity: z.number().int().positive(),
	attributes: z.record(z.string(), z.string()).default({}),
	addons: z.array(OrderLineAddon).default([]),
	unitPriceINR: PriceINR,
	unitPricePaid: z.number().nonnegative(),
	lineTotalINR: PriceINR,
	lineTotalPaid: z.number().nonnegative(),
});
export type OrderLine = z.infer<typeof OrderLine>;

export const OrderShipping = z.object({
	value: z.number().nonnegative(),
	currency: z.string().length(3),
	provider: z.string().optional(),
	method: z.string().optional(),
});
export type OrderShipping = z.infer<typeof OrderShipping>;

export const AppliedPromotion = z.object({
	promotionId: Id,
	code: z.string().nullable().default(null),
	amountINR: z.number().nonnegative(),
});
export type AppliedPromotion = z.infer<typeof AppliedPromotion>;

export const OrderStatusEvent = z.object({
	status: OrderStatus,
	at: IsoDateTime,
	note: z.string().optional(),
});
export type OrderStatusEvent = z.infer<typeof OrderStatusEvent>;

export const Order = z.object({
	id: Id,
	orderNumber: z.string().min(1),
	userId: Id.nullable().default(null),
	/** Paid currency (INR canonical; non-INR resolved at checkout). */
	currency: z.string().length(3),
	lines: z.array(OrderLine).min(1),
	subtotalINR: PriceINR,
	subtotalPaid: z.number().nonnegative(),
	shipping: OrderShipping.optional(),
	promotionsApplied: z.array(AppliedPromotion).default([]),
	totalINR: PriceINR,
	totalPaid: z.number().nonnegative(),
	gateway: PaymentGateway.optional(),
	status: OrderStatus.default('pending'),
	statusTimeline: z.array(OrderStatusEvent).default([]),
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
