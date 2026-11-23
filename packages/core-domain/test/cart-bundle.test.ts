import type { CatalogPageBundle, CatalogPageBundleItem, CatalogPageFreeWith } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { freeItemsFor, priceBundleLine, productFreeChildren } from '../src/catalog/cart-bundle';

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
const free = (over: Partial<CatalogPageFreeWith> = {}): CatalogPageFreeWith => ({
	take: 'all',
	count: null,
	from: null,
	required: true,
	given: true,
	min: 1,
	max: 1,
	noneOrExactly: false,
	items: [
		{
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
		},
	],
	...over,
});
const set = (over: Partial<CatalogPageBundle> = {}): CatalogPageBundle => ({
	heading: 'components',
	priceINR: 14850,
	separatelyINR: 19800,
	saveINR: 4950,
	fromPrice: false,
	lowINR: 14850,
	highINR: 14850,
	levels: [
		{
			code: 'saree',
			label: 'Saree',
			take: 1,
			choice: false,
			priceMode: 'difference',
			items: [item('saree', 16400)],
		},
		{
			code: 'blouse',
			label: 'Blouse',
			take: 1,
			choice: false,
			priceMode: 'difference',
			items: [item('blouse', 3400)],
		},
	],
	extras: [item('box', 300)],
	pricing: {
		base: { kind: 'pieces' },
		eventSale: [],
		inputs: [],
		methodRules: [
			{
				id: 'r',
				name: null,
				enabled: true,
				when: { match: 'all', conditions: [] },
				then: [{ kind: 'percentOff', amount: 25, level: null, items: [] }],
				otherwise: [],
			},
		],
		methodCombine: 'all',
		params: {},
		rules: [],
		combine: 'all',
		capAtSeparately: false,
		roundTo: 'one',
	},
	stock: { setsPossible: 3, state: 'in_stock', soldOutPieces: [], soldOutChoices: [] },
	buyable: true,
	saleWindow: null,
	...over,
});
const choice = (over = {}) => ({ picks: {}, variants: {}, extras: [], free: {}, ...over });

describe('a set as a cart line', () => {
	it('splits the set price into piece shares (the B2.9 example) and adds extras at their price', () => {
		const line = priceBundleLine(set(), choice({ extras: ['box'] }));
		if (!line.ok) throw new Error(line.reason);
		expect(line.totalINR).toBe(14850 + 300);
		expect(line.children.map((c) => [c.role, c.key, c.priceINR])).toEqual([
			['piece', 'saree', 12300],
			['piece', 'blouse', 2550],
			['extra', 'box', 300],
		]);
	});

	it('refuses a set that cannot be bought, a missing size and a missing free choice', () => {
		expect(priceBundleLine(set({ buyable: false }), choice())).toEqual({ ok: false, reason: 'bundle_not_on_sale' });
		const sized = set({
			levels: [
				{
					code: 'pc',
					label: 'PC',
					take: 1,
					choice: false,
					priceMode: 'difference',
					items: [item('pc', 450, { variants: [{ id: 'm', label: 'M', inStock: true }] })],
				},
			],
		});
		expect(priceBundleLine(sized, choice())).toEqual({ ok: false, reason: 'size_needed' });
		const ok = priceBundleLine(sized, choice({ variants: { pc: 'm' } }));
		expect(ok.ok && ok.children[0]?.variantLabel).toBe('M');
		const withChoice = set({
			levels: [
				{
					code: 's',
					label: 'S',
					take: 1,
					choice: false,
					priceMode: 'difference',
					items: [item('s', 9000, { freeWith: free({ given: false, take: 'exactly', count: 1 }) })],
				},
			],
		});
		expect(priceBundleLine(withChoice, choice())).toEqual({ ok: false, reason: 'free_choice_needed' });
		const picked = priceBundleLine(withChoice, choice({ free: { s: [{ productId: 'pc', variantId: null }] } }));
		expect(picked.ok && picked.children.map((c) => [c.role, c.parentKey, c.priceINR])).toEqual([
			['piece', null, 6750],
			['free', 's', 0],
		]);
	});

	it('gives a product its free items: given ones by themselves, a choice as asked', () => {
		expect(productFreeChildren(free(), [])).toMatchObject({
			ok: true,
			children: [{ role: 'free', productId: 'pc', priceINR: 0 }],
		});
		expect(productFreeChildren(free({ given: false, take: 'upto', count: 1, min: 0 }), [])).toEqual({
			ok: true,
			children: [],
		});
		expect(freeItemsFor(free({ given: false, take: 'exactly', count: 1, min: 1 }), [])).toBeNull();
		expect(productFreeChildren(null, [])).toEqual({ ok: true, children: [] });
	});
});
