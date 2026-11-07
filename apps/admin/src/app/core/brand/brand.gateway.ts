import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import type { BrandSettings, StorefrontBrand } from '@saha-textile/contracts';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';

const NO_BRAND: StorefrontBrand = { shopName: '', logo: null, seal: null, icons: {} };

@Injectable({ providedIn: 'root' })
export class BrandGateway {
	private readonly http = inject(HttpClient);

	/** The public Brand Kit, as every screen reads it. */
	brand(): Observable<StorefrontBrand> {
		return this.http.get<StorefrontBrand>(`${runtimeConfig.apiUrl}/storefront/brand`);
	}

	settings(): Observable<BrandSettings> {
		return this.http.get<BrandSettings>(`${runtimeConfig.apiUrl}/admin/settings/brand`);
	}

	save(value: BrandSettings): Observable<BrandSettings> {
		return this.http.put<BrandSettings>(`${runtimeConfig.apiUrl}/admin/settings/brand`, value);
	}
}

/** An unreachable API answers "no brand", so screens fall back to plain text. */
export function injectBrandQuery() {
	const gateway = inject(BrandGateway);
	return injectQuery(() => ({
		queryKey: ['brand'],
		queryFn: () => firstValueFrom(gateway.brand()).catch(() => NO_BRAND),
		staleTime: 5 * 60_000,
	}));
}
