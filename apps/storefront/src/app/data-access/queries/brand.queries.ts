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

/** One resolved logo set (`ResolvedBrandLogos` in `@saha-textile/contracts`). */
export interface BrandLogos {
	logo: BrandImage | null;
	logoDark: BrandImage | null;
	seal: BrandImage | null;
	sealDark: BrandImage | null;
	/** PNG icon address by pixel size. */
	icons: Record<string, string>;
	/** The icon for a dark browser, by size; empty when there is none. */
	iconsDark: Record<string, string>;
}

/** `StorefrontBrand` from `@saha-textile/contracts`, as the storefront reads it. */
export interface StorefrontBrand extends BrandLogos {
	shopName: string;
	admin: BrandLogos;
	/** 1200×630 JPEG for pages shared without their own picture. */
	shareImage: string | null;
	/** Profile addresses by network (facebook, instagram, x, pinterest, linkedin, threads, youtube); '' where unset. */
	socials: Record<string, string>;
	/** App store pages; '' where there is none. Phones open them in the store app. */
	apps: { android: string; ios: string };
	themeColor: string;
	/** The admin's theme colour; the shop does not use it. */
	adminThemeColor: string;
}

const NO_LOGOS: BrandLogos = { logo: null, logoDark: null, seal: null, sealDark: null, icons: {}, iconsDark: {} };
export const NO_BRAND: StorefrontBrand = {
	shopName: '',
	...NO_LOGOS,
	admin: NO_LOGOS,
	shareImage: null,
	socials: {},
	apps: { android: '', ios: '' },
	themeColor: '#417394',
	adminThemeColor: '#0da487',
};

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
