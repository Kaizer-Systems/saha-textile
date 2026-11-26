import { z } from 'zod';

import { PostalAddressInput } from './address-book';
import { Id, PriceINR } from './common';
import { AppliedCoupon, CouponRefusal } from './coupon';

/**
 * The shop checkout (shipping brief shop01–shop06, approved 19 Nov; orders brief shop07–shop17,
 * approved 20 Nov).
 *
 * Steps: delivery address · billing (same as delivery unless unticked) · "Address in India
 * (optional)" only when both addresses are abroad on the export-off path · the shipping line with
 * its reason · coupons · Pay. The currency decides the gateway (₹ → the INR gateway; any other →
 * PayPal); shoppers never see a gateway name. Shop words never mention invoices or GST.
 */

export const CheckoutAddressChoice = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('saved'), savedAddressId: Id }),
	z.object({
		kind: z.literal('new'),
		address: PostalAddressInput,
		/** "Save to my addresses" ticked, with "Name this address". */
		saveAs: z.string().trim().min(1).max(80).nullable().default(null),
	}),
]);
export type CheckoutAddressChoice = z.infer<typeof CheckoutAddressChoice>;

/** "Address in India (optional)": any part may be left empty; only a complete one is used. */
export const AddressInIndiaInput = z.object({
	fullName: z.string().trim().max(120).default(''),
	line1: z.string().trim().max(200).default(''),
	line2: z.string().trim().max(200).default(''),
	city: z.string().trim().max(80).default(''),
	state: z.string().trim().max(80).default(''),
	postalCode: z.string().trim().max(12).default(''),
});
export type AddressInIndiaInput = z.infer<typeof AddressInIndiaInput>;

export const CheckoutRequest = z.object({
	delivery: CheckoutAddressChoice,
	/** Null when "Same as delivery address" stays ticked. */
	billing: CheckoutAddressChoice.nullable(),
	addressInIndia: AddressInIndiaInput.nullable().default(null),
	currency: z.string().length(3),
	couponCodes: z.array(z.string().trim().min(1).max(24)).max(5).default([]),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequest>;

/** Why Pay stays off. */
export const PayBlockedReason = z.enum([
	'pieceCannotShip',
	'deliveryAbroadNotOffered',
	'cartEmpty',
	'lineProblem',
	'noGateway',
]);
export type PayBlockedReason = z.infer<typeof PayBlockedReason>;

export const CheckoutQuote = z.object({
	currency: z.string().length(3),
	lines: z.array(
		z.object({
			lineId: Id,
			title: z.string(),
			quantity: z.number().int().positive(),
			unitPrice: z.number().nonnegative(),
			lineTotal: z.number().nonnegative(),
			couponAmount: z.number().nonnegative(),
			/** Shown under the line with a Remove button when the piece can't go to the delivery country. */
			cannotShipReason: z.string().nullable(),
		}),
	),
	shipping: z.object({
		charge: z.number().nonnegative(),
		chargeINR: PriceINR,
		/** The reason line under the charge, in the shopper's words. */
		reason: z.array(z.string()),
		zone: z.enum(['domestic', 'international']),
	}),
	coupons: z.array(AppliedCoupon),
	couponRefusals: z.array(z.object({ code: z.string(), refusal: CouponRefusal })),
	totals: z.object({
		goods: z.number(),
		coupon: z.number(),
		shipping: z.number(),
		total: z.number(),
		totalINR: PriceINR,
	}),
	/** The optional "Address in India" step shows (both addresses abroad, export-off path). */
	showAddressInIndia: z.boolean(),
	/** "Paying from India? Pay in ₹ instead": a quiet, non-blocking note (K2). */
	notes: z.array(z.enum(['payFromIndiaInRupees', 'importDutyBuyerPays'])),
	/** S5/S7 before HDFC takes cards issued abroad: the currency picker opens with this currency first. */
	currencyPicker: z.object({ first: z.string().length(3) }).nullable(),
	payBlocked: PayBlockedReason.nullable(),
});
export type CheckoutQuote = z.infer<typeof CheckoutQuote>;

export const CheckoutPlace = CheckoutRequest.extend({ idempotencyKey: z.string().min(16).max(80) });
export type CheckoutPlace = z.infer<typeof CheckoutPlace>;

/** What the browser does next: post or go to the gateway's page. */
export const CheckoutHandoff = z.object({
	orderId: Id,
	orderNumber: z.string(),
	handoff: z.discriminatedUnion('kind', [
		z.object({ kind: z.literal('redirect'), url: z.string() }),
		z.object({ kind: z.literal('form-post'), url: z.string(), fields: z.record(z.string(), z.string()) }),
		/** PayPal JS SDK v6 on the page: the server-made PayPal order id. */
		z.object({ kind: z.literal('paypal-sdk'), paypalOrderId: z.string() }),
	]),
});
export type CheckoutHandoff = z.infer<typeof CheckoutHandoff>;

/**
 * After the gateway: what the shop shows. `paid` → the order is placed. `pending` → "We're confirming
 * your payment" (the bank hasn't answered; the pieces stay held until the 15 minutes run out). `failed`
 * or `cancelled` → back to checkout with the approved popup when one applies (shop04 PayPal, shop05
 * INR card refused). `refunded` → the payment came after the hold ended and a piece had sold meanwhile
 * (OD1): refunded in full, the sold lines named for the cart popup (drawn in a brief before it is built).
 */
export const CheckoutPaymentOutcome = z.object({
	orderId: Id,
	orderNumber: z.string(),
	result: z.enum(['paid', 'pending', 'failed', 'cancelled', 'refunded']),
	popup: z.enum(['chooseCurrency', 'switchToRegionCurrency']).nullable(),
	/** The currency the popup lists first. */
	firstCurrency: z.string().length(3).nullable(),
	/** `refunded`: the cart lines whose pieces sold before the payment arrived. */
	soldOutLineIds: z.array(Id).default([]),
});
export type CheckoutPaymentOutcome = z.infer<typeof CheckoutPaymentOutcome>;

/** The shop's return page: `token` is PayPal's order id; a claim only, checked by a status enquiry. */
export const CheckoutConfirm = z.object({
	token: z
		.string()
		.regex(/^[A-Z0-9]{5,40}$/)
		.optional(),
	/** The shopper came back from the gateway's Cancel: the hold is let go at once (OD1). */
	cancelled: z.boolean().default(false),
});
export type CheckoutConfirm = z.infer<typeof CheckoutConfirm>;
