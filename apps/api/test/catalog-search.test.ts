import { ServiceUnavailableException } from '@nestjs/common';
import { CatalogCard } from '@saha-textile/contracts';
import { SearchUnavailableError, type SearchAnalyticsRepository, type SearchPort } from '@saha-textile/core-domain';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { withCatalogLocale } from '../src/catalog/catalog-locale';
import type { CatalogPublicService } from '../src/catalog/catalog-public.service';
import type { CatalogRateLimit } from '../src/catalog/catalog-rate-limit';
import { CatalogSearchController } from '../src/catalog/catalog-search.controller';
import { SearchInsightsService } from '../src/catalog/search-insights.service';

const request = { ip: '127.0.0.1' } as FastifyRequest;
const now = new Date('2026-11-08T06:00:00Z');

const card = (id: string, inStock = true): CatalogCard =>
	CatalogCard.parse({
		id,
		slug: id.replace(/_/g, '-'),
		title: id,
		path: `/product/${id}`,
		price: { kind: 'single', sellingINR: 4200, mrpINR: null, percentOff: null },
		badges: [],
		sku: null,
		image: null,
		inStock,
		madeToOrder: false,
	});

const query = (q: string, extra: Partial<{ page: number; source: 'page' | 'typeahead' }> = {}) => ({
	q,
	page: 1,
	pageSize: 24,
	source: 'typeahead' as const,
	...extra,
});

function setup(options: { search?: SearchPort['search']; cards?: CatalogCard[] } = {}) {
	const limits = { enforce: vi.fn().mockResolvedValue(undefined) };
	const search = vi.fn(
		options.search ?? (async () => ({ items: [{ id: 'prd_silk' }], total: 31, page: 1, pageSize: 24 })),
	);
	const cardsForIds = vi.fn(async (ids: readonly string[]) =>
		(options.cards ?? [card('prd_silk')]).filter((row) => ids.includes(row.id)),
	);
	const home = vi.fn(async () => ({ bestsellers: [card('best_1'), card('best_2'), card('sold_out', false)] }));
	const analytics = {
		recordQuery: vi.fn(async () => undefined),
		recordResultClick: vi.fn(async () => undefined),
		listProductClicks: vi.fn(async () => [] as Awaited<ReturnType<SearchAnalyticsRepository['listProductClicks']>>),
	};
	const products = { findById: vi.fn(async (id: string) => (id === 'missing' ? null : { id })) };
	const catalog = { cardsForIds, home } as unknown as CatalogPublicService;
	const insights = new SearchInsightsService(analytics, products as never, catalog);
	const controller = new CatalogSearchController(
		{ search } as unknown as SearchPort,
		catalog,
		limits as unknown as CatalogRateLimit,
		insights,
	);
	return { controller, insights, search, cardsForIds, analytics, products, limits };
}

describe('catalogue search', () => {
	it('answers one page of full cards, so results carry their real price and photo', async () => {
		const { controller, search, cardsForIds } = setup();
		await expect(controller.searchProducts(query('silk', { page: 2 }), request)).resolves.toEqual({
			items: [card('prd_silk')],
			total: 31,
			page: 2,
			pageSize: 24,
		});
		expect(search).toHaveBeenCalledWith({ q: 'silk', page: 2, pageSize: 24 });
		expect(cardsForIds).toHaveBeenCalledWith(['prd_silk']);
	});

	it('narrows to one category when asked', async () => {
		const { controller, search } = setup();
		await controller.searchProducts({ ...query('silk'), categoryId: 'cat_sarees' }, request);
		expect(search).toHaveBeenCalledWith({ q: 'silk', categoryId: 'cat_sarees', page: 1, pageSize: 24 });
	});

	it('counts a committed search once, on its first page, in the request language', async () => {
		const { controller, analytics } = setup();
		await withCatalogLocale('bn', () =>
			controller.searchProducts(query('  Red Silk ', { source: 'page' }), request),
		);
		expect(analytics.recordQuery).toHaveBeenCalledWith(
			expect.objectContaining({ normalizedQuery: 'red silk', locale: 'bn', resultCount: 31 }),
		);
		await controller.searchProducts(query('red silk', { source: 'page', page: 2 }), request);
		await controller.searchProducts(query('red silk'), request);
		expect(analytics.recordQuery).toHaveBeenCalledTimes(1);
	});

	it('still answers when the count cannot be saved', async () => {
		const { controller, analytics } = setup();
		analytics.recordQuery.mockRejectedValueOnce(new Error('mongo down'));
		await expect(controller.searchProducts(query('silk', { source: 'page' }), request)).resolves.toMatchObject({
			total: 31,
		});
	});

	it('says 503 when the index cannot be reached, and never falls back to Mongo', async () => {
		const { controller } = setup({
			search: async () => {
				throw new SearchUnavailableError('Search is not configured');
			},
		});
		await expect(controller.searchProducts(query('silk'), request)).rejects.toBeInstanceOf(
			ServiceUnavailableException,
		);
	});

	it('passes other failures through', async () => {
		const { controller } = setup({
			search: async () => {
				throw new Error('bug');
			},
		});
		await expect(controller.searchProducts(query('silk'), request)).rejects.toThrow('bug');
	});
});

describe('search result clicks', () => {
	it('counts a click on a live product under its own rate limit', async () => {
		const { controller, analytics, limits } = setup();
		await controller.recordClick({ q: 'Jamdani', productId: 'prd_1' }, request);
		expect(limits.enforce).toHaveBeenCalledWith('search_click', { ip: '127.0.0.1' });
		expect(analytics.recordResultClick).toHaveBeenCalledWith(
			expect.objectContaining({ normalizedQuery: 'jamdani', locale: 'en', productId: 'prd_1' }),
		);
	});

	it('ignores unknown products, empty words and storage faults', async () => {
		const { controller, insights, analytics } = setup();
		await controller.recordClick({ q: 'silk', productId: 'missing' }, request);
		await insights.recordClick('   ', 'prd_1');
		await insights.recordSearch('   ', 3);
		expect(analytics.recordResultClick).not.toHaveBeenCalled();
		expect(analytics.recordQuery).not.toHaveBeenCalled();
		analytics.recordResultClick.mockRejectedValueOnce(new Error('mongo down'));
		await expect(insights.recordClick('silk', 'prd_1')).resolves.toBeUndefined();
	});
});

describe('trending', () => {
	const clicks = (ids: string[]) =>
		ids.map((productId, index) => ({ productId, date: '2026-11-08', clicks: 10 - index }));

	it('ranks products by recent search clicks once at least four can be bought', async () => {
		const cards = ['a', 'b', 'c', 'd', 'e'].map((id) => card(id, id !== 'c'));
		const { insights, analytics } = setup({ cards });
		analytics.listProductClicks.mockResolvedValue(clicks(['a', 'b', 'c', 'd', 'e']));
		const result = await insights.trending(6, now);
		expect(result.kind).toBe('trending');
		expect(result.items.map((row) => row.id)).toEqual(['a', 'b', 'd', 'e']);
		expect(analytics.listProductClicks).toHaveBeenCalledWith({ fromDate: '2026-10-26', toDate: '2026-11-08' });
	});

	it('shows buyable bestsellers as Popular until there is enough data', async () => {
		const { controller, analytics } = setup();
		analytics.listProductClicks.mockResolvedValue(clicks(['prd_silk']));
		await expect(controller.trending({ limit: 6 }, request)).resolves.toEqual({
			kind: 'popular',
			items: [card('best_1'), card('best_2')],
		});
	});

	it('caches each language for five minutes and trims to the asked length', async () => {
		const cards = ['a', 'b', 'c', 'd'].map((id) => card(id));
		const { insights, analytics } = setup({ cards });
		analytics.listProductClicks.mockResolvedValue(clicks(['a', 'b', 'c', 'd']));
		expect((await insights.trending(2, now)).items).toHaveLength(2);
		await insights.trending(6, new Date(now.getTime() + 60_000));
		expect(analytics.listProductClicks).toHaveBeenCalledTimes(1);
		await withCatalogLocale('bn', () => insights.trending(6, now));
		await insights.trending(6, new Date(now.getTime() + 6 * 60_000));
		expect(analytics.listProductClicks).toHaveBeenCalledTimes(3);
	});
});

describe('trending beside a product', () => {
	const clicks = (ids: string[]) =>
		ids.map((productId, index) => ({ productId, date: '2026-11-08', clicks: 10 - index }));

	/** Products in `cat_saree` unless named in `elsewhere`; the page's own product is `self`. */
	const build = (elsewhere: string[] = []) => {
		const all = ['self', 'a', 'b', 'c', 'd', 'e', 'best', 'new', 'x'];
		const cards = all.map((id) => card(id, id !== 'e'));
		const parts = setup({ cards });
		// The real read keeps the order of the ids it was given.
		parts.cardsForIds.mockImplementation(async (ids: readonly string[]) =>
			ids.flatMap((id) => cards.filter((row) => row.id === id)),
		);
		const row = (id: string) => ({ id, categoryIds: elsewhere.includes(id) ? ['cat_other'] : ['cat_saree'] });
		const products = parts.products as unknown as Record<string, ReturnType<typeof vi.fn>>;
		products['findById'] = vi.fn(async (id: string) => (id === 'missing' ? null : row(id)));
		products['findBySlug'] = vi.fn(async (slug: string) => (slug === 'gone' ? null : row('self')));
		products['list'] = vi.fn(async (filter: { insight?: string }) => ({
			items: (filter.insight ? ['self', 'best', 'a'] : ['new', 'self']).map(row),
			total: 3,
			page: 1,
			pageSize: 13,
		}));
		return { ...parts, productsMock: products };
	};

	it('ranks same-category clicks first, then bestsellers and newest, never itself', async () => {
		const { insights, analytics, productsMock } = build(['x']);
		analytics.listProductClicks.mockResolvedValue(clicks(['self', 'x', 'a', 'b', 'c', 'd', 'e', 'missing']));
		const result = await insights.trendingFor('red', 6, now);
		expect(result.kind).toBe('trending');
		expect(result.items.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd', 'best', 'new']);
		expect(productsMock['list']).toHaveBeenCalledWith(
			expect.objectContaining({ audience: 'public', categoryIds: ['cat_saree'], insight: 'bestseller' }),
		);
	});

	it('fills from the category as Popular when few clicks match, and is empty for an unknown product', async () => {
		const { insights } = build();
		const result = await insights.trendingFor('red', 6, now);
		expect(result).toEqual({ kind: 'popular', items: [card('best'), card('a'), card('new')] });
		expect(await insights.trendingFor('gone', 6, now)).toEqual({ kind: 'popular', items: [] });
	});

	it('caches each product and language for five minutes, trimmed to the asked length', async () => {
		const { insights, analytics } = build();
		expect((await insights.trendingFor('red', 1, now)).items).toHaveLength(1);
		expect((await insights.trendingFor('red', 6, new Date(now.getTime() + 60_000))).items).toHaveLength(3);
		expect(analytics.listProductClicks).toHaveBeenCalledTimes(1);
		await withCatalogLocale('bn', () => insights.trendingFor('red', 6, now));
		await insights.trendingFor('red', 6, new Date(now.getTime() + 6 * 60_000));
		expect(analytics.listProductClicks).toHaveBeenCalledTimes(3);
	});

	it('needs no bestsellers or newest pieces once clicks fill the list', async () => {
		const many = Array.from({ length: 14 }, (_, index) => `c${index}`);
		const cards = many.map((id) => card(id));
		const parts = setup({ cards });
		parts.cardsForIds.mockImplementation(async (ids: readonly string[]) =>
			ids.flatMap((id) => cards.filter((row) => row.id === id)),
		);
		const products = parts.products as unknown as Record<string, ReturnType<typeof vi.fn>>;
		products['findById'] = vi.fn(async (id: string) => ({ id, categoryIds: ['cat_saree'] }));
		products['findBySlug'] = vi.fn(async () => ({ id: 'self', categoryIds: ['cat_saree'] }));
		products['list'] = vi.fn();
		parts.analytics.listProductClicks.mockResolvedValue(
			many.map((productId, index) => ({ productId, date: '2026-11-08', clicks: 30 - index })),
		);
		const result = await parts.insights.trendingFor('red', 20, now);
		expect(result).toMatchObject({ kind: 'trending' });
		expect(result.items).toHaveLength(12);
		expect(products['list']).not.toHaveBeenCalled();
	});

	it('keeps the cache bounded', async () => {
		const { insights } = build();
		for (let index = 0; index < 501; index += 1) await insights.trendingFor(`p${index}`, 1, now);
		const cache = (insights as unknown as { productCache: Map<string, unknown> }).productCache;
		expect(cache.size).toBe(500);
		expect(cache.has('en:p0')).toBe(false);
	});
});
