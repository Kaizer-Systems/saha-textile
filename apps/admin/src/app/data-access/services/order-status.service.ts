import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { Params } from '@data-access/interfaces/core.interface';
import { IOrderStatusModel } from '@data-access/interfaces/order-status.interface';

@Injectable({
	providedIn: 'root',
})
export class OrderStatusService {
	private http = inject(HttpClient);

	getOrderStatus(payload?: Params): Observable<IOrderStatusModel> {
		return this.http.get<IOrderStatusModel>(`${environment.URL}/order-status.json`, {
			params: payload,
		});
	}
}
