import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { PAGE_EXPLAINS_ERRORS } from '@core/shipping/shipping.gateway';

import type {
	AdminFxOverview,
	AdminPaymentRouting,
	CurrencyRateWrite,
	FxFetchResult,
	FxSettingsWrite,
	PaymentRoutingWrite,
} from '@saha-textile/contracts';

export const FX_KEY = ['admin', 'fx'] as const;
/**
 * FX6 (owner, 2026-11-17): the launch currencies PayPal takes, as the admin writes them. The same
 * list as `LAUNCH_CURRENCY_SYMBOLS` in the contracts, kept here because the admin imports only types
 * from them (the browser can't load their CommonJS build).
 */
export const LAUNCH_SYMBOLS = ['US$', '£', '€', 'C$', 'A$', 'S$', 'NZ$'] as const;
export const PAYMENT_ROUTING_KEY = ['admin', 'payments', 'routing'] as const;

/** Names the brief writes differently from the browser's ("Pound Sterling", not "British Pound"). */
const CURRENCY_NAME_KEYS: Readonly<Record<string, string>> = { GBP: 'fx_name_GBP' };

/**
 * A currency's name in the admin's language: the browser's name (as language names are shown),
 * except where the brief names it otherwise.
 */
export function currencyDisplayName(code: string, lang: string, translate: (key: string) => string): string {
	const key = CURRENCY_NAME_KEYS[code];
	if (key) return translate(key);
	try {
		// With the default fallback ('code'), of() answers a name or the code itself, never undefined.
		return new Intl.DisplayNames([lang], { type: 'currency' }).of(code) as string;
	} catch {
		return code;
	}
}

/** "12:30": the daily fetch time, 24-hour India time, as the brief writes it. */
export const FETCH_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Admin › Currencies and Settings › Payment method (shipping rules brief fx01–fx03, pay01):
 * exchange rates, the PayPal markup, the daily fetch, and which gateway takes each currency.
 */
@Injectable({ providedIn: 'root' })
export class FxGateway {
	private readonly http = inject(HttpClient);

	private base(path: string): string {
		return `${runtimeConfig.apiUrl}${path}`;
	}

	overview(): Observable<AdminFxOverview> {
		return this.http.get<AdminFxOverview>(this.base('/admin/fx'));
	}

	saveSettings(body: FxSettingsWrite): Observable<AdminFxOverview> {
		return this.http.post<AdminFxOverview>(this.base('/admin/fx/settings'), body, PAGE_EXPLAINS_ERRORS);
	}

	setRate(code: string, body: CurrencyRateWrite): Observable<AdminFxOverview> {
		return this.http.post<AdminFxOverview>(
			this.base(`/admin/fx/currencies/${encodeURIComponent(code)}`),
			body,
			PAGE_EXPLAINS_ERRORS,
		);
	}

	fetchNow(): Observable<FxFetchResult> {
		return this.http.post<FxFetchResult>(this.base('/admin/fx/fetch-now'), {}, PAGE_EXPLAINS_ERRORS);
	}

	routing(): Observable<AdminPaymentRouting> {
		return this.http.get<AdminPaymentRouting>(this.base('/admin/payments/routing'));
	}

	saveRouting(body: PaymentRoutingWrite): Observable<AdminPaymentRouting> {
		return this.http.post<AdminPaymentRouting>(this.base('/admin/payments/routing'), body, PAGE_EXPLAINS_ERRORS);
	}
}

export function injectFxOverviewQuery(enabled: () => boolean = () => true) {
	const gateway = inject(FxGateway);
	return injectQuery(() => ({
		queryKey: [...FX_KEY],
		queryFn: () => firstValueFrom(gateway.overview()),
		enabled: enabled(),
		staleTime: 30_000,
	}));
}

export function injectPaymentRoutingQuery() {
	const gateway = inject(FxGateway);
	return injectQuery(() => ({
		queryKey: [...PAYMENT_ROUTING_KEY],
		queryFn: () => firstValueFrom(gateway.routing()),
		staleTime: 30_000,
	}));
}
