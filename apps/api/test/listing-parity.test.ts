import { Product, type ProductVariant } from '@saha-textile/contracts';
import type { ListingFilters, ListingQuery } from '@saha-textile/core-domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withCatalogLocale } from '../src/catalog/catalog-locale';
import { MongoListing } from '../src/catalog/mongo-listing';
import { MeilisearchListing } from '../src/search/meilisearch-listing';
import { MeilisearchSearch } from '../src/search/meilisearch-search';

/**
 * The same catalogue through both engines must give the same page: the proof that a fallback to
 * Mongo, or a future engine, never changes what a shopper sees. Needs a real Meilisearch:
 *
 *   RUN_SEARCH_IT=1 MEILISEARCH_HOST=http://127.0.0.1:7700 MEILISEARCH_API_KEY=… pnpm exec vitest run listing-parity
 */
const host = process.env['MEILISEARCH_HOST'];
const key = process.env['MEILISEARCH_API_KEY'];
const INDEX = 'products_parity_test';

const group = (
	attributeCode: string,
	role: string,
	labels: Array<[string, string, string]>,
	name: [string, string],
) => ({
	attributeCode,
	label: { en: name[0], fr: name[1] },
	semanticRole: role,
	displayStyle: 'rectangle',
	requiredSelection: false,
	terms: labels.map(([code, en, fr]) => ({ code, label: { en, fr } })),
});
const fabric = (code: string, en: string, fr: string) =>
	group('fabric', 'filter_only', [[code, en, fr]], ['Fabric', 'Tissu']);
const color = (...codes: Array<[string, string, string]>) =>
	group('color', 'variation_axis', codes, ['Color', 'Couleur']);

const rows: Array<[string, string, string, number, number, number, unknown[]]> = [
	[
		'prd_1',
		'Banarasi Saree',
		'Saree Banarasi',
		5000,
		4000,
		4.5,
		[fabric('silk', 'Silk', 'Soie'), color(['red', 'Red', 'Rouge'])],
	],
	[
		'prd_2',
		'Cotton Saree',
		'Saree en coton',
		1500,
		1500,
		3,
		[fabric('cotton', 'Cotton', 'Coton'), color(['blue', 'Blue', 'Bleu'])],
	],
	[
		'prd_10',
		'Ikkat Saree',
		'Saree Ikkat',
		9000,
		9000,
		5,
		[fabric('silk', 'Silk', 'Soie'), color(['red', 'Red', 'Rouge'], ['blue', 'Blue', 'Bleu'])],
	],
	['prd_11', 'Plain Kurti', 'Kurti uni', 800, 800, 0, [fabric('cotton', 'Cotton', 'Coton')]],
	[
		'prd_3',
		'Silk Dupatta',
		'Dupatta en soie',
		2500,
		2000,
		4,
		[
			fabric('silk', 'Silk', 'Soie'),
			group('color', 'filter_only', [['red', 'Red', 'Rouge']], ['Color', 'Couleur']),
		],
	],
];

const products = rows.map(([id, en, fr, , selling, avg, optionGroups], index) =>
	Product.parse({
		id,
		type: 'simple',
		sku: id,
		title: { en, fr },
		slug: id.replace('_', '-'),
		categoryIds: index < 3 ? ['cat_sarees'] : ['cat_other'],
		basePriceINR: selling,
		ratingsSummary: { avg, count: 1 },
		optionGroups,
		status: 'live',
		createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
	}),
);
const variants = rows.map(
	([id, , , mrp, selling]) =>
		({
			id: `var_${id}`,
			productId: id,
			sku: `SKU-${id}`,
			isBaseVariant: true,
			status: 'live',
			priceINR: mrp,
			compareAtPriceINR: null,
			salePriceINR: selling === mrp ? null : selling,
			stock: { tracked: true, quantity: 5, lowStockThreshold: null, allowBackorder: false },
		}) as unknown as ProductVariant,
);

const mongo = new MongoListing(
	{
		list: async (query: { categoryId?: string }) => {
			const items = products.filter((row) => !query.categoryId || row.categoryIds.includes(query.categoryId));
			// Newest first, as the repository lists them.
			return { items: [...items].reverse(), total: items.length };
		},
	} as never,
	{
		listForProducts: async (ids: readonly string[]) => variants.filter((row) => ids.includes(row.productId)),
	} as never,
);

const filters = (over: Partial<ListingFilters> = {}): ListingFilters => ({
	priceRanges: [],
	minRating: null,
	categoryIds: [],
	attributes: new Map(),
	...over,
});
const ticks = (entries: Array<[string, string[]]>) => new Map(entries.map(([code, terms]) => [code, new Set(terms)]));

const cases: Array<[string, Partial<ListingQuery>]> = [
	['everything', {}],
	['one category', { categoryId: 'cat_sarees' }],
	['a tick keeps its siblings counted', { filters: filters({ attributes: ticks([['fabric', ['silk']]]) }) }],
	[
		'ticks across two facets',
		{
			filters: filters({
				attributes: ticks([
					['fabric', ['silk']],
					['color', ['blue']],
				]),
			}),
		},
	],
	['two ticks in one facet', { filters: filters({ attributes: ticks([['fabric', ['silk', 'cotton']]]) }) }],
	[
		'price ranges',
		{
			filters: filters({
				priceRanges: [
					{ min: 0, max: 1000 },
					{ min: 5000, max: null },
				],
			}),
		},
	],
	['a rating floor', { filters: filters({ minRating: 4 }) }],
	['a ticked category', { filters: filters({ categoryIds: ['cat_other'] }) }],
	['an unknown category', { filters: filters({ categoryIds: ['no-such-category'] }) }],
	['price low to high', { sort: 'low-high' }],
	['price high to low', { sort: 'high-low' }],
	['a to z', { sort: 'a-z' }],
	['z to a', { sort: 'z-a' }],
	['discount', { sort: 'discount-high-low' }],
	['id ascending', { sort: 'asc' }],
	['id descending', { sort: 'desc' }],
	['the second page', { page: 2, pageSize: 2, sort: 'asc' }],
	['French labels', { locale: 'fr', sort: 'a-z' }],
];

describe.skipIf(!process.env['RUN_SEARCH_IT'] || !host)('Meilisearch and Mongo give the same listing', () => {
	const search = new MeilisearchSearch(host, key, async () => [], INDEX, ['en', 'fr']);
	const meili = new MeilisearchListing(search);
	const send = (path: string, method: string) =>
		fetch(`${host}${path}`, { method, ...(key ? { headers: { authorization: `Bearer ${key}` } } : {}) });

	beforeAll(async () => {
		await search.replaceIndex(
			products.map((product) => ({ product, variants: variants.filter((row) => row.productId === product.id) })),
		);
	}, 60_000);

	afterAll(async () => {
		await send(`/indexes/${INDEX}`, 'DELETE');
	});

	it.each(cases)('%s', async (_name, over) => {
		const query: ListingQuery = { filters: filters(), page: 1, pageSize: 24, locale: 'en', ...over };
		const fromMongo = await withCatalogLocale(query.locale, () => mongo.page(query));
		const fromSearch = await meili.page(query);
		expect(fromSearch).toEqual(fromMongo);
	});
});
