import { z } from 'zod';

import { I18nString, Id, Slug } from './common';

/**
 * Per-product business meaning of an option group (owner lock 2026-07-04).
 * `semanticRole` decides behavior; display style NEVER decides business behavior.
 * - `filter_only`      — searchable/filterable/display attribute; no SKU row.
 * - `variation_axis`   — generates variant matrix rows (changes SKU/stock/price/image/identity).
 * - `named_add_on`     — customizes an included sub-part/service (e.g. saree blouse design);
 *                        snapshots on the cart/order line; no variant Cartesian rows.
 * - `bundle_component_option` — resolves separate inventory/components via bundles.
 */
export const SemanticRole = z.enum(['filter_only', 'variation_axis', 'named_add_on', 'bundle_component_option']);
export type SemanticRole = z.infer<typeof SemanticRole>;

/** Default role for a global attribute definition (adds non-product-facing defaults). */
export const AttributeDefaultRole = z.enum([
	'filter_only',
	'variation_axis',
	'named_add_on',
	'bundle_component_option',
	'descriptive',
	'search',
]);
export type AttributeDefaultRole = z.infer<typeof AttributeDefaultRole>;

/**
 * Storefront option renderer (visual ONLY — owner lock 2026-07-04, canonical six;
 * `image_tile` ["Image V2"] + `radio_bar` added 2026-07-17 for storefront/admin parity).
 */
export const OptionDisplayStyle = z.enum([
	'rectangle',
	'circle',
	'image_swatch',
	'color_swatch',
	'radio',
	'dropdown',
	'image_tile',
	'radio_bar',
]);
export type OptionDisplayStyle = z.infer<typeof OptionDisplayStyle>;

/** Facet renderer for the category sidebar/off-canvas filter UI. */
export const FacetDisplayStyle = z.enum(['checkbox', 'swatch', 'range', 'rating', 'toggle', 'chips', 'radio']);
export type FacetDisplayStyle = z.infer<typeof FacetDisplayStyle>;

/** One reusable term of a global attribute definition (with search aliases/transliterations). */
export const AttributeDefinitionTerm = z.object({
	code: z.string().min(1),
	label: I18nString,
	slug: Slug,
	/** Required when rendered as `color_swatch`. */
	hex: z
		.string()
		.regex(/^#([0-9a-fA-F]{6})$/, 'must be a 6-digit hex colour')
		.optional(),
	/** Required when rendered as `image_swatch`/`image_tile` (media library asset). */
	swatchAssetId: Id.optional(),
	aliases: z.array(z.string()).default([]),
	/** Base/material-only term (e.g. `no_stitching`, `no_blouse`) — maps to `isBaseVariant`. */
	isBase: z.boolean().default(false),
});
export type AttributeDefinitionTerm = z.infer<typeof AttributeDefinitionTerm>;

/** Reusable filter defaults on a definition — public sidebar exposure is decided by `CategoryFacetConfig`. */
export const AttributeFilterConfig = z.object({
	visible: z.boolean().default(true),
	sortOrder: z.number().int().default(0),
	facetEligible: z.boolean().optional(),
	defaultFacetDisplayStyle: FacetDisplayStyle.optional(),
	defaultFacetLabel: I18nString.optional(),
	showCountsByDefault: z.boolean().optional(),
});
export type AttributeFilterConfig = z.infer<typeof AttributeFilterConfig>;

/**
 * Global attribute definition entity (`attributeDefinitions`) — Fastkart's
 * "Attribute" master. Business meaning is NOT decided globally: a product can
 * override `defaultRole`/`defaultDisplayStyle` per option group (toggle-based;
 * Color is filter/descriptive by default, variation-driving only when marked).
 */
export const AttributeDefinition = z.object({
	id: Id,
	code: z.string().min(1),
	label: I18nString,
	defaultRole: AttributeDefaultRole.default('filter_only'),
	defaultDisplayStyle: OptionDisplayStyle.default('rectangle'),
	valueType: z.enum(['term', 'color', 'number', 'text']).default('term'),
	terms: z.array(AttributeDefinitionTerm).default([]),
	filterConfig: AttributeFilterConfig.optional(),
	createdAt: z.string().optional(),
	updatedAt: z.string().optional(),
});
export type AttributeDefinition = z.infer<typeof AttributeDefinition>;

/**
 * One measurement/customization field of an add-on template. Validation bounds
 * are a SEAM (worksheet §14/B6): optional config, not locked business law.
 */
export const AddonTemplateField = z.object({
	code: z.string().min(1),
	label: I18nString,
	type: z.enum(['number', 'text', 'select']).default('number'),
	unit: z.enum(['in', 'cm']).optional(),
	required: z.boolean().default(false),
	options: z.array(z.string()).optional(),
	validation: z
		.object({
			min: z.number().optional(),
			max: z.number().optional(),
			decimals: z.number().int().nonnegative().optional(),
		})
		.optional(),
});
export type AddonTemplateField = z.infer<typeof AddonTemplateField>;

/**
 * Reusable tailoring/customization template entity (`addonTemplates`), with
 * conditional visibility (e.g. blouse measurements apply only when the selected
 * term is not a base term). Measurement sets are data-driven per product —
 * never a hardcoded fixed field set (owner lock 2026-07-18).
 */
export const AddonTemplate = z.object({
	id: Id,
	code: z.string().min(1),
	label: I18nString,
	fields: z.array(AddonTemplateField).min(1),
	/** Show these fields only when the referenced attribute has one of these terms selected. */
	appliesWhen: z
		.array(
			z.object({
				attributeCode: z.string().min(1),
				termCodes: z.array(z.string()).min(1),
			}),
		)
		.optional(),
	status: z.enum(['active', 'archived']).default('active'),
});
export type AddonTemplate = z.infer<typeof AddonTemplate>;
