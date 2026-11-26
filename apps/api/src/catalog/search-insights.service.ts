import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CatalogCard, CatalogSearchTrending } from '@saha-textile/contracts';
import {
	TRENDING_MIN_PRODUCTS,
	normalizeSearchQuery,
	rankTrending,
	trendingRange,
	type ProductRepository,
	type SearchAnalyticsRepository,
} from '@saha-textile/core-domain';

import { PRODUCT_REPOSITORY, SEARCH_ANALYTICS_REPOSITORY } from '../infra/tokens';
import { catalogLocale } from './catalog-locale';
import { CatalogPublicService } from './catalog-public.service';

/** Trending changes slowly, and every shopper opening the box would otherwise rank it again. */
const TRENDING_TTL_MS = 5 * 60 * 1000;
/** Enough candidates that sold-out or hidden products can drop out and still fill the list. */
const CANDIDATES = 24;
const MAX_ITEMS = 12;
/** Product pages each keep their own list; past this many the oldest entries make room. */
const PRODUCT_CACHE_LIMIT = 500;

/**
 * Search counts and Trending. Recording never fails a shopper's request: a lost count is
 * acceptable, a broken search box is not.
 */
@Injectable()
export class SearchInsightsService {
	private readonly logger = new Logger(SearchInsightsService.name);
	private readonly cache = new Map<string, { at: number; value: CatalogSearchTrending }>();
	private readonly productCache = new Map<string, { at: number; value: CatalogSearchTrending }>();

	constructor(
		@Inject(SEARCH_ANALYTICS_REPOSITORY) private readonly analytics: SearchAnalyticsRepository,
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		private readonly catalog: CatalogPublicService,
	) {}

	/** Counts a committed search. Empty words are not a search. */
	async recordSearch(q: string, resultCount: number, now = new Date()): Promise<void> {
		const normalizedQuery = normalizeSearchQuery(q);
		if (!normalizedQuery) return;
		try {
			await this.analytics.recordQuery({ normalizedQuery, locale: catalogLocale(), resultCount, at: now });
		} catch (error) {
			this.logger.warn(`search count not saved: ${(error as Error).message}`);
		}
	}

	/** Counts a result click on a product that is on sale; anything else is ignored. */
	async recordClick(q: string, productId: string, now = new Date()): Promise<void> {
		const normalizedQuery = normalizeSearchQuery(q);
		if (!normalizedQuery) return;
		const product = await this.products.findById(productId, 'public');
		if (!product) return;
		try {
			await this.analytics.recordResultClick({ normalizedQuery, locale: catalogLocale(), productId, at: now });
		} catch (error) {
			this.logger.warn(`search click not saved: ${(error as Error).message}`);
		}
	}

	/** The most opened products from search, or bestsellers as Popular until enough exist. */
	async trending(limit: number, now = new Date()): Promise<CatalogSearchTrending> {
		const locale = catalogLocale();
		const hit = this.cache.get(locale);
		const full = hit && now.getTime() - hit.at < TRENDING_TTL_MS ? hit.value : await this.rank(locale, now);
		return { kind: full.kind, items: full.items.slice(0, limit) };
	}

	/**
	 * "Trending" beside one product: products opened from search lately that share one of its
	 * categories, then that category's bestsellers, then its newest pieces, so every product page
	 * has a full list. Never the product itself, and only products on sale.
	 */
	async trendingFor(slug: string, limit: number, now = new Date()): Promise<CatalogSearchTrending> {
		const key = `${catalogLocale()}:${slug}`;
		const hit = this.productCache.get(key);
		if (hit && now.getTime() - hit.at < TRENDING_TTL_MS)
			return { ...hit.value, items: hit.value.items.slice(0, limit) };
		const product = await this.products.findBySlug(slug, 'public');
		if (!product) return { kind: 'popular', items: [] };
		const categories = new Set(product.categoryIds);
		const ranked = rankTrending(await this.analytics.listProductClicks(trendingRange(now)), now)
			.map((row) => row.productId)
			.filter((id) => id !== product.id)
			.slice(0, CANDIDATES);
		const clicked = (await Promise.all(ranked.map((id) => this.products.findById(id, 'public'))))
			.filter((row) => row !== null && row.categoryIds.some((id) => categories.has(id)))
			.map((row) => row!.id);
		const ids = [...clicked];
		const kind: CatalogSearchTrending['kind'] = clicked.length >= TRENDING_MIN_PRODUCTS ? 'trending' : 'popular';
		for (const insight of ['bestseller', undefined] as const) {
			if (ids.length >= MAX_ITEMS) break;
			const page = await this.products.list({
				audience: 'public',
				page: 1,
				pageSize: MAX_ITEMS + 1,
				categoryIds: [...categories],
				...(insight ? { insight } : {}),
			});
			for (const row of page.items) if (row.id !== product.id && !ids.includes(row.id)) ids.push(row.id);
		}
		const items = (await this.catalog.cardsForIds(ids.slice(0, MAX_ITEMS * 2))).filter(buyable).slice(0, MAX_ITEMS);
		const value: CatalogSearchTrending = { kind, items };
		// A Map keeps insertion order, so its first key is the oldest entry.
		if (this.productCache.size >= PRODUCT_CACHE_LIMIT)
			this.productCache.delete(this.productCache.keys().next().value as string);
		this.productCache.set(key, { at: now.getTime(), value });
		return { kind, items: items.slice(0, limit) };
	}

	private async rank(locale: string, now: Date): Promise<CatalogSearchTrending> {
		const ranked = rankTrending(await this.analytics.listProductClicks(trendingRange(now)), now);
		const cards = (await this.catalog.cardsForIds(ranked.slice(0, CANDIDATES).map((row) => row.productId)))
			.filter(buyable)
			.slice(0, MAX_ITEMS);
		const value: CatalogSearchTrending =
			cards.length >= TRENDING_MIN_PRODUCTS
				? { kind: 'trending', items: cards }
				: {
						kind: 'popular',
						items: (await this.catalog.home()).bestsellers.filter(buyable).slice(0, MAX_ITEMS),
					};
		this.cache.set(locale, { at: now.getTime(), value });
		return value;
	}
}

const buyable = (card: CatalogCard) => card.inStock || card.madeToOrder;
