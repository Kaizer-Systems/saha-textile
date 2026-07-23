import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { ICatalogResponse } from '@data-access/interfaces/catalog.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { IProductModel } from '@data-access/interfaces/product.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class ProductService {
	private http = inject(HttpClient);

	public skeletonLoader: boolean = false;

	/** Raw full list (mock JSON) — still used by the PDP/related/deal readers that filter by id/slug. */
	getProducts(payload?: Params): Observable<IProductModel> {
		return this.http.get<IProductModel>(`${environment.URL}/product.json`, { params: payload });
	}

	/**
	 * Category-listing catalog (Pass A) — hits the Nitro route that filters/sorts/
	 * paginates server-side and returns a lean 25-card slice + disjunctive facets.
	 * `params` carries category, page, limit, sortBy, rating, price_min/max and any
	 * attribute facet (fabric/color/occasion/work) as comma-joined values.
	 */
	getCatalog(payload?: Params): Observable<ICatalogResponse> {
		return this.http.get<ICatalogResponse>(`${environment.baseURL}api/products`, { params: payload });
	}
}
