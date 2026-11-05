import { z } from 'zod';

import { CatalogStatus } from './catalog';
import { CatalogRupee, Id, IsoDateTime } from './common';

/** One resolved axis selection on a variant row. */
export const VariantOptionSelection = z.object({
	attributeCode: z.string().min(1),
	termCode: z.string().min(1),
});
export type VariantOptionSelection = z.infer<typeof VariantOptionSelection>;

/**
 * Stock for one variant.
 *
 * Owner lock: stock is tracked on VARIANTS, never on the parent product.
 * `allowBackorder` stays false. Made to order is a product switch, not an oversell
 * of a stocked saree. `DEC-STOCK-RESERVE` still owns reservation timing. The card's
 * low-stock threshold lives on the product, so this per-variant field is not a second rule.
 */
export const VariantStock = z.object({
	tracked: z.boolean().default(true),
	quantity: z.number().int().default(0),
	lowStockThreshold: z.number().int().nonnegative().nullable().default(null),
	/** Seam — `DEC-BACKORDER`. */
	allowBackorder: z.boolean().default(false),
});
export type VariantStock = z.infer<typeof VariantStock>;

/** Physical dimensions used for shipping quotes; provider-agnostic (behind `ShippingPort`). */
export const VariantShippingProfile = z.object({
	weightGrams: z.number().nonnegative().nullable().default(null),
	lengthCm: z.number().nonnegative().nullable().default(null),
	widthCm: z.number().nonnegative().nullable().default(null),
	heightCm: z.number().nonnegative().nullable().default(null),
});
export type VariantShippingProfile = z.infer<typeof VariantShippingProfile>;

/**
 * Tax classification. Pure SEAM — `DEC-TAX-HSN` decides HSN granularity, how classes are
 * assigned and confirmed, and what gets snapshotted on an order line. Nothing here is a
 * rate: rates live in `taxClasses`/`taxRules` config, never in a catalog contract.
 */
export const VariantTaxProfile = z.object({
	hsnCode: z.string().min(1).nullable().default(null),
	taxClassId: Id.nullable().default(null),
});
export type VariantTaxProfile = z.infer<typeof VariantTaxProfile>;

/**
 * Optional window during which `salePriceINR` is the selling price. The card and the
 * product page read the two stored rupee amounts; they do not recompute a percent.
 */
export const VariantSaleWindow = z.object({
	startsAt: IsoDateTime.nullable().default(null),
	endsAt: IsoDateTime.nullable().default(null),
});
export type VariantSaleWindow = z.infer<typeof VariantSaleWindow>;

/**
 * A purchasable SKU row (`productVariants`) — first-class, not embedded in the product.
 *
 * Owner locks encoded here:
 *   - Variant rows exist ONLY for option groups whose `semanticRole` is
 *     `variation_axis`. Named add-ons (a saree's blouse design) are cart/order-line
 *     customization and never appear in `optionSelections`.
 *   - `No Stitching` / `No Blouse` rows carry `isBaseVariant: true`.
 *   - SKUs are globally unique and immutable once published or referenced by an order
 *     (`DEC-SKU`); variant SKUs are auto-suffixed from the product SKU. Immutability is a
 *     write-path/audit rule — a schema cannot see the previous value.
 *   - `optionSelectionHash` is the duplicate guard for one combination per product.
 *
 * A variant may set SKU, MRP (`compareAtPriceINR`), selling price, stock, images,
 * shipping dimensions, barcode, availability, and HSN. An empty field inherits the
 * product. Title, description, and SEO stay on the product. Colour and apparel size
 * are variation axes, not free-text overrides.
 */
export const ProductVariant = z
	.object({
		id: Id,
		productId: Id,
		sku: z.string().min(1),
		status: CatalogStatus.default('draft'),
		optionSelections: z.array(VariantOptionSelection).min(1),
		/**
		 * Stable hash of the sorted `attributeCode:termCode` pairs. Computed at the write
		 * boundary and unique per product, so the same combination cannot be created twice.
		 */
		optionSelectionHash: z.string().min(1),
		isBaseVariant: z.boolean().default(false),
		priceINR: CatalogRupee,
		compareAtPriceINR: CatalogRupee.nullable().default(null),
		salePriceINR: CatalogRupee.nullable().default(null),
		barcode: z.string().min(1).nullable().optional(),
		saleWindow: VariantSaleWindow.optional(),
		stock: VariantStock.default({ tracked: true, quantity: 0, lowStockThreshold: null, allowBackorder: false }),
		shippingProfile: VariantShippingProfile.optional(),
		taxProfile: VariantTaxProfile.optional(),
		media: z
			.object({
				primaryAssetId: Id.nullable().default(null),
			})
			.optional(),
		createdAt: IsoDateTime.optional(),
		updatedAt: IsoDateTime.optional(),
	})
	.superRefine((variant, ctx) => {
		const codes = variant.optionSelections.map((selection) => selection.attributeCode);
		if (new Set(codes).size !== codes.length) {
			ctx.addIssue({
				code: 'custom',
				message: 'a variant may select at most one term per axis',
				path: ['optionSelections'],
			});
		}

		if (variant.salePriceINR !== null && variant.salePriceINR > variant.priceINR) {
			ctx.addIssue({
				code: 'custom',
				message: '`salePriceINR` may not exceed `priceINR`',
				path: ['salePriceINR'],
			});
		}

		const { startsAt, endsAt } = variant.saleWindow ?? {};
		if (startsAt && endsAt && startsAt > endsAt) {
			ctx.addIssue({
				code: 'custom',
				message: 'sale window ends before it starts',
				path: ['saleWindow', 'endsAt'],
			});
		}
	});
export type ProductVariant = z.infer<typeof ProductVariant>;

/**
 * All variants of one product. Enforces what a single row cannot: one row per option
 * combination, at most one base variant, and a single owning product.
 */
export const ProductVariantSet = z
	.array(ProductVariant)
	.min(1)
	.superRefine((variants, ctx) => {
		if (new Set(variants.map((variant) => variant.productId)).size > 1) {
			ctx.addIssue({ code: 'custom', message: 'every variant in a set must belong to the same product' });
		}

		const hashes = variants.map((variant) => variant.optionSelectionHash);
		if (new Set(hashes).size !== hashes.length) {
			ctx.addIssue({ code: 'custom', message: 'duplicate option combination among variants' });
		}

		const skus = variants.map((variant) => variant.sku);
		if (new Set(skus).size !== skus.length) {
			ctx.addIssue({ code: 'custom', message: 'variant SKUs must be unique' });
		}

		if (variants.filter((variant) => variant.isBaseVariant).length > 1) {
			ctx.addIssue({ code: 'custom', message: 'a product may declare at most one base variant' });
		}

		const axisSignature = (variant: ProductVariant) =>
			variant.optionSelections
				.map((selection) => selection.attributeCode)
				.sort()
				.join('|');
		if (new Set(variants.map(axisSignature)).size > 1) {
			ctx.addIssue({ code: 'custom', message: 'all variants of a product must select the same set of axes' });
		}
	});
export type ProductVariantSet = z.infer<typeof ProductVariantSet>;

/**
 * Canonical `optionSelectionHash` input: axis selections sorted by attribute code and
 * joined, so the hash is independent of the order the admin picked them in.
 */
export const optionSelectionKey = (selections: readonly VariantOptionSelection[]): string =>
	[...selections]
		.map((selection) => `${selection.attributeCode}:${selection.termCode}`)
		.sort()
		.join('|');
