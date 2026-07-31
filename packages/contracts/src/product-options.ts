import { z } from 'zod';

import { OptionDisplayStyle, SemanticRole } from './attribute';
import { I18nString, Id, PriceINR } from './common';

/**
 * One selectable term of a per-product option group.
 *
 * `priceDeltaINR` and `requiresMeasurements` are SEAMS: how add-on pricing and
 * measurement validation finally behave is `DEC-ADDON-MEASUREMENTS`. The structure is
 * safe to build now; the values stay admin-entered data, and no engine reads them yet.
 */
export const ProductOptionTerm = z.object({
	code: z.string().min(1),
	label: I18nString,
	/** Material-only / opt-out term ("No Stitching", "No Blouse", "No Design"). */
	isBase: z.boolean().default(false),
	hex: z
		.string()
		.regex(/^#([0-9a-fA-F]{6})$/, 'must be a 6-digit hex colour')
		.optional(),
	swatchAssetId: Id.optional(),
	/** Seam — `DEC-ADDON-MEASUREMENTS`. */
	priceDeltaINR: PriceINR.optional(),
	/** Seam — `DEC-ADDON-MEASUREMENTS`: which template collects the measurements. */
	addonTemplateIds: z.array(Id).default([]),
	requiresMeasurements: z.boolean().default(false),
	sortOrder: z.number().int().default(0),
});
export type ProductOptionTerm = z.infer<typeof ProductOptionTerm>;

/**
 * A per-product option group.
 *
 * Owner locks encoded here:
 *   - `semanticRole` decides BEHAVIOR; `displayStyle` is purely visual and never
 *     determines business behavior. The two are independent fields for that reason.
 *   - No axis is globally variation-driving: Color, size, fabric, design, waist and the
 *     rest are per-product toggles. A group is a `variation_axis` only when it changes
 *     SKU, stock, price row, image, base identity, or purchasability.
 *   - A `named_add_on` group (a saree's `Blouse Design`) customizes an included
 *     sub-part. It must offer an opt-out default — the locked `No Design` behavior —
 *     which is why a default term is required and must be a base term.
 *   - Multiple named add-on groups per product are supported.
 */
export const ProductOptionGroup = z
	.object({
		/** References an `attributeDefinitions.code`; the definition supplies reusable terms. */
		attributeCode: z.string().min(1),
		label: I18nString,
		semanticRole: SemanticRole,
		displayStyle: OptionDisplayStyle,
		requiredSelection: z.boolean().default(false),
		defaultTermCode: z.string().min(1).nullable().default(null),
		terms: z.array(ProductOptionTerm).min(1),
	})
	.superRefine((group, ctx) => {
		const codes = group.terms.map((term) => term.code);
		if (new Set(codes).size !== codes.length) {
			ctx.addIssue({
				code: 'custom',
				message: 'term codes must be unique within an option group',
				path: ['terms'],
			});
		}

		if (group.defaultTermCode && !codes.includes(group.defaultTermCode)) {
			ctx.addIssue({
				code: 'custom',
				message: '`defaultTermCode` must reference a term of this group',
				path: ['defaultTermCode'],
			});
		}

		if (group.terms.filter((term) => term.isBase).length > 1) {
			ctx.addIssue({ code: 'custom', message: 'a group may declare at most one base term', path: ['terms'] });
		}

		if (group.semanticRole === 'named_add_on') {
			const base = group.terms.find((term) => term.isBase);
			if (!base) {
				ctx.addIssue({
					code: 'custom',
					message: 'a named add-on group must offer an opt-out base term (the locked "No Design" behavior)',
					path: ['terms'],
				});
			}
			if (!group.defaultTermCode) {
				ctx.addIssue({
					code: 'custom',
					message: 'a named add-on group must declare `defaultTermCode`',
					path: ['defaultTermCode'],
				});
			} else if (base && group.defaultTermCode !== base.code) {
				ctx.addIssue({
					code: 'custom',
					message: 'a named add-on group must default to its base (opt-out) term',
					path: ['defaultTermCode'],
				});
			}
		}

		if (group.semanticRole === 'variation_axis' && group.terms.length < 1) {
			ctx.addIssue({ code: 'custom', message: 'a variation axis needs at least one term', path: ['terms'] });
		}
	});
export type ProductOptionGroup = z.infer<typeof ProductOptionGroup>;

/**
 * Every option group of one product, with the cross-group invariants: codes are unique,
 * and the variation axes are the ones the variant matrix is generated from.
 */
export const ProductOptionGroupSet = z.array(ProductOptionGroup).superRefine((groups, ctx) => {
	const codes = groups.map((group) => group.attributeCode);
	if (new Set(codes).size !== codes.length) {
		ctx.addIssue({ code: 'custom', message: 'a product may not declare the same attribute twice' });
	}
});
export type ProductOptionGroupSet = z.infer<typeof ProductOptionGroupSet>;

/** The attribute codes that drive the variant matrix, in declaration order. */
export const variationAxisCodes = (groups: readonly ProductOptionGroup[]): string[] =>
	groups.filter((group) => group.semanticRole === 'variation_axis').map((group) => group.attributeCode);
