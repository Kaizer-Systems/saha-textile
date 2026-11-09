import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { from, Observable, switchMap } from 'rxjs';

import { runtimeConfig, runtimeConfigReady } from '@core/config/runtime-config';
import { backgroundRequest } from '@core/interceptors/background-request';
import { ApiCartView, CartLineChoice } from '@core/state/cart/cart-view';

/** Failures are answered by the cart effects, in the shopper's language, so none toast here. */
@Injectable({
	providedIn: 'root',
})
export class CartService {
	private http = inject(HttpClient);
	private options = { withCredentials: true, context: backgroundRequest() };

	/**
	 * Read when called, never when the service is made: the first cart read starts while
	 * `/config.json` is still loading, and a URL fixed then is the built-in localhost default.
	 */
	private get url(): string {
		return `${runtimeConfig.apiUrl}/cart/current`;
	}

	/** Waits for the runtime config, because the cart is read as the app starts. */
	current(): Observable<ApiCartView> {
		return from(runtimeConfigReady).pipe(switchMap(() => this.http.get<ApiCartView>(this.url, this.options)));
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
