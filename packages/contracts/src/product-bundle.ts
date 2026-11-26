import { z } from 'zod';

import { BundlePriceRule, BundleRuleCombine } from './bundle-rules';
import { CatalogStatus } from './catalog';
import { CatalogRupee, I18nString, Id, IsoDateTime } from './common';

/**
 * A bundle (set) is a product of type `bundle`, built in its own builder (owner, 22 Nov 2026; brief
 * UE6GxSvKq5VfspTqD41ixQ revisions 1–3). It is a list of levels; each level holds one or more products and says
 * how many the shopper takes. A level holding no more products than it takes is fixed (green tick); a level
 * holding more is a choice. Optional extras sit outside the levels. The set carries no stock, HSN or tax of its
 * own: each piece is stocked, invoiced and taxed as itself, at its share of the set price.
 *
 * **`DEC-BUNDLE-NESTING` is LOCKED: a bundle can never contain another bundle.** The write path resolves every
 * referenced product and refuses a bundle, so checkout resolves exactly one level into concrete order lines.
 */

/** An item's key inside one bundle: `productId`, or `productId:variantId` when a variant is pinned. */
export const bundleItemKey = (item: { productId: string; variantId: string | null }): string =>
	item.variantId ? `${item.productId}:${item.variantId}` : item.productId;

export const BundleItem = z.object({
	productId: Id,
	/** A pinned size or colour. Null: the shopper chooses when the product has variants (S8), else its only row. */
	variantId: Id.nullable().default(null),
	/** Pieces, or tenths of a metre for fabric sold by the metre. */
	quantity: z.number().int().positive().max(9999).default(1),
	/** The item's price in this set. Null follows its selling price (R1); an override survives price changes. */
	priceInSetINR: CatalogRupee.nullable().default(null),
});
export type BundleItem = z.infer<typeof BundleItem>;

/** How a choice level prices a pick under a fixed set price (suggestion S3). */
export const BundleLevelPriceMode = z.enum(['difference', 'included', 'own']);
export type BundleLevelPriceMode = z.infer<typeof BundleLevelPriceMode>;

/** Where a level's products come from: picked one by one, or every live product of a category (S10). */
export const BundleLevelSource = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('items') }),
	z.object({
		kind: z.literal('category'),
		categoryId: Id,
		/** The most products the level offers, newest first. */
		limit: z.number().int().min(1).max(50).default(12),
	}),
]);
export type BundleLevelSource = z.infer<typeof BundleLevelSource>;

export const BundleLevel = z
	.object({
		code: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,40}$/),
		label: I18nString,
		/** How many the shopper takes from this level. */
		take: z.number().int().min(1).max(20).default(1),
		source: BundleLevelSource.default({ kind: 'items' }),
		items: z.array(BundleItem).max(50).default([]),
		priceMode: BundleLevelPriceMode.default('difference'),
	})
	.superRefine((level, ctx) => {
		const keys = level.items.map(bundleItemKey);
		if (new Set(keys).size !== keys.length) {
			ctx.addIssue({ code: 'custom', path: ['items'], message: 'a product may appear once in a level' });
		}
		if (level.source.kind === 'items' && level.items.length > 0 && level.take > level.items.length) {
			ctx.addIssue({ code: 'custom', path: ['take'], message: 'a level cannot take more than it holds' });
		}
	});
export type BundleLevel = z.infer<typeof BundleLevel>;

/** An optional extra: outside the levels, ticked by the shopper. Price 0 is "Free". */
export const BundleExtra = BundleItem;
export type BundleExtra = z.infer<typeof BundleExtra>;

/** How the set is priced: a method from the price method list, the numbers it asks for, and the set's own rules. */
export const BundlePricing = z.object({
	methodId: Id,
	/** The method's inputs as typed on this bundle ("percent": 10, "setPrice": 44900). */
	params: z.record(z.string(), z.number().finite()).default({}),
	rules: z.array(BundlePriceRule).max(20).default([]),
	combine: BundleRuleCombine.default('all'),
	/** The set price never goes above the pieces bought separately. */
	capAtSeparately: z.boolean().default(false),
	roundTo: z.enum(['none', 'one', 'ten']).default('one'),
});
export type BundlePricing = z.infer<typeof BundlePricing>;

/** The worked-out stock, saved on the bundle whenever a piece's stock moves (V3). */
export const BundleStockSummary = z.object({
	setsPossible: z.number().int().nonnegative(),
	state: z.enum(['in_stock', 'low_stock', 'out_of_stock']),
	/** Fixed pieces that are sold out (each stops the bundle). */
	soldOutPieces: z.array(z.string()).default([]),
	/** Choices that are sold out (the bundle sells while one full combination remains). */
	soldOutChoices: z.array(z.string()).default([]),
	totalPieces: z.number().int().nonnegative().default(0),
	totalChoices: z.number().int().nonnegative().default(0),
	updatedAt: IsoDateTime.optional(),
});
export type BundleStockSummary = z.infer<typeof BundleStockSummary>;

export const ProductBundle = z
	.object({
		id: Id,
		/** The product (type `bundle`) this set backs. */
		productId: Id,
		levels: z.array(BundleLevel).max(12).default([]),
		extras: z.array(BundleExtra).max(20).default([]),
		pricing: BundlePricing,
		/** On sale from / to, for festival sets (suggestion 9). Outside it the set cannot be bought. */
		saleWindow: z.object({ from: IsoDateTime.nullable(), to: IsoDateTime.nullable() }).nullable().default(null),
		/** An optional styled photo of the whole set, shown first; the pieces' photos follow (A5). */
		styledPhoto: z.object({ assetId: Id, versionId: z.string().nullable() }).nullable().default(null),
		/** Why the set may cost more than its pieces during a sale, when kept on purpose (C09). */
		dearerReason: z.string().trim().max(300).nullable().default(null),
		stock: BundleStockSummary.nullable().default(null),
		status: CatalogStatus.default('draft'),
		createdAt: z.string().optional(),
		updatedAt: z.string().optional(),
	})
	.superRefine((bundle, ctx) => {
		const codes = bundle.levels.map((level) => level.code);
		if (new Set(codes).size !== codes.length) {
			ctx.addIssue({ code: 'custom', path: ['levels'], message: 'level codes must be unique' });
		}
		bundle.levels.forEach((level, at) =>
			level.items.forEach((item, itemAt) => {
				if (item.productId === bundle.productId) {
					ctx.addIssue({
						code: 'custom',
						path: ['levels', at, 'items', itemAt, 'productId'],
						message: 'a bundle may not contain itself',
					});
				}
			}),
		);
		const pieceKeys = new Set(bundle.levels.flatMap((level) => level.items.map(bundleItemKey)));
		bundle.extras.forEach((extra, at) => {
			if (pieceKeys.has(bundleItemKey(extra))) {
				ctx.addIssue({
					code: 'custom',
					path: ['extras', at],
					message: 'an optional extra cannot also be a piece of the set',
				});
			}
		});
	});
export type ProductBundle = z.infer<typeof ProductBundle>;

/** The builder's Build and Price rules tabs. Its id and product come from the address. */
export const ProductBundleWrite = z.object({
	levels: z.array(BundleLevel).max(12),
	extras: z.array(BundleExtra).max(20).default([]),
	pricing: BundlePricing,
	saleWindow: z.object({ from: IsoDateTime.nullable(), to: IsoDateTime.nullable() }).nullable().default(null),
	styledPhoto: z.object({ assetId: Id, versionId: z.string().nullable() }).nullable().default(null),
	dearerReason: z.string().trim().max(300).nullable().default(null),
});
export type ProductBundleWrite = z.infer<typeof ProductBundleWrite>;

/** What the shopper chose in a set: picks per level, sizes for "shopper chooses" items, extras, free items. */
export const BundleChoice = z.object({
	/** Level code → item keys picked. Fixed levels need nothing. */
	picks: z.record(z.string(), z.array(z.string()).max(20)).default({}),
	/** Item key → the variant (size or colour) the shopper chose, for items without a pinned variant. */
	variants: z.record(z.string(), Id).default({}),
	/** Extra item keys ticked. */
	extras: z.array(z.string()).max(20).default([]),
	/** Item key (a piece) → the free items picked for it, when its product gives a choice (D5). */
	free: z
		.record(z.string(), z.array(z.object({ productId: Id, variantId: Id.nullable().default(null) })).max(10))
		.default({}),
});
export type BundleChoice = z.infer<typeof BundleChoice>;
