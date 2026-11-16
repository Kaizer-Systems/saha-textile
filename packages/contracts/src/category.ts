import { z } from 'zod';

import { I18nString, Id, LocalizedText, SeoMeta, Slug } from './common';

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
