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
	shortDescription: 'Short',
	metaTitle: 'Meta title',
	metaDescription: 'Meta text',
	price: { kind: 'single', sellingINR: 2000, mrpINR: 2400, percentOff: 16 },
	badges: { primary: 'sale', secondary: null },
	madeToOrder: false,
	estimatedDeliveryText: null,
	sareeLengthM: null,
	blousePieceM: null,
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
			galleryIndexes: [],
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
			galleryIndexes: [],
		},
	],
	measurements: {
		templateCode: 'blouse-measurements',
		priceINR: 0,
		fields: [{ code: 'chest', label: 'Chest', unit: 'in', min: 24, max: 50, step: 0.5 }],
		sizeGuide: [],
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

	it('keeps the four looks from the renders and each value’s second line and colour', () => {
		const looks = pageToProduct({
			...page,
			optionGroups: [
				{
					...page.optionGroups[0]!,
					displayStyle: 'size_v2',
					terms: [term('s', 'S'), term('m', 'M', { subLabel: 'Medium' })],
				},
				{
					...page.optionGroups[1]!,
					displayStyle: 'colour_chip',
					terms: [
						term('no-design', 'None', { isBase: true, hex: '#ffffff', subLabel: null }),
						term('red', 'Red', { hex: '#aa0000', subLabel: 'Deep red' }),
					],
				},
			],
		});
		expect(looks.attributes[0]?.style).toBe('size_v2');
		expect(looks.attributes[0]?.attribute_values.map((value) => value.sub_label)).toEqual([undefined, 'Medium']);
		expect(looks.addon_groups?.[0]?.style).toBe('colour_chip');
		expect(looks.addon_groups?.[0]?.terms.map((value) => [value.hex, value.sub_label])).toEqual([
			['#ffffff', undefined],
			['#aa0000', 'Deep red'],
		]);
		for (const style of ['picture_row', 'picture_chip']) {
			const read = pageToProduct({ ...page, optionGroups: [{ ...page.optionGroups[1]!, displayStyle: style }] });
			expect(read.addon_groups?.[0]?.style).toBe(style);
		}
	});

	it('gives each set item its photo and page, and keeps the levels', () => {
		const card = { roles: { card: [{ url: 'piece-400.webp', width: 400 }] } };
		const piece = (key: string, image: unknown) => ({
			key,
			productId: key,
			slug: key,
			title: key,
			sku: key,
			image,
			mrpINR: null,
			sellingINR: 5000,
			saleINR: null,
			priceInSetINR: 5000,
			todayINR: 5000,
			quantity: 1,
			soldBy: 'piece',
			inStock: true,
			available: 2,
			variantId: null,
			variantLabel: null,
			variants: [],
			freeWith: null,
		});
		const set = pageToProduct({
			...page,
			bundle: {
				heading: 'choose',
				priceINR: 7300,
				separatelyINR: 10000,
				saveINR: 2700,
				fromPrice: true,
				lowINR: 7300,
				highINR: 7300,
				levels: [
					{
						code: 'saree',
						label: 'Saree',
						take: 1,
						choice: true,
						priceMode: 'difference',
						items: [piece('peacock', card), piece('arni', null)],
					},
				],
				extras: [],
				pricing: {
					base: { kind: 'pieces' },
					inputs: [],
					methodRules: [],
					methodCombine: 'all',
					params: {},
					rules: [],
					combine: 'all',
					capAtSeparately: false,
					roundTo: 'one',
					eventSale: [],
				},
				stock: { setsPossible: 2, state: 'in_stock', soldOutPieces: [], soldOutChoices: [] },
				buyable: true,
				saleWindow: null,
			},
		} as never);
		expect(set.bundle?.levels[0]?.items.map((row) => [row.image, row.slug])).toEqual([
			['piece-400.webp', 'peacock'],
			[undefined, 'arni'],
		]);
		expect(set.bundle?.levels.map((level) => [level.code, level.take, level.choice])).toEqual([['saree', 1, true]]);
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

describe('pageToProduct link preview', () => {
	const photo = (roles: Record<string, string>) => ({
		assetId: 'med_1',
		width: 1200,
		height: 1600,
		alt: 'Saree',
		dominantColor: null,
		thumbHash: null,
		roles: Object.fromEntries(
			Object.entries(roles).map(([role, url]) => [
				role,
				[{ url, width: 1200, height: 630, format: 'image/jpeg' }],
			]),
		),
	});

	it('uses the 1200×630 link-preview card once the main-photo sizes exist', () => {
		const product = pageToProduct({
			...page,
			gallery: [photo({ gallery: 'g.webp' })],
			shareImageUrl: 'share.jpg',
			shareImageSize: { width: 1200, height: 630, type: 'image/jpeg' },
		} as ApiProductPage);
		expect(product.product_meta_image?.original_url).toBe('share.jpg');
		expect(product.product_meta_image).toMatchObject({
			mime_type: 'image/jpeg',
			pixels: { width: 1200, height: 630 },
		});
		expect(product.product_thumbnail?.original_url).toBe('g.webp');
	});

	it('falls back to the first gallery photo before they are made', () => {
		const product = pageToProduct({ ...page, gallery: [photo({ gallery: 'g.webp' })] } as ApiProductPage);
		expect(product.product_meta_image?.original_url).toBe('g.webp');
	});
});
