import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { runtimeConfig, runtimeConfigReady } from '@core/config/runtime-config';

import type { ResolvedPiecePictureView, StorefrontPageLayoutView } from '@features/page-builder/page-builder.types';

export type { ResolvedPiecePictureView, StorefrontPageLayoutView };

/**
 * A page's live Page Builder layout (`GET /storefront/pages/:type/layout`), drawn by the shop's server. Empty
 * (`revisionId` null) while the builder's switch is off or nothing is live, and when the API cannot be reached:
 * the page then draws its fixed layout, which is also the fallback (Page Builder FX-20).
 */
export function injectPageLayoutQuery(pageType: () => string) {
	const http = inject(HttpClient);
	const transloco = inject(TranslocoService);
	return injectQuery(() => ({
		queryKey: ['page-layout', pageType(), transloco.getActiveLang()],
		queryFn: async (): Promise<StorefrontPageLayoutView> => {
			await runtimeConfigReady;
			try {
				return await firstValueFrom(
					http.get<StorefrontPageLayoutView>(
						`${runtimeConfig.apiUrl}/storefront/pages/${pageType()}/layout`,
						{
							params: { locale: transloco.getActiveLang() },
						},
					),
				);
			} catch {
				return { pageType: pageType(), revisionId: null, sections: [], refreshAt: null };
			}
		},
		staleTime: 60_000,
	}));
}
