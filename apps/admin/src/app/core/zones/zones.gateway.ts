import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { PAGE_EXPLAINS_ERRORS } from '@core/shipping/shipping.gateway';

import type {
	AdminZoneRow,
	PriceZone,
	PriceZoneStatusWrite,
	PriceZoneWrite,
	ZoneTryRequest,
	ZoneTryResult,
} from '@saha-textile/contracts';

/** Every zone screen reads under this key, so a change refreshes them all. */
export const ZONES_KEY = ['admin-zones'] as const;

/** Customers › Zones (DEC-B2B-ZONES): price lists for business buyers, built with rules. */
@Injectable({ providedIn: 'root' })
export class ZonesGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path = '') => `${runtimeConfig.apiUrl}/admin/zones${path}`;
	private readonly id = (value: string) => encodeURIComponent(value);

	list(): Observable<AdminZoneRow[]> {
		return this.http.get<AdminZoneRow[]>(this.api());
	}

	get(id: string): Observable<PriceZone> {
		return this.http.get<PriceZone>(this.api(`/${this.id(id)}`));
	}

	save(id: string | null, body: PriceZoneWrite): Observable<PriceZone> {
		return id
			? this.http.put<PriceZone>(this.api(`/${this.id(id)}`), body, PAGE_EXPLAINS_ERRORS)
			: this.http.post<PriceZone>(this.api(), body, PAGE_EXPLAINS_ERRORS);
	}

	setStatus(id: string, body: PriceZoneStatusWrite): Observable<PriceZone> {
		return this.http.post<PriceZone>(this.api(`/${this.id(id)}/status`), body, PAGE_EXPLAINS_ERRORS);
	}

	remove(id: string): Observable<unknown> {
		return this.http.delete(this.api(`/${this.id(id)}`), PAGE_EXPLAINS_ERRORS);
	}

	tryRules(body: ZoneTryRequest): Observable<ZoneTryResult> {
		return this.http.post<ZoneTryResult>(this.api('/try'), body, PAGE_EXPLAINS_ERRORS);
	}
}

export function injectZonesQuery() {
	const gateway = inject(ZonesGateway);
	return injectQuery(() => ({
		queryKey: [...ZONES_KEY, 'list'],
		queryFn: () => firstValueFrom(gateway.list()),
	}));
}
