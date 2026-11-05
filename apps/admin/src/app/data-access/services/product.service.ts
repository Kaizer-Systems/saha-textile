import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import {
	CatalogProductDetail,
	CatalogProductList,
	CatalogProductWrite,
	CatalogReplacementTarget,
} from '@data-access/interfaces/catalog-product.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { IProductModel } from '@data-access/interfaces/product.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class ProductService {
	private http = inject(HttpClient);

	getProducts(payload?: Params): Observable<IProductModel> {
		return this.http.get<IProductModel>(`${environment.URL}/product.json`, { params: payload });
	}

	/** The catalogue as the API holds it, every status, for the product list and its pickers. */
	getCatalogProducts(query: { search?: string; page?: number; pageSize?: number }): Observable<CatalogProductList> {
		const params: Record<string, string> = {};
		if (query.search) params['search'] = query.search;
		if (query.page) params['page'] = String(query.page);
		if (query.pageSize) params['pageSize'] = String(query.pageSize);
		return this.http.get<CatalogProductList>(`${environment.apiUrl}/admin/catalog/products`, { params });
	}

	getCatalogProduct(idOrSlug: string): Observable<CatalogProductDetail> {
		return this.http.get<CatalogProductDetail>(
			`${environment.apiUrl}/admin/catalog/products/${encodeURIComponent(idOrSlug)}`,
		);
	}

	getReplacementTargets(): Observable<CatalogReplacementTarget[]> {
		return this.http.get<CatalogReplacementTarget[]>(
			`${environment.apiUrl}/admin/catalog/products/replacement-targets`,
		);
	}

	saveCatalogProduct(idOrSlug: string, body: CatalogProductWrite): Observable<{ id: string; slug: string }> {
		return this.http.post<{ id: string; slug: string }>(
			`${environment.apiUrl}/admin/catalog/products/${encodeURIComponent(idOrSlug)}`,
			body,
		);
	}

	discontinueCatalogProduct(idOrSlug: string, replacementPath: string | null) {
		return this.http.post<{ slug: string; statusCode: number; targetPath: string | null }>(
			`${environment.apiUrl}/admin/catalog/products/${encodeURIComponent(idOrSlug)}/discontinue`,
			{ replacementPath },
		);
	}
}
