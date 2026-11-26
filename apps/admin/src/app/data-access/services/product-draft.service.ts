import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';

import type { ProductDraft, ProductDraftList, ProductDraftWrite } from '@saha-textile/contracts';

/** Products › Drafts: unfinished product-form work, kept apart from products (brief § 7). */
@Injectable({ providedIn: 'root' })
export class ProductDraftService {
	private http = inject(HttpClient);
	private base = (path = '') => `${environment.apiUrl}/admin/catalog/product-drafts${path}`;

	list(query: {
		scope: 'mine' | 'everyone';
		productId?: string;
		search?: string;
		page?: number;
		pageSize?: number;
	}): Observable<ProductDraftList> {
		const params: Record<string, string> = { scope: query.scope };
		if (query.productId) params['productId'] = query.productId;
		if (query.search?.trim()) params['search'] = query.search.trim();
		if (query.page) params['page'] = String(query.page);
		if (query.pageSize) params['pageSize'] = String(query.pageSize);
		return this.http.get<ProductDraftList>(this.base(), { params });
	}

	get(id: string): Observable<ProductDraft> {
		return this.http.get<ProductDraft>(this.base(`/${encodeURIComponent(id)}`));
	}

	/** Saves the form as it is, with no checks; a known id saves over that draft. */
	save(id: string | null, body: ProductDraftWrite): Observable<ProductDraft> {
		return this.http.post<ProductDraft>(this.base(id ? `/${encodeURIComponent(id)}` : ''), body);
	}

	discard(id: string): Observable<void> {
		return this.http.delete<void>(this.base(`/${encodeURIComponent(id)}`));
	}
}
