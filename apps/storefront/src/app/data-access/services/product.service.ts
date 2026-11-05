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
import { ICatalogResponse } from '@data-access/interfaces/catalog.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { IProduct, IProductModel } from '@data-access/interfaces/product.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class ProductService {
	private http = inject(HttpClient);

	public skeletonLoader: boolean = false;

	/** Raw full list (mock JSON) — still used by the PDP/related/deal readers that filter by id/slug. */
	getProducts(payload?: Params): Observable<IProductModel> {
		return this.http.get<IProductModel>(`${environment.URL}/product.json`, {
			params: payload,
			headers: { 'x-st-background': '1' },
		});
	}

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
				headers: { 'x-st-background': '1' },
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
		return this.http
			.get<ApiHome>(`${environment.apiUrl}/catalog/home`, { headers: { 'x-st-background': '1' } })
			.pipe(
				map((home) => ({
					newArrivals: home.newArrivals.map(cardToProduct),
					bestsellers: home.bestsellers.map(cardToProduct),
					featured: home.featured.map(cardToProduct),
					sale: home.sale.map(cardToProduct),
				})),
			);
	}

	search(term: string): Observable<IProduct[]> {
		return this.http
			.get<{ items: Array<{ id: string; slug: string; title: string }> }>(
				`${environment.apiUrl}/catalog/search`,
				{
					headers: { 'x-st-background': '1' },
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
				headers: { 'x-st-background': '1' },
				params: { slug: slugs },
			})
			.pipe(map((cards) => cards.map(cardToProduct)));
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
