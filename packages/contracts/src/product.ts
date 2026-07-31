import { z } from 'zod';

import { I18nString, Id, IsoDateTime, PriceINR, SeoMeta, Slug } from './common';

export const ProductType = z.enum(['simple', 'variable']);
export type ProductType = z.infer<typeof ProductType>;

/**
 * Product lifecycle status (owner lock, catalog section).
 *
 * - `draft`        — never published; invisible to every storefront surface.
 * - `live`         — the ONLY storefront-queryable status (listing, search, sitemap).
 * - `disabled`     — hidden everywhere, full data and media retained; fully reversible.
 * - `discontinued` — hidden everywhere and starts the retention window, after which rich
 *                    data and Spaces media are purged down to a minimal tombstone
 *                    (name, SKU, audit references). Order-line snapshots survive.
 *
 * Supersedes the earlier `draft|published|archived` enum and the 5-value
 * `draft|published|hidden|archived|discontinued` sketch in the catalog architecture
 * reference, which predates this lock.
 */
export const ProductStatus = z.enum(['draft', 'live', 'disabled', 'discontinued']);
export type ProductStatus = z.infer<typeof ProductStatus>;

/**
 * Lifecycle timestamps behind the status. Nullable because a product only acquires
 * them as it moves through the lifecycle; `richDataPurgedAt` is stamped by the
 * retention job when a discontinued product has been reduced to its tombstone.
 *
 * The retention WINDOW itself is not stored here — it is configuration read by the
 * retention job (locked at 30 days), so changing it never requires a data migration.
 */
export const ProductLifecycle = z.object({
	liveAt: IsoDateTime.nullable().default(null),
	disabledAt: IsoDateTime.nullable().default(null),
	discontinuedAt: IsoDateTime.nullable().default(null),
	richDataPurgedAt: IsoDateTime.nullable().default(null),
	/** Free-text admin reason captured on disable/discontinue; audited separately. */
	statusReason: z.string().max(500).nullable().default(null),
});
export type ProductLifecycle = z.infer<typeof ProductLifecycle>;

/**
 * One selectable term of an attribute. `isBase` marks the material-only option
 * ("No Stitching" / "No Blouse"), rendered first/selected by default.
 */
export const AttributeTerm = z.object({
	code: z.string().min(1),
	label: I18nString,
	isBase: z.boolean().default(false),
	/** Swatch image (e.g. design thumbnail). */
	swatch: z.string().optional(),
	/** Hex colour for colour-type attributes. */
	hex: z
		.string()
		.regex(/^#([0-9a-fA-F]{6})$/, 'must be a 6-digit hex colour')
		.optional(),
});
export type AttributeTerm = z.infer<typeof AttributeTerm>;

/** A product attribute (e.g. "Blouse Designs", "Color"). */
export const Attribute = z.object({
	code: z.string().min(1),
	label: I18nString,
	usedForVariations: z.boolean().default(true),
	terms: z.array(AttributeTerm).min(1),
});
export type Attribute = z.infer<typeof Attribute>;

/**
 * A concrete variation row (cartesian selection of attribute terms) with its
 * own price/SKU/stock/image. Prices are always INR.
 */
export const Variation = z.object({
	id: Id,
	/** Map of attribute code -> selected term code, e.g. { design: 'design-1', color: 'black' }. */
	attributes: z.record(z.string(), z.string()),
	priceINR: PriceINR,
	salePriceINR: PriceINR.nullable().default(null),
	sku: z.string().min(1),
	stock: z.number().int().nonnegative().default(0),
	image: z.string().optional(),
});
export type Variation = z.infer<typeof Variation>;

export const AddonType = z.enum(['number', 'text', 'select']);
export type AddonType = z.infer<typeof AddonType>;

/**
 * Custom tailoring add-on captured per cart line (e.g. Shoulder/Waist/Sleeve).
 * Modeled separately from variations to avoid combinatorial explosion.
 */
export const Addon = z.object({
	code: z.string().min(1),
	label: I18nString,
	type: AddonType.default('number'),
	unit: z.string().optional(),
	required: z.boolean().default(false),
	options: z.array(z.string()).optional(),
});
export type Addon = z.infer<typeof Addon>;

export const RatingsSummary = z.object({
	avg: z.number().min(0).max(5).default(0),
	count: z.number().int().nonnegative().default(0),
});
export type RatingsSummary = z.infer<typeof RatingsSummary>;

export const Product = z.object({
	id: Id,
	type: ProductType,
	sku: z.string().min(1),
	title: I18nString,
	slug: Slug,
	description: I18nString.optional(),
	categoryIds: z.array(Id).default([]),
	tags: z.array(z.string()).default([]),
	/** Canonical base price in INR. */
	basePriceINR: PriceINR,
	media: z
		.object({
			gallery: z.array(z.string()).default([]),
		})
		.default({ gallery: [] }),
	attributes: z.array(Attribute).default([]),
	variations: z.array(Variation).default([]),
	addons: z.array(Addon).default([]),
	relatedProductIds: z.array(Id).default([]),
	crossSellIds: z.array(Id).default([]),
	upsellIds: z.array(Id).default([]),
	seo: SeoMeta.optional(),
	ratingsSummary: RatingsSummary.default({ avg: 0, count: 0 }),
	status: ProductStatus.default('draft'),
	lifecycle: ProductLifecycle.default({
		liveAt: null,
		disabledAt: null,
		discontinuedAt: null,
		richDataPurgedAt: null,
		statusReason: null,
	}),
	createdAt: z.string().optional(),
	updatedAt: z.string().optional(),
});
export type Product = z.infer<typeof Product>;
