import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { from, Observable, switchMap } from 'rxjs';

import { runtimeConfig, runtimeConfigReady } from '@core/config/runtime-config';

import type { ShopOrderPage, ShopOrderView } from '@saha-textile/contracts';

import { Params } from '@data-access/interfaces/core.interface';
import { IOrderModel } from '@data-access/interfaces/order.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class OrderService {
	private http = inject(HttpClient);

	public skeletonLoader: boolean = false;

	private readonly withCookies = { withCredentials: true };

	/** The signed-in shopper's own orders, newest first (bundle builder brief E06). */
	mine(page: number, pageSize: number): Observable<ShopOrderPage> {
		return from(runtimeConfigReady).pipe(
			switchMap(() =>
				this.http.get<ShopOrderPage>(`${runtimeConfig.apiUrl}/orders/mine`, {
					...this.withCookies,
					params: { page, pageSize },
				}),
			),
		);
	}

	/** One of the shopper's own orders by its number (E05). */
	one(orderNumber: string): Observable<ShopOrderView> {
		return from(runtimeConfigReady).pipe(
			switchMap(() =>
				this.http.get<ShopOrderView>(
					`${runtimeConfig.apiUrl}/orders/mine/${encodeURIComponent(orderNumber)}`,
					this.withCookies,
				),
			),
		);
	}

	/** Vendor demo list; nothing reads it since My orders moved to the API (end-of-project cleanup list). */
	getOrders(payload?: Params): Observable<IOrderModel> {
		return this.http.get<IOrderModel>(`${environment.URL}/order.json`, { params: payload });
	}
}
