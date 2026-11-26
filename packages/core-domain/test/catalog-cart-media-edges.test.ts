import type {
	CatalogPageBundle,
	CatalogPageBundleItem,
	CatalogPageFreeWith,
	CatalogProductPage,
} from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { freeItemsFor, priceBundleLine, productFreeChildren } from '../src/catalog/cart-bundle';
import { priceCartLine } from '../src/catalog/cart-line';
import { heicColourProfile, suggestProfile } from '../src/catalog/media-files';

const item = (key: string, price: number, over: Partial<CatalogPageBundleItem> = {}): CatalogPageBundleItem => ({
	key,
	productId: key,
	slug: key,
	title: key,
	sku: key.toUpperCase(),
	image: null,
	mrpINR: null,
	sellingINR: price,
	saleINR: null,
	priceInSetINR: price,
	todayINR: price,
	quantity: 1,
	soldBy: 'piece',
	inStock: true,
	available: 3,
	variantId: null,
	variantLabel: null,
	variants: [],
	freeWith: null,
	...over,
});
const freeItem = (productId: string, over: Record<string, unknown> = {}) => ({
	productId,
	title: productId,
	image: null,
	mrpINR: 450,
	sellingINR: 450,
	quantity: 1,
	inStock: true,
	variantId: null,
	variantLabel: null,
	variants: [] as Array<{ id: string; label: string; inStock: boolean }>,
	...over,
});
const free = (over: Partial<CatalogPageFreeWith> = {}): CatalogPageFreeWith =>
	({
		take: 'all',
		count: null,
		from: null,
		required: true,
		given: true,
		min: 1,
		max: 1,
		noneOrExactly: false,
		items: [freeItem('pc')],
		...over,
	}) as CatalogPageFreeWith;
const sizes = [
	{ id: 'm', label: 'M', inStock: true },
	{ id: 'l', label: 'L', inStock: false },
];
const set = (over: Partial<CatalogPageBundle> = {}, pricing: Record<string, unknown> = {}): CatalogPageBundle =>
	({
		heading: 'components',
		priceINR: 1000,
		separatelyINR: 1000,
		saveINR: 0,
		fromPrice: false,
		lowINR: 1000,
		highINR: 1000,
		levels: [
			{
				code: 'saree',
				label: 'Saree',
				take: 1,
				choice: false,
				priceMode: 'difference',
				items: [item('saree', 1000)],
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
			...pricing,
		},
		stock: { setsPossible: 3, state: 'in_stock', soldOutPieces: [], soldOutChoices: [] },
		buyable: true,
		saleWindow: null,
		...over,
	}) as CatalogPageBundle;
const choice = (over = {}) => ({ picks: {}, variants: {}, extras: [], free: {}, ...over });

describe('free items with a product: the remaining cases', () => {
	it('gives nothing without a rule, and a given item in the size asked for', () => {
		expect(freeItemsFor(null, [])).toEqual([]);
		const sized = free({ items: [freeItem('pc', { variants: sizes })] });
		expect(freeItemsFor(sized, [{ productId: 'pc', variantId: 'm' }])).toEqual([
			{ productId: 'pc', variantId: 'm' },
		]);
		expect(freeItemsFor(sized, [{ productId: 'pc', variantId: 'l' }])).toBeNull();
		expect(freeItemsFor(sized, [])).toBeNull();
	});

	it('refuses a pick that is unknown, sold out, picked twice or missing its size', () => {
		const rule = free({
			given: false,
			min: 0,
			max: 2,
			items: [freeItem('a'), freeItem('b', { inStock: false }), freeItem('c', { variants: sizes })],
		});
		const pick = (productId: string, variantId: string | null = null) => ({ productId, variantId });
		expect(freeItemsFor(rule, [pick('x')])).toBeNull();
		expect(freeItemsFor(rule, [pick('b')])).toBeNull();
		expect(freeItemsFor(rule, [pick('a'), pick('a')])).toBeNull();
		expect(freeItemsFor(rule, [pick('c')])).toBeNull();
		expect(freeItemsFor(rule, [pick('c', 'm')])).toEqual([pick('c', 'm')]);
	});

	it('takes none or exactly the count on a “none or exactly” rule', () => {
		const rule = free({
			given: false,
			noneOrExactly: true,
			min: 0,
			max: 2,
			items: [freeItem('a'), freeItem('b'), freeItem('c')],
		});
		const pick = (productId: string) => ({ productId, variantId: null });
		expect(freeItemsFor(rule, [])).toEqual([]);
		expect(freeItemsFor(rule, [pick('a'), pick('b')])).toHaveLength(2);
		expect(freeItemsFor(rule, [pick('a')])).toBeNull();
	});

	it('asks for a free choice before the product can go in the cart, and labels a chosen size', () => {
		const rule = free({ given: false, min: 1, max: 1, items: [freeItem('pc', { variants: sizes })] });
		expect(productFreeChildren(rule, [])).toEqual({ ok: false, reason: 'free_choice_needed' });
		const made = productFreeChildren(rule, [{ productId: 'pc', variantId: 'm' }]);
		expect(made.ok && made.children[0]?.variantLabel).toBe('M');
	});
});

describe('a set as a cart line: the remaining cases', () => {
	it('prices a set whose page carries no sale events', () => {
		const line = priceBundleLine(set(), choice());
		expect(line.ok && line.totalINR).toBe(1000);
	});

	it('refuses a set its quote can’t price, and a piece gone out of stock', () => {
		const empty = set({
			levels: [{ code: 'none', label: 'None', take: 1, choice: false, priceMode: 'difference', items: [] }],
		});
		expect(priceBundleLine(empty, choice())).toEqual({ ok: false, reason: 'bundle_incomplete' });
		const soldOut = set({
			levels: [
				{
					code: 'saree',
					label: 'Saree',
					take: 1,
					choice: false,
					priceMode: 'difference',
					items: [item('saree', 1000, { inStock: false })],
				},
			],
		});
		expect(priceBundleLine(soldOut, choice())).toEqual({ ok: false, reason: 'bundle_incomplete' });
		// An add-on chosen with the set that has since sold out.
		const extraGone = set({ extras: [item('blouse', 300, { inStock: false })] });
		expect(priceBundleLine(extraGone, choice({ extras: ['blouse'] }))).toEqual({
			ok: false,
			reason: 'bundle_incomplete',
		});
	});

	it('puts a set on the cart under its own SKU or its slug, with an MRP only when the pieces cost more', () => {
		const product = (over: Record<string, unknown>) =>
			({
				slug: 'bridal-set',
				madeToOrder: false,
				selected: null,
				optionGroups: [],
				variants: [],
				measurements: null,
				...over,
			}) as unknown as CatalogProductPage;
		const bySlug = priceCartLine(product({ bundle: set() }), { variationId: null, addons: [] });
		expect(bySlug.ok && [bySlug.line.sku, bySlug.line.mrpINR]).toEqual(['bridal-set', null]);
		const cheaper = set(
			{},
			{
				methodRules: [
					{
						id: 'r',
						name: null,
						enabled: true,
						when: { match: 'all', conditions: [] },
						then: [{ kind: 'percentOff', amount: 10, level: null, items: [] }],
						otherwise: [],
					},
				],
			},
		);
		const bySku = priceCartLine(
			product({
				bundle: cheaper,
				selected: { sku: 'SET-1', sellingINR: 900, mrpINR: null, quantity: 1, buyable: true },
			}),
			{
				variationId: null,
				addons: [],
			},
		);
		expect(bySku.ok && [bySku.line.sku, bySku.line.mrpINR]).toEqual(['SET-1', 1000]);
		expect(priceCartLine(product({ bundle: set({ buyable: false }) }), { variationId: null, addons: [] })).toEqual({
			ok: false,
			reason: 'bundle_not_on_sale',
		});
	});

	it('refuses a product whose free item still needs choosing', () => {
		const product = {
			slug: 'silk',
			madeToOrder: false,
			selected: { sku: 'BASE', sellingINR: 800, mrpINR: null, quantity: 3, buyable: true },
			optionGroups: [],
			variants: [],
			measurements: null,
			bundle: null,
			freeWith: free({ given: false, min: 1, max: 1 }),
		} as unknown as CatalogProductPage;
		expect(priceCartLine(product, { variationId: null, addons: [] })).toEqual({
			ok: false,
			reason: 'free_choice_needed',
		});
	});
});

describe('photo files: the remaining cases', () => {
	it('suggests the best-ranked usable profile that fits, and nothing when none does', () => {
		const profile = (key: string, over: Record<string, unknown> = {}) => ({
			key,
			shape: { width: 3, height: 4 },
			enabled: true,
			mainPhotoOnly: false,
			...over,
		});
		const portrait = { width: 3000, height: 4000 };
		expect(
			suggestProfile(
				[
					profile('own_3x4'),
					profile('product_3x4'),
					profile('off', { enabled: false }),
					profile('main', { mainPhotoOnly: true }),
					profile('any', { shape: null }),
				],
				portrait,
			),
		).toBe('product_3x4');
		expect(suggestProfile([profile('own_3x4'), profile('custom_3x4')], portrait)).toBe('own_3x4');
		expect(suggestProfile([profile('wide', { shape: { width: 21, height: 9 } })], portrait)).toBeNull();
	});

	it('reads a HEIC colour profile only from a box of a sensible size', () => {
		const box = (size: number, payload: number[]) =>
			new Uint8Array([
				(size >>> 24) & 255,
				(size >>> 16) & 255,
				(size >>> 8) & 255,
				size & 255,
				...new TextEncoder().encode('colrprof'),
				...payload,
			]);
		const payload = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		expect(heicColourProfile(box(22, payload))).toEqual(new Uint8Array(payload));
		expect(heicColourProfile(box(16, payload))).toBeNull();
		expect(heicColourProfile(box(100, payload))).toBeNull();
	});
});
