import { Product, ProductVariant } from '@saha-textile/contracts';
import { SearchUnavailableError, type ListingFilters, type ListingQuery } from '@saha-textile/core-domain';
import { firstValueFrom, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CatalogLocaleInterceptor, catalogLocale, localized, withCatalogLocale } from '../src/catalog/catalog-locale';
import { ResilientListing } from '../src/catalog/resilient-listing';
import { idOrder, listingDocument } from '../src/search/listing-document';
import { MeilisearchListing } from '../src/search/meilisearch-listing';
import { MeilisearchSearch } from '../src/search/meilisearch-search';

const filters = (over: Partial<ListingFilters> = {}): ListingFilters => ({
	priceRanges: [],
	minRating: null,
	categoryIds: [],
	attributes: new Map(),
	...over,
});
const query = (over: Partial<ListingQuery> = {}): ListingQuery => ({
	filters: filters(),
	page: 1,
	pageSize: 24,
	locale: 'en',
	...over,
});

describe('catalog locale', () => {
	const run = (asked: unknown) => {
		const interceptor = new CatalogLocaleInterceptor();
		const context = { switchToHttp: () => ({ getRequest: () => ({ query: { locale: asked } }) }) };
		return firstValueFrom(interceptor.intercept(context as never, { handle: () => of(catalogLocale()) }));
	};

	it('reads ?locale= and refuses anything that is not a language', async () => {
		await expect(run('fr')).resolves.toBe('fr');
		await expect(run('../etc')).resolves.toBe('en');
		await expect(run(undefined)).resolves.toBe('en');
		const noQuery = { switchToHttp: () => ({ getRequest: () => ({}) }) };
		await expect(
			firstValueFrom(
				new CatalogLocaleInterceptor().intercept(noQuery as never, { handle: () => of(catalogLocale()) }),
			),
		).resolves.toBe('en');
	});

	it('falls back to English, then to nothing', () => {
		expect(withCatalogLocale('fr', () => localized({ en: 'Red', fr: 'Rouge' }))).toBe('Rouge');
		expect(withCatalogLocale('fr', () => localized({ en: 'Red' }))).toBe('Red');
		expect(withCatalogLocale('fr', () => localized({ en: 'Red', fr: '' }))).toBe('Red');
		expect(localized({})).toBe('');
	});
});

describe('ResilientListing', () => {
	const answer = (total: number) => ({ productIds: [], total, facets: [] });
	const build = (primary: () => Promise<ReturnType<typeof answer>>) => {
		const fallback = { page: vi.fn(async () => answer(9)) };
		return { listing: new ResilientListing({ page: primary }, fallback), fallback };
	};

	it('uses search when it answers', async () => {
		const { listing, fallback } = build(async () => answer(3));
		expect((await listing.page(query())).total).toBe(3);
		expect(fallback.page).not.toHaveBeenCalled();
	});

	it('keeps an honest empty result for ticked filters', async () => {
		const { listing, fallback } = build(async () => answer(0));
		const ticked = [
			filters({ priceRanges: [{ min: 1, max: 2 }] }),
			filters({ minRating: 4 }),
			filters({ categoryIds: ['c'] }),
			filters({ attributes: new Map([['color', new Set(['red'])]]) }),
		];
		for (const value of ticked) expect((await listing.page(query({ filters: value }))).total).toBe(0);
		expect(fallback.page).not.toHaveBeenCalled();
	});

	it('asks Mongo when an unfiltered listing is empty, since the index may not be filled', async () => {
		const { listing } = build(async () => answer(0));
		expect((await listing.page(query())).total).toBe(9);
	});

	it('falls back when search is down, and lets real faults through', async () => {
		const down = build(async () => {
			throw new SearchUnavailableError('down');
		});
		expect((await down.listing.page(query())).total).toBe(9);
		const fault = build(async () => {
			throw new Error('bug');
		});
		await expect(fault.listing.page(query())).rejects.toThrow('bug');
	});
});

const product = (over: Record<string, unknown> = {}) =>
	Product.parse({
		id: 'prd_12',
		type: 'simple',
		sku: 'S',
		title: { en: 'Silk Saree', fr: 'Saree en Soie' },
		slug: 'silk-saree',
		categoryIds: ['cat_1'],
		basePriceINR: 1000,
		optionGroups: [
			{
				attributeCode: 'fabric',
				label: { en: 'Fabric', fr: 'Tissu' },
				semanticRole: 'filter_only',
				displayStyle: 'rectangle',
				requiredSelection: false,
				terms: [{ code: 'silk', label: { en: 'Silk', fr: 'Soie' } }],
			},
			{
				attributeCode: 'color',
				label: { en: 'Color' },
				semanticRole: 'variation_axis',
				displayStyle: 'rectangle',
				requiredSelection: true,
				terms: [{ code: 'red', label: { en: 'Red' } }],
			},
			{
				attributeCode: 'blouse',
				label: { en: 'Blouse' },
				semanticRole: 'named_add_on',
				displayStyle: 'rectangle',
				requiredSelection: false,
				defaultTermCode: 'none',
				terms: [{ code: 'none', label: { en: 'None' }, isBase: true }],
			},
		],
		...over,
	});

describe('listingDocument', () => {
	it('carries what filters and sorting need, in every language', () => {
		const doc = listingDocument({ product: product(), variants: [] }, ['en', 'fr']);
		expect(doc).toMatchObject({
			id: 'prd_12',
			idOrder: 'prd_000000000012',
			createdOrder: '',
			terms: ['fabric:silk', 'color:red'],
			filterCodes: ['fabric'],
			titleOrder: { en: 'silk saree', fr: 'saree en soie' },
		});
		expect(JSON.parse(doc.facetValues[0] as string)).toMatchObject({
			code: 'fabric',
			term: 'silk',
			group: { fr: 'Tissu' },
			label: { fr: 'Soie' },
		});
	});

	it('sorts an untranslated title by its English', () => {
		const doc = listingDocument(
			{ product: product({ title: { en: 'Plain' }, createdAt: '2026-01-01T00:00:00.000Z' }), variants: [] },
			['en', 'fr'],
		);
		expect(doc.titleOrder).toEqual({ en: 'plain', fr: 'plain' });
		expect(doc.createdOrder).toBe('2026-01-01T00:00:00.000Z');
		expect(idOrder('abc')).toBe('abc');
	});
});

const facet = (code: string, term: string, label: Record<string, string>, group: Record<string, string>) =>
	JSON.stringify({ code, term, label, group });
const silk = facet('fabric', 'silk', { en: 'Silk', fr: 'Soie' }, { en: 'Fabric', fr: 'Tissu' });
const cotton = facet('fabric', 'cotton', { en: 'Cotton' }, { en: 'Fabric' });
const red = facet('color', 'red', { en: 'Red' }, { en: 'Color' });
const addon = facet('hidden', 'x', { en: 'X' }, { en: 'Hidden' });

describe('MeilisearchListing', () => {
	const build = (results: unknown[]) => {
		const multiSearch = vi.fn(async () => results);
		return { listing: new MeilisearchListing({ index: 'products', multiSearch } as never), multiSearch };
	};
	const sent = (multiSearch: { mock: { calls: unknown[][] } }) =>
		multiSearch.mock.calls[0]?.[0] as Array<{ filter: string[]; sort?: string[]; page?: number }>;
	const main = { hits: [{ id: 'a' }, {}], totalHits: 7, facetDistribution: { facetValues: { [silk]: 2, [red]: 1 } } };
	const everything = {
		facetDistribution: {
			facetValues: { [silk]: 5, [cotton]: 3, [red]: 4, [addon]: 1 },
			filterCodes: { fabric: 8, color: 2 },
		},
	};

	it('reads one page, keeps every value, and counts by the filters', async () => {
		const { listing, multiSearch } = build([main, everything]);
		const page = await listing.page(query({ categoryId: 'cat_1' }));
		expect(page.productIds).toEqual(['a']);
		expect(page.total).toBe(7);
		expect(page.facets).toEqual([
			{ code: 'color', label: 'Color', terms: [{ code: 'red', label: 'Red', count: 1 }] },
			{
				code: 'fabric',
				label: 'Fabric',
				terms: [
					{ code: 'cotton', label: 'Cotton', count: 0 },
					{ code: 'silk', label: 'Silk', count: 2 },
				],
			},
		]);
		expect(sent(multiSearch)[0]?.filter).toEqual(['categoryIds = "cat_1"']);
		expect(sent(multiSearch)[0]?.sort).toEqual(['createdOrder:desc', 'idOrder:asc']);
	});

	it('shows labels in the asked language, falling back to English, then nothing', async () => {
		const blank = facet('fabric', 'wool', {}, {});
		const { listing } = build([
			main,
			{ facetDistribution: { facetValues: { [silk]: 1, [cotton]: 1, [blank]: 1 }, filterCodes: { fabric: 1 } } },
		]);
		const [fabric] = (await listing.page(query({ locale: 'fr' }))).facets;
		expect(fabric?.label).toBe('Tissu');
		expect(fabric?.terms.map((term) => term.label)).toEqual(['', 'Cotton', 'Soie']);
	});

	it('builds every filter and gives a ticked facet its own count', async () => {
		const own = { facetDistribution: { facetValues: { [cotton]: 4, [silk]: 2 } } };
		const { listing, multiSearch } = build([main, everything, own]);
		const page = await listing.page(
			query({
				filters: filters({
					priceRanges: [
						{ min: 0, max: 1000 },
						{ min: 20000, max: null },
					],
					minRating: 4,
					categoryIds: ['c1', 'c2'],
					attributes: new Map([['fabric', new Set(['silk', 'cotton'])]]),
				}),
				sort: 'low-high',
				locale: 'en',
			}),
		);
		const [first, , perFacet] = sent(multiSearch);
		expect(first?.filter).toEqual([
			'((maxINR >= 0 AND minINR <= 1000) OR maxINR >= 20000)',
			'rating >= 4',
			'categoryIds IN ["c1", "c2"]',
			'terms IN ["fabric:silk", "fabric:cotton"]',
		]);
		expect(perFacet?.filter).toHaveLength(3);
		expect(first?.sort).toEqual(['minINR:asc', 'idOrder:asc']);
		expect(page.facets.find((row) => row.code === 'fabric')?.terms).toEqual([
			{ code: 'cotton', label: 'Cotton', count: 4 },
			{ code: 'silk', label: 'Silk', count: 2 },
		]);
	});

	it.each([
		['asc', ['idOrder:asc']],
		['desc', ['idOrder:desc']],
		['high-low', ['minINR:desc', 'idOrder:asc']],
		['a-z', ['titleOrder.fr:asc', 'idOrder:asc']],
		['z-a', ['titleOrder.fr:desc', 'idOrder:desc']],
		['discount-high-low', ['percentOff:desc', 'idOrder:asc']],
	] as const)('sorts by %s', async (sort, expected) => {
		const { listing, multiSearch } = build([{}, {}]);
		const page = await listing.page(query({ sort, locale: 'fr' }));
		expect(sent(multiSearch)[0]?.sort).toEqual(expected);
		expect(page).toEqual({ productIds: [], total: 0, facets: [] });
	});

	it('reads answers with no distribution at all', async () => {
		const { listing } = build([{ hits: [{ id: 'a' }] }, { facetDistribution: { filterCodes: { fabric: 1 } } }]);
		expect((await listing.page(query())).facets).toEqual([]);
		const noCounts = build([{}, everything]).listing;
		const page = await noCounts.page(query());
		expect(page.facets[0]?.terms[0]?.count).toBe(0);
	});

	it('merges one term stored under two label spellings', async () => {
		const other = facet('fabric', 'silk', { en: 'Pure Silk' }, { en: 'Fabric' });
		const { listing } = build([
			{ facetDistribution: { facetValues: { [silk]: 2, [other]: 1 } } },
			{ facetDistribution: { facetValues: { [silk]: 2, [other]: 1 }, filterCodes: { fabric: 3 } } },
		]);
		const [fabric] = (await listing.page(query())).facets;
		expect(fabric?.terms).toEqual([{ code: 'silk', label: 'Silk', count: 3 }]);
	});
});

describe('MeilisearchSearch as the listing client', () => {
	const fetcher = vi.fn();
	const reply = (status: number, body?: unknown) =>
		({ ok: status < 400, status, json: async () => body }) as unknown as Response;
	const search = () => new MeilisearchSearch('http://meili.test', 'k', async () => [], 'products', ['en', 'fr']);
	const entry = { product: product(), variants: [] as ProductVariant[] };

	beforeEach(() => {
		fetcher.mockReset();
		vi.stubGlobal('fetch', fetcher);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('runs a multi-search, and takes an empty answer', async () => {
		fetcher.mockResolvedValueOnce(reply(200, { results: [{ a: 1 }] }));
		await expect(search().multiSearch([{ q: '' }])).resolves.toEqual([{ a: 1 }]);
		fetcher.mockResolvedValueOnce(reply(200, {}));
		await expect(search().multiSearch([])).resolves.toEqual([]);
	});

	it('replaces the index in batches and waits for the last task', async () => {
		let uid = 0;
		fetcher.mockImplementation(async (url: string) => {
			if (url.includes('/tasks/')) return reply(200, { status: uid > 0 ? 'succeeded' : 'enqueued' });
			uid += 1;
			return reply(202, { taskUid: uid });
		});
		await search().replaceIndex(Array.from({ length: 501 }, () => entry));
		const posts = fetcher.mock.calls.filter((call) => call[1].method === 'POST');
		expect(posts).toHaveLength(2);
		expect(fetcher.mock.calls.at(-1)?.[0]).toBe(`http://meili.test/tasks/${uid}`);
		expect(fetcher.mock.calls.some((call) => call[1].method === 'DELETE')).toBe(true);
	});

	it('polls a task still running', async () => {
		let polls = 0;
		fetcher.mockImplementation(async (url: string) => {
			if (!url.includes('/tasks/')) return reply(202, { taskUid: 1 });
			polls += 1;
			return reply(200, { status: polls > 1 ? 'succeeded' : 'processing' });
		});
		await search().replaceIndex([]);
		expect(polls).toBeGreaterThan(1);
	});

	it('fails when a task fails or never finishes', async () => {
		fetcher.mockImplementation(async (url: string) =>
			reply(200, url.includes('/tasks/') ? { status: 'failed' } : { taskUid: 1 }),
		);
		await expect(search().replaceIndex([])).rejects.toBeInstanceOf(SearchUnavailableError);
		fetcher.mockImplementation(async (url: string) =>
			reply(200, url.includes('/tasks/') ? { status: 'canceled' } : { taskUid: 1 }),
		);
		await expect(search().replaceIndex([])).rejects.toThrow('did not finish');
		const start = Date.now();
		vi.spyOn(Date, 'now')
			.mockReturnValueOnce(start)
			.mockReturnValue(start + 120_000);
		fetcher.mockImplementation(async () => reply(200, { taskUid: 1 }));
		await expect(search().replaceIndex([])).rejects.toThrow('did not finish');
		vi.restoreAllMocks();
	});
});
