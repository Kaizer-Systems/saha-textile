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

/**
 * Search counts and Trending. Recording never fails a shopper's request: a lost count is
 * acceptable, a broken search box is not.
 */
@Injectable()
export class SearchInsightsService {
	private readonly logger = new Logger(SearchInsightsService.name);
	private readonly cache = new Map<string, { at: number; value: CatalogSearchTrending }>();

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
