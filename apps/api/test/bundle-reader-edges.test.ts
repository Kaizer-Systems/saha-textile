import { Product, ProductBundle, ProductVariant } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { BundleReader } from '../src/catalog/bundles/bundle-reader';

const both = { en: 'Text', bn: 'Texte' };
const axis = (attributeCode: string, role: string, terms: Array<{ code: string; label: string }>) => ({
	attributeCode,
	label: both,
	semanticRole: role,
	displayStyle: 'rectangle',
	requiredSelection: false,
	terms: terms.map((term) => ({ code: term.code, label: { en: term.label } })),
});
const product = (id: string, over: Record<string, unknown> = {}) =>
	Product.parse({
		id,
		type: 'simple',
		sku: `SKU-${id}`,
		title: { en: `${id} title` },
		slug: id.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
		basePriceINR: 1500,
		status: 'live',
		...over,
	});
const variant = (id: string, productId: string, over: Record<string, unknown> = {}) =>
	ProductVariant.parse({
		id,
		productId,
		sku: `V-${id}`,
		status: 'live',
		// A selection the products' axes never name, so a row reads as its SKU unless a test pins one.
		optionSelections: [{ attributeCode: 'finish', termCode: 'plain' }],
		optionSelectionHash: `h:${id}`,
		isBaseVariant: false,
		priceINR: 1000,
		stock: { quantity: 2 },
		...over,
	});
const bundle = (over: Record<string, unknown> = {}) =>
	ProductBundle.parse({
		id: 'bnd_1',
		productId: 'prd_set',
		levels: [],
		pricing: { methodId: 'bpm_pieces' },
		...over,
	});
const level = (code: string, items: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) => ({
	code,
	label: { en: code },
	take: 1,
	items: items.map((item) => ({ variantId: null, quantity: 1, priceInSetINR: null, ...item })),
	...over,
});

interface Setup {
	products?: Product[];
	variants?: ProductVariant[];
	methods?: boolean;
	sales?: boolean;
}

function reader(options: Setup = {}) {
	const products = options.products ?? [];
	const rows = options.variants ?? [];
	const productRepo = {
		findById: async (id: string) => products.find((row) => row.id === id) ?? null,
		list: vi.fn(async () => ({ items: products, total: products.length })),
	};
	const variantRepo = { listForProduct: async (id: string) => rows.filter((row) => row.productId === id) };
	const methods = options.methods ? { findById: async () => ({ id: 'bpm_pieces', active: true, rules: [] }) } : null;
	const sales = options.sales
		? {
				priceFor: (row: ProductVariant) =>
					row.id === 'v_sale'
						? { saleINR: 800, eventId: 'evt_diwali', endsAt: '2026-11-30T00:00:00.000Z' }
						: null,
				setRules: () => [],
			}
		: null;
	return {
		service: new BundleReader(productRepo as never, variantRepo as never, methods as never, sales as never),
		productRepo,
	};
}

const piece = (productId: string, over: Record<string, unknown> = {}) => ({
	productId,
	variantId: null,
	quantity: 1,
	priceInSetINR: null,
	...over,
});

describe('a bundle piece as the reader sees it', () => {
	it('drops a piece whose product is gone', async () => {
		expect(await reader().service.item(piece('prd_gone'))).toBeNull();
	});

	it('names a pinned size or colour by its axis terms only, and nothing when none is an axis term', async () => {
		const groups = [
			axis('colour', 'variation_axis', [{ code: 'red', label: 'Red' }]),
			{
				...axis('fabric', 'named_add_on', []),
				defaultTermCode: 'none',
				terms: [
					{ code: 'none', label: { en: 'No design' }, isBase: true },
					{ code: 'silk', label: { en: 'Silk' } },
				],
			},
		];
		const { service } = reader({
			products: [product('prd_1', { optionGroups: groups })],
			variants: [
				variant('v_red', 'prd_1', {
					optionSelections: [
						{ attributeCode: 'colour', termCode: 'red' },
						{ attributeCode: 'fabric', termCode: 'silk' },
						{ attributeCode: 'size', termCode: 'xl' },
					],
				}),
				variant('v_plain', 'prd_1', { optionSelections: [{ attributeCode: 'fabric', termCode: 'silk' }] }),
			],
		});
		expect(await service.item(piece('prd_1', { variantId: 'v_red' }))).toMatchObject({
			variantId: 'v_red',
			variantLabel: 'Red',
			sku: 'V-v_red',
		});
		expect((await service.item(piece('prd_1', { variantId: 'v_plain' })))?.variantLabel).toBeNull();
		const chooses = await service.item(piece('prd_1'));
		expect(chooses?.variants.map((row) => row.label)).toEqual(['Red', 'V-v_plain']);
	});

	it('falls back to the product when the pinned variant is gone, and to its own price when it has no live rows', async () => {
		const { service } = reader({
			products: [product('prd_1')],
			variants: [variant('v_off', 'prd_1', { status: 'disabled' })],
		});
		const item = await service.item(piece('prd_1', { variantId: 'v_gone' }));
		expect(item).toMatchObject({
			variantId: null,
			sku: 'SKU-prd_1',
			sellingINR: 1500,
			available: 0,
			capacity: 0,
			mrpINR: null,
		});
	});

	it('picks the first row with stock when none is the base, else the first row', async () => {
		const stocked = reader({
			products: [product('prd_1')],
			variants: [
				variant('v_empty', 'prd_1', { stock: { quantity: 0 }, priceINR: 700 }),
				variant('v_full', 'prd_1', { stock: { quantity: 4 }, priceINR: 900 }),
			],
		});
		expect((await stocked.service.item(piece('prd_1')))?.sellingINR).toBe(900);
		const empty = reader({
			products: [product('prd_1')],
			variants: [variant('v_first', 'prd_1', { stock: { quantity: 0 }, priceINR: 650 })],
		});
		expect((await empty.service.item(piece('prd_1')))?.sellingINR).toBe(650);
	});

	it('leaves a live made-to-order piece unlimited, with every choice in stock', async () => {
		const { service } = reader({
			products: [product('prd_1', { madeToOrder: true })],
			variants: [
				variant('v_a', 'prd_1', { stock: { quantity: 0 } }),
				variant('v_b', 'prd_1', { stock: { quantity: 0 } }),
			],
		});
		const item = await service.item(piece('prd_1'));
		expect(item).toMatchObject({ madeToOrder: true, available: null, capacity: Number.POSITIVE_INFINITY });
		expect(item?.variants.every((row) => row.inStock && row.available === null)).toBe(true);
	});

	it('reads a running sale for the default row, and the photo version the product keeps for its main photo', async () => {
		const { service } = reader({
			sales: true,
			products: [
				product('prd_1', {
					media: { gallery: ['ast_1'], compound: [], altOverrides: {}, versions: { ast_1: 'ver_1' } },
				}),
				product('prd_2', { media: { gallery: ['ast_2'], compound: [], altOverrides: {}, versions: {} } }),
				product('prd_3'),
			],
			variants: [
				variant('v_sale', 'prd_1', { isBaseVariant: true }),
				variant('v_2', 'prd_2', { isBaseVariant: true }),
			],
		});
		expect(await service.item(piece('prd_1'))).toMatchObject({
			saleINR: 800,
			saleEventId: 'evt_diwali',
			todayINR: 800,
			imageAssetId: 'ast_1',
			imageVersionId: 'ver_1',
		});
		expect(await service.item(piece('prd_2'))).toMatchObject({
			saleINR: null,
			imageAssetId: 'ast_2',
			imageVersionId: null,
		});
		expect(await service.item(piece('prd_3'))).toMatchObject({ imageAssetId: null, imageVersionId: null });
	});
});

describe('a bundle as the reader works it out', () => {
	it('fills a category level with its newest live products, leaving bundles and the set itself out', async () => {
		const { service, productRepo } = reader({
			products: [
				product('prd_set', { type: 'bundle' }),
				product('prd_other_set', { type: 'bundle' }),
				product('prd_a'),
				product('prd_b'),
				product('prd_c'),
			],
		});
		const resolved = await service.resolve(
			bundle({ levels: [level('cat', [], { source: { kind: 'category', categoryId: 'cat_1', limit: 2 } })] }),
		);
		expect(resolved.method).toBeNull();
		expect(resolved.levels[0]?.items.map((item) => item.productId)).toEqual(['prd_a', 'prd_b']);
		expect(productRepo.list).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'cat_1', pageSize: 3 }));
	});

	it('prices by the pieces without a method, and counts a piece off the shop as none in stock', async () => {
		const { service } = reader({
			methods: true,
			products: [product('prd_a'), product('prd_off', { status: 'disabled' })],
			variants: [
				variant('v_a', 'prd_a', { isBaseVariant: true }),
				variant('v_off', 'prd_off', { isBaseVariant: true }),
			],
		});
		const resolved = await service.resolve(
			bundle({ levels: [level('g', [{ productId: 'prd_a' }, { productId: 'prd_off' }])] }),
		);
		expect(resolved.method).toMatchObject({ id: 'bpm_pieces' });
		expect(service.toQuote({ ...resolved, method: null }).method).toEqual({
			base: { kind: 'pieces' },
			inputs: [],
			rules: [],
			combine: 'all',
		});
		const stock = service.stock(resolved, null, new Date('2026-11-24T00:00:00.000Z'));
		expect(stock.setsPossible).toBeGreaterThan(0);
	});

	it('honours rules that narrow choices when working out stock', async () => {
		const { service } = reader({
			products: [product('prd_a'), product('prd_b')],
			variants: [
				variant('v_a', 'prd_a', { isBaseVariant: true }),
				variant('v_b', 'prd_b', { isBaseVariant: true }),
			],
		});
		const narrowed = bundle({
			levels: [level('g', [{ productId: 'prd_a' }, { productId: 'prd_b' }])],
			pricing: {
				methodId: 'bpm_pieces',
				rules: [{ id: 'r1', then: [{ kind: 'hideItem', level: 'g', items: ['prd_b'] }] }],
			},
		});
		const stock = service.stock(await service.resolve(narrowed), 1);
		expect(stock.state).toBeDefined();
	});

	it('sells only inside the sale window, while live, in stock and with levels', async () => {
		const { service } = reader({
			products: [product('prd_a')],
			variants: [variant('v_a', 'prd_a', { isBaseVariant: true })],
		});
		const now = new Date('2026-11-24T00:00:00.000Z');
		const at = (saleWindow: unknown, levels = [level('g', [{ productId: 'prd_a' }])]) =>
			service.resolve(bundle({ levels, saleWindow }));
		const stock = { setsPossible: 2, state: 'in_stock', soldOutPieces: [], soldOutChoices: [] } as never;
		expect(service.buyable(await at(null), stock, true, now)).toBe(true);
		expect(service.buyable(await at({ from: null, to: null }), stock, true, now)).toBe(true);
		expect(
			service.buyable(
				await at({ from: '2026-11-01T00:00:00.000Z', to: '2026-12-01T00:00:00.000Z' }),
				stock,
				true,
				now,
			),
		).toBe(true);
		expect(service.buyable(await at({ from: '2026-12-01T00:00:00.000Z', to: null }), stock, true, now)).toBe(false);
		expect(service.buyable(await at({ from: null, to: '2026-11-01T00:00:00.000Z' }), stock, true, now)).toBe(false);
		expect(service.buyable(await at(null, []), stock, true, now)).toBe(false);
	});
});

describe('free items and the set block on the product page', () => {
	const image = async () => null;

	it('shows no free items when none is given, or when none is still on the shop', async () => {
		const { service } = reader({ products: [product('prd_off', { status: 'disabled' })] });
		expect(await service.freeWithPage(null, image)).toBeNull();
		const freeWith = {
			items: [
				{ productId: 'prd_gone', variantId: null, quantity: 1 },
				{ productId: 'prd_off', variantId: null, quantity: 1 },
			],
			take: 'all',
			count: null,
			from: null,
			required: true,
		};
		expect(await service.freeWithPage(freeWith as never, image)).toBeNull();
	});

	it('draws no set block while every level is empty, and pieces with their photos otherwise', async () => {
		const { service } = reader({
			products: [product('prd_a'), product('prd_b')],
			variants: [
				variant('v_a', 'prd_a', { isBaseVariant: true }),
				variant('v_b', 'prd_b', { isBaseVariant: true }),
			],
		});
		const set = product('prd_set', { type: 'bundle' });
		expect(await service.page(await service.resolve(bundle({ levels: [level('g', [])] })), set, image)).toBeNull();
		const drawn = await service.page(
			await service.resolve(bundle({ levels: [level('g', [{ productId: 'prd_a' }])], extras: [piece('prd_b')] })),
			set,
			async (row) => ({ assetId: row.id }) as never,
		);
		expect(drawn?.levels[0]?.items[0]).toMatchObject({ productId: 'prd_a', image: { assetId: 'prd_a' } });
		expect(drawn?.extras[0]).toMatchObject({ productId: 'prd_b' });
		expect(drawn?.pricing.eventSale).toEqual([]);
	});
});

describe('pieces with choices, on the product page', () => {
	const image = async () => null;

	it('lists each piece’s choices in the set block and among free items, and names no choice by a term it lacks', async () => {
		const groups = [axis('colour', 'variation_axis', [{ code: 'red', label: 'Red' }])];
		const { service } = reader({
			products: [product('prd_c', { optionGroups: groups })],
			variants: [
				variant('v_red', 'prd_c', {
					isBaseVariant: true,
					optionSelections: [{ attributeCode: 'colour', termCode: 'red' }],
				}),
				variant('v_blue', 'prd_c', { optionSelections: [{ attributeCode: 'colour', termCode: 'blue' }] }),
			],
		});
		expect((await service.item(piece('prd_c', { variantId: 'v_blue' })))?.variantLabel).toBeNull();
		const set = product('prd_set', { type: 'bundle' });
		const drawn = await service.page(
			await service.resolve(bundle({ levels: [level('g', [{ productId: 'prd_c' }])] })),
			set,
			image,
		);
		expect(drawn?.levels[0]?.items[0]?.variants.map((row) => row.id)).toEqual(['v_red', 'v_blue']);
		const free = await service.freeWithPage(
			{
				items: [{ productId: 'prd_c', variantId: null, quantity: 1 }],
				take: 'all',
				count: null,
				from: null,
				required: true,
			} as never,
			image,
		);
		expect(JSON.stringify(free)).toContain('v_blue');
	});
});
