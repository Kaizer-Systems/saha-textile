import { describe, expect, it } from 'vitest';

import {
	ProductBundle,
	ProductOptionGroup,
	ProductOptionGroupSet,
	ProductRelation,
	ProductVariant,
	ProductVariantSet,
	optionSelectionKey,
	variationAxisCodes,
} from '../src/index';

describe('ProductOptionGroup — semantic role decides behavior, display never does', () => {
	const designAxis = {
		attributeCode: 'salwaar_design',
		label: { en: 'Salwaar Designs' },
		semanticRole: 'variation_axis' as const,
		displayStyle: 'image_swatch' as const,
		requiredSelection: true,
		defaultTermCode: 'no-stitching',
		terms: [
			{ code: 'no-stitching', label: { en: 'No Stitching' }, isBase: true },
			{ code: 'design-1', label: { en: 'Design 1' }, priceDeltaINR: 900 },
		],
	};

	const blouseAddon = {
		attributeCode: 'blouse_design',
		label: { en: 'Blouse Design' },
		semanticRole: 'named_add_on' as const,
		displayStyle: 'image_tile' as const,
		defaultTermCode: 'no-design',
		terms: [
			{ code: 'no-design', label: { en: 'No Design' }, isBase: true },
			{ code: 'design-a', label: { en: 'Design A' }, priceDeltaINR: 600, requiresMeasurements: true },
		],
	};

	it('parses a variation axis with term defaults', () => {
		const parsed = ProductOptionGroup.parse(designAxis);
		expect(parsed.terms[1]?.isBase).toBe(false);
		expect(parsed.terms[1]?.addonTemplateIds).toEqual([]);
		expect(parsed.terms[0]?.sortOrder).toBe(0);
	});

	it('lets the same role take any display style — style is never behavior', () => {
		for (const displayStyle of ['rectangle', 'circle', 'dropdown', 'radio_bar'] as const) {
			expect(ProductOptionGroup.safeParse({ ...designAxis, displayStyle }).success).toBe(true);
		}
	});

	it('requires a named add-on to offer an opt-out default (the locked "No Design" behavior)', () => {
		expect(ProductOptionGroup.safeParse(blouseAddon).success).toBe(true);

		// no base term at all
		expect(
			ProductOptionGroup.safeParse({
				...blouseAddon,
				defaultTermCode: 'design-a',
				terms: [{ code: 'design-a', label: { en: 'Design A' } }],
			}).success,
		).toBe(false);

		// base term exists but the group defaults to a paid one
		expect(ProductOptionGroup.safeParse({ ...blouseAddon, defaultTermCode: 'design-a' }).success).toBe(false);

		// no default at all
		expect(ProductOptionGroup.safeParse({ ...blouseAddon, defaultTermCode: null }).success).toBe(false);
	});

	it('does not force a default on a filter-only group', () => {
		expect(
			ProductOptionGroup.safeParse({
				attributeCode: 'fabric',
				label: { en: 'Fabric' },
				semanticRole: 'filter_only',
				displayStyle: 'rectangle',
				terms: [{ code: 'silk', label: { en: 'Silk' } }],
			}).success,
		).toBe(true);
	});

	it('rejects duplicate terms, an unknown default, and two base terms', () => {
		const duplicate = designAxis.terms[0]!;
		expect(ProductOptionGroup.safeParse({ ...designAxis, terms: [duplicate, duplicate] }).success).toBe(false);
		expect(ProductOptionGroup.safeParse({ ...designAxis, defaultTermCode: 'nope' }).success).toBe(false);
		expect(
			ProductOptionGroup.safeParse({
				...designAxis,
				terms: [duplicate, { code: 'design-1', label: { en: 'Design 1' }, isBase: true }],
			}).success,
		).toBe(false);
	});

	it('rejects a product declaring the same attribute twice', () => {
		expect(ProductOptionGroupSet.safeParse([designAxis, blouseAddon]).success).toBe(true);
		expect(ProductOptionGroupSet.safeParse([designAxis, designAxis]).success).toBe(false);
	});

	it('derives the variant matrix axes from semantic role only', () => {
		const groups = ProductOptionGroupSet.parse([
			designAxis,
			blouseAddon,
			{
				attributeCode: 'color',
				label: { en: 'Color' },
				semanticRole: 'filter_only',
				displayStyle: 'color_swatch',
				terms: [{ code: 'black', label: { en: 'Black' }, hex: '#000000' }],
			},
		]);
		// Colour is descriptive here and the blouse add-on is customization: neither makes SKU rows.
		expect(variationAxisCodes(groups)).toEqual(['salwaar_design']);
	});
});

describe('ProductVariant', () => {
	const variant = (overrides: Record<string, unknown> = {}) => ({
		id: 'var_1',
		productId: 'prod_5557',
		sku: 'SKU75789-1-NS',
		optionSelections: [{ attributeCode: 'salwaar_design', termCode: 'no-stitching' }],
		optionSelectionHash: 'salwaar_design:no-stitching',
		isBaseVariant: true,
		priceINR: 1200,
		...overrides,
	});

	it('applies stock and pricing defaults', () => {
		const parsed = ProductVariant.parse(variant());
		expect(parsed.status).toBe('draft');
		expect(parsed.stock).toEqual({ tracked: true, quantity: 0, lowStockThreshold: null, allowBackorder: false });
		expect(parsed.salePriceINR).toBeNull();
		expect(parsed.compareAtPriceINR).toBeNull();
	});

	it('rejects two terms of the same axis on one row', () => {
		expect(
			ProductVariant.safeParse(
				variant({
					optionSelections: [
						{ attributeCode: 'salwaar_design', termCode: 'no-stitching' },
						{ attributeCode: 'salwaar_design', termCode: 'design-1' },
					],
				}),
			).success,
		).toBe(false);
	});

	it('rejects a sale price above the list price and an inverted sale window', () => {
		expect(ProductVariant.safeParse(variant({ salePriceINR: 1500 })).success).toBe(false);
		expect(ProductVariant.safeParse(variant({ salePriceINR: 900 })).success).toBe(true);
		expect(
			ProductVariant.safeParse(
				variant({ saleWindow: { startsAt: '2026-08-10T00:00:00.000Z', endsAt: '2026-08-01T00:00:00.000Z' } }),
			).success,
		).toBe(false);
	});

	it('requires at least one axis selection and a SKU', () => {
		expect(ProductVariant.safeParse(variant({ optionSelections: [] })).success).toBe(false);
		expect(ProductVariant.safeParse(variant({ sku: '' })).success).toBe(false);
	});

	it('builds an order-independent option key', () => {
		const forward = optionSelectionKey([
			{ attributeCode: 'design', termCode: 'design-1' },
			{ attributeCode: 'color', termCode: 'black' },
		]);
		const reversed = optionSelectionKey([
			{ attributeCode: 'color', termCode: 'black' },
			{ attributeCode: 'design', termCode: 'design-1' },
		]);
		expect(forward).toBe(reversed);
		expect(forward).toBe('color:black|design:design-1');
	});
});

describe('ProductVariantSet', () => {
	const base = {
		productId: 'prod_5557',
		priceINR: 1200,
	};
	const rows = [
		{
			...base,
			id: 'var_1',
			sku: 'SKU-1',
			optionSelections: [{ attributeCode: 'design', termCode: 'no-stitching' }],
			optionSelectionHash: 'design:no-stitching',
			isBaseVariant: true,
		},
		{
			...base,
			id: 'var_2',
			sku: 'SKU-2',
			optionSelections: [{ attributeCode: 'design', termCode: 'design-1' }],
			optionSelectionHash: 'design:design-1',
		},
	];

	it('accepts a coherent matrix', () => {
		expect(ProductVariantSet.safeParse(rows).success).toBe(true);
	});

	it('rejects a duplicate combination, duplicate SKUs, and two base rows', () => {
		expect(
			ProductVariantSet.safeParse([rows[0], { ...rows[1], optionSelectionHash: 'design:no-stitching' }]).success,
		).toBe(false);
		expect(ProductVariantSet.safeParse([rows[0], { ...rows[1], sku: 'SKU-1' }]).success).toBe(false);
		expect(ProductVariantSet.safeParse([rows[0], { ...rows[1], isBaseVariant: true }]).success).toBe(false);
	});

	it('rejects rows that disagree about which axes exist', () => {
		expect(
			ProductVariantSet.safeParse([
				rows[0],
				{
					...rows[1],
					optionSelections: [
						{ attributeCode: 'design', termCode: 'design-1' },
						{ attributeCode: 'color', termCode: 'black' },
					],
				},
			]).success,
		).toBe(false);
	});

	it('rejects variants of different products in one set', () => {
		expect(ProductVariantSet.safeParse([rows[0], { ...rows[1], productId: 'prod_other' }]).success).toBe(false);
	});
});

describe('ProductBundle — DEC-BUNDLE-NESTING is locked', () => {
	const bundle = (overrides: Record<string, unknown> = {}) => ({
		id: 'bundle_1',
		productId: 'prod_bridal_set',
		bundleType: 'fixed_kit',
		pricePolicy: 'sum_components',
		groups: [
			{
				code: 'core',
				label: { en: 'Core' },
				maxSelections: 2,
				components: [
					{ productId: 'prod_saree_001', quantity: 1 },
					{ productId: 'prod_blouse_002', quantity: 1 },
				],
			},
		],
		...overrides,
	});

	it('exposes no nesting knob at all — the flag cannot be flipped back on', () => {
		const parsed = ProductBundle.parse(bundle());
		expect('allowNestedBundles' in parsed).toBe(false);
		expect('maxDepth' in parsed).toBe(false);
	});

	it('rejects a bundle containing itself', () => {
		expect(
			ProductBundle.safeParse(
				bundle({
					groups: [
						{
							code: 'core',
							label: { en: 'Core' },
							maxSelections: 1,
							components: [{ productId: 'prod_bridal_set', quantity: 1 }],
						},
					],
				}),
			).success,
		).toBe(false);
	});

	it('ties fixedPriceINR to the fixed-price policy in both directions', () => {
		expect(ProductBundle.safeParse(bundle({ pricePolicy: 'fixed_bundle_price' })).success).toBe(false);
		expect(
			ProductBundle.safeParse(bundle({ pricePolicy: 'fixed_bundle_price', fixedPriceINR: 7999 })).success,
		).toBe(true);
		expect(ProductBundle.safeParse(bundle({ fixedPriceINR: 7999 })).success).toBe(false);
	});

	it('rejects optional components inside a fixed kit', () => {
		expect(
			ProductBundle.safeParse(
				bundle({
					groups: [
						{
							code: 'core',
							label: { en: 'Core' },
							maxSelections: 2,
							components: [
								{ productId: 'prod_saree_001', quantity: 1 },
								{ productId: 'prod_blouse_002', quantity: 1, required: false },
							],
						},
					],
				}),
			).success,
		).toBe(false);
	});

	it('validates selection bounds and duplicate components', () => {
		const group = {
			code: 'choose',
			label: { en: 'Choose' },
			minSelections: 3,
			maxSelections: 1,
			components: [{ productId: 'prod_a', quantity: 1 }],
		};
		expect(ProductBundle.safeParse(bundle({ bundleType: 'choose_one_per_group', groups: [group] })).success).toBe(
			false,
		);
		expect(
			ProductBundle.safeParse(
				bundle({
					bundleType: 'choose_one_per_group',
					groups: [{ ...group, minSelections: 1, maxSelections: 5 }],
				}),
			).success,
		).toBe(false);
		expect(
			ProductBundle.safeParse(
				bundle({
					groups: [
						{
							code: 'core',
							label: { en: 'Core' },
							maxSelections: 2,
							components: [
								{ productId: 'prod_a', quantity: 1 },
								{ productId: 'prod_a', quantity: 1 },
							],
						},
					],
				}),
			).success,
		).toBe(false);
	});
});

describe('ProductRelation — curated versus analytics-backed (DEC-PRODUCT-RELATIONS)', () => {
	const relation = (overrides: Record<string, unknown> = {}) => ({
		id: 'rel_1',
		sourceProductId: 'prod_saree_001',
		relationType: 'related',
		targetId: 'prod_saree_002',
		surfaces: ['product_detail'],
		...overrides,
	});

	it('defaults to a manual, draft relation', () => {
		const parsed = ProductRelation.parse(relation());
		expect(parsed.source).toBe('manual');
		expect(parsed.status).toBe('draft');
		expect(parsed.targetType).toBe('product');
		expect(parsed.insightSetId).toBeNull();
	});

	it('forbids analytics from inventing related/upsell links', () => {
		for (const relationType of ['related', 'upsell']) {
			const result = ProductRelation.safeParse(
				relation({ relationType, source: 'insight_set', insightSetId: 'insight_2026_w31' }),
			);
			expect(result.success).toBe(false);
		}
	});

	it('allows cross-sell and bought-together from an insight set, and manually too', () => {
		for (const relationType of ['cross_sell', 'bought_together']) {
			expect(
				ProductRelation.safeParse(
					relation({ relationType, source: 'insight_set', insightSetId: 'insight_2026_w31' }),
				).success,
			).toBe(true);
			expect(ProductRelation.safeParse(relation({ relationType, source: 'manual' })).success).toBe(true);
		}
	});

	it('requires an insight-set relation to name its persisted set, and forbids it otherwise', () => {
		expect(ProductRelation.safeParse(relation({ relationType: 'cross_sell', source: 'insight_set' })).success).toBe(
			false,
		);
		expect(ProductRelation.safeParse(relation({ insightSetId: 'insight_2026_w31' })).success).toBe(false);
	});

	it('rejects a self-relation, an empty surface list, and an inverted window', () => {
		expect(ProductRelation.safeParse(relation({ targetId: 'prod_saree_001' })).success).toBe(false);
		expect(ProductRelation.safeParse(relation({ surfaces: [] })).success).toBe(false);
		expect(
			ProductRelation.safeParse(
				relation({ startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-08-01T00:00:00.000Z' }),
			).success,
		).toBe(false);
	});
});
