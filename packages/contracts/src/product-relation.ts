import { z } from 'zod';

import { CatalogStatus } from './catalog';
import { Id, IsoDateTime } from './common';

/**
 * Kinds of merchandising relationship. These change DISCOVERY and suggestions only —
 * anything that changes pricing or inventory by resolving to separate lines is a
 * `ProductBundle`.
 */
export const ProductRelationType = z.enum([
	'related',
	'upsell',
	'cross_sell',
	'bought_together',
	'complete_the_look',
	'substitute',
	'same_collection',
]);
export type ProductRelationType = z.infer<typeof ProductRelationType>;

/**
 * Where a relation came from.
 *
 * Owner lock (`DEC-PRODUCT-RELATIONS`): related and upsell links are CURATED MANUALLY in
 * product setup; cross-sell and bought-together derive from persisted weekly analytics
 * insight sets, with optional manual additions. `insight_set` therefore points at a
 * persisted `productInsightSets` row — the storefront reads persisted sets only and
 * never runs a live analytics join.
 */
/**
 * What a relation points AT.
 *
 * Named rather than inlined so the Mongo schema can be built from it. A hand-copied `enum: [...]`
 * beside a contract is a second source of truth that agrees until the day it does not — and one
 * of them already went stale and answered 500 to a request no test could have caught.
 */
export const ProductRelationTargetType = z.enum(['product', 'variant', 'product_group']);
export type ProductRelationTargetType = z.infer<typeof ProductRelationTargetType>;

export const ProductRelationSource = z.enum(['manual', 'insight_set', 'imported_woocommerce']);
export type ProductRelationSource = z.infer<typeof ProductRelationSource>;

/** Relation types that must always be hand-curated (owner lock). */
export const MANUALLY_CURATED_RELATION_TYPES: readonly ProductRelationType[] = ['related', 'upsell'];

/** Relation types that analytics insight sets may populate (owner lock). */
export const ANALYTICS_BACKED_RELATION_TYPES: readonly ProductRelationType[] = ['cross_sell', 'bought_together'];

/** Storefront surfaces a relation may be rendered on. */
export const ProductRelationSurface = z.enum([
	'product_detail',
	'cart',
	'checkout',
	'post_purchase',
	'search_zero_state',
	'category_listing',
]);
export type ProductRelationSurface = z.infer<typeof ProductRelationSurface>;

/**
 * One merchandising relationship (`productRelations`).
 *
 * Invariants encoded from the lock:
 *   - `related` / `upsell` may only be `manual`; analytics never invents them.
 *   - an `insight_set` relation must name the persisted set it came from, so a rail can
 *     always be traced back to the weekly run that produced it;
 *   - a relation may not point at itself.
 *
 * Rules the write/read path still owns: a relation is surfaced publicly only when the
 * TARGET is live, and a target leaving `live` disables the relation.
 */
export const ProductRelation = z
	.object({
		id: Id,
		sourceProductId: Id,
		relationType: ProductRelationType,
		targetType: ProductRelationTargetType.default('product'),
		targetId: Id,
		surfaces: z.array(ProductRelationSurface).min(1),
		/** Lower sorts first within a surface. */
		rank: z.number().int().nonnegative().default(0),
		source: ProductRelationSource.default('manual'),
		/** Required for `insight_set`: the persisted `productInsightSets` row behind this rail. */
		insightSetId: Id.nullable().default(null),
		/** Short admin-facing justification, e.g. "bought together in 38% of orders". */
		reason: z.string().max(280).nullable().default(null),
		startsAt: IsoDateTime.nullable().default(null),
		endsAt: IsoDateTime.nullable().default(null),
		status: CatalogStatus.default('draft'),
		createdAt: IsoDateTime.optional(),
		updatedAt: IsoDateTime.optional(),
	})
	.superRefine((relation, ctx) => {
		if (relation.targetType === 'product' && relation.targetId === relation.sourceProductId) {
			ctx.addIssue({ code: 'custom', message: 'a product may not relate to itself', path: ['targetId'] });
		}

		if (MANUALLY_CURATED_RELATION_TYPES.includes(relation.relationType) && relation.source === 'insight_set') {
			ctx.addIssue({
				code: 'custom',
				message: `\`${relation.relationType}\` links are curated manually; analytics insight sets may only populate ${ANALYTICS_BACKED_RELATION_TYPES.join(' and ')}`,
				path: ['source'],
			});
		}

		if (relation.source === 'insight_set' && !relation.insightSetId) {
			ctx.addIssue({
				code: 'custom',
				message: 'an analytics-backed relation must reference the persisted insight set it came from',
				path: ['insightSetId'],
			});
		}

		if (relation.source !== 'insight_set' && relation.insightSetId) {
			ctx.addIssue({
				code: 'custom',
				message: '`insightSetId` is only meaningful for an `insight_set` relation',
				path: ['insightSetId'],
			});
		}

		if (relation.startsAt && relation.endsAt && relation.startsAt > relation.endsAt) {
			ctx.addIssue({ code: 'custom', message: 'relation ends before it starts', path: ['endsAt'] });
		}
	});
export type ProductRelation = z.infer<typeof ProductRelation>;
