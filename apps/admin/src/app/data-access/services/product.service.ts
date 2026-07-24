import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

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
}
