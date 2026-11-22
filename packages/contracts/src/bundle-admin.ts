import { z } from 'zod';

import { BundlePriceMethodRow } from './bundle-rules';
import { CatalogPageBundle } from './catalog-read';
import { Id, LocalizedText } from './common';
import { BundleStockSummary, ProductBundle } from './product-bundle';
import { ProductStatus } from './product';

/** A bundle's own FAQ questions (the FAQ's tab), as the product form keeps them. */
export const BundleFaqRow = z.object({
	id: z.string().min(1).optional(),
	question: z.record(z.string(), z.string().max(500)),
	answer: z.record(z.string(), z.string().max(4000)),
});
export type BundleFaqRow = z.infer<typeof BundleFaqRow>;

/**
 * The bundle builder's reads and writes (bundle builder brief, approved 2026-11-22; V1 option 1: every part of a
 * bundle is edited in the builder, tabs Build, Price rules, Details, Photos, SEO, FAQ's and Status).
 */

/** One item as the builder's tables show it (R1): MRP, selling, the running sale and the price in this set. */
export const BundleBuilderItem = z.object({
	key: z.string(),
	productId: Id,
	title: z.string(),
	sku: z.string(),
	imageUrl: z.string().nullable(),
	mrpINR: z.number().nullable(),
	sellingINR: z.number(),
	/** Shown only while a sale covers the item (R1), with the sale's name and end. */
	saleINR: z.number().nullable(),
	saleName: z.string().nullable(),
	saleEndsAt: z.string().nullable(),
	priceInSetINR: z.number(),
	overridden: z.boolean(),
	/** Units free to sell; null when made to order. */
	available: z.number().int().nullable(),
	live: z.boolean(),
	/** Show on shop (D5): a hidden product can still be a piece, an extra or a free item. */
	shown: z.boolean(),
	isBundle: z.boolean(),
	soldBy: z.enum(['piece', 'metre']),
	variants: z.array(z.object({ id: Id, label: z.string() })),
	/** How many free items this piece's own product brings (shown under its name, D5). */
	freeItems: z.number().int().nonnegative(),
});
export type BundleBuilderItem = z.infer<typeof BundleBuilderItem>;

export const BundleCheckView = z.object({
	severity: z.enum(['error', 'warn', 'ok']),
	code: z.string(),
	level: z.string().nullable(),
	key: z.string().nullable(),
	input: z.string().nullable(),
	totalINR: z.number().nullable(),
	separatelyINR: z.number().nullable(),
});
export type BundleCheckView = z.infer<typeof BundleCheckView>;

export const BundleProductView = z.object({
	id: Id,
	slug: z.string(),
	sku: z.string(),
	status: ProductStatus,
	/** True once it has ever been live. */
	published: z.boolean(),
	showOnShop: z.boolean(),
	featured: z.boolean(),
	title: LocalizedText,
	shortDescription: LocalizedText,
	description: LocalizedText,
	categoryIds: z.array(z.string()),
	tags: z.array(z.string()),
	seo: z.object({ title: LocalizedText, description: LocalizedText }),
	faqEnabled: z.boolean(),
	faq: z.array(BundleFaqRow).default([]),
	lowStockThreshold: z.number().int().nullable(),
});
export type BundleProductView = z.infer<typeof BundleProductView>;

/** What the builder page opens with. */
export const BundleBuilderView = z.object({
	product: BundleProductView,
	bundle: ProductBundle.nullable(),
	items: z.array(BundleBuilderItem),
	methods: z.array(BundlePriceMethodRow),
	checks: z.array(BundleCheckView),
	/** The shop's own set block for the preview, as the product page would draw it. */
	page: CatalogPageBundle.nullable(),
	stock: BundleStockSummary.nullable(),
	/** The bundle's photos: the styled photo first, then each piece's main photo in level order (A5). */
	photos: z.array(z.object({ assetId: Id, url: z.string(), fromKey: z.string().nullable() })),
});
export type BundleBuilderView = z.infer<typeof BundleBuilderView>;

/** A draft worked out without saving: the live preview, the checks and the item rows. */
export const BundleDraftResponse = BundleBuilderView.pick({
	items: true,
	checks: true,
	page: true,
	stock: true,
	photos: true,
});
export type BundleDraftResponse = z.infer<typeof BundleDraftResponse>;

/** The builder's Details, SEO, FAQ's and Status tabs (no HSN, tax, stock or weight: V2). */
export const BundleDetailsWrite = z.object({
	title: LocalizedText,
	shortDescription: LocalizedText,
	description: LocalizedText,
	categoryIds: z.array(Id).max(30),
	tags: z.array(z.string().trim().min(1).max(60)).max(40),
	seo: z.object({ title: LocalizedText, description: LocalizedText }),
	faqEnabled: z.boolean(),
	faq: z.array(BundleFaqRow).max(30).default([]),
	featured: z.boolean(),
	showOnShop: z.boolean(),
	lowStockThreshold: z.number().int().nonnegative().nullable(),
});
export type BundleDetailsWrite = z.infer<typeof BundleDetailsWrite>;
