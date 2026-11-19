import { z } from 'zod';

import { GoLiveGap, ReplacementPath } from './catalog-write';
import { Id } from './common';
import { ProductStatus } from './product';
import { SaleRule, ShopEventStatus } from './shop-event';

/**
 * Bulk actions on the admin product list (product bulk actions brief, approved 2026-11-19).
 *
 * Every action runs on the server, one product at a time inside one request: one product failing
 * never stops the others, and each product answers for itself. A dry run says what would happen
 * and changes nothing, so the admin's question can name what will be done and what skipped.
 */

/** The most products one bulk action takes. */
export const PRODUCT_BULK_MAX = 200;

const ProductIds = z
	.array(Id)
	.min(1)
	.max(PRODUCT_BULK_MAX)
	.refine((ids) => new Set(ids).size === ids.length, 'Each product may appear once');

export const ProductBulkWrite = z.object({
	ids: ProductIds,
	/** True: only say what would happen; nothing changes. */
	dryRun: z.boolean().default(false),
});
export type ProductBulkWrite = z.infer<typeof ProductBulkWrite>;

/** Discontinue: every product's old links show "gone", or all point to one live product or collection. */
export const ProductBulkDiscontinueWrite = ProductBulkWrite.extend({
	replacementPath: ReplacementPath.nullable().default(null),
});
export type ProductBulkDiscontinueWrite = z.infer<typeof ProductBulkDiscontinueWrite>;

/** Why a product was skipped or refused. */
export const ProductBulkReason = z.enum([
	/** Go Live: already live. */
	'already_live',
	/** Take off shop: not live. */
	'not_live',
	/** Discontinued products take no action but none. */
	'discontinued',
	/** Go Live: a field in some language is empty; `gaps` names them. */
	'needs_work',
	/** Delete: the product has been live once (Q1 = A: discontinue it instead). */
	'was_live',
	/** Delete: the product holds stock or has stock history. */
	'has_stock',
	/** Delete: the product is on an order. */
	'has_orders',
	/** Delete: a launch or a sale that has not ended names the product. */
	'in_event',
	/** Discontinue: the replacement is one of the products being discontinued. */
	'replacement_in_batch',
	'not_found',
	/** Anything else; nothing changed for this product. */
	'failed',
]);
export type ProductBulkReason = z.infer<typeof ProductBulkReason>;

export const ProductBulkRow = z.object({
	id: Id,
	title: z.string(),
	/** `done`: changed (or would change, on a dry run). `skipped`: nothing to do. `refused`: could not. */
	outcome: z.enum(['done', 'skipped', 'refused']),
	reason: ProductBulkReason.nullable().default(null),
	gaps: z.array(GoLiveGap).default([]),
	/** Duplicate: the copy made, and its product code. */
	copyId: Id.nullable().default(null),
	copySku: z.string().nullable().default(null),
});
export type ProductBulkRow = z.infer<typeof ProductBulkRow>;

export const ProductBulkResult = z.object({
	dryRun: z.boolean(),
	rows: z.array(ProductBulkRow),
});
export type ProductBulkResult = z.infer<typeof ProductBulkResult>;

// ── Put on sale ──────────────────────────────────────────────────────────────────

/** One product and its rule: % or ₹ off for all, or a fixed price per product (and per SKU). */
export const ProductSaleLineWrite = z.object({
	productId: Id,
	rule: SaleRule,
});
export type ProductSaleLineWrite = z.infer<typeof ProductSaleLineWrite>;

export const ProductSaleWrite = z.object({
	/** A sale that has not ended, or null to make a new draft sale holding these products. */
	eventId: Id.nullable(),
	lines: z
		.array(ProductSaleLineWrite)
		.min(1)
		.max(PRODUCT_BULK_MAX)
		.refine((lines) => new Set(lines.map((line) => line.productId)).size === lines.length, 'Each product once'),
	dryRun: z.boolean().default(false),
});
export type ProductSaleWrite = z.infer<typeof ProductSaleWrite>;

/** One SKU's price now and on sale. */
export const ProductSalePrice = z.object({
	sku: z.string(),
	/** The colour or size, empty for a product with one price row. */
	label: z.string(),
	normalINR: z.number().int().nonnegative(),
	saleINR: z.number().int().nonnegative().nullable(),
	/** The rule cannot apply to this price: ₹ 0 or less, above normal, or more off than the price. */
	refused: z.boolean(),
	/** More than 60% off: probably a typing slip. */
	warning: z.boolean(),
});
export type ProductSalePrice = z.infer<typeof ProductSalePrice>;

export const ProductSaleRow = z.object({
	productId: Id,
	title: z.string(),
	sku: z.string(),
	status: ProductStatus,
	thumbnailUrl: z.string().nullable(),
	/** `done`: joins the sale. `refused`: left out, with why. */
	outcome: z.enum(['done', 'refused']),
	reason: z.enum(['overlap', 'bad_rule', 'discontinued', 'not_found']).nullable().default(null),
	/** The clashing sale's name, for `overlap`. */
	detail: z.string().default(''),
	/** Already in this sale through a category: its own rule takes over. */
	viaCategory: z.boolean().default(false),
	prices: z.array(ProductSalePrice),
});
export type ProductSaleRow = z.infer<typeof ProductSaleRow>;

export const ProductSaleResult = z.object({
	dryRun: z.boolean(),
	/** The sale the products joined, or the new draft sale made for them. Null on a dry run for a new sale. */
	eventId: Id.nullable(),
	eventStatus: ShopEventStatus.nullable(),
	rows: z.array(ProductSaleRow),
});
export type ProductSaleResult = z.infer<typeof ProductSaleResult>;
