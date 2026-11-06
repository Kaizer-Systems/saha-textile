import { z } from 'zod';

import { Slug } from './common';
import { ProductShippingDefaults, ProductStatus } from './product';

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
		hsnCode: OptionalText,
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
		hsnCode: OptionalText,
		variants: z.array(AdminVariantWrite).min(1),
		relatedProductIds: z.array(z.string().min(1)).max(12).optional(),
		upsellProductIds: z.array(z.string().min(1)).max(12).optional(),
		crossSellProductIds: z.array(z.string().min(1)).max(12).optional(),
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
	quantity: z.number().int(),
	available: z.boolean(),
	weightGrams: z.number().nullable(),
	lengthCm: z.number().nullable(),
	widthCm: z.number().nullable(),
	heightCm: z.number().nullable(),
	barcode: z.string().nullable(),
	hsnCode: z.string().nullable(),
});
export type AdminVariantView = z.infer<typeof AdminVariantView>;

export const AdminProductDetail = z.object({
	id: z.string(),
	slug: z.string(),
	sku: z.string(),
	title: z.string(),
	type: z.enum(['simple', 'variable']),
	status: ProductStatus,
	/** True once the product has ever been live: its SKUs are then frozen. */
	published: z.boolean(),
	featured: z.boolean(),
	madeToOrder: z.boolean(),
	estimatedDeliveryText: z.string().nullable(),
	lowStockThreshold: z.number().int().nullable(),
	pinnedBadges: z.array(CatalogBadgeCode),
	hiddenBadges: z.array(CatalogBadgeCode),
	addonPriceINR: z.number().int().nullable(),
	replacementPath: z.string().nullable(),
	shipping: ProductShippingDefaults,
	hsnCode: z.string().nullable(),
	relatedProductIds: z.array(z.string()),
	upsellProductIds: z.array(z.string()),
	crossSellProductIds: z.array(z.string()),
	variants: z.array(AdminVariantView),
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
		question: z.object({ en: z.string().min(1), fr: z.string().optional() }),
		answer: z.object({ en: z.string().min(1), fr: z.string().optional() }),
		scope: z.enum(['global', 'category', 'product', 'mixed']).default('global'),
		categoryIds: z.array(z.string()).default([]),
		productIds: z.array(z.string()).default([]),
		status: z.enum(['draft', 'live']).default('draft'),
		displayOrder: z.number().int().default(0),
	})
	.superRefine((row, ctx) => {
		if (row.status === 'live' && (!row.question.fr?.trim() || !row.answer.fr?.trim())) {
			ctx.addIssue({
				code: 'custom',
				message: 'English and French are required before publish',
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
