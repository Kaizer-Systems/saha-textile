import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { map, Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { Params } from '@data-access/interfaces/core.interface';
import { ICurrency, ICurrencyModel } from '@data-access/interfaces/currency.interface';

import type { ShopCurrency } from '@saha-textile/contracts';

/**
 * One of the API's currencies in the shape the shop's price pipe and picker read: the rate is the
 * shop rate (the stored rate with the PayPal markup on all but rupees), so a price shown while
 * browsing is the price the checkout charges.
 */
export function toShopCurrency(row: ShopCurrency, index: number): ICurrency {
	return {
		id: index + 1,
		code: row.code,
		symbol: row.symbol,
		no_of_decimal: 2,
		exchange_rate: row.shopRateFromINR,
		symbol_position: 'before_price',
		thousands_separator: ',',
		decimal_separator: '.',
		status: row.enabled,
		created_by_id: 0,
	};
}

@Injectable({
	providedIn: 'root',
})
export class CurrencyService {
	private http = inject(HttpClient);

	/** The currencies the shop sells in (`GET /currency`); only enabled ones with a rate are listed. */
	getCurrencies(_payload?: Params): Observable<ICurrencyModel> {
		return this.http
			.get<ShopCurrency[]>(`${runtimeConfig.apiUrl}/currency`)
			.pipe(map((rows) => ({ data: rows.map(toShopCurrency), total: rows.length })));
	}
}
