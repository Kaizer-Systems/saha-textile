import { z } from 'zod';

import { Id, IsoDateTime } from './common';

export const PromotionType = z.enum(['percentage', 'fixed']);
export type PromotionType = z.infer<typeof PromotionType>;

/** Discount applicability scope — discounts may target any level. */
export const PromotionScope = z.enum(['global', 'category', 'product', 'variation', 'color', 'tag', 'cart']);
export type PromotionScope = z.infer<typeof PromotionScope>;

export const PromotionKind = z.enum(['flash_sale', 'clearance', 'upsell', 'cross_sell', 'offer']);
export type PromotionKind = z.infer<typeof PromotionKind>;

export const PromotionConditions = z.object({
	minCartINR: z.number().nonnegative().default(0),
	firstOrderOnly: z.boolean().default(false),
});
export type PromotionConditions = z.infer<typeof PromotionConditions>;

/**
 * Polymorphic promotion. The resolution engine runs in the backend at
 * price-calculation time, computed on INR first. For `color` scope, `targetIds`
 * holds colour term codes (e.g. ["red"]).
 */
export const Promotion = z.object({
	id: Id,
	name: z.string().min(1),
	type: PromotionType,
	value: z.number().nonnegative(),
	scope: PromotionScope,
	targetIds: z.array(z.string()).default([]),
	/** null = automatic (no coupon code required). */
	couponCode: z.string().nullable().default(null),
	kind: PromotionKind,
	stackable: z.boolean().default(false),
	priority: z.number().int().default(0),
	startsAt: IsoDateTime.optional(),
	endsAt: IsoDateTime.optional(),
	conditions: PromotionConditions.default({ minCartINR: 0, firstOrderOnly: false }),
});
export type Promotion = z.infer<typeof Promotion>;
