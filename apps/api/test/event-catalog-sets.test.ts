import { Product, ShopEvent } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { EventCatalog } from '../src/events/event-catalog';

const product = (id: string, over: Record<string, unknown> = {}) =>
	Product.parse({
		id,
		type: 'bundle',
		sku: `BND-${id}`,
		title: { en: id },
		slug: id.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
		basePriceINR: 0,
		status: 'live',
		...over,
	});

/** A set whose one piece costs this much in the set. */
const quoteAt = (priceINR: number) => ({
	levels: [
		{
			code: 'g',
			take: 1,
			priceMode: 'difference',
			items: [
				{ key: 'i1', quantity: 1, priceInSetINR: priceINR, todayINR: priceINR, onSale: false, perTenth: false },
			],
		},
	],
	extras: [],
	method: { base: { kind: 'pieces' }, inputs: [], rules: [], combine: 'all' },
	params: {},
	rules: [],
	combine: 'all',
	capAtSeparately: false,
	roundTo: 'one',
});

const percent = (value: number) => ({ kind: 'percent' as const, value, skuPrices: {} });

const event = (includeSets: boolean) =>
	ShopEvent.parse({
		id: 'evt_puja',
		type: 'sale',
		name: 'Puja Sale',
		sale: {
			categories: [
				{
					categoryId: 'cat_sets',
					rule: percent(10),
					exceptions: [{ productId: 'set_held', mode: 'held', rule: null }],
				},
				{ categoryId: 'cat_ghost', rule: percent(30), exceptions: [] },
			],
			products: [
				{ productId: 'set_a', rule: percent(20) },
				{ productId: 'set_zero', rule: percent(20) },
				{ productId: 'set_none', rule: percent(20) },
				{ productId: 'saree', rule: percent(20) },
			],
			includeSets,
		},
	});

function catalog(withSets = true) {
	const products = [
		product('set_a'),
		product('set_zero'),
		product('set_none'),
		product('saree', { type: 'simple' }),
		product('set_held', { categoryIds: ['cat_sets'] }),
		product('set_cat', { categoryIds: ['cat_sets'] }),
		product('set_ghost', { categoryIds: ['cat_ghost'] }),
	];
	const prices: Record<string, number> = { set_a: 2000, set_zero: 0, set_held: 2000, set_cat: 2000, set_ghost: 2000 };
	return new EventCatalog(
		{
			findById: async (id: string) => products.find((row) => row.id === id) ?? null,
			list: async ({ categoryIds, page }: { categoryIds: string[]; page: number }) => {
				const items =
					page === 1 ? products.filter((row) => row.categoryIds.some((id) => categoryIds.includes(id))) : [];
				return { items, total: items.length };
			},
		} as never,
		{ listForProducts: async () => [] } as never,
		// Only `cat_sets` is in the tree: `cat_ghost` names a category that is gone.
		{ tree: async () => [{ id: 'cat_sets', ancestors: [], path: [], parentId: null }] } as never,
		{} as never,
		{} as never,
		{} as never,
		withSets
			? ({
					findByProductId: async (id: string) =>
						id === 'set_none' || id === 'saree' ? null : { productId: id },
				} as never)
			: null,
		withSets
			? ({
					resolve: async (bundle: { productId: string }) => bundle,
					toQuote: (bundle: { productId: string }) => quoteAt(prices[bundle.productId] ?? 0),
				} as never)
			: null,
	);
}

describe('a sale’s Review tab with sets included', () => {
	it('shows each set once at its own price: on sale, held, by its category, or with no rule found', async () => {
		const rows = await catalog().salePrices(event(true));
		const byId = new Map(rows.map((row) => [row.productId, row]));
		expect(byId.get('set_a')).toMatchObject({ normalINR: 2000, saleINR: 1600, categoryId: null, refused: false });
		expect(byId.get('set_held')).toMatchObject({ normalINR: 2000, saleINR: null, source: 'held', refused: false });
		expect(byId.get('set_cat')).toMatchObject({ normalINR: 2000, saleINR: 1800, categoryId: 'cat_sets' });
		expect(byId.get('set_ghost')).toMatchObject({
			saleINR: null,
			source: 'held',
			categoryId: null,
			refused: false,
		});
		// No stored set, no set price, or not a set: these have price rows of their own, none here.
		expect(byId.has('set_zero')).toBe(false);
		expect(byId.has('set_none')).toBe(false);
		expect(byId.has('saree')).toBe(false);
	});

	it('works out no set prices without the set stores, or with the sets switch off', async () => {
		expect(await catalog(false).salePrices(event(true))).toEqual([]);
		expect(await catalog().salePrices(event(false))).toEqual([]);
	});
});
