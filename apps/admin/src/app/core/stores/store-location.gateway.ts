import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';

import type { AdminStoreLocationRow, StoreLocationSaveResult, StoreLocationWrite } from '@saha-textile/contracts';

/** The query key every Stores screen and the home tile share, so a save refreshes them all. */
export const STORE_LOCATIONS_KEY = ['store-locations'] as const;

/** Settings › Stores: the shop's physical stores, super admin only. */
@Injectable({ providedIn: 'root' })
export class StoreLocationGateway {
	private readonly http = inject(HttpClient);
	private readonly base = (path = '') => `${runtimeConfig.apiUrl}/admin/store-locations${path}`;

	list(): Observable<AdminStoreLocationRow[]> {
		return this.http.get<AdminStoreLocationRow[]>(this.base());
	}

	detail(id: string): Observable<AdminStoreLocationRow> {
		return this.http.get<AdminStoreLocationRow>(this.base(`/${encodeURIComponent(id)}`));
	}

	save(id: string | null, body: StoreLocationWrite): Observable<StoreLocationSaveResult> {
		return this.http.post<StoreLocationSaveResult>(this.base(id ? `/${encodeURIComponent(id)}` : ''), body);
	}

	setActive(id: string, active: boolean): Observable<StoreLocationSaveResult> {
		return this.http.post<StoreLocationSaveResult>(this.base(`/${encodeURIComponent(id)}/active`), { active });
	}

	reorder(ids: readonly string[]): Observable<{ ok: boolean }> {
		return this.http.post<{ ok: boolean }>(this.base('/order'), { ids });
	}

	remove(id: string): Observable<{ ok: boolean }> {
		return this.http.delete<{ ok: boolean }>(this.base(`/${encodeURIComponent(id)}`));
	}
}

/** Every store, in display order. Waits until `enabled` says the admin may read Settings. */
export function injectStoreLocationsQuery(enabled: () => boolean = () => true) {
	const gateway = inject(StoreLocationGateway);
	return injectQuery(() => ({
		queryKey: STORE_LOCATIONS_KEY,
		queryFn: () => firstValueFrom(gateway.list()),
		enabled: enabled(),
	}));
}
