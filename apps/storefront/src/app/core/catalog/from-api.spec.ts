import { describe, expect, it } from 'vitest';

import { ApiProductPage, pageToProduct } from './from-api';

const term = (
	code: string,
	label: string,
	extra: Partial<ApiProductPage['optionGroups'][number]['terms'][number]> = {},
) => ({
	code,
	label,
	isBase: false,
	hex: null,
	image: null,
	priceDeltaINR: null,
	requiresMeasurements: false,
	...extra,
});

const page: ApiProductPage = {
	id: 'prd_931',
	slug: 'kurti-palazzo-set',
	path: '/product/kurti-palazzo-set',
	title: 'Kurti Palazzo Set',
	description: '',
	price: { kind: 'single', sellingINR: 2000, mrpINR: 2400, percentOff: 16 },
	badges: { primary: 'sale', secondary: null },
	madeToOrder: false,
	estimatedDeliveryText: null,
	selected: { sku: 'KPS-2', sellingINR: 2000, mrpINR: 2400, quantity: 4, buyable: true },
	unknownVariant: false,
	gallery: [],
	optionGroups: [
		{
			code: 'size',
			label: 'Size',
			role: 'variation_axis',
			displayStyle: 'circle',
			required: true,
			defaultTermCode: null,
			terms: [term('s', 'S'), term('m', 'M')],
		},
		{
			code: 'blouse-design',
			label: 'Blouse Designs',
			role: 'named_add_on',
			displayStyle: 'image_tile',
			required: true,
			defaultTermCode: 'no-design',
			terms: [
				term('no-design', 'No Design', { isBase: true, priceDeltaINR: 0 }),
				term('design-1', 'Design 1', { priceDeltaINR: 750, requiresMeasurements: true }),
			],
		},
		{
			code: 'fabric',
			label: 'Fabric',
			role: 'filter_only',
			displayStyle: 'rectangle',
			required: false,
			defaultTermCode: null,
			terms: [term('cotton', 'Cotton')],
		},
	],
	variants: [
		{
			id: 'var_1',
			sku: 'KPS-1',
			selections: { size: 's' },
			sellingINR: 2400,
			mrpINR: null,
			quantity: 3,
			buyable: true,
			galleryIndex: null,
		},
		{
			id: 'var_2',
			sku: 'KPS-2',
			selections: { size: 'm' },
			sellingINR: 2000,
			mrpINR: 2400,
			quantity: 4,
			buyable: true,
			galleryIndex: null,
		},
	],
	measurements: {
		templateCode: 'blouse-measurements',
		priceINR: 0,
		fields: [{ code: 'chest', label: 'Chest', unit: 'in', min: 24, max: 50, step: 0.5 }],
	},
	bundle: null,
	breadcrumb: [],
};

describe('pageToProduct', () => {
	const product = pageToProduct(page);

	it('turns each variation axis into a picker the configurator can select from', () => {
		expect(product.attributes.map((attribute) => [attribute.slug, attribute.style])).toEqual([['size', 'circle']]);
		const [small, medium] = product.attributes[0]!.attribute_values;
		expect(
			product.variations.map((row) => [row.id, row.sku, row.attribute_values.map((value) => value.id)]),
		).toEqual([
			['var_1', 'KPS-1', [small!.id]],
			['var_2', 'KPS-2', [medium!.id]],
		]);
		expect(product.variations[1]).toMatchObject({ price: 2400, sale_price: 2000, discount: 16 });
	});

	it('opens on the SKU the server selected and keeps the real string id', () => {
		expect(product.id).toBe('prd_931');
		expect(product.sku).toBe('KPS-2');
		expect(product.quantity).toBe(4);
	});

	it('carries add-ons, their measurements, and filter facts', () => {
		expect(product.addon_groups?.[0]).toMatchObject({ code: 'blouse-design', default_term_code: 'no-design' });
		expect(product.addon_groups?.[0]?.terms[1]).toMatchObject({
			code: 'design-1',
			price_delta: 750,
			requires_measurements: true,
		});
		expect(product.measurement_fields).toEqual([
			{ code: 'chest', label: 'Chest', unit: 'in', step: 0.5, min: 24, max: 50 },
		]);
		expect(product.semantic_attributes).toEqual([
			{ code: 'fabric', label: 'Fabric', value: 'Cotton', icon: expect.any(String) },
		]);
	});
});
