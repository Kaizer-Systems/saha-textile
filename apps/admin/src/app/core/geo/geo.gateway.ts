import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';

import type { GeoCountry, GeoCountryDetail, PinLookup } from '@saha-textile/contracts';

/** Country data hardly changes; one read per screen visit is plenty. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Country, State, phone and PIN data for address forms (`DEC-ADDRESS`): the country list once, then
 * only the chosen country's States, and one PIN at a time. Never the whole data set.
 */
@Injectable({ providedIn: 'root' })
export class GeoGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path: string) => `${runtimeConfig.apiUrl}/geo${path}`;

	countries(): Observable<GeoCountry[]> {
		return this.http.get<GeoCountry[]>(this.api('/countries'));
	}

	country(code: string): Observable<GeoCountryDetail> {
		return this.http.get<GeoCountryDetail>(this.api(`/countries/${encodeURIComponent(code.toUpperCase())}`));
	}

	pin(pin: string): Observable<PinLookup | null> {
		return this.http.get<PinLookup | null>(this.api(`/pin/${encodeURIComponent(pin)}`));
	}
}

export function injectGeoCountryQuery(code: () => string | null) {
	const gateway = inject(GeoGateway);
	return injectQuery(() => ({
		queryKey: ['geo', 'country', code()],
		queryFn: () => firstValueFrom(gateway.country(code() as string)),
		enabled: !!code(),
		staleTime: DAY_MS,
	}));
}
