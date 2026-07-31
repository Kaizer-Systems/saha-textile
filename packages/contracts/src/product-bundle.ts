import { z } from 'zod';

import { CatalogStatus } from './catalog';
import { I18nString, Id, PriceINR } from './common';

/**
 * How a bundle is assembled.
 * - `fixed_kit`             — every component ships together, no choice.
 * - `choose_one_per_group`  — the customer picks within each group.
 * - `optional_addons`       — components the customer may add.
 */
export const BundleType = z.enum(['fixed_kit', 'choose_one_per_group', 'optional_addons']);
export type BundleType = z.infer<typeof BundleType>;

/**
 * How a bundle is priced. The chosen policy is stored; the MATH runs server-side in the
 * pricing engine, which is also where promotion interaction (`DEC-PROMO-STACK`) is
 * resolved. No prices are computed in a contract.
 */
export const BundlePricePolicy = z.enum(['sum_components', 'fixed_bundle_price', 'discounted_components']);
export type BundlePricePolicy = z.infer<typeof BundlePricePolicy>;

/**
 * One component of a bundle group.
 *
 * `productId` must reference a NON-bundle product — see `ProductBundle` below. A
 * contract cannot look that up, so the write path resolves the referenced product and
 * rejects a bundle component.
 */
export const BundleComponent = z.object({
	productId: Id,
	/** Pin a specific purchasable row; omitted means the customer chooses at add-to-cart. */
	variantId: Id.nullable().default(null),
	quantity: z.number().int().positive().default(1),
	required: z.boolean().default(true),
	/** Per-component adjustment used by `discounted_components`; seam for the pricing engine. */
	priceAdjustmentINR: PriceINR.nullable().default(null),
});
export type BundleComponent = z.infer<typeof BundleComponent>;

/** A selection group inside a bundle. */
export const BundleGroup = z
	.object({
		code: z.string().min(1),
		label: I18nString,
		minSelections: z.number().int().nonnegative().default(0),
		maxSelections: z.number().int().positive(),
		components: z.array(BundleComponent).min(1),
	})
	.superRefine((group, ctx) => {
		if (group.minSelections > group.maxSelections) {
			ctx.addIssue({
				code: 'custom',
				message: '`minSelections` may not exceed `maxSelections`',
				path: ['minSelections'],
			});
		}
		if (group.maxSelections > group.components.length) {
			ctx.addIssue({
				code: 'custom',
				message: '`maxSelections` may not exceed the number of components',
				path: ['maxSelections'],
			});
		}
		const productKeys = group.components.map((component) => `${component.productId}:${component.variantId ?? '*'}`);
		if (new Set(productKeys).size !== productKeys.length) {
			ctx.addIssue({
				code: 'custom',
				message: 'a component may not appear twice in one group',
				path: ['components'],
			});
		}
	});
export type BundleGroup = z.infer<typeof BundleGroup>;

/**
 * A true compound product (`productBundles`) — selecting it resolves to separate
 * component lines, changing cart lines, price policy, and inventory consumption.
 *
 * This is NOT cross-sell, upsell, related products, bought-together rails, or named
 * add-ons; those are `productRelations` and product option groups respectively.
 *
 * **`DEC-BUNDLE-NESTING` is LOCKED: a bundle can never contain another bundle.** The
 * pre-lock architecture sketch had `allowNestedBundles` / `maxDepth` knobs; they are
 * deliberately absent so nesting cannot be re-enabled by flipping a flag. Enforcement is
 * two-part: no depth configuration here, and the write path rejects a component whose
 * product is itself a bundle. Bundles are therefore acyclic by construction, and
 * checkout resolves exactly one level into concrete, snapshotted order lines.
 */
export const ProductBundle = z
	.object({
		id: Id,
		/** The purchasable product this bundle backs. */
		productId: Id,
		bundleType: BundleType,
		pricePolicy: BundlePricePolicy,
		/** Required when `pricePolicy` is `fixed_bundle_price`. */
		fixedPriceINR: PriceINR.nullable().default(null),
		groups: z.array(BundleGroup).min(1),
		status: CatalogStatus.default('draft'),
		createdAt: z.string().optional(),
		updatedAt: z.string().optional(),
	})
	.superRefine((bundle, ctx) => {
		const codes = bundle.groups.map((group) => group.code);
		if (new Set(codes).size !== codes.length) {
			ctx.addIssue({ code: 'custom', message: 'bundle group codes must be unique', path: ['groups'] });
		}

		if (bundle.pricePolicy === 'fixed_bundle_price' && bundle.fixedPriceINR === null) {
			ctx.addIssue({
				code: 'custom',
				message: '`fixed_bundle_price` requires `fixedPriceINR`',
				path: ['fixedPriceINR'],
			});
		}

		if (bundle.pricePolicy !== 'fixed_bundle_price' && bundle.fixedPriceINR !== null) {
			ctx.addIssue({
				code: 'custom',
				message: '`fixedPriceINR` is only meaningful for `fixed_bundle_price`',
				path: ['fixedPriceINR'],
			});
		}

		// A bundle may not contain the product it backs — the one self-reference a schema can see.
		bundle.groups.forEach((group, groupIndex) => {
			group.components.forEach((component, componentIndex) => {
				if (component.productId === bundle.productId) {
					ctx.addIssue({
						code: 'custom',
						message: 'a bundle may not contain itself',
						path: ['groups', groupIndex, 'components', componentIndex, 'productId'],
					});
				}
			});
		});

		if (bundle.bundleType === 'fixed_kit') {
			const optional = bundle.groups.some((group) => group.components.some((component) => !component.required));
			if (optional) {
				ctx.addIssue({
					code: 'custom',
					message: 'a `fixed_kit` bundle may not contain optional components',
					path: ['groups'],
				});
			}
		}
	});
export type ProductBundle = z.infer<typeof ProductBundle>;
