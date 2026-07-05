import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { Params } from '@data-access/interfaces/core.interface';
import { IOrderModel } from '@data-access/interfaces/order.interface';

@Injectable({
	providedIn: 'root',
})
export class OrderService {
	private http = inject(HttpClient);

	getOrders(payload?: Params): Observable<IOrderModel> {
		return this.http.get<IOrderModel>(`${environment.URL}/order.json`, { params: payload });
	}
}
