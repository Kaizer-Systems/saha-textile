import { z } from 'zod';

import { Id, IsoDateTime, PriceINR } from './common';

/**
 * Coupons (`DEC-PROMO-STACK`, Orders round OD4 option A plus a stacking switch; owner 2026-11-20;
 * brief cp01–cp07, shop12–shop13).
 *
 * - One coupon per order, unless every applied coupon is set to combine with others.
 * - A coupon skips pieces already on sale unless it is set to include them. Automatic offers never
 *   stack: the lowest price wins.
 * - Coupons cover products and their stitching, never delivery; free delivery is its own coupon kind.
 * - Once per customer unless set otherwise.
 * - Order of use when coupons combine: % off first, then ₹ off, then free delivery; each works on
 *   what is left and never takes a line below ₹0.
 * - How one coupon's discount is split across items at different GST rates stays with the CA (D1).
 */

export const CouponKind = z.enum(['percentOff', 'amountOff', 'freeDelivery']);
export type CouponKind = z.infer<typeof CouponKind>;

export const CouponScope = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('wholeOrder') }),
	z.object({
		kind: z.literal('categories'),
		categoryIds: z.array(Id).min(1).max(200),
		includeSubcategories: z.boolean().default(true),
	}),
	z.object({ kind: z.literal('products'), productIds: z.array(Id).min(1).max(2_000) }),
]);
export type CouponScope = z.infer<typeof CouponScope>;

export const CouponAudience = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('everyone') }),
	z.object({ kind: z.literal('firstOrder') }),
	z.object({ kind: z.literal('customers'), customerIds: z.array(Id).min(1).max(2_000) }),
	z.object({ kind: z.literal('businesses'), businessIds: z.array(Id).min(1).max(2_000) }),
]);
export type CouponAudience = z.infer<typeof CouponAudience>;

/** A coupon code as typed: letters and digits (hyphens allowed), stored upper case. */
export const CouponCode = z
	.string()
	.trim()
	.transform((value) => value.toUpperCase())
	.pipe(z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,23}$/, { message: 'coupon_code_shape' }));
export type CouponCode = z.infer<typeof CouponCode>;

export const CouponFields = z.object({
	code: CouponCode,
	/** Admin only: what the coupon is for. */
	title: z.string().trim().min(1).max(120),
	kind: CouponKind,
	/** Percent for `percentOff`, whole rupees for `amountOff`, 0 for `freeDelivery`. */
	value: z.number().finite().nonnegative(),
	/** The most a % coupon takes off one order, in rupees; null = no cap. */
	capINR: PriceINR.nullable().default(null),
	scope: CouponScope.default({ kind: 'wholeOrder' }),
	excludedProductIds: z.array(Id).max(2_000).default([]),
	/** Pieces already on sale are left out unless this is on (OD4). */
	includeSaleItems: z.boolean().default(false),
	minOrderINR: PriceINR.default(0),
	audience: CouponAudience.default({ kind: 'everyone' }),
	channels: z
		.object({ shop: z.boolean(), admin: z.boolean() })
		.default({ shop: true, admin: true })
		.refine((value) => value.shop || value.admin, { message: 'needs_a_channel' }),
	/** Uses per customer (1 by default); null = unlimited. */
	usesPerCustomer: z.number().int().positive().nullable().default(1),
	/** Uses in all; null = unlimited. */
	totalUses: z.number().int().positive().nullable().default(null),
	validFrom: IsoDateTime.nullable().default(null),
	validUntil: IsoDateTime.nullable().default(null),
	/** Combines with other coupons that also combine (the stacking switch). */
	combines: z.boolean().default(false),
});
export type CouponFields = z.infer<typeof CouponFields>;

export const Coupon = CouponFields.extend({
	id: Id,
	/** The row switch: an off coupon can't be used. */
	enabled: z.boolean().default(true),
	usedCount: z.number().int().nonnegative().default(0),
	revision: z.number().int().nonnegative().default(0),
	createdAt: IsoDateTime.optional(),
	updatedAt: IsoDateTime.optional(),
	updatedBy: z.string().nullable().default(null),
});
export type Coupon = z.infer<typeof Coupon>;

export const CouponWrite = CouponFields.extend({
	enabled: z.boolean().default(true),
	revision: z.number().int().nonnegative().optional(),
}).superRefine((value, ctx) => {
	if (value.kind === 'percentOff' && !(value.value > 0 && value.value <= 100)) {
		ctx.addIssue({ code: 'custom', path: ['value'], message: 'percent_range' });
	}
	if (value.kind === 'amountOff' && !(Number.isInteger(value.value) && value.value > 0)) {
		ctx.addIssue({ code: 'custom', path: ['value'], message: 'whole_rupees' });
	}
	if (value.kind !== 'percentOff' && value.capINR !== null) {
		ctx.addIssue({ code: 'custom', path: ['capINR'], message: 'cap_percent_only' });
	}
	if (value.validFrom && value.validUntil && value.validUntil <= value.validFrom) {
		ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'ends_before_start' });
	}
});
export type CouponWrite = z.infer<typeof CouponWrite>;

export const CouponListQuery = z.object({
	q: z.string().trim().max(60).optional(),
	filter: z.enum(['all', 'on', 'off', 'expired']).default('all'),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(15),
});
export type CouponListQuery = z.infer<typeof CouponListQuery>;

export const CouponListRow = Coupon.pick({
	id: true,
	code: true,
	title: true,
	kind: true,
	value: true,
	capINR: true,
	combines: true,
	enabled: true,
	usedCount: true,
	totalUses: true,
	validFrom: true,
	validUntil: true,
}).extend({
	/** What it applies to, in plain words, built by the server. */
	appliesTo: z.string(),
	expired: z.boolean(),
});
export type CouponListRow = z.infer<typeof CouponListRow>;

export const CouponListResponse = z.object({
	items: z.array(CouponListRow),
	total: z.number().int().nonnegative(),
	counts: z.object({ all: z.number().int(), on: z.number().int(), off: z.number().int(), expired: z.number().int() }),
});
export type CouponListResponse = z.infer<typeof CouponListResponse>;

/** Bulk Delete / Turn on / Turn off on every ticked coupon (owner, 2026-11-20). */
export const CouponBulkAction = z.object({
	action: z.enum(['delete', 'turnOn', 'turnOff']),
	ids: z.array(Id).min(1).max(500),
});
export type CouponBulkAction = z.infer<typeof CouponBulkAction>;

export const CouponBulkResult = z.object({
	done: z.array(Id),
	/** A coupon already used on an order is turned off rather than deleted. */
	refused: z.array(z.object({ id: Id, code: z.string(), reason: z.enum(['used_on_orders', 'not_found']) })),
});
export type CouponBulkResult = z.infer<typeof CouponBulkResult>;

export const CouponSwitchWrite = z.object({ enabled: z.boolean() });
export type CouponSwitchWrite = z.infer<typeof CouponSwitchWrite>;

/* ---------------------------------------------------------------------------------------------- */
/* Applying coupons                                                                               */
/* ---------------------------------------------------------------------------------------------- */

/** Why a coupon gives a line nothing, or can't be used at all. Shown in plain words. */
export const CouponLineReason = z.enum([
	'applied',
	'onSale',
	'notInScope',
	'excluded',
	'nothingLeft',
	'zoneLineNotAllowed',
	'zoneSettingNeeded',
]);
export type CouponLineReason = z.infer<typeof CouponLineReason>;

export const CouponRefusal = z.enum([
	'unknown',
	'off',
	'notStarted',
	'expired',
	'wrongChannel',
	'notForThisBuyer',
	'firstOrderOnly',
	'usedUpForCustomer',
	'usedUp',
	'belowMinimum',
	'doesNotCombine',
	'alreadyApplied',
	'nothingEligible',
]);
export type CouponRefusal = z.infer<typeof CouponRefusal>;

export const AppliedCouponLine = z.object({
	lineId: Id,
	reason: CouponLineReason,
	amountINR: PriceINR,
});
export type AppliedCouponLine = z.infer<typeof AppliedCouponLine>;

/** One applied coupon, as an order keeps it and both checkouts show it. */
export const AppliedCoupon = z.object({
	couponId: Id,
	code: z.string(),
	kind: CouponKind,
	/** Off the pieces and stitching (0 for free delivery). */
	amountINR: PriceINR,
	/** Off the delivery charge (free delivery only). */
	deliveryAmountINR: PriceINR.default(0),
	lines: z.array(AppliedCouponLine),
	combines: z.boolean(),
});
export type AppliedCoupon = z.infer<typeof AppliedCoupon>;

export const ApplyCouponRequest = z.object({ code: CouponCode });
export type ApplyCouponRequest = z.infer<typeof ApplyCouponRequest>;

/** The coupon popup on the admin checkout: coupons this order can use, and why others can't. */
export const CouponOption = z.object({
	couponId: Id,
	code: z.string(),
	title: z.string(),
	kind: CouponKind,
	value: z.number(),
	combines: z.boolean(),
	/** What it would take off this order now. */
	wouldTakeINR: PriceINR,
	refusal: CouponRefusal.nullable(),
});
export type CouponOption = z.infer<typeof CouponOption>;

/** Try it on the builder: a real cart, and why each line did or didn't get money off. */
export const CouponTryRequest = z.object({
	coupon: CouponFields,
	items: z
		.array(
			z.object({
				productId: Id,
				variantId: Id.nullable().default(null),
				quantity: z.number().int().positive().max(99),
			}),
		)
		.min(1)
		.max(20),
	deliveryINR: PriceINR.default(0),
});
export type CouponTryRequest = z.infer<typeof CouponTryRequest>;

export const CouponTryResult = z.object({
	refusal: CouponRefusal.nullable(),
	applied: AppliedCoupon.nullable(),
	lines: z.array(
		z.object({
			lineId: Id,
			title: z.string(),
			unitPriceINR: PriceINR,
			quantity: z.number().int(),
			onSale: z.boolean(),
			reason: CouponLineReason,
			amountINR: PriceINR,
		}),
	),
	totalBeforeINR: PriceINR,
	totalAfterINR: PriceINR,
});
export type CouponTryResult = z.infer<typeof CouponTryResult>;
