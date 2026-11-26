import { z } from 'zod';

import { Id } from './common';

/**
 * "Free with this product" (brief P8, revision 3 P8.0–P8.8; owner, 22 Nov 2026). Real stocked products, never a
 * service, given at no charge with the product they are attached to: always, or chosen by the shopper.
 *
 * - `take: 'all'`: the shopper gets every item; `required: false` lets them leave items off (one item: "May take it").
 * - `take: 'exactly'`: the shopper picks exactly `count`; `required: false` also allows none.
 * - `take: 'upto'`: at most `count`; at least one when `required`.
 * - `take: 'between'`: at least `from`, at most `count`.
 *
 * A sold-out free item hides (when given) or greys (in a choice); the main product keeps selling (D4).
 */
export const FreeWithItem = z.object({
	productId: Id,
	/** A pinned size or colour; null lets the shopper choose when the product has variants. */
	variantId: Id.nullable().default(null),
	quantity: z.number().int().min(1).max(20).default(1),
});
export type FreeWithItem = z.infer<typeof FreeWithItem>;

export const FreeWithTake = z.enum(['all', 'exactly', 'upto', 'between']);
export type FreeWithTake = z.infer<typeof FreeWithTake>;

export const FreeWith = z
	.object({
		items: z.array(FreeWithItem).min(1).max(10),
		take: FreeWithTake.default('all'),
		count: z.number().int().min(1).max(10).nullable().default(null),
		from: z.number().int().min(0).max(10).nullable().default(null),
		required: z.boolean().default(true),
	})
	.superRefine((rule, ctx) => {
		const n = rule.items.length;
		const keys = rule.items.map((item) => `${item.productId}:${item.variantId ?? '*'}`);
		if (new Set(keys).size !== keys.length) {
			ctx.addIssue({ code: 'custom', path: ['items'], message: 'a free item may appear once' });
		}
		if (rule.take !== 'all') {
			if (rule.count === null) ctx.addIssue({ code: 'custom', path: ['count'], message: 'say how many' });
			else if (rule.count > n) {
				ctx.addIssue({ code: 'custom', path: ['count'], message: 'cannot be more than the items listed' });
			}
		}
		if (rule.take === 'between') {
			if (rule.from === null) ctx.addIssue({ code: 'custom', path: ['from'], message: 'say the least' });
			else if (rule.count !== null && rule.from > rule.count) {
				ctx.addIssue({ code: 'custom', path: ['from'], message: 'the least cannot be more than the most' });
			}
		}
	});
export type FreeWith = z.infer<typeof FreeWith>;

/** A free item the shopper picked (or was given), with the size they chose when it has sizes. */
export const FreePick = z.object({ productId: Id, variantId: Id.nullable().default(null) });
export type FreePick = z.infer<typeof FreePick>;
