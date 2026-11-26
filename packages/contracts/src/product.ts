import { z } from 'zod';

import { CatalogRupee, I18nString, Id, IsoDateTime, LocalizedText, PriceINR, SeoMeta, Slug } from './common';
import { FreeWith } from './free-with';
import { ProductOptionGroupSet } from './product-options';
import { ProductShippingCharges } from './shipping-rules';
import { ProductVideo } from './site-settings';

/** One quick-length button of a metre product (M5): "2.5 m · suit". */
export const QuickLength = z.object({
	tenths: z.number().int().min(1).max(1000),
	label: LocalizedText.default({}),
});
export type QuickLength = z.infer<typeof QuickLength>;

/** The main category is the first one chosen; its HSN and returnability are the product's defaults (PD3). */
export function mainCategoryId(categoryIds: readonly string[]): string | null {
	return categoryIds[0] ?? null;
}

export const ProductType = z.enum(['simple', 'variable', 'bundle']);
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

/** Product-level weight and box size. A variant's empty measure inherits these. */
export const ProductShippingDefaults = z.object({
	weightGrams: z.number().nonnegative().nullable().default(null),
	lengthCm: z.number().nonnegative().nullable().default(null),
	widthCm: z.number().nonnegative().nullable().default(null),
	heightCm: z.number().nonnegative().nullable().default(null),
});
export type ProductShippingDefaults = z.infer<typeof ProductShippingDefaults>;

export const Product = z.object({
	id: Id,
	type: ProductType,
	sku: z.string().min(1),
	title: I18nString,
	slug: Slug,
	description: I18nString.optional(),
	/** The card and search summary, in each language. */
	shortDescription: LocalizedText.default({}),
	categoryIds: z.array(Id).default([]),
	tags: z.array(z.string()).default([]),
	/** Canonical base price in INR. */
	basePriceINR: PriceINR,
	/** Simple is one gallery; compound is one per variant combination. Switching parks the other. */
	imageMode: z.enum(['simple', 'compound']).default('simple'),
	media: z
		.object({
			/** Asset ids in order. Position 1 is the primary image. */
			gallery: z.array(z.string()).default([]),
			/** One ordered gallery per variant combination, kept while in simple mode. */
			compound: z.array(z.object({ selectionHash: z.string().min(1), gallery: z.array(z.string()) })).default([]),
			/** Alt text set here, per asset, in each language. Empty inherits the media library. */
			altOverrides: z.record(z.string(), LocalizedText).default({}),
			/**
			 * The version each photo shows here (R4-1: a page stores the photo and its version), per asset id. A photo
			 * without one shows the version the website picks by itself (photos chosen before media step 4).
			 */
			versions: z.record(z.string(), z.string()).default({}),
			/** The link-preview picture chosen in "Meta image", when not the main photo's own share card. */
			shareImage: z.object({ assetId: Id, versionId: z.string().nullable() }).nullable().optional(),
		})
		.default({ gallery: [], compound: [], altOverrides: {}, versions: {} }),
	attributes: z.array(Attribute).default([]),
	/**
	 * Per-product option groups: variation axes, named add-ons, filter-only facts, and bundle
	 * options. `semanticRole` decides behaviour; `displayStyle` only decides the look.
	 */
	optionGroups: ProductOptionGroupSet.default([]),
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
	/** Live products only. Lead time is `estimated` delivery text while this is on. */
	madeToOrder: z.boolean().default(false),
	/** The made-to-order lead time, shown on the product page only. */
	estimatedDeliveryText: I18nString.nullable().default(null),
	/** Null uses the shop default of 2. A set value also badges a one-off. */
	lowStockThreshold: z.number().int().nonnegative().nullable().default(null),
	lifetimeUnitsReceived: z.number().int().nonnegative().default(0),
	featured: z.boolean().default(false),
	/**
	 * Show on shop (owner, 22 Nov 2026, D5): off keeps a live product stocked and usable as a set piece, an extra
	 * or a free item, but out of listings, search, the sitemap, feeds and related lists; its own page is "not found".
	 */
	showOnShop: z.boolean().default(true),
	/** Free with this product (P8): real products given at no charge, always or by the shopper's choice. */
	freeWith: FreeWith.nullable().default(null),
	/** Shows the FAQ section on the product page: its own questions and its categories'. */
	faqEnabled: z.boolean().default(false),
	/** YouTube videos and Shorts, at most five, in the order admin set (owner, 2026-11-10). */
	videos: z.array(ProductVideo).default([]),
	insightBadges: z.array(z.enum(['bestseller', 'trending'])).default([]),
	pinnedBadges: z.array(z.string()).default([]),
	hiddenBadges: z.array(z.string()).default([]),
	backInStockAt: IsoDateTime.nullable().default(null),
	replacementTarget: z
		.object({
			kind: z.enum(['product', 'collection']),
			path: z.string().min(1),
		})
		.nullable()
		.default(null),
	/** Saree length and blouse piece, in metres. One number serves every language. */
	sareeLengthM: z.number().positive().max(20).nullable().default(null),
	blousePieceM: z.number().positive().max(5).nullable().default(null),
	/** Reusable measurement template. Null when the product has no tailoring fields. */
	addonTemplateCode: z.string().min(1).nullable().default(null),
	/** Whole-rupee override of the template price. Null inherits the template. */
	addonPriceINR: CatalogRupee.nullable().default(null),
	/** True when a live variant is selling below its MRP. Home's Sale rail reads this. */
	onSale: z.boolean().default(false),
	/** The product's own shipping charges; empty uses its main category's (owner, 2026-11-19). */
	shippingCharges: ProductShippingCharges.optional(),
	/** Ships free in both zones, whatever the rule sets say. */
	freeShipping: z.boolean().optional(),
	shippingDefaults: ProductShippingDefaults.default({
		weightGrams: null,
		lengthCm: null,
		widthCm: null,
		heightCm: null,
	}),
	/** Product-level HSN. A variant's empty HSN inherits it. */
	hsnCode: z.string().min(1).nullable().default(null),
	/**
	 * Pieces, or fabric by the metre (P11). Metre stock and order quantities are whole tenths of
	 * a metre. Fixed once the product has stock or orders.
	 */
	soldBy: z.enum(['piece', 'metre']).default('piece'),
	/** Whether a buyer may return it: null follows the main category (owner, 2026-11-15). */
	returnable: z.boolean().nullable().default(null),
	/** Fabric by the metre (shop brief A01): the least a buyer may cut, in tenths (M2: 1.0 m = 10). */
	shortestCutTenths: z.number().int().min(1).max(1000).nullable().default(null),
	/** Up to four quick-length buttons (M5), each a length in tenths and a label in every language. */
	quickLengths: z.array(QuickLength).max(4).default([]),
	/** Cloth width in inches, shown in Product Information. */
	widthInches: z.number().positive().max(200).nullable().default(null),
	/** Delivery weight of one metre: an order line weighs length × this. */
	weightPerMetreGrams: z.number().int().positive().max(100_000).nullable().default(null),
	createdAt: z.string().optional(),
	updatedAt: z.string().optional(),
});
export type Product = z.infer<typeof Product>;
