import { describe, expect, it } from 'vitest';

import { freeWithFromApi, pageToProduct, smallCardUrl, type ApiCard, type ApiProductPage } from './from-api';

type ApiImage = NonNullable<ApiCard['image']>;

const source = (width: number, url = `https://cdn.test/${width}.webp`) => ({
	url,
	width,
	height: width,
	format: 'image/webp',
});
const image = (roles: Record<string, ReturnType<typeof source>[]>): ApiImage =>
	({ assetId: 'm1', width: 300, height: 400, alt: 'Photo', roles }) as ApiImage;

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

const freeItem = (over: Record<string, unknown> = {}) => ({
	productId: 'pc',
	title: 'Petticoat',
	image: null,
	mrpINR: 450,
	sellingINR: 450,
	quantity: 1,
	inStock: true,
	variantId: null,
	variantLabel: null,
	variants: [],
	...over,
});
const freeRule = (items: unknown[]) =>
	({
		take: 'all',
		count: null,
		from: null,
		required: true,
		given: true,
		min: 1,
		max: 1,
		noneOrExactly: false,
		items,
	}) as never;

describe('smallCardUrl', () => {
	it('takes the narrowest card picture, whatever the order', () => {
		expect(smallCardUrl(image({ card: [source(700), source(200), source(400)] }))).toBe(
			'https://cdn.test/200.webp',
		);
		expect(smallCardUrl(image({}))).toBeNull();
		expect(smallCardUrl(null)).toBeNull();
	});
});

describe('free items from the API', () => {
	it('carries each item’s card picture and sizes, and leaves out a picture without a card file', () => {
		const rule = freeWithFromApi(
			freeRule([
				freeItem({
					image: image({ card: [source(400)] }),
					variants: [{ id: 'm', label: 'M', inStock: false }],
				}),
				freeItem({ productId: 'bag', image: image({}) }),
			]),
		);
		expect(rule?.items[0]).toMatchObject({
			image: 'https://cdn.test/400.webp',
			variants: [{ id: 'm', label: 'M', in_stock: false }],
		});
		expect(rule?.items[1]?.image).toBeUndefined();
		expect(rule?.items[1]).toHaveProperty('image');
	});
});

describe('pageToProduct: share pictures, fabric and set pictures', () => {
	it('states the share picture’s size when the API sends it, and nothing about it otherwise', () => {
		const sized = pageToProduct(
			page({
				shareImageUrl: 'https://cdn.test/share.jpg',
				shareImageSize: { width: 1200, height: 630, type: 'image/jpeg' },
			} as never),
		);
		expect(sized.product_meta_image).toMatchObject({
			mime_type: 'image/jpeg',
			pixels: { width: 1200, height: 630 },
		});
		const plain = pageToProduct(page({ shareImageUrl: 'https://cdn.test/share.jpg' } as never));
		expect(plain.product_meta_image).toMatchObject({ mime_type: '', pixels: undefined });
	});

	it('adds the tall share card when the pipeline has made one', () => {
		const product = pageToProduct(page({ shareStoryUrl: 'https://cdn.test/tall.jpg' } as never));
		expect(product.share_story_image).toMatchObject({
			original_url: 'https://cdn.test/tall.jpg',
			mime_type: 'image/jpeg',
		});
	});

	it('keeps a metre product’s rule, or none when the API sent none, and names its measurements', () => {
		const rule = { shortestCutTenths: 10, stepTenths: 5, quickLengths: [], widthInches: 44 };
		expect(pageToProduct(page({ soldBy: 'metre', metre: rule } as never)).metre_rule).toEqual(rule);
		expect(pageToProduct(page({ soldBy: 'metre' } as never)).metre_rule).toBeNull();
		const measurements = {
			templateCode: 't',
			priceINR: 100,
			fields: [],
			sizeGuide: [],
			title: 'Blouse measurements',
		};
		expect(pageToProduct(page({ measurements } as never)).measurement_title).toBe('Blouse measurements');
	});
});

describe('set pieces from the API', () => {
	const item = (key: string, selling: number, over: Record<string, unknown> = {}) => ({
		key,
		productId: key,
		slug: key,
		title: key.toUpperCase(),
		sku: key.toUpperCase(),
		image: null,
		mrpINR: null,
		sellingINR: selling,
		saleINR: null,
		priceInSetINR: selling,
		todayINR: selling,
		quantity: 1,
		soldBy: 'piece' as const,
		inStock: true,
		available: 3,
		variantId: null,
		variantLabel: null,
		variants: [],
		freeWith: null,
		...over,
	});
	const bundle = (overrides: Record<string, unknown> = {}) =>
		({
			heading: 'choose',
			priceINR: 500,
			separatelyINR: 700,
			saveINR: 200,
			fromPrice: true,
			lowINR: 500,
			highINR: 600,
			levels: [
				{
					code: 'set',
					label: 'Set',
					take: 1,
					choice: true,
					priceMode: 'difference',
					items: [item('a', 100), item('b', 200, { quantity: 2, inStock: false })],
				},
			],
			extras: [item('pc', 0, { mrpINR: 450, todayINR: 450 })],
			pricing: {
				base: { kind: 'fixed', input: 'setPrice' },
				inputs: [],
				methodRules: [],
				methodCombine: 'all',
				params: { setPrice: 500 },
				rules: [],
				combine: 'all',
				capAtSeparately: false,
				roundTo: 'one',
				eventSale: [],
			},
			stock: { setsPossible: 3, state: 'in_stock', soldOutPieces: [], soldOutChoices: ['b'] },
			buyable: true,
			saleWindow: null,
			...overrides,
		}) as ApiProductPage['bundle'];

	it('carries a piece’s sizes, and no picture when its image has no card file', () => {
		const product = pageToProduct(
			page({
				bundle: bundle({
					extras: [item('pc', 0, { image: image({}), variants: [{ id: 'm', label: 'M', inStock: true }] })],
				}),
			}),
		);
		const extra = product.bundle?.extras[0];
		expect(extra?.variants).toEqual([{ id: 'm', label: 'M', in_stock: true }]);
		expect(extra).toHaveProperty('image', undefined);
	});
});
