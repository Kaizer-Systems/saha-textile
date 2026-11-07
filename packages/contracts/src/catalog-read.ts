import { z } from 'zod';

import { OptionDisplayStyle, SemanticRole } from './attribute';
import { Id, IsoDateTime, Slug } from './common';
import { ResolvedImage } from './media';

const money = z.number().int().nonnegative();

export const CatalogCardPrice = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('single'),
		sellingINR: money,
		mrpINR: money.nullable(),
		percentOff: money.nullable(),
	}),
	z.object({
		kind: z.literal('range'),
		minINR: money,
		maxINR: money,
	}),
]);
export type CatalogCardPrice = z.infer<typeof CatalogCardPrice>;

/** A listing card. The image, when present, carries the `card` role and nothing else. */
export const CatalogCard = z
	.object({
		id: Id,
		slug: Slug,
		title: z.string(),
		path: z.string().min(1),
		price: CatalogCardPrice,
		badges: z.array(z.string()).max(2),
		/** Pieces left, sent only while the low-stock fact is showing. */
		lowStockLeft: z.number().int().nonnegative().nullable().default(null),
		sku: z.string().nullable(),
		image: ResolvedImage.nullable(),
		inStock: z.boolean(),
		madeToOrder: z.boolean(),
	})
	.superRefine((card, ctx) => {
		const roles = Object.keys(card.image?.roles ?? {});
		if (roles.some((role) => role !== 'card')) {
			ctx.addIssue({ code: 'custom', message: 'a card image carries the card role only', path: ['image'] });
		}
	});
export type CatalogCard = z.infer<typeof CatalogCard>;

export const CatalogHome = z.object({
	newArrivals: z.array(CatalogCard),
	bestsellers: z.array(CatalogCard),
	featured: z.array(CatalogCard),
	sale: z.array(CatalogCard),
});
export type CatalogHome = z.infer<typeof CatalogHome>;

/** A real recent sale. Product and time only: nothing here may identify the buyer or the order. */
export const RecentPurchase = z.object({
	card: CatalogCard,
	purchasedAt: IsoDateTime,
});
export type RecentPurchase = z.infer<typeof RecentPurchase>;

export const RecentPurchases = z.object({ items: z.array(RecentPurchase) });
export type RecentPurchases = z.infer<typeof RecentPurchases>;

const swatchImage = ResolvedImage.nullable().superRefine((image, ctx) => {
	const roles = Object.keys(image?.roles ?? {});
	if (roles.some((role) => role !== 'swatch_image')) {
		ctx.addIssue({ code: 'custom', message: 'a swatch image carries the square role only' });
	}
});

const galleryImage = ResolvedImage.superRefine((image, ctx) => {
	if (!image.roles['gallery']?.length) {
		ctx.addIssue({ code: 'custom', message: 'a product image needs the gallery role', path: ['roles'] });
	}
	const roles = Object.keys(image.roles);
	if (roles.some((role) => role !== 'gallery' && role !== 'zoom')) {
		ctx.addIssue({ code: 'custom', message: 'a product image carries gallery and zoom only', path: ['roles'] });
	}
});

export const CatalogFacet = z.object({
	code: z.string(),
	label: z.string(),
	terms: z.array(z.object({ code: z.string(), label: z.string(), count: z.number().int().nonnegative() })),
});

export const CatalogSort = z.enum(['asc', 'desc', 'low-high', 'high-low', 'a-z', 'z-a', 'discount-high-low']);
export type CatalogSort = z.infer<typeof CatalogSort>;

const ATTRIBUTE_FILTER = /^[a-z0-9-]+:[^|:,]+(,[^|:,]+)*(\|[a-z0-9-]+:[^|:,]+(,[^|:,]+)*)*$/;
const attributeFilter = z.string().regex(ATTRIBUTE_FILTER).max(500);

/** Listing query params. Anything malformed is a 400, never a 500. */
export const CatalogPlacementQuery = z.object({
	path: z.string().max(300).default(''),
	page: z.coerce.number().int().positive().max(100_000).default(1),
	pageSize: z.coerce.number().int().positive().max(100).default(24),
	sortBy: CatalogSort.optional(),
	price_min: z.coerce.number().nonnegative().optional(),
	price_max: z.coerce.number().nonnegative().optional(),
	/** Ticked price ranges, each `min-max` with an open end allowed: `0-1000,20000-`. */
	price: z
		.string()
		.regex(/^\d+-\d*(,\d+-\d*)*$/)
		.max(200)
		.optional(),
	/** Ticked star ratings. The lowest one is the floor. */
	rating: z
		.string()
		.regex(/^[1-5](,[1-5])*$/)
		.optional(),
	/** Ticked categories inside the listing, by slug. */
	category: z
		.string()
		.regex(/^[a-z0-9-]+(,[a-z0-9-]+)*$/)
		.max(500)
		.optional(),
	/** `fabric:silk,cotton|color:red`. A repeated param adds more groups. */
	attribute: z.union([attributeFilter, z.array(attributeFilter).max(10)]).optional(),
});
export type CatalogPlacementQuery = z.infer<typeof CatalogPlacementQuery>;

export const CatalogSeoRouteQuery = z.object({
	path: z.string().min(1).max(300),
	locale: z.enum(['en', 'fr']),
});
export type CatalogSeoRouteQuery = z.infer<typeof CatalogSeoRouteQuery>;

export const CatalogCardsQuery = z.object({
	slug: z.union([Slug, z.array(Slug).max(50)]).optional(),
});
export type CatalogCardsQuery = z.infer<typeof CatalogCardsQuery>;

export const CatalogSearchQuery = z.object({
	q: z.string().max(200).default(''),
	categoryId: Id.optional(),
});
export type CatalogSearchQuery = z.infer<typeof CatalogSearchQuery>;

export const CatalogPlacementPage = z.object({
	path: z.string(),
	title: z.string(),
	breadcrumb: z.array(z.object({ name: z.string(), path: z.string() })),
	products: z.array(CatalogCard),
	total: z.number().int().nonnegative(),
	page: z.number().int().positive(),
	pageSize: z.number().int().positive(),
	facets: z.array(CatalogFacet),
	/** False when the URL carries a facet combination. */
	indexable: z.boolean(),
});
export type CatalogPlacementPage = z.infer<typeof CatalogPlacementPage>;

export const CatalogGallery = z.object({
	slug: Slug,
	frames: z.array(galleryImage),
});
export type CatalogGallery = z.infer<typeof CatalogGallery>;

const PageOptionTerm = z.object({
	code: z.string().min(1),
	label: z.string(),
	isBase: z.boolean(),
	hex: z.string().nullable(),
	image: swatchImage,
	priceDeltaINR: money.nullable(),
	requiresMeasurements: z.boolean(),
});

/** One option group as the product page shows it. Role decides behaviour; style decides look. */
export const CatalogPageOptionGroup = z.object({
	code: z.string().min(1),
	label: z.string(),
	role: SemanticRole,
	displayStyle: OptionDisplayStyle,
	required: z.boolean(),
	defaultTermCode: z.string().nullable(),
	terms: z.array(PageOptionTerm),
});
export type CatalogPageOptionGroup = z.infer<typeof CatalogPageOptionGroup>;

export const CatalogPageVariant = z.object({
	id: Id,
	sku: z.string().min(1),
	/** Variation-axis code to term code. */
	selections: z.record(z.string(), z.string()),
	sellingINR: money,
	mrpINR: money.nullable(),
	quantity: z.number().int().nonnegative(),
	buyable: z.boolean(),
	/** Position of this variant's photo in `gallery`, when it has one. */
	galleryIndex: z.number().int().nonnegative().nullable(),
	/** This variant's own photos in `gallery`, in order. Empty when it shares the product's. */
	galleryIndexes: z.array(z.number().int().nonnegative()).default([]),
});
export type CatalogPageVariant = z.infer<typeof CatalogPageVariant>;

export const CatalogPageMeasurements = z.object({
	/** Null when the fields are the product's own rather than a shared template. */
	templateCode: z.string().min(1).nullable(),
	priceINR: money,
	fields: z.array(
		z.object({
			code: z.string().min(1),
			label: z.string(),
			unit: z.enum(['in', 'cm']),
			min: z.number().nullable(),
			max: z.number().nullable(),
			step: z.number().positive().nullable(),
		}),
	),
});

export const CatalogPageBundle = z.object({
	bundleType: z.enum(['fixed_kit', 'choose_one_per_group', 'optional_addons']),
	pricePolicy: z.enum(['sum_components', 'fixed_bundle_price', 'discounted_components']),
	priceINR: money,
	groups: z.array(
		z.object({
			code: z.string().min(1),
			label: z.string(),
			minSelections: z.number().int().nonnegative(),
			maxSelections: z.number().int().positive(),
			components: z.array(
				z.object({
					productId: Id,
					slug: Slug,
					title: z.string(),
					sku: z.string(),
					sellingINR: money,
					quantity: z.number().int().positive(),
					required: z.boolean(),
					inStock: z.boolean(),
				}),
			),
		}),
	),
});

/** One category in the shop menu, in the language asked for. */
export const CatalogMenuCategory = z.object({
	id: Id,
	name: z.string(),
	slug: Slug,
	description: z.string(),
	parentId: Id.nullable(),
	level: z.number().int().positive(),
	/** Canonical path under `/collections/`. */
	path: z.string().min(1),
	imageUrl: z.string().nullable(),
	iconUrl: z.string().nullable(),
});
export type CatalogMenuCategory = z.infer<typeof CatalogMenuCategory>;

/** The product page read model. Prices are whole rupees from Mongo; images are resolved URLs. */
export const CatalogProductPage = z.object({
	id: Id,
	slug: Slug,
	path: z.string().min(1),
	title: z.string(),
	description: z.string(),
	shortDescription: z.string(),
	metaTitle: z.string(),
	metaDescription: z.string(),
	price: CatalogCardPrice,
	badges: z.object({ primary: z.string().nullable(), secondary: z.string().nullable() }),
	madeToOrder: z.boolean(),
	estimatedDeliveryText: z.string().nullable(),
	selected: z
		.object({
			sku: z.string(),
			sellingINR: money,
			mrpINR: money.nullable(),
			quantity: z.number().int().nonnegative(),
			buyable: z.boolean(),
		})
		.nullable(),
	unknownVariant: z.boolean(),
	gallery: z.array(galleryImage),
	optionGroups: z.array(CatalogPageOptionGroup),
	variants: z.array(CatalogPageVariant),
	measurements: CatalogPageMeasurements.nullable(),
	bundle: CatalogPageBundle.nullable(),
	breadcrumb: z.array(z.object({ name: z.string(), path: z.string() })),
});
export type CatalogProductPage = z.infer<typeof CatalogProductPage>;

export const CatalogSwatch = z.object({
	attributeCode: z.string(),
	termCode: z.string(),
	label: z.string(),
	hex: z.string().nullable(),
	image: swatchImage,
});
export type CatalogSwatch = z.infer<typeof CatalogSwatch>;
