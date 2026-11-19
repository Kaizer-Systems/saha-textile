import { z } from 'zod';

import { I18nString, Id, LocalizedText, SeoMeta, Slug } from './common';
import { CategoryShipping } from './shipping-rules';

/**
 * Taxonomy node. Arbitrary nesting via adjacency-list + materialized path.
 * Products reference categories by id and may belong to many simultaneously.
 */
export const Category = z.object({
	id: Id,
	name: I18nString,
	slug: Slug,
	/** Parent node id; null for a top-level category. */
	parentId: Id.nullable().default(null),
	/** Materialized path of ids from root to this node (inclusive). */
	path: z.array(Id).default([]),
	/** Ancestor ids (path excluding self). */
	ancestors: z.array(Id).default([]),
	depth: z.number().int().nonnegative().default(0),
	/** Distinguishes curated collections (e.g. "Wedding") from strict taxonomy. */
	isBannerCollection: z.boolean().default(false),
	displayOrder: z.number().int().default(0),
	/** The HSN its products inherit (4, 6 or 8 digits); a product may override it (owner, 2026-11-15). */
	hsnCode: z
		.string()
		.regex(/^(\d{4}|\d{6}|\d{8})$/, { message: 'hsn_digits' })
		.nullable()
		.default(null),
	/** Whether its products can be returned by default; a product may override it (owner, 2026-11-15). */
	returnable: z.boolean().default(true),
	/**
	 * Shipping charges, weight and box its products inherit (owner, 2026-11-19); an empty value
	 * comes from the parent category, then the shop default. Absent on older rows: all empty.
	 */
	shipping: CategoryShipping.optional(),
	description: LocalizedText.default({}),
	seo: SeoMeta.optional(),
	media: z
		.object({
			bannerImage: z.string().optional(),
			iconImage: z.string().optional(),
			/** The version each picture shows, by photo id (R4-1; media step 4d). Empty: the shop's own pick. */
			versions: z.record(z.string(), z.string()).optional(),
		})
		.optional(),
});
export type Category = z.infer<typeof Category>;
