import { describe, expect, it } from 'vitest';

import {
	type ApiCard,
	type ApiPlacement,
	type ApiProductPage,
	cardBadges,
	cardToProduct,
	galleryAttachment,
	pageToProduct,
	placementToCatalog,
} from './from-api';

type ApiImage = NonNullable<ApiCard['image']>;

const source = (width: number, url = `https://cdn.test/${width}.webp`) => ({
	url,
	width,
	height: width,
	format: 'image/webp',
});
const image = (roles: Record<string, ReturnType<typeof source>[]>): ApiImage =>
	({ assetId: 'm1', width: 300, height: 400, alt: 'Photo', roles }) as ApiImage;

const card = (overrides: Partial<ApiCard> = {}): ApiCard => ({
	id: 'p1',
	slug: 'red',
	title: 'Red',
	path: '/product/red',
	price: { kind: 'single', sellingINR: 900, mrpINR: 1000, percentOff: 10 },
	badges: [],
	sku: 'SKU',
	image: null,
	inStock: true,
	madeToOrder: false,
	...overrides,
});

const page = (overrides: Partial<ApiProductPage> = {}): ApiProductPage => ({
	id: 'p1',
	slug: 'red',
	path: '/product/red',
	title: 'Red',
	description: '',
	shortDescription: 'Short',
	metaTitle: 'Meta title',
	metaDescription: 'Meta text',
	price: { kind: 'single', sellingINR: 900, mrpINR: null, percentOff: null },
	badges: { primary: null, secondary: null },
	madeToOrder: false,
	estimatedDeliveryText: null,
	sareeLengthM: null,
	blousePieceM: null,
	selected: null,
	unknownVariant: false,
	gallery: [],
	optionGroups: [],
	variants: [],
	measurements: null,
	bundle: null,
	breadcrumb: [],
	...overrides,
});

const group = (overrides: Record<string, unknown> = {}) =>
	({
		code: 'size',
		label: 'Size',
		role: 'variation_axis',
		displayStyle: 'circle',
		required: true,
		defaultTermCode: null,
		terms: [
			{
				code: 's',
				label: 'S',
				isBase: false,
				hex: null,
				image: null,
				priceDeltaINR: null,
				requiresMeasurements: false,
			},
		],
		...overrides,
	}) as ApiProductPage['optionGroups'][number];

const variant = (overrides: Record<string, unknown> = {}) =>
	({
		id: 'v1',
		sku: 'V1',
		selections: { size: 's' },
		sellingINR: 900,
		mrpINR: null,
		quantity: 1,
		buyable: true,
		galleryIndex: null,
		galleryIndexes: [],
		...overrides,
	}) as ApiProductPage['variants'][number];

describe('cardBadges', () => {
	it('splits promotions from stock facts', () => {
		expect(cardBadges(['sale', 'low_stock'])).toEqual({ primary: 'sale', secondary: 'low_stock' });
		expect(cardBadges(['back_in_stock'])).toEqual({ primary: null, secondary: 'back_in_stock' });
		expect(cardBadges([])).toEqual({ primary: null, secondary: null });
	});
});

describe('cardToProduct', () => {
	it('reads a single price, with or without an MRP', () => {
		expect(cardToProduct(card())).toMatchObject({ price: 1000, sale_price: 900, variations: [] });
		expect(
			cardToProduct(card({ price: { kind: 'single', sellingINR: 900, mrpINR: null, percentOff: null } })).price,
		).toBe(900);
	});

	it('shows a range as two variations', () => {
		const product = cardToProduct(card({ price: { kind: 'range', minINR: 100, maxINR: 300 } }));
		expect(product).toMatchObject({ price: 300, sale_price: 100 });
		expect(product.variations?.map((row) => row.sku)).toEqual(['min', 'max']);
	});

	it('marks sale, featured and stock', () => {
		expect(cardToProduct(card({ badges: ['sale'] }))).toMatchObject({ is_sale_enable: 1, is_featured: 0 });
		expect(cardToProduct(card({ badges: ['featured'] }))).toMatchObject({ is_sale_enable: 0, is_featured: 1 });
		expect(cardToProduct(card({ inStock: false, sku: null }))).toMatchObject({
			quantity: 0,
			stock_status: 'out_of_stock',
			sku: '',
		});
	});

	it('picks a card photo of at least 400 wide, then the first, then none', () => {
		const url = (roles: Record<string, ReturnType<typeof source>[]>) =>
			(
				cardToProduct(card({ image: image(roles) })).product_thumbnail as unknown as
					{ original_url: string } | undefined
			)?.original_url;
		expect(url({ card: [source(200), source(400)] })).toBe('https://cdn.test/400.webp');
		expect(url({ card: [source(200)] })).toBe('https://cdn.test/200.webp');
		expect(url({ card: [] })).toBeUndefined();
		expect(url({})).toBeUndefined();
	});
});

describe('galleryAttachment', () => {
	it('prefers a wide frame, then the first, then nothing', () => {
		const url = (roles: Record<string, ReturnType<typeof source>[]>) =>
			(galleryAttachment(image(roles), 0) as unknown as { original_url: string; id: number }).original_url;
		expect(url({ gallery: [source(600), source(900)] })).toBe('https://cdn.test/900.webp');
		expect(url({ gallery: [source(600)] })).toBe('https://cdn.test/600.webp');
		expect(url({ gallery: [] })).toBe('');
		expect(url({})).toBe('');
	});
});

describe('placementToCatalog', () => {
	const placement = (overrides: Partial<ApiPlacement> = {}): ApiPlacement => ({
		path: 'sarees',
		title: 'Sarees',
		breadcrumb: [{ name: 'Sarees', path: '/collections/sarees' }],
		products: [],
		total: 0,
		page: 1,
		pageSize: 24,
		facets: [{ code: 'fabric', label: 'Fabric', terms: [{ code: 'silk', label: 'Silk', count: 2 }] }],
		indexable: true,
		...overrides,
	});

	it('reads an empty listing', () => {
		expect(placementToCatalog(placement())).toMatchObject({
			last_page: 1,
			category: { name: 'Sarees', canonical_path: 'sarees' },
			breadcrumb: [{ name: 'Sarees', path: 'sarees' }],
			facets: { fabric: [{ value: 'silk', label: 'Silk', count: 2 }] },
			price_range: { min: 0, max: 0 },
		});
	});

	it('spans single and range prices, and shows no category for the all-products page', () => {
		const result = placementToCatalog(
			placement({
				path: '',
				total: 30,
				products: [card(), card({ price: { kind: 'range', minINR: 100, maxINR: 2000 } })],
			}),
		);
		expect(result).toMatchObject({ category: null, last_page: 2, price_range: { min: 100, max: 2000 } });
	});
});

describe('pageToProduct prices', () => {
	it('uses the selected SKU first', () => {
		const selected = { sku: 'V1', sellingINR: 700, mrpINR: 800, quantity: 1, buyable: true };
		expect(pageToProduct(page({ selected }))).toMatchObject({
			price: 800,
			sale_price: 700,
			sku: 'V1',
			quantity: 1,
		});
		expect(pageToProduct(page({ selected: { ...selected, mrpINR: null } })).price).toBe(700);
	});

	it('falls back to the page price', () => {
		expect(pageToProduct(page())).toMatchObject({
			price: 900,
			sale_price: 900,
			sku: '',
			quantity: 0,
			stock_status: 'in_stock',
		});
		expect(
			pageToProduct(page({ price: { kind: 'single', sellingINR: 900, mrpINR: 1000, percentOff: 10 } })).price,
		).toBe(1000);
		expect(pageToProduct(page({ price: { kind: 'range', minINR: 100, maxINR: 300 } }))).toMatchObject({
			price: 300,
			sale_price: 100,
		});
	});

	it('reads the featured badge', () => {
		expect(pageToProduct(page({ badges: { primary: 'featured', secondary: null } })).is_featured).toBe(1);
	});

	it('marks a selected SKU that cannot be bought', () => {
		const selected = { sku: 'V1', sellingINR: 700, mrpINR: null, quantity: 0, buyable: false };
		expect(pageToProduct(page({ selected })).stock_status).toBe('out_of_stock');
	});

	it('takes the SKU from the first variation when none is selected', () => {
		expect(pageToProduct(page({ optionGroups: [group()], variants: [variant()] })).sku).toBe('V1');
	});
});

describe('pageToProduct gallery', () => {
	const frames = [
		image({ gallery: [source(900, 'a')] }),
		image({ gallery: [source(900, 'b')] }),
		image({ gallery: [source(900, 'c')] }),
	];
	const urls = (product: ReturnType<typeof pageToProduct>) =>
		(product.product_galleries as unknown as Array<{ original_url: string }>).map((row) => row.original_url);

	it('puts the selected photo first', () => {
		const selected = { sku: 'V1', sellingINR: 1, mrpINR: null, quantity: 1, buyable: true };
		expect(
			urls(
				pageToProduct(
					page({
						gallery: frames,
						selected,
						optionGroups: [group()],
						variants: [variant({ galleryIndex: 1 })],
					}),
				),
			),
		).toEqual(['b', 'c', 'a']);
	});

	it('keeps the order for the first photo, or no photo at all', () => {
		const selected = { sku: 'V1', sellingINR: 1, mrpINR: null, quantity: 1, buyable: true };
		expect(
			urls(
				pageToProduct(
					page({
						gallery: frames,
						selected,
						optionGroups: [group()],
						variants: [variant({ galleryIndex: 0 })],
					}),
				),
			),
		).toEqual(['a', 'b', 'c']);
		expect(
			urls(pageToProduct(page({ gallery: frames, selected, optionGroups: [group()], variants: [variant()] }))),
		).toEqual(['a', 'b', 'c']);
	});
});

describe('pageToProduct options', () => {
	it('gives a variant its own photos', () => {
		const photo = (name: string) => image({ gallery: [source(900, name)] });
		const product = pageToProduct(
			page({
				gallery: [photo('a'), photo('b')],
				optionGroups: [group()],
				variants: [variant({ galleryIndexes: [1] })],
			}),
		);
		expect(product.variations?.[0]?.variation_galleries?.map((frame) => frame.original_url)).toEqual(['b']);
	});

	it('builds attributes, styles and hex colours', () => {
		const swatch = image({ swatch_image: [source(80), source(160, 'big')] });
		const product = pageToProduct(
			page({
				optionGroups: [
					group({
						displayStyle: 'color_swatch',
						terms: [
							{
								code: 's',
								label: 'S',
								isBase: false,
								hex: '#ff0000',
								image: swatch,
								priceDeltaINR: null,
								requiresMeasurements: false,
							},
						],
					}),
					group({ code: 'odd', displayStyle: 'mystery' }),
				],
			}),
		);
		expect(product.type).toBe('classified');
		expect(product.attributes?.[0]).toMatchObject({ style: 'color' });
		expect(product.attributes?.[0]?.attribute_values[0]).toMatchObject({ hex_color: '#ff0000' });
		expect(
			(product.attributes?.[0]?.attribute_values[0]?.variation_image as unknown as { original_url: string })
				.original_url,
		).toBe('big');
		expect(product.attributes?.[1]?.style).toBe('rectangle');
	});

	it('maps variants, with a discount only below the MRP', () => {
		const frames = [image({ gallery: [source(900, 'a')] })];
		const product = pageToProduct(
			page({
				gallery: frames,
				optionGroups: [group()],
				variants: [
					variant({ mrpINR: 1000, sellingINR: 900, galleryIndex: 0 }),
					variant({
						id: 'v2',
						sku: 'V2',
						mrpINR: 900,
						sellingINR: 900,
						buyable: false,
						selections: { size: 'gone' },
					}),
				],
			}),
		);
		expect(product.variations?.[0]).toMatchObject({ price: 1000, discount: 10, name: 'S', variation_image_id: 1 });
		expect(product.variations?.[1]).toMatchObject({
			discount: 0,
			stock_status: 'out_of_stock',
			name: '',
			variation_image_id: undefined,
		});
	});

	it('builds add-ons with defaults and deltas', () => {
		const product = pageToProduct(
			page({
				optionGroups: [
					group({
						code: 'blouse',
						role: 'named_add_on',
						displayStyle: 'unknown',
						terms: [
							{
								code: 'none',
								label: 'None',
								isBase: true,
								hex: null,
								image: null,
								priceDeltaINR: null,
								requiresMeasurements: false,
							},
							{
								code: 'one',
								label: 'One',
								isBase: false,
								hex: null,
								image: null,
								priceDeltaINR: 500,
								requiresMeasurements: true,
							},
						],
					}),
					group({ code: 'with-default', role: 'named_add_on', displayStyle: 'radio', defaultTermCode: 's' }),
				],
			}),
		);
		expect(product.addon_groups?.[0]).toMatchObject({ style: 'image_tile', default_term_code: undefined });
		expect(product.addon_groups?.[0]?.terms.map((term) => term.price_delta)).toEqual([0, 500]);
		expect(product.addon_groups?.[1]).toMatchObject({ style: 'radio', default_term_code: 's' });
		expect(product.addon_groups?.[1]?.terms[0]?.is_default).toBe(true);
	});

	it('lists facts with their icons', () => {
		const product = pageToProduct(page({ optionGroups: [group({ code: 'fabric', role: 'filter_only' })] }));
		expect(product.semantic_attributes?.[0]).toMatchObject({ code: 'fabric', value: 'S', icon: 'ri-shirt-line' });
		expect(pageToProduct(page()).semantic_attributes).toBeUndefined();
	});
});

describe('pageToProduct measurements and bundles', () => {
	const fields = [
		{ code: 'chest', label: 'Chest', unit: 'in' as const, min: 1, max: 2, step: 0.5 },
		{ code: 'hip', label: 'Hip', unit: 'cm' as const, min: null, max: null, step: null },
	];
	const measurements = { templateCode: 't', priceINR: 100, fields, sizeGuide: [] };
	const bundle = (overrides: Record<string, unknown> = {}) =>
		({
			bundleType: 'fixed_kit',
			pricePolicy: 'sum_components',
			priceINR: 500,
			groups: [
				{
					code: 'set',
					label: 'Set',
					minSelections: 1,
					maxSelections: 1,
					components: [
						{
							productId: 'a',
							slug: 'a',
							title: 'A',
							sku: 'A',
							sellingINR: 100,
							quantity: 1,
							required: true,
							inStock: true,
						},
						{
							productId: 'b',
							slug: 'b',
							title: 'B',
							sku: 'B',
							sellingINR: 200,
							quantity: 2,
							required: false,
							inStock: false,
						},
					],
				},
			],
			...overrides,
		}) as ApiProductPage['bundle'];

	it('keeps only the limits a field has', () => {
		const product = pageToProduct(page({ measurements }));
		expect(product.measurement_fields).toEqual([
			{ code: 'chest', label: 'Chest', unit: 'in', step: 0.5, min: 1, max: 2 },
			{ code: 'hip', label: 'Hip', unit: 'cm' },
		]);
		expect(
			pageToProduct(page({ measurements: { ...measurements, fields: [] } })).measurement_fields,
		).toBeUndefined();
	});

	it('carries the size guide only when the template has one', () => {
		expect(pageToProduct(page({ measurements })).size_guide).toBeUndefined();
		const rows = [{ size: 'M', values: { chest: 36 } }];
		const guide = pageToProduct(page({ measurements: { ...measurements, sizeGuide: rows } })).size_guide;
		expect(guide?.rows).toEqual(rows);
		expect(guide?.fields[0]).toEqual({ code: 'chest', label: 'Chest', unit: 'in' });
	});

	it('carries the saree length and blouse piece', () => {
		const product = pageToProduct(page({ sareeLengthM: 5.5, blousePieceM: 0.8 }));
		expect([product.saree_length_m, product.blouse_piece_m]).toEqual([5.5, 0.8]);
	});

	it('moves measurements onto a bundle', () => {
		const product = pageToProduct(page({ measurements, bundle: bundle() }));
		expect(product.measurement_fields).toBeUndefined();
		expect(product.bundle?.measurement_fields).toHaveLength(2);
	});

	it('maps a bundle, with fallbacks for unknown kinds', () => {
		const selected = { sku: 'SET', sellingINR: 1, mrpINR: null, quantity: 1, buyable: true };
		const product = pageToProduct(
			page({
				selected,
				bundle: bundle({ bundleType: 'other', pricePolicy: 'other' }),
				optionGroups: [
					group({ code: 'pick', role: 'bundle_component_option', displayStyle: 'unknown' }),
					group({
						code: 'pick2',
						role: 'bundle_component_option',
						displayStyle: 'radio',
						defaultTermCode: 's',
					}),
				],
			}),
		);
		expect(product.bundle).toMatchObject({
			sku: 'SET',
			bundle_type: 'fixed-kit',
			price_policy: 'fixed-bundle-price',
			bundle_price: 500,
		});
		expect(product.bundle?.components.map((row) => row.stock_status)).toEqual(['in_stock', 'out_of_stock']);
		expect(product.bundle?.option_groups?.[0]).toMatchObject({ style: 'rectangle', default_term_code: undefined });
		expect(product.bundle?.option_groups?.[1]).toMatchObject({ style: 'radio', default_term_code: 's' });
		expect(product.bundle).not.toHaveProperty('measurement_fields');
	});

	it('names a bundle by its slug with no selection, and maps known kinds', () => {
		const product = pageToProduct(
			page({ bundle: bundle({ bundleType: 'optional_addons', pricePolicy: 'discounted_components' }) }),
		);
		expect(product.bundle).toMatchObject({
			sku: 'red',
			bundle_type: 'optional-addons',
			price_policy: 'discounted-components',
		});
	});
});
