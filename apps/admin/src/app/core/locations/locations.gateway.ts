import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import { QUIET } from '../purchasing/purchasing.gateway';

import type {
	Location,
	LocationChip,
	LocationWrite,
	AdminUserLocations,
	AdminUserLocationsWrite,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export type LocationRow = Location & { people: number };

export const LOCATION_KEYS = {
	list: ['locations', 'list'] as const,
	chip: ['locations', 'chip'] as const,
	user: (id: string) => ['locations', 'user', id] as const,
};

/** Settings › Locations, where users work and the header chip (accounts brief K1–K3, L1–L3). */
@Injectable({ providedIn: 'root' })
export class LocationsGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path: string) => `${runtimeConfig.apiUrl}/admin${path}`;

	list(): Observable<LocationRow[]> {
		return this.http.get<LocationRow[]>(this.api('/locations'));
	}
	create(body: LocationWrite): Observable<Location> {
		return this.http.post<Location>(this.api('/locations'), body, QUIET);
	}
	save(id: string, body: LocationWrite): Observable<Location> {
		return this.http.put<Location>(this.api(`/locations/${encodeURIComponent(id)}`), body, QUIET);
	}
	setActive(id: string, active: boolean): Observable<Location> {
		return this.http.post<Location>(this.api(`/locations/${encodeURIComponent(id)}/active`), { active }, QUIET);
	}
	adminUserLocations(userId: string): Observable<AdminUserLocations> {
		return this.http.get<AdminUserLocations>(this.api(`/locations/users/${encodeURIComponent(userId)}`));
	}
	saveAdminUserLocations(userId: string, body: AdminUserLocationsWrite): Observable<AdminUserLocations> {
		return this.http.put<AdminUserLocations>(
			this.api(`/locations/users/${encodeURIComponent(userId)}`),
			body,
			QUIET,
		);
	}
	chip(): Observable<LocationChip> {
		return this.http.get<LocationChip>(this.api('/me/location'));
	}
	switchTo(locationId: string | null): Observable<LocationChip> {
		return this.http.put<LocationChip>(this.api('/me/location'), { locationId }, QUIET);
	}
}
