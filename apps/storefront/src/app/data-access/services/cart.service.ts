import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { ApiCartView, CartLineChoice } from '@core/state/cart/cart-view';
import { backgroundRequest } from '@core/interceptors/background-request';

import { environment } from '../../../../public/environments/environment';

/** Failures are answered by the cart effects, in the shopper's language, so none toast here. */
@Injectable({
	providedIn: 'root',
})
export class CartService {
	private http = inject(HttpClient);
	private url = `${environment.apiUrl}/cart/current`;
	private options = { withCredentials: true, context: backgroundRequest() };

	current(): Observable<ApiCartView> {
		return this.http.get<ApiCartView>(this.url, this.options);
	}

	add(line: CartLineChoice & { productId: string; quantity: number }): Observable<ApiCartView> {
		return this.http.post<ApiCartView>(`${this.url}/lines`, line, this.options);
	}

	update(id: string, change: Partial<CartLineChoice> & { quantity: number }): Observable<ApiCartView> {
		return this.http.patch<ApiCartView>(`${this.url}/lines/${encodeURIComponent(id)}`, change, this.options);
	}

	remove(id: string): Observable<ApiCartView> {
		return this.http.delete<ApiCartView>(`${this.url}/lines/${encodeURIComponent(id)}`, this.options);
	}
}
