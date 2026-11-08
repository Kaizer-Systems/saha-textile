import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, map } from 'rxjs';

import {
	ApiCard,
	ApiHome,
	ApiPlacement,
	ApiProductPage,
	cardToProduct,
	galleryAttachment,
	pageToProduct,
	placementToCatalog,
} from '@core/catalog/from-api';
import { backgroundRequest } from '@core/interceptors/background-request';
import { ICatalogResponse } from '@data-access/interfaces/catalog.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { IProduct, IProductRelations, IRecentPurchase } from '@data-access/interfaces/product.interface';

import { environment } from '../../../../public/environments/environment';

export interface SearchOptions {
	page?: number;
	pageSize?: number;
	source?: 'typeahead' | 'page';
}

export interface SearchPage {
	items: IProduct[];
	total: number;
}

export interface SearchTrending {
	kind: 'trending' | 'popular';
	items: IProduct[];
}

@Injectable({
	providedIn: 'root',
})
export class ProductService {
	private http = inject(HttpClient);

	public skeletonLoader: boolean = false;

	/** One page of a listing, with its filter counts. `params` come from `toCatalogParams`. */
	getCatalog(payload?: Params): Observable<ICatalogResponse> {
		const { limit, ...params } = payload ?? {};
		return this.http
			.get<ApiPlacement>(`${environment.apiUrl}/catalog/placements`, {
				context: backgroundRequest(),
				params: { ...params, pageSize: limit ?? 24 },
			})
			.pipe(map(placementToCatalog));
	}

	home(): Observable<{ newArrivals: IProduct[]; bestsellers: IProduct[]; featured: IProduct[]; sale: IProduct[] }> {
		return this.http.get<ApiHome>(`${environment.apiUrl}/catalog/home`, { context: backgroundRequest() }).pipe(
			map((home) => ({
				newArrivals: home.newArrivals.map(cardToProduct),
				bestsellers: home.bestsellers.map(cardToProduct),
				featured: home.featured.map(cardToProduct),
				sale: home.sale.map(cardToProduct),
			})),
		);
	}

	/** Real sales from the last day. Empty until there are paid orders, which keeps the popup hidden. */
	recentPurchases(): Observable<IRecentPurchase[]> {
		return this.http
			.get<{
				items: Array<{ card: ApiCard; purchasedAt: string }>;
			}>(`${environment.apiUrl}/catalog/recent-purchases`, { context: backgroundRequest() })
			.pipe(
				map(({ items }) =>
					items.map(({ card, purchasedAt }) => ({ product: cardToProduct(card), purchasedAt })),
				),
			);
	}

	/**
	 * One page of search results. `source: 'page'` marks a search the shopper committed, which the
	 * API counts; the suggestion box sends `typeahead`, which it never counts.
	 */
	search(term: string, options: SearchOptions = {}): Observable<SearchPage> {
		const { page = 1, pageSize = 24, source = 'typeahead' } = options;
		return this.http
			.get<{ items: ApiCard[]; total: number }>(`${environment.apiUrl}/catalog/search`, {
				context: backgroundRequest(),
				params: { q: term, page, pageSize, source },
			})
			.pipe(map((body) => ({ items: body.items.map(cardToProduct), total: body.total })));
	}

	/** Counts a product opened from search. Fire and forget: a lost count never bothers the shopper. */
	searchClick(term: string, productId: string | number): void {
		this.http
			.post(
				`${environment.apiUrl}/catalog/search/clicks`,
				{ q: term, productId: String(productId) },
				{ context: backgroundRequest() },
			)
			.subscribe({ error: () => undefined });
	}

	/** Products most opened from search lately, or bestsellers as Popular until there is data. */
	trending(limit = 6): Observable<SearchTrending> {
		return this.http
			.get<{ kind: SearchTrending['kind']; items: ApiCard[] }>(`${environment.apiUrl}/catalog/search/trending`, {
				context: backgroundRequest(),
				params: { limit },
			})
			.pipe(map((body) => ({ kind: body.kind, items: body.items.map(cardToProduct) })));
	}

	/** Trending in this product's categories, topped up with their bestsellers (never the product itself). */
	trendingFor(slug: string, limit = 4): Observable<IProduct[]> {
		return this.http
			.get<{ items: ApiCard[] }>(`${environment.apiUrl}/catalog/products/${encodeURIComponent(slug)}/trending`, {
				params: { limit },
			})
			.pipe(map((body) => body.items.map(cardToProduct)));
	}

	cardsFor(slugs: string[]): Observable<IProduct[]> {
		return this.http
			.get<ApiCard[]>(`${environment.apiUrl}/catalog/cards`, {
				context: backgroundRequest(),
				params: { slug: slugs },
			})
			.pipe(map((cards) => cards.map(cardToProduct)));
	}

	/** Saved related, upsell, cross-sell and bought-together cards for one product. */
	getRelations(slug: string): Observable<IProductRelations> {
		return this.http
			.get<Record<keyof IProductRelations, ApiCard[]>>(
				`${environment.apiUrl}/catalog/products/${encodeURIComponent(slug)}/relations`,
			)
			.pipe(
				map((rows) => ({
					related: rows.related.map(cardToProduct),
					upsell: rows.upsell.map(cardToProduct),
					crossSell: rows.crossSell.map(cardToProduct),
					boughtTogether: rows.boughtTogether.map(cardToProduct),
				})),
			);
	}

	getProductPage(slug: string, variant?: string | null): Observable<IProduct> {
		return this.http
			.get<ApiProductPage>(`${environment.apiUrl}/catalog/products/${encodeURIComponent(slug)}/view`, {
				params: variant ? { variant } : {},
			})
			.pipe(map(pageToProduct));
	}

	getGallery(slug: string): Observable<IProduct['product_galleries']> {
		return this.http
			.get<{ frames: ApiProductPage['gallery'] }>(
				`${environment.apiUrl}/catalog/products/${encodeURIComponent(slug)}/gallery`,
			)
			.pipe(map((body) => body.frames.map(galleryAttachment)));
	}
}
