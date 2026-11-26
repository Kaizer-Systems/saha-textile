import { z } from 'zod';

import { AttributeDefinition } from './attribute';
import { LocaleCode, Slug } from './common';
import { FreeWith } from './free-with';
import { BundleStockSummary } from './product-bundle';
import { ProductShippingDefaults, ProductStatus, ProductType, QuickLength } from './product';
import { CategoryShipping, ProductShippingCharges } from './shipping-rules';
import { ProductOptionGroupSet } from './product-options';
import { ProductVideo, ProductVideos } from './site-settings';

/** Every badge a card can show. Pinning wins inside its own slot; hiding skips it. */
export const CatalogBadgeCode = z.enum([
	'sale',
	'featured',
	'bestseller',
	'trending',
	'new',
	'low_stock',
	'back_in_stock',
]);
export type CatalogBadgeCode = z.infer<typeof CatalogBadgeCode>;

const WholeRupee = z.number().int().nonnegative();
const Measure = z.number().nonnegative().nullable();
const OptionalText = z.string().trim().min(1).max(64).nullable();
/** An HSN has 4, 6 or 8 digits (F02C); checked in the form and again here. */
const OptionalHsn = z
	.string()
	.trim()
	.regex(/^(\d{4}|\d{6}|\d{8})$/, { message: 'hsn_digits' })
	.nullable();

/** The fields a product sold by the metre carries (A01). Ignored for products sold by the piece. */
export const MetreFieldsWrite = z.object({
	shortestCutTenths: z.number().int().min(1).max(1000),
	quickLengths: z.array(QuickLength).max(4),
	widthInches: z.number().positive().max(200).nullable(),
	weightPerMetreGrams: z.number().int().positive().max(100_000),
});
export type MetreFieldsWrite = z.infer<typeof MetreFieldsWrite>;

const TextByLocale = z.record(z.string(), z.string().max(20_000));

/** Everything on the product form that is not merchandising: the language-bound text and images. */
/** A photo and the version a field shows (media R4-1): the product's share picture, a variant's own picture. */
export const PictureRef = z.object({ assetId: z.string().min(1), versionId: z.string().min(1).nullable() });
export type PictureRef = z.infer<typeof PictureRef>;

export const ProductContentWrite = z.object({
	title: TextByLocale,
	shortDescription: TextByLocale,
	description: TextByLocale,
	metaTitle: TextByLocale,
	metaDescription: TextByLocale,
	estimatedDeliveryText: TextByLocale.default({}),
	sareeLengthM: z.number().positive().max(20).nullable().default(null),
	blousePieceM: z.number().positive().max(5).nullable().default(null),
	categoryIds: z.array(z.string().min(1)).max(50),
	optionGroups: ProductOptionGroupSet,
	/** The measurement template an option can ask for. */
	addonTemplateCode: z.string().min(1).nullable().default(null),
	imageMode: z.enum(['simple', 'compound']),
	gallery: z.array(z.string().min(1)).max(40),
	compound: z.array(z.object({ selectionHash: z.string().min(1), gallery: z.array(z.string().min(1)).max(40) })),
	altOverrides: z.record(z.string(), TextByLocale),
	/** The version each photo shows on this product, per asset id (media step 4b). */
	versions: z.record(z.string(), z.string().min(1)).default({}),
	/** The link-preview picture when it isn't the main photo's own share card (owner, 17 Nov: "Meta image"). */
	shareImage: PictureRef.nullable().optional(),
	/** The FAQ tab: the switch, and this product's own questions in display order. */
	faqEnabled: z.boolean().default(false),
	faq: z
		.array(
			z.object({
				/** Present for a question already saved; a new one gets an id on save. */
				id: z.string().min(1).optional(),
				question: z.record(z.string(), z.string().max(500)),
				answer: z.record(z.string(), z.string().max(4000)),
			}),
		)
		.max(30)
		.default([]),
});
export type ProductContentWrite = z.infer<typeof ProductContentWrite>;

/** A replacement is a live product or a live collection, never a redirected path. */
export const ReplacementPath = z
	.string()
	.trim()
	.regex(/^\/(product\/[a-z0-9-]+|collections(\/[a-z0-9-]+)+)$/, 'Use /product/{slug} or /collections/{path}');

export const DiscontinueProduct = z.object({
	replacementPath: ReplacementPath.nullable().optional(),
});
export type DiscontinueProduct = z.infer<typeof DiscontinueProduct>;

/** One variant row of the admin form. An empty measure inherits the product's value. */
export const AdminVariantWrite = z
	.object({
		id: z.string().min(1),
		sku: z.string().trim().min(1),
		mrpINR: WholeRupee.nullable(),
		sellingINR: WholeRupee,
		quantity: z.number().int().nonnegative(),
		available: z.boolean(),
		weightGrams: Measure,
		lengthCm: Measure,
		widthCm: Measure,
		heightCm: Measure,
		barcode: OptionalText,
		hsnCode: OptionalHsn,
		/** The variant's own picture, shown first when it is chosen (owner, 17 Nov: "Variation image"); absent keeps it. */
		image: PictureRef.nullable().optional(),
	})
	.refine((row) => row.mrpINR === null || row.sellingINR <= row.mrpINR, {
		path: ['sellingINR'],
		message: 'The selling price may not be above the MRP',
	});
export type AdminVariantWrite = z.infer<typeof AdminVariantWrite>;

/**
 * The admin product form. Status is only live or disabled here; discontinuing is its own
 * action. Relations are replaced only when sent.
 */
export const ProductMerchandisingWrite = z
	.object({
		sku: z.string().trim().min(1),
		/** A new address. The old one then forwards here. */
		slug: Slug.optional(),
		status: z.enum(['live', 'disabled']),
		featured: z.boolean(),
		madeToOrder: z.boolean(),
		estimatedDeliveryText: z.string().trim().min(1).max(200).nullable(),
		lowStockThreshold: z.number().int().nonnegative().nullable(),
		pinnedBadges: z.array(CatalogBadgeCode).max(2),
		hiddenBadges: z.array(CatalogBadgeCode),
		addonPriceINR: WholeRupee.nullable(),
		shipping: ProductShippingDefaults,
		/** The product's own shipping charges; empty uses the category's. Absent keeps them (shipping brief prd01). */
		shippingCharges: ProductShippingCharges.optional(),
		/** Ships free in both zones, whatever the rule sets say. Absent keeps it. */
		freeShipping: z.boolean().optional(),
		hsnCode: OptionalHsn,
		/** Piece or metre (P11); refused once the product has stock, stock history or orders. Absent keeps it. */
		soldBy: z.enum(['piece', 'metre']).optional(),
		/** Null follows the main category; true or false overrides it. Absent keeps it. */
		returnable: z.boolean().nullable().optional(),
		/** Required when sold by the metre (shortest cut and weight per metre); absent keeps them. */
		metre: MetreFieldsWrite.optional(),
		variants: z.array(AdminVariantWrite).min(1),
		/** Language-bound text, categories, options and images. Absent leaves them as they are. */
		content: ProductContentWrite.optional(),
		relatedProductIds: z.array(z.string().min(1)).max(12).optional(),
		upsellProductIds: z.array(z.string().min(1)).max(12).optional(),
		crossSellProductIds: z.array(z.string().min(1)).max(12).optional(),
		/** YouTube videos and Shorts for the product page, as checked in admin. Absent leaves them. */
		videos: ProductVideos.optional(),
		/** Off: live and stocked, but never listed or shown on its own (D5). Absent keeps it. */
		showOnShop: z.boolean().optional(),
		/** Free with this product (P8). Null removes them; absent keeps them. */
		freeWith: FreeWith.nullable().optional(),
	})
	.superRefine((body, ctx) => {
		if (body.madeToOrder && body.status !== 'live') {
			ctx.addIssue({
				code: 'custom',
				path: ['madeToOrder'],
				message: 'Only a live product can be made to order',
			});
		}
		if (body.madeToOrder && !body.estimatedDeliveryText) {
			ctx.addIssue({
				code: 'custom',
				path: ['estimatedDeliveryText'],
				message: 'Enter the lead time for a made-to-order product',
			});
		}
		if (body.pinnedBadges.some((code) => body.hiddenBadges.includes(code))) {
			ctx.addIssue({ code: 'custom', path: ['hiddenBadges'], message: 'A badge cannot be pinned and hidden' });
		}
		const ids = body.variants.map((row) => row.id);
		const skus = body.variants.map((row) => row.sku);
		if (new Set(ids).size !== ids.length || new Set(skus).size !== skus.length) {
			ctx.addIssue({ code: 'custom', path: ['variants'], message: 'Each variant and SKU may appear once' });
		}
	});
export type ProductMerchandisingWrite = z.infer<typeof ProductMerchandisingWrite>;

export const AdminProductListQuery = z.object({
	search: z.string().trim().max(100).optional(),
	status: ProductStatus.optional(),
	/** Only items the shop shows that still lack text in this language (Settings › Languages). */
	missing: LocaleCode.optional(),
	/** Products › Bundles lists only bundles; All products lists everything. */
	type: ProductType.optional(),
	/** "shown" or "hidden" from the shop (Show on shop, D5). */
	shop: z.enum(['shown', 'hidden']).optional(),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminProductListQuery = z.infer<typeof AdminProductListQuery>;

export const AdminProductRow = z.object({
	id: z.string(),
	slug: z.string(),
	sku: z.string(),
	title: z.string(),
	status: ProductStatus,
	featured: z.boolean(),
	sellingFromINR: z.number().int().nonnegative(),
	stock: z.number().int(),
	variantCount: z.number().int().nonnegative(),
	thumbnailUrl: z.string().nullable(),
	/** True once the product has been live: "Off shop" rather than "Not live yet" when it isn't. */
	wasLive: z.boolean().default(false),
	type: ProductType.default('simple'),
	showOnShop: z.boolean().default(true),
	/** Bundles only: how many levels, its set price today, and its worked-out stock. */
	bundle: z
		.object({
			levels: z.number().int().nonnegative(),
			choices: z.boolean(),
			setPriceINR: z.number().nonnegative().nullable(),
			fromPrice: z.boolean(),
			stock: BundleStockSummary.nullable(),
		})
		.nullable()
		.default(null),
});
export type AdminProductRow = z.infer<typeof AdminProductRow>;

export const AdminProductList = z.object({
	items: z.array(AdminProductRow),
	total: z.number().int().nonnegative(),
	page: z.number().int().min(1),
	pageSize: z.number().int().min(1),
});
export type AdminProductList = z.infer<typeof AdminProductList>;

export const AdminVariantView = z.object({
	id: z.string(),
	sku: z.string(),
	label: z.string(),
	isBase: z.boolean(),
	mrpINR: z.number().int().nullable(),
	sellingINR: z.number().int(),
	/** On hand, in stock units (pieces, or tenths of a metre). */
	quantity: z.number().int(),
	/** On hand but not for sale (P3). */
	held: z.number().int().nonnegative().default(0),
	/** Paid, not yet shipped: 0 until DEC-STOCK-RESERVE is built. */
	inOrders: z.number().int().nonnegative().default(0),
	/** On hand − held − in orders: the only number the shop uses. */
	freeToSell: z.number().int().default(0),
	available: z.boolean(),
	weightGrams: z.number().nullable(),
	lengthCm: z.number().nullable(),
	widthCm: z.number().nullable(),
	heightCm: z.number().nullable(),
	barcode: z.string().nullable(),
	hsnCode: z.string().nullable(),
	image: PictureRef.nullable().default(null),
});
export type AdminVariantView = z.infer<typeof AdminVariantView>;

export const AdminProductDetail = z.object({
	id: z.string(),
	slug: z.string(),
	sku: z.string(),
	title: z.string(),
	/** Bundles open in the same form (its Bundle tab), so the detail must carry them too. */
	type: ProductType,
	status: ProductStatus,
	/** True once the product has ever been live: its SKUs are then frozen. */
	published: z.boolean(),
	featured: z.boolean(),
	showOnShop: z.boolean().default(true),
	freeWith: FreeWith.nullable().default(null),
	madeToOrder: z.boolean(),
	estimatedDeliveryText: z.string().nullable(),
	lowStockThreshold: z.number().int().nullable(),
	pinnedBadges: z.array(CatalogBadgeCode),
	hiddenBadges: z.array(CatalogBadgeCode),
	addonPriceINR: z.number().int().nullable(),
	replacementPath: z.string().nullable(),
	shipping: ProductShippingDefaults,
	shippingCharges: ProductShippingCharges.nullable().default(null),
	freeShipping: z.boolean().default(false),
	hsnCode: z.string().nullable(),
	soldBy: z.enum(['piece', 'metre']).default('piece'),
	/** True once the product has stock, stock history or orders: Sold by is then fixed (P11). */
	soldByLocked: z.boolean().default(false),
	/** Null follows the main category. */
	returnable: z.boolean().nullable().default(null),
	/** The main category's defaults, for "From Tant (5208)" and the HSN popup (F02). */
	mainCategory: z
		.object({
			id: z.string(),
			name: z.string(),
			hsnCode: z.string().nullable(),
			returnable: z.boolean(),
			/** The category's own shipping values, for "Use Sarees's value" (prd01); null when it sets none. */
			shipping: CategoryShipping.nullable().default(null),
		})
		.nullable()
		.default(null),
	metre: z
		.object({
			shortestCutTenths: z.number().int().nullable(),
			quickLengths: z.array(QuickLength),
			widthInches: z.number().nullable(),
			weightPerMetreGrams: z.number().int().nullable(),
		})
		.default({ shortestCutTenths: null, quickLengths: [], widthInches: null, weightPerMetreGrams: null }),
	/** The form's language-bound text, options and images, as stored. */
	content: ProductContentWrite,
	/** Picture of each attached image, for the form's tiles. */
	images: z.array(z.object({ assetId: z.string(), url: z.string(), width: z.number(), height: z.number() })),
	relatedProductIds: z.array(z.string()),
	upsellProductIds: z.array(z.string()),
	crossSellProductIds: z.array(z.string()),
	variants: z.array(AdminVariantView),
	videos: z.array(ProductVideo).default([]),
	/** The product's last save, for a draft of changes' conflict check. */
	updatedAt: z.string().nullable().default(null),
});
export type AdminProductDetail = z.infer<typeof AdminProductDetail>;

export const AdminReplacementTarget = z.object({
	kind: z.enum(['product', 'collection']),
	path: z.string(),
	label: z.string(),
});
export type AdminReplacementTarget = z.infer<typeof AdminReplacementTarget>;

export const FaqWrite = z
	.object({
		id: z.string().min(1).optional(),
		question: z.object({ en: z.string().min(1), bn: z.string().optional() }),
		answer: z.object({ en: z.string().min(1), bn: z.string().optional() }),
		scope: z.enum(['global', 'category', 'product', 'mixed']).default('global'),
		categoryIds: z.array(z.string()).default([]),
		productIds: z.array(z.string()).default([]),
		status: z.enum(['draft', 'live']).default('draft'),
		displayOrder: z.number().int().default(0),
	})
	.superRefine((row, ctx) => {
		if (row.status === 'live' && (!row.question.bn?.trim() || !row.answer.bn?.trim())) {
			ctx.addIssue({
				code: 'custom',
				message: 'English and Bengali are required before publish',
				path: ['question'],
			});
		}
	});
export type FaqWrite = z.infer<typeof FaqWrite>;

export const QuestionWrite = z.object({
	productSlug: z.string().min(1),
	question: z.string().min(1).max(2000),
	askerName: z.string().min(1).max(120),
	askerEmail: z.email(),
	isAnonymous: z.boolean().default(false),
});
export type QuestionWrite = z.infer<typeof QuestionWrite>;

export const AnswerWrite = z.object({ answer: z.string().min(1).max(4000) });
export type AnswerWrite = z.infer<typeof AnswerWrite>;

export const StockAlertWrite = z.object({
	variantSku: z.string().min(1),
});
export type StockAlertWrite = z.infer<typeof StockAlertWrite>;

/** A new product starts disabled, with one base variant, and is finished on the form. */
export const ProductCreate = z.object({
	type: ProductType,
	/** A bundle's own number is given by the server ("BND-0001", for search only: V2); anything sent is ignored. */
	sku: z.string().trim().min(1).max(64),
	title: z.object({ en: z.string().trim().min(1).max(300) }).catchall(z.string().max(300)),
	basePriceINR: WholeRupee.default(0),
});
export type ProductCreate = z.infer<typeof ProductCreate>;

/** What stops a product going live. `locale` is null when the gap is not language-bound. */
export const GoLiveGap = z.object({ field: z.string(), locale: z.string().nullable() });
export type GoLiveGap = z.infer<typeof GoLiveGap>;

/** Same answer from the form and the list: live, or the gaps and nothing changed. */
export const GoLiveResult = z.object({ live: z.boolean(), gaps: z.array(GoLiveGap) });
export type GoLiveResult = z.infer<typeof GoLiveResult>;

export const AdminCategoryWrite = z.object({
	name: TextByLocale,
	description: TextByLocale,
	seoTitle: TextByLocale,
	seoDescription: TextByLocale,
	slug: Slug,
	parentId: z.string().min(1).nullable(),
	/** Further parents this category also appears under. */
	alsoUnder: z.array(z.string().min(1)).max(20),
	/** Left out, a saved category keeps its place. */
	displayOrder: z.number().int().optional(),
	imageId: z.string().min(1).nullable().optional(),
	iconId: z.string().min(1).nullable().optional(),
	/** The version each chosen picture shows, by photo id (R4-1; media step 4d). */
	imageVersions: z.record(z.string(), z.string()).optional(),
	/** The HSN its products inherit (F03). Left out, a saved category keeps it. */
	hsnCode: OptionalHsn.optional(),
	/** Whether its products can be returned by default (F03). Left out, a saved category keeps it. */
	returnable: z.boolean().optional(),
	/** Shipping charges, weight and box its products inherit (shipping brief cat01). Left out, a saved category keeps them. */
	shipping: CategoryShipping.optional(),
	/**
	 * When the HSN changes: also give the new code to the products whose main category this is and
	 * whose HSN is the category's old one (or empty). Products with their own HSN are left alone.
	 */
	updateProductsHsn: z.boolean().default(false),
});
export type AdminCategoryWrite = z.infer<typeof AdminCategoryWrite>;

/** F03: which products a category HSN change would reach, and which keep their own code. */
export const CategoryHsnImpact = z.object({
	categoryHsn: z.string().nullable(),
	using: z.number().int().nonnegative(),
	own: z.array(z.object({ id: z.string(), sku: z.string(), title: z.string(), hsnCode: z.string() })),
});
export type CategoryHsnImpact = z.infer<typeof CategoryHsnImpact>;

const CategoryImageRow = z.object({ id: z.string(), url: z.string() });

export const AdminCategoryRow = z.object({
	id: z.string(),
	name: z.record(z.string(), z.string()),
	description: z.record(z.string(), z.string()),
	seoTitle: z.record(z.string(), z.string()),
	seoDescription: z.record(z.string(), z.string()),
	slug: z.string(),
	parentId: z.string().nullable(),
	alsoUnder: z.array(z.string()),
	path: z.string().nullable(),
	productCount: z.number().int().nonnegative(),
	image: CategoryImageRow.nullable(),
	icon: CategoryImageRow.nullable(),
	/** The version each picture shows, by photo id (media step 4d). */
	imageVersions: z.record(z.string(), z.string()).default({}),
	hsnCode: z.string().nullable().default(null),
	returnable: z.boolean().default(true),
	shipping: CategoryShipping.nullable().default(null),
});
export type AdminCategoryRow = z.infer<typeof AdminCategoryRow>;

export const AdminAttributeWrite = AttributeDefinition.omit({ createdAt: true, updatedAt: true, id: true });
export type AdminAttributeWrite = z.infer<typeof AdminAttributeWrite>;
