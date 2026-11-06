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

@Injectable({
	providedIn: 'root',
})
export class ProductService {
	private http = inject(HttpClient);

	public skeletonLoader: boolean = false;

	/**
	 * Category-listing catalog (Pass A) — hits the Nitro route that filters/sorts/
	 * paginates server-side and returns a lean 25-card slice + disjunctive facets.
	 * `params` carries category, page, limit, sortBy, rating, price_min/max and any
	 * attribute facet (fabric/color/occasion/work) as comma-joined values.
	 */
	getCatalog(payload?: Params): Observable<ICatalogResponse> {
		const path = String(payload?.['category'] ?? '');
		const reserved = new Set(['page', 'limit', 'category', 'sortBy', 'rating', 'price_min', 'price_max']);
		const attribute = Object.entries(payload ?? {})
			.filter(([key, value]) => !reserved.has(key) && value)
			.map(([key, value]) => `${key}:${value}`)
			.join('|');
		return this.http
			.get<ApiPlacement>(`${environment.apiUrl}/catalog/placements`, {
				context: backgroundRequest(),
				params: {
					path,
					page: payload?.['page'] ?? 1,
					pageSize: payload?.['limit'] ?? 24,
					...(attribute ? { attribute } : {}),
				},
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

	search(term: string): Observable<IProduct[]> {
		return this.http
			.get<{ items: Array<{ id: string; slug: string; title: string }> }>(
				`${environment.apiUrl}/catalog/search`,
				{
					context: backgroundRequest(),
					params: { q: term },
				},
			)
			.pipe(
				map((page) =>
					page.items.map(
						(item) =>
							({
								id: 0,
								name: item.title,
								slug: item.slug,
								price: 0,
								sale_price: 0,
								stock_status: 'in_stock',
								product_thumbnail: undefined,
							}) as unknown as IProduct,
					),
				),
			);
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
