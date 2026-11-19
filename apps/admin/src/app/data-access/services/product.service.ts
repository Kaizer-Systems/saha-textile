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

import type {
	GoLiveResult,
	ProductBulkResult,
	ProductBundle,
	ProductBundleWrite,
	ProductCreate,
	ProductSaleResult,
	ProductSaleWrite,
} from '@saha-textile/contracts';

/** The product list's bulk actions, by their API path (product bulk actions brief, 2026-11-19). */
export type ProductBulkAction = 'go-live' | 'take-off' | 'discontinue' | 'duplicate' | 'delete';

@Injectable({
	providedIn: 'root',
})
export class ProductService {
	private http = inject(HttpClient);

	getProducts(payload?: Params): Observable<IProductModel> {
		return this.http.get<IProductModel>(`${environment.URL}/product.json`, { params: payload });
	}

	/** The catalogue as the API holds it, every status, for the product list and its pickers. */
	getCatalogProducts(query: {
		search?: string;
		page?: number;
		pageSize?: number;
		missing?: string | null;
	}): Observable<CatalogProductList> {
		const params: Record<string, string> = {};
		if (query.search) params['search'] = query.search;
		if (query.missing) params['missing'] = query.missing;
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

	createCatalogProduct(body: ProductCreate): Observable<{ id: string; slug: string }> {
		return this.http.post<{ id: string; slug: string }>(`${environment.apiUrl}/admin/catalog/products`, body);
	}

	/** The one check behind Go Live, for the form and the list. */
	goLive(idOrSlug: string): Observable<GoLiveResult> {
		return this.http.post<GoLiveResult>(
			`${environment.apiUrl}/admin/catalog/products/${encodeURIComponent(idOrSlug)}/go-live`,
			{},
		);
	}

	getBundle(idOrSlug: string): Observable<ProductBundle | null> {
		return this.http.get<ProductBundle | null>(
			`${environment.apiUrl}/admin/catalog/products/${encodeURIComponent(idOrSlug)}/bundle`,
		);
	}

	saveBundle(idOrSlug: string, body: ProductBundleWrite): Observable<ProductBundle> {
		return this.http.post<ProductBundle>(
			`${environment.apiUrl}/admin/catalog/products/${encodeURIComponent(idOrSlug)}/bundle`,
			body,
		);
	}

	/** One bulk action for up to 200 products; `dryRun` says what would happen and changes nothing. */
	bulk(
		action: ProductBulkAction,
		ids: readonly string[],
		dryRun: boolean,
		replacementPath: string | null = null,
	): Observable<ProductBulkResult> {
		return this.http.post<ProductBulkResult>(`${environment.apiUrl}/admin/catalog/products/bulk/${action}`, {
			ids,
			dryRun,
			...(action === 'discontinue' ? { replacementPath } : {}),
		});
	}

	/** Put on sale: products join a sale that has not ended, or a new draft sale. */
	addToSale(body: ProductSaleWrite): Observable<ProductSaleResult> {
		return this.http.post<ProductSaleResult>(`${environment.apiUrl}/admin/events/sale-products`, body);
	}

	discontinueCatalogProduct(idOrSlug: string, replacementPath: string | null) {
		return this.http.post<{ slug: string; statusCode: number; targetPath: string | null }>(
			`${environment.apiUrl}/admin/catalog/products/${encodeURIComponent(idOrSlug)}/discontinue`,
			{ replacementPath },
		);
	}
}
