import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, map, of } from 'rxjs';

import { ApiCard, cardToProduct } from '@core/catalog/from-api';
import { IProduct } from '@data-access/interfaces/product.interface';

import { environment } from '../../../../public/environments/environment';

/** What the account's wishlist answers: every saved id, and cards for those on sale. */
export interface WishlistRead {
	productIds: string[];
	items: IProduct[];
}

/**
 * The wishlist over HTTP. The account routes take the customer from the session cookie; a guest
 * list is only ever read as cards by id, because it lives in the guest's own session cookie.
 */
@Injectable({
	providedIn: 'root',
})
export class WishlistService {
	private http = inject(HttpClient);

	account(): Observable<WishlistRead> {
		return this.http
			.get<{ productIds: string[]; items: ApiCard[] }>(`${environment.apiUrl}/storefront/wishlist`, {
				withCredentials: true,
			})
			.pipe(map((body) => ({ productIds: body.productIds, items: body.items.map(cardToProduct) })));
	}

	add(productId: string): Observable<{ productIds: string[] }> {
		return this.http.post<{ productIds: string[] }>(
			`${environment.apiUrl}/storefront/wishlist`,
			{ productId },
			{ withCredentials: true },
		);
	}

	remove(productId: string): Observable<{ productIds: string[] }> {
		return this.http.delete<{ productIds: string[] }>(
			`${environment.apiUrl}/storefront/wishlist/${encodeURIComponent(productId)}`,
			{ withCredentials: true },
		);
	}

	merge(productIds: string[]): Observable<{ productIds: string[] }> {
		return this.http.post<{ productIds: string[] }>(
			`${environment.apiUrl}/storefront/wishlist/merge`,
			{ productIds },
			{ withCredentials: true },
		);
	}

	/** Cards for products still on sale, in the order asked. */
	cards(productIds: string[]): Observable<IProduct[]> {
		if (!productIds.length) return of([]);
		return this.http
			.get<ApiCard[]>(`${environment.apiUrl}/catalog/cards`, { params: { id: productIds } })
			.pipe(map((cards) => cards.map(cardToProduct)));
	}
}
