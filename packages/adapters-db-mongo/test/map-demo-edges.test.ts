import { describe, expect, it } from 'vitest';

import { CATALOG_PHOTO_ASSET_IDS, mapDemoCatalogue } from '../src/seed/map-demo-catalogue';

const map = (products: unknown[], attributes?: unknown[]) =>
	mapDemoCatalogue({ products: products as never, ...(attributes ? { attributes: attributes as never } : {}) });

describe('mapDemoCatalogue with sparse rows', () => {
	it('builds a product from an id alone', () => {
		const { products, variants, addonTemplates, photoAssets } = map([{ id: 7 }]);
		expect(products[0]).toMatchObject({
			id: 'prd_7',
			sku: 'SKU-7',
			slug: 'product-7',
			title: { en: 'product-7' },
			type: 'simple',
			status: 'live',
			categoryIds: [],
			tags: [],
			description: undefined,
			estimatedDeliveryText: null,
			addonTemplateCode: null,
			lifecycle: { liveAt: '2026-01-01T00:00:00.000Z' },
		});
		expect(variants[0]).toMatchObject({ id: 'var_7_base', stock: { quantity: 0 }, salePriceINR: null });
		expect(addonTemplates).toEqual([]);
		expect(photoAssets).toEqual([]);
	});

	it('reads prices, dates, delivery text and tags', () => {
		const { products, variants } = map([
			{
				id: 1,
				name: 'Silk',
				description: 'Soft',
				price: '1200.4',
				sale_price: -5,
				quantity: 2.6,
				created_at: '2026-02-02T00:00:00.000Z',
				estimated_delivery_text: ' Three weeks ',
				is_featured: 1,
				tags: [{ slug: 'silk' }, { name: 'Festive' }, {}],
			},
			{ id: 2, price: 'not a number' },
		]);
		expect(products[0]).toMatchObject({
			slug: 'silk',
			basePriceINR: 1200,
			description: { en: 'Soft' },
			featured: true,
			tags: ['silk', 'Festive'],
			estimatedDeliveryText: { en: 'Three weeks' },
			lifecycle: { liveAt: '2026-02-02T00:00:00.000Z' },
		});
		expect(variants[0]?.stock.quantity).toBe(3);
		expect(products[1]?.basePriceINR).toBe(0);
	});

	it('hides what is deleted or switched off, and treats true as live', () => {
		const { products, variants } = map([
			{ id: 1, deleted_at: '2026-01-01' },
			{ id: 2, status: 0 },
			{ id: 3, status: true },
			{ id: 4, status: 1 },
		]);
		expect(products.map((product) => product.status)).toEqual(['draft', 'draft', 'live', 'live']);
		expect(products[0]?.lifecycle.liveAt).toBeNull();
		expect(variants[0]?.status).toBe('draft');
	});

	it('copes with blank names, a symbols-only slug, and repeated SKUs', () => {
		const { products, variants } = map([
			{ id: 1, name: '   ', slug: '***', sku: 'SAME' },
			{ id: 2, sku: 'SAME' },
			{ id: 3, sku: 'SAME' },
			{ id: 4, sku: '   ' },
		]);
		expect(products[0]?.slug).toBe('item');
		expect(products[0]?.title.en).toBe('item');
		expect(products.map((product) => product.sku)).toEqual(['SAME', 'SAME-2', 'SAME-3', 'sku-4']);
		expect(new Set(variants.map((variant) => variant.sku)).size).toBe(variants.length);
	});

	it('resolves a second clash on the same owner', () => {
		const { products } = map([
			{ id: 2, sku: 'SAME-3' },
			{ id: 3, sku: 'SAME' },
			{ id: 4, sku: 'SAME' },
		]);
		expect(products.map((product) => product.sku)).toEqual(['SAME-3', 'SAME', 'SAME-4']);
		const repeated = map([
			{ id: 1, sku: 'X' },
			{ id: 2, sku: 'X-3' },
			{ id: 3, sku: 'X' },
			{ id: 4, sku: 'X-3' },
		]);
		expect(repeated.products[2]?.sku).toBe('X-3-2');
	});
});

describe('categories', () => {
	it('builds paths from a canonical path, a slug, or an id', () => {
		const { categories, placements } = map([
			{
				id: 1,
				categories: [
					{ id: 10, name: 'Sarees', slug: 'sarees', canonical_path: 'sarees' },
					{ id: 11, name: 'Silk', slug: 'silk', canonical_path: 'sarees/silk' },
					{ id: 12, slug: 'loose' },
					{ id: 13 },
					{ id: 14, canonical_path: 'orphans/kid', status: 0 },
					{ id: 15, canonical_path: 'end/' },
				],
			},
		]);
		expect(categories.find((row) => row.id === 'cat_11')).toMatchObject({
			parentId: 'cat_10',
			path: ['cat_10', 'cat_11'],
			depth: 1,
		});
		expect(categories.find((row) => row.id === 'cat_12')?.name.en).toBe('loose');
		expect(categories.find((row) => row.id === 'cat_13')).toMatchObject({
			slug: 'category-13',
			name: { en: 'Category 13' },
		});
		expect(categories.find((row) => row.id === 'cat_14')?.path).toEqual(['cat_14', 'cat_14']);
		expect(categories.find((row) => row.id === 'cat_15')?.slug).toBe('category-15');
		expect(placements.find((row) => row.categoryId === 'cat_11')).toMatchObject({
			pathLabel: 'Sarees / Silk',
			parentCategoryId: 'cat_10',
			status: 'live',
		});
		expect(placements.find((row) => row.categoryId === 'cat_14')?.status).toBe('draft');
		expect(placements.find((row) => row.categoryId === 'cat_13')?.parentCategoryId).toBeNull();
	});

	it('keeps one placement per path', () => {
		const { placements } = map([
			{
				id: 1,
				categories: [
					{ id: 10, slug: 'twin', canonical_path: 'twin' },
					{ id: 11, slug: 'twin', canonical_path: 'twin' },
				],
			},
		]);
		expect(placements).toHaveLength(1);
	});
});

describe('attributes', () => {
	const colour = {
		name: 'Colour',
		slug: 'colour',
		style: 'color',
		attribute_values: [{ value: 'Red', slug: 'red', hex_color: '#ff0000' }, { value: 'Odd', hex_color: 'red' }, {}],
	};

	it('reads the master list, and merges a product attribute into it', () => {
		const { attributeDefinitions, products } = map(
			[
				{
					id: 1,
					attributes: [{ ...colour, attribute_values: [{ value: 'Blue' }] }],
					variations: [{ id: 1, name: 'Blue' }],
				},
			],
			[colour, { name: 'Bare' }, {}],
		);
		const definition = attributeDefinitions.find((row) => row.code === 'colour');
		expect(definition).toMatchObject({ defaultRole: 'variation_axis', valueType: 'color' });
		expect(definition?.terms.map((term) => term.code)).toEqual(['red', 'odd', 'term-3', 'blue']);
		expect(definition?.terms[0]).toMatchObject({ hex: '#ff0000' });
		expect(definition?.terms[1]).not.toHaveProperty('hex');
		expect(attributeDefinitions.find((row) => row.code === 'bare')?.valueType).toBe('term');
		expect(attributeDefinitions.find((row) => row.code === 'item')?.label.en).toBe('item');
		expect(products[0]?.optionGroups[0]).toMatchObject({ semanticRole: 'variation_axis', requiredSelection: true });
	});

	it('leaves a role alone when a later product does not vary by it', () => {
		const { attributeDefinitions } = map([{ id: 1, attributes: [colour] }], [colour]);
		expect(attributeDefinitions.find((row) => row.code === 'colour')?.defaultRole).toBe('filter_only');
	});

	it('gives image swatches a photo, and unknown styles a rectangle', () => {
		const { products, attributeDefinitions } = map(
			[
				{
					id: 1,
					attributes: [
						{
							slug: 'design',
							style: 'image',
							attribute_values: [{ value: 'No Stitching' }, { slug: 'one' }],
						},
						{ name: 'Odd style', style: 'mystery', attribute_values: [{ value: 'A' }] },
						{ style: 'radio', attribute_values: [{ value: 'B' }] },
						{ name: 'Empty', attribute_values: [] },
						{ name: 'Missing' },
					],
				},
			],
			[{ name: 'Master image', style: 'image', attribute_values: [{ value: 'M' }] }],
		);
		const [design, odd, unnamed] = products[0]!.optionGroups;
		expect(design).toMatchObject({
			displayStyle: 'image_swatch',
			semanticRole: 'filter_only',
			label: { en: 'design' },
		});
		expect(design?.terms[0]).toMatchObject({ isBase: true, swatchAssetId: expect.any(String) });
		expect(design?.terms[1]?.code).toBe('one');
		expect(odd?.displayStyle).toBe('rectangle');
		expect(unnamed?.attributeCode).toBe('item');
		expect(products[0]?.attributes.map((row) => row.code)).toEqual(['design', 'odd-style', 'axis']);
		expect(products[0]?.attributes[0]?.terms[0]).toHaveProperty('swatch');
		expect(products[0]?.attributes[0]?.label.en).toBe('design');
		expect(products[0]?.attributes[2]?.label.en).toBe('Attribute');
		expect(attributeDefinitions.find((row) => row.code === 'master-image')?.terms[0]).toHaveProperty(
			'swatchAssetId',
		);
	});

	it('gives a term with a hex colour its hex on the product', () => {
		const { products } = map([{ id: 1, attributes: [colour] }]);
		expect(products[0]?.attributes[0]?.terms[0]).toMatchObject({ hex: '#ff0000' });
		expect(products[0]?.attributes[0]?.terms[2]?.label.en).toBe('Term 3');
		expect(products[0]?.optionGroups[0]?.terms[0]).toMatchObject({ hex: '#ff0000' });
		expect(products[0]?.optionGroups[0]?.terms[2]?.label.en).toBe('Term 3');
	});
});

describe('option groups', () => {
	it('builds add-ons and bundle options, and skips empty groups', () => {
		const { products } = map([
			{
				id: 1,
				addon_groups: [
					{
						code: 'Blouse',
						label: 'Blouse',
						required: true,
						style: 'image_tile',
						terms: [
							{ code: 'none', is_default: true },
							{ label: 'Stitched', price_delta: 500, requires_measurements: true },
							{},
						],
					},
					{
						label: 'From the label',
						style: 'radio',
						default_term_code: 'b',
						terms: [{ code: 'a' }, { code: 'b' }],
					},
					{ terms: [{ code: 'only' }] },
					{ code: 'first-label', terms: [{ label: 'Label only' }] },
					{ code: 'odd', style: 'mystery', terms: [{ code: 'x' }] },
					{ code: 'empty', terms: [] },
					{ code: 'no-terms' },
					{ code: 'Blouse', terms: [{ code: 'repeat' }] },
				],
				bundle: { option_groups: [{ code: 'size', terms: [{ code: 's' }] }] },
			},
		]);
		const groups = products[0]!.optionGroups;
		const blouse = groups.find((group) => group.attributeCode === 'blouse');
		expect(blouse).toMatchObject({
			displayStyle: 'image_tile',
			requiredSelection: true,
			defaultTermCode: 'none',
			semanticRole: 'named_add_on',
		});
		expect(blouse?.terms).toHaveLength(2);
		expect(blouse?.terms[0]).toMatchObject({ isBase: true, label: { en: 'none' } });
		expect(blouse?.terms[1]).toMatchObject({
			code: 'stitched',
			priceDeltaINR: 500,
			requiresMeasurements: true,
			addonTemplateIds: ['addon_blouse_measurements'],
		});
		expect(groups.find((group) => group.attributeCode === 'from-the-label')).toMatchObject({
			displayStyle: 'radio',
			defaultTermCode: 'b',
			requiredSelection: false,
		});
		expect(groups.find((group) => group.attributeCode === 'item')?.terms[0]?.code).toBe('only');
		expect(groups.find((group) => group.attributeCode === 'first-label')?.defaultTermCode).toBe('item');
		expect(groups.find((group) => group.attributeCode === 'odd')?.displayStyle).toBe('rectangle');
		expect(groups.find((group) => group.attributeCode === 'empty')).toBeUndefined();
		const size = groups.find((group) => group.attributeCode === 'size');
		expect(size).toMatchObject({ semanticRole: 'bundle_component_option', displayStyle: 'rectangle' });
		expect(size?.terms[0]?.isBase).toBe(false);
	});

	it('records filter facts and skips blank ones', () => {
		const { products } = map([
			{
				id: 1,
				semantic_attributes: [
					{ code: 'weave', label: 'weave', value: 'Banarasi' },
					{ label: 'Blank', value: '  ' },
					{ code: 'novalue' },
					{ value: 'No code' },
				],
				filter_attributes: { fabric: 'Silk' },
			},
		]);
		const groups = products[0]!.optionGroups;
		expect(groups.find((group) => group.attributeCode === 'weave')).toMatchObject({
			semanticRole: 'filter_only',
			label: { en: 'Weave' },
			terms: [{ code: 'banarasi' }],
		});
		expect(groups.find((group) => group.attributeCode === 'fabric')?.label.en).toBe('Fabric');
		expect(groups.find((group) => group.attributeCode === 'item')?.label.en).toBe('item');
		expect(groups.find((group) => group.attributeCode === 'blank')).toBeUndefined();
		expect(groups.find((group) => group.attributeCode === 'novalue')).toBeUndefined();
	});
});

describe('variations', () => {
	const size = {
		slug: 'size',
		name: 'Size',
		attribute_values: [{ value: 'Small', slug: 'small' }, { value: 'Large' }],
	};
	const fit = { name: 'Fit', attribute_values: [{ value: 'Loose', slug: 'loose' }] };

	it('matches a name across several axes', () => {
		const { variants } = map([
			{
				id: 1,
				attributes: [size, fit],
				variations: [
					{ id: 1, name: 'Small / Loose' },
					{ id: 2, name: 'large / unknown' },
					{ id: 3, name: 'small / loose' },
				],
			},
		]);
		expect(variants[0]?.optionSelections).toEqual([
			{ attributeCode: 'size', termCode: 'small' },
			{ attributeCode: 'fit', termCode: 'loose' },
		]);
		expect(variants[1]?.optionSelections).toEqual([
			{ attributeCode: 'size', termCode: 'large' },
			{ attributeCode: 'fit', termCode: 'unknown' },
		]);
	});

	it('names an unnamed axis, and an axis with no values', () => {
		const { variants } = map([
			{
				id: 1,
				attributes: [{ attribute_values: [{ value: 'A' }] }, {}],
				variations: [{ id: 1, name: 'A / B' }],
			},
		]);
		expect(variants[0]?.optionSelections).toEqual([
			{ attributeCode: 'axis-0', termCode: 'a' },
			{ attributeCode: 'axis-1', termCode: 'b' },
		]);
	});

	it('matches one axis by the whole name, and falls back', () => {
		const { variants } = map([
			{
				id: 1,
				attributes: [size],
				variations: [{ id: 1, name: 'Small' }, { id: 2, name: 'One / Two' }, { id: 3 }],
			},
		]);
		expect(variants.map((row) => row.optionSelections[0]?.termCode)).toEqual(['small', 'one-two', 'term']);
	});

	it('finds a term with no slug on a one-axis product', () => {
		const { variants } = map([
			{
				id: 1,
				attributes: [{ attribute_values: [{ value: 'Plain' }] }],
				variations: [
					{ id: 1, name: 'one / two' },
					{ id: 2, name: 'Plain' },
				],
			},
			{
				id: 2,
				attributes: [{ name: 'No values' }],
				variations: [
					{ id: 3, name: 'Solo' },
					{ id: 4, name: 'a / b' },
				],
			},
		]);
		expect(variants[0]?.optionSelections[0]?.attributeCode).toBe('axis');
		expect(variants[1]?.optionSelections[0]?.termCode).toBe('plain');
		expect(variants[2]?.optionSelections).toEqual([{ attributeCode: 'no-values', termCode: 'solo' }]);
	});

	it('uses a generic selection with no attributes', () => {
		const { variants } = map([{ id: 1, sku: 'S', price: 100, variations: [{ name: 'Only' }, {}, { id: 9 }] }]);
		expect(variants.map((row) => row.optionSelections[0]?.termCode)).toEqual(['only', 'var-base', 'var-9']);
		expect(variants[0]).toMatchObject({ id: 'var_1_0', sku: 'S-1', priceINR: 100, isBaseVariant: true });
		expect(variants[2]).toMatchObject({ id: 'var_1_9', isBaseVariant: false });
	});

	it('keeps two rows with the same selection apart', () => {
		const { variants } = map([
			{
				id: 1,
				variations: [
					{ id: 1, name: 'Same' },
					{ id: 2, name: 'Same' },
				],
			},
		]);
		expect(variants[1]?.optionSelections.at(-1)).toEqual({ attributeCode: 'row', termCode: '2' });
		expect(variants[0]?.optionSelectionHash).not.toBe(variants[1]?.optionSelectionHash);
	});

	it('puts a product on sale when one variant is, and keeps its own price', () => {
		const { products, variants } = map([
			{
				id: 1,
				price: 1000,
				variations: [
					{ id: 1, name: 'A', price: 900, sale_price: 800, sku: 'A', quantity: 2 },
					{ id: 2, name: 'B', sale_price: 2000 },
				],
			},
		]);
		expect(products[0]).toMatchObject({ onSale: true, basePriceINR: 1000 });
		expect(variants[0]).toMatchObject({ priceINR: 900, salePriceINR: 800, compareAtPriceINR: 900, sku: 'A' });
		expect(variants[0]?.stock.quantity).toBe(2);
		expect(variants[1]).toMatchObject({ priceINR: 1000, salePriceINR: null, compareAtPriceINR: null });
	});

	it('keeps the sale price when the product itself is on sale', () => {
		const { products } = map([
			{ id: 1, price: 1000, sale_price: 800, variations: [{ id: 1, name: 'A', sale_price: 500 }] },
		]);
		expect(products[0]).toMatchObject({ onSale: true, basePriceINR: 800 });
	});
});

describe('measurements and bundles', () => {
	it('builds the template from the first measured product', () => {
		const { addonTemplates, products } = map([
			{
				id: 1,
				measurement_fields: [
					{ code: 'chest', label: 'Chest', unit: 'cm', min: 10, max: 20 },
					{ label: 'Waist' },
					{ code: 'hip' },
					{},
				],
			},
			{ id: 2, bundle: { measurement_fields: [{ code: 'later' }] } },
		]);
		expect(addonTemplates[0]?.fields).toEqual([
			expect.objectContaining({
				code: 'chest',
				unit: 'cm',
				validation: expect.objectContaining({ min: 10, max: 20 }),
			}),
			expect.objectContaining({
				code: 'waist',
				unit: 'in',
				validation: expect.objectContaining({ min: 4, max: 60 }),
			}),
			expect.objectContaining({ code: 'hip', label: { en: 'hip' } }),
			expect.objectContaining({ code: 'measure', label: { en: 'Measurement' } }),
		]);
		expect(products[0]?.addons.map((addon) => addon.code)).toEqual(['chest', 'waist', 'hip', 'measure']);
		expect(products[0]?.addons[0]?.unit).toBe('cm');
		expect(products[0]?.addons[3]?.label.en).toBe('Measurement');
		expect(products[1]?.addonTemplateCode).toBe('blouse-measurements');
	});

	it('leaves out a bundle that has no components to offer', () => {
		expect(map([{ id: 1, type: 'bundle' }]).bundles).toEqual([]);
	});

	it('builds a bundle from the other products', () => {
		const { bundles } = map([{ id: 1, type: 'bundle', price: 500 }, { id: 2 }]);
		expect(bundles[0]).toMatchObject({ productId: 'prd_1', fixedPriceINR: 500 });
		expect(bundles[0]?.groups[0]?.components).toHaveLength(1);
	});
});

describe('photo assets', () => {
	const image = (assetId: unknown, roles: unknown) => ({ image: { assetId, roles } });
	const url = 'https://cdn.test/media/a/card.webp';

	it('collects derivatives from nested images and skips what it cannot use', () => {
		const [first, second] = CATALOG_PHOTO_ASSET_IDS;
		const { photoAssets } = map([
			{
				id: 1,
				nested: [
					image(first, {
						card: [
							{ url, width: 400, height: 533 },
							{ url, width: 400, height: 533 },
							{ url, width: 800, height: 'tall' },
							{ url: 5, width: 100 },
							{ url: 'https://other.test/a.webp', width: 100 },
							{ url, width: 0 },
							{ url, width: 'wide' },
						],
						empty: null,
					}),
					image(second, {}),
					image(7, { card: [] }),
					image('other', undefined),
					{ image: 'just text' },
					null,
				],
			},
		]);
		expect(photoAssets).toHaveLength(1);
		expect(photoAssets[0]).toMatchObject({ width: 800, height: 1067, slug: 'local-catalog-photo-1' });
		expect(photoAssets[0]?.derivatives.map((row) => row.width)).toEqual([400, 800]);
	});
});
