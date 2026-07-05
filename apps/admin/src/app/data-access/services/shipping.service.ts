import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, map } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { Params } from '@data-access/interfaces/core.interface';
import { IShipping, IShippingModel } from '@data-access/interfaces/shipping.interface';

@Injectable({
	providedIn: 'root',
})
export class ShippingService {
	private http = inject(HttpClient);

	getShippings(payload?: Params): Observable<IShippingModel> {
		return this.http.get<IShipping[]>(`${environment.URL}/shipping.json`, { params: payload }).pipe(
			map((data) => ({
				data,
				total: data.length,
			})),
		);
	}
}
