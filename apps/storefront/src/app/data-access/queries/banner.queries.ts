import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { runtimeConfig, runtimeConfigReady } from '@core/config/runtime-config';
import { ResolvedImage, ResolvedImageSource, roleSrcset } from '@core/media/resolved-image';

/** One width of one banner image, as the API resolves it. */
export type BannerSource = ResolvedImageSource;

export type BannerImage = ResolvedImage;

/** `ResolvedBanner` from `@saha-textile/contracts`, as the storefront reads it. */
export interface ResolvedBanner {
	key: string;
	position: string;
	slot: string;
	containsText: boolean;
	images: { desktop: BannerImage; tablet: BannerImage | null; phone: BannerImage | null };
	heading: string | null;
	subheading: string | null;
	ctaLabel: string | null;
	link: { href: string; external: boolean } | null;
	alt: string;
}

export interface StorefrontBanners {
	heroLayout: 'hero_full' | 'hero_main_side' | 'hero_main_stack' | 'hero_center_sides';
	banners: ResolvedBanner[];
}

/**
 * A page's live banners (`GET /storefront/banners`), resolved for the active locale. An
 * unreachable API answers "no banners", so the page falls back to its theme artwork.
 */
export function injectBannersQuery(ownerType: () => 'home' | 'global' = () => 'home') {
	const http = inject(HttpClient);
	const transloco = inject(TranslocoService);
	return injectQuery(() => ({
		queryKey: ['banners', ownerType(), transloco.getActiveLang()],
		queryFn: async (): Promise<StorefrontBanners> => {
			await runtimeConfigReady;
			try {
				return await firstValueFrom(
					http.get<StorefrontBanners>(`${runtimeConfig.apiUrl}/storefront/banners`, {
						params: { ownerType: ownerType(), locale: transloco.getActiveLang() },
					}),
				);
			} catch {
				return { heroLayout: 'hero_full', banners: [] };
			}
		},
		staleTime: 5 * 60_000,
	}));
}

/** `srcset` for one banner image's `banner` role. */
export const bannerSrcset = (image: BannerImage | null): string | null => roleSrcset(image, 'banner');

/** The largest rendered width, used as `src`. */
export const bannerSrc = (image: BannerImage): string => image.roles['banner']?.at(-1)?.url ?? '';
