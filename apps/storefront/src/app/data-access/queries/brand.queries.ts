import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { runtimeConfig, runtimeConfigReady } from '@core/config/runtime-config';

interface BrandImage {
	url: string;
	srcset: string;
	width: number;
	height: number;
}

/** `StorefrontBrand` from `@saha-textile/contracts`, as the storefront reads it. */
export interface StorefrontBrand {
	shopName: string;
	logo: BrandImage | null;
	seal: BrandImage | null;
	/** PNG icon address by pixel size. */
	icons: Record<string, string>;
}

const NO_BRAND: StorefrontBrand = { shopName: '', logo: null, seal: null, icons: {} };

/** The Brand Kit. An unreachable API answers "no brand", so screens fall back to the shop name. */
export function injectBrandQuery() {
	const http = inject(HttpClient);
	return injectQuery(() => ({
		queryKey: ['brand'],
		queryFn: async (): Promise<StorefrontBrand> => {
			await runtimeConfigReady;
			try {
				return await firstValueFrom(http.get<StorefrontBrand>(`${runtimeConfig.apiUrl}/storefront/brand`));
			} catch {
				return NO_BRAND;
			}
		},
		staleTime: 5 * 60_000,
	}));
}
