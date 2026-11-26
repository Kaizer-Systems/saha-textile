import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../../public/environments/environment';

import type {
	AdminProductList,
	BundleBuilderView,
	BundleDetailsWrite,
	BundleDraftResponse,
	BundlePriceMethod,
	BundlePriceMethodRow,
	BundlePriceMethodWrite,
	PreviewCodeResponse,
	ProductBundleWrite,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

const products = `${environment.apiUrl}/admin/catalog/products`;
const methods = `${environment.apiUrl}/admin/catalog/bundle-price-methods`;
const id = (value: string) => encodeURIComponent(value);

/** The bundle builder's calls (bundle builder brief, approved 2026-11-22). */
@Injectable({ providedIn: 'root' })
export class BundleService {
	private readonly http = inject(HttpClient);

	/** Products › Bundles: bundles only, with their levels, set price and worked-out stock. */
	list(query: { search?: string; page?: number; pageSize?: number }): Observable<AdminProductList> {
		const params: Record<string, string> = { type: 'bundle' };
		if (query.search) params['search'] = query.search;
		if (query.page) params['page'] = String(query.page);
		if (query.pageSize) params['pageSize'] = String(query.pageSize);
		return this.http.get<AdminProductList>(products, { params });
	}

	builder(productId: string): Observable<BundleBuilderView> {
		return this.http.get<BundleBuilderView>(`${products}/${id(productId)}/bundle/builder`);
	}

	draft(productId: string, body: ProductBundleWrite): Observable<BundleDraftResponse> {
		return this.http.post<BundleDraftResponse>(`${products}/${id(productId)}/bundle/draft`, body);
	}

	build(productId: string, body: ProductBundleWrite): Observable<BundleBuilderView> {
		return this.http.put<BundleBuilderView>(`${products}/${id(productId)}/bundle/build`, body);
	}

	details(productId: string, body: BundleDetailsWrite): Observable<{ id: string; slug: string }> {
		return this.http.put<{ id: string; slug: string }>(`${products}/${id(productId)}/bundle/details`, body);
	}

	/** A one-time code for the builder's shop preview (/__preview/bundle). */
	previewCode(productId: string): Observable<PreviewCodeResponse> {
		return this.http.post<PreviewCodeResponse>(
			`${environment.apiUrl}/admin/page-builder/bundles/${id(productId)}/preview-code`,
			{},
		);
	}

	methods(): Observable<BundlePriceMethodRow[]> {
		return this.http.get<BundlePriceMethodRow[]>(methods);
	}

	method(methodId: string): Observable<BundlePriceMethodRow> {
		return this.http.get<BundlePriceMethodRow>(`${methods}/${id(methodId)}`);
	}

	createMethod(body: BundlePriceMethodWrite): Observable<BundlePriceMethod> {
		return this.http.post<BundlePriceMethod>(methods, body);
	}

	updateMethod(methodId: string, body: BundlePriceMethodWrite): Observable<BundlePriceMethod> {
		return this.http.put<BundlePriceMethod>(`${methods}/${id(methodId)}`, body);
	}

	deleteMethod(methodId: string): Observable<void> {
		return this.http.delete<void>(`${methods}/${id(methodId)}`);
	}
}
