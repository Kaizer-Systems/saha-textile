import { z } from 'zod';

import { FacetDisplayStyle } from './attribute';
import { CatalogStatus } from './catalog';
import { I18nString, Id, Slug } from './common';

/**
 * One position of a category inside the taxonomy DAG (`categoryPlacements`).
 *
 * Owner lock: categories use a multi-placement DAG — do NOT force a strict
 * single-parent tree. The same category node (e.g. `Pure Silk`) can hang under several
 * merchandising contexts without duplicating products or corrupting breadcrumbs, so
 * identity lives in `categories` and POSITION lives here.
 *
 * Write-path rules this schema cannot express on a single row (repository/use-case must
 * enforce them):
 *   - the graph stays acyclic — a placement may never appear in its own ancestor path;
 *   - moving a placement emits redirects from the old path;
 *   - `pathCategoryIds`/`pathSlugs` are recomputed for the whole subtree on a move.
 */
export const CategoryPlacement = z.object({
	id: Id,
	categoryId: Id,
	/** Null for a root placement. */
	parentCategoryId: Id.nullable().default(null),
	/** Ancestor category ids from root to self (inclusive). */
	pathCategoryIds: z.array(Id).min(1),
	/**
	 * Slug segments matching `pathCategoryIds`. `pathSlugs.join('/')` is the category
	 * route — PROVISIONAL until `DEC-I18N-ROUTES` settles the canonical locale URL law
	 * (whether a locale prefix participates in this path).
	 */
	pathSlugs: z.array(Slug).min(1),
	/** Human-readable breadcrumb label, e.g. `Sarees / Pure Silk`. */
	pathLabel: z.string().min(1),
	depth: z.number().int().nonnegative(),
	/**
	 * The placement whose path is the category's canonical URL. Exactly one canonical
	 * placement per category that has storefront pages — see `CategoryPlacementSet`.
	 */
	isCanonical: z.boolean().default(false),
	displayOrder: z.number().int().default(0),
	status: CatalogStatus.default('draft'),
	createdAt: z.string().optional(),
	updatedAt: z.string().optional(),
});
export type CategoryPlacement = z.infer<typeof CategoryPlacement>;

/**
 * All placements of ONE category, with the cross-row invariants a single placement
 * cannot check: paths and depths must agree, and a category may not advertise two
 * canonical URLs (that is how duplicate-content SEO bugs start).
 */
export const CategoryPlacementSet = z
	.array(CategoryPlacement)
	.min(1)
	.superRefine((placements, ctx) => {
		const categoryIds = new Set(placements.map((placement) => placement.categoryId));
		if (categoryIds.size > 1) {
			ctx.addIssue({ code: 'custom', message: 'every placement in a set must belong to the same category' });
		}

		const canonical = placements.filter((placement) => placement.isCanonical);
		if (canonical.length > 1) {
			ctx.addIssue({ code: 'custom', message: 'a category may have at most one canonical placement' });
		}

		placements.forEach((placement, index) => {
			if (placement.pathCategoryIds.length !== placement.pathSlugs.length) {
				ctx.addIssue({
					code: 'custom',
					message: '`pathSlugs` must have one segment per `pathCategoryIds` entry',
					path: [index, 'pathSlugs'],
				});
			}
			if (placement.depth !== placement.pathCategoryIds.length - 1) {
				ctx.addIssue({
					code: 'custom',
					message: '`depth` must equal `pathCategoryIds.length - 1`',
					path: [index, 'depth'],
				});
			}
			if (placement.pathCategoryIds.at(-1) !== placement.categoryId) {
				ctx.addIssue({
					code: 'custom',
					message: '`pathCategoryIds` must end with the placed category itself',
					path: [index, 'pathCategoryIds'],
				});
			}
			const parent = placement.pathCategoryIds.at(-2) ?? null;
			if (parent !== placement.parentCategoryId) {
				ctx.addIssue({
					code: 'custom',
					message: '`parentCategoryId` must match the second-to-last path entry',
					path: [index, 'parentCategoryId'],
				});
			}
			if (new Set(placement.pathCategoryIds).size !== placement.pathCategoryIds.length) {
				ctx.addIssue({
					code: 'custom',
					message: 'a placement path may not repeat a category (cycle)',
					path: [index, 'pathCategoryIds'],
				});
			}
		});
	});
export type CategoryPlacementSet = z.infer<typeof CategoryPlacementSet>;

/** Where a sidebar facet's values come from. */
export const FacetSource = z.enum([
	'category',
	'tag',
	'attribute',
	'variant_option',
	'price',
	'rating',
	'stock',
	'shipping',
	'merchandising_flag',
	'badge',
]);
export type FacetSource = z.infer<typeof FacetSource>;

/**
 * Indexing policy for URLs produced by this facet.
 *
 * Owner lock: arbitrary faceted URLs are `noindex,follow` and canonicalize to the base
 * listing. Only a deliberately modelled SEO landing page may be indexable, which is why
 * there is no `always_index` option to reach for.
 */
export const FacetSeoPolicy = z.enum(['never_index', 'allow_curated_landing_only']);
export type FacetSeoPolicy = z.infer<typeof FacetSeoPolicy>;

/**
 * One filter in the category sidebar / off-canvas UI.
 *
 * Merchandising exposure ONLY. Whether an attribute is eligible to be a facet is
 * `attributeDefinitions.filterConfig`; whether it is publicly shown here — and in what
 * order, style, and on which breakpoint — is the owner-locked category/placement facet
 * configuration.
 */
export const CategoryFacet = z.object({
	code: z.string().min(1),
	source: FacetSource,
	/** Required when `source` is `attribute` or `variant_option`. */
	attributeCode: z.string().min(1).optional(),
	label: I18nString,
	enabled: z.boolean().default(true),
	displayOrder: z.number().int().default(0),
	displayStyle: FacetDisplayStyle,
	collapsedByDefault: z.boolean().default(false),
	showCounts: z.boolean().default(true),
	/** Locked: facet visibility is configured per breakpoint, not inferred from CSS. */
	desktopVisible: z.boolean().default(true),
	mobileVisible: z.boolean().default(true),
	seoPolicy: FacetSeoPolicy.default('never_index'),
	/** Cap on rendered values; null = show all. */
	valueLimit: z.number().int().positive().nullable().default(null),
	/** Hide values with fewer matches than this (noise control). */
	minCountToShow: z.number().int().nonnegative().default(0),
});
export type CategoryFacet = z.infer<typeof CategoryFacet>;

/** Which surface a facet configuration applies to; resolved most-specific-first. */
export const FacetConfigScope = z.enum(['global', 'category', 'category_placement', 'product_group']);
export type FacetConfigScope = z.infer<typeof FacetConfigScope>;

/**
 * Facet configuration for one scope (`categoryFacetConfigs`). Resolution order at read
 * time is placement → category → product group → global.
 */
export const CategoryFacetConfig = z
	.object({
		id: Id,
		scope: FacetConfigScope,
		categoryId: Id.optional(),
		categoryPlacementId: Id.optional(),
		productGroupId: Id.optional(),
		facets: z.array(CategoryFacet).default([]),
		status: CatalogStatus.default('draft'),
		createdAt: z.string().optional(),
		updatedAt: z.string().optional(),
	})
	.superRefine((config, ctx) => {
		const required = {
			category: 'categoryId',
			category_placement: 'categoryPlacementId',
			product_group: 'productGroupId',
		} as const;

		const key = required[config.scope as keyof typeof required];
		if (key && !config[key]) {
			ctx.addIssue({ code: 'custom', message: `scope \`${config.scope}\` requires \`${key}\``, path: [key] });
		}

		const codes = config.facets.map((facet) => facet.code);
		if (new Set(codes).size !== codes.length) {
			ctx.addIssue({
				code: 'custom',
				message: 'facet codes must be unique within a configuration',
				path: ['facets'],
			});
		}

		config.facets.forEach((facet, index) => {
			if ((facet.source === 'attribute' || facet.source === 'variant_option') && !facet.attributeCode) {
				ctx.addIssue({
					code: 'custom',
					message: `a \`${facet.source}\` facet requires \`attributeCode\``,
					path: ['facets', index, 'attributeCode'],
				});
			}
			if (!facet.desktopVisible && !facet.mobileVisible && facet.enabled) {
				ctx.addIssue({
					code: 'custom',
					message: 'an enabled facet must be visible on at least one breakpoint',
					path: ['facets', index],
				});
			}
		});
	});
export type CategoryFacetConfig = z.infer<typeof CategoryFacetConfig>;
