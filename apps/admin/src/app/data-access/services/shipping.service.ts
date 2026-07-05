import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { Params } from '@data-access/interfaces/core.interface';
import { IShipping } from '@data-access/interfaces/shipping.interface';

@Injectable({
	providedIn: 'root',
})
export class ShippingService {
	private http = inject(HttpClient);

	getShippings(payload?: Params): Observable<IShipping[]> {
		return this.http.get<IShipping[]>(`${environment.URL}/shipping.json`, { params: payload });
	}
}
