import { z } from 'zod';

import { OptionDisplayStyle, SemanticRole } from './attribute';
import { Id, Slug } from './common';
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

/** The product page read model. Prices are whole rupees from Mongo; images are resolved URLs. */
export const CatalogProductPage = z.object({
	id: Id,
	slug: Slug,
	path: z.string().min(1),
	title: z.string(),
	description: z.string(),
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
