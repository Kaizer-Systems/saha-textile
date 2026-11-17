import { HttpClient } from '@angular/common/http';
import { Component, PLATFORM_ID, computed, inject } from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { ActivatedRoute } from '@angular/router';

import { REQUEST } from '@analogjs/router/tokens';
import { TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { runtimeConfig, runtimeConfigReady } from '@core/config/runtime-config';

import { PageLayout } from './page-layout';
import type { StorefrontPageLayoutView } from './page-builder.types';

/** The session cookie the preview middleware sets (server/middleware/preview.ts). */
export const PREVIEW_COOKIE = 'st_preview';

/** A cookie's value from a Cookie header. */
export function cookieValue(header: string | undefined, name: string): string | null {
	for (const part of (header ?? '').split(';')) {
		const [key, ...value] = part.trim().split('=');
		if (key === name) return decodeURIComponent(value.join('='));
	}
	return null;
}

/**
 * The builder's preview (Page Builder step 6): a layout's draft drawn by the shop's own section code, at
 * `/{locale}/__preview/{pageType}`. The session cookie can't be read by scripts, so the draft is fetched on the server
 * and reaches the browser in the page's data copy; the browser never asks again (a new draft is a reload).
 */
@Component({
	selector: 'app-page-preview',
	template: `@if (sections(); as list) {
		<app-page-layout [sections]="list" />
	}`,
	imports: [PageLayout],
})
export class PagePreview {
	private readonly http = inject(HttpClient);
	private readonly request = inject(REQUEST, { optional: true }) as { headers?: { cookie?: string } } | null;
	private readonly onServer = isPlatformServer(inject(PLATFORM_ID));
	private readonly locale = inject(TranslocoService).getActiveLang();
	readonly pageType = inject(ActivatedRoute).snapshot.paramMap.get('type') ?? 'home';

	private readonly query = injectQuery(() => ({
		queryKey: ['page-preview', this.pageType, this.locale],
		enabled: this.onServer,
		staleTime: Number.POSITIVE_INFINITY,
		queryFn: async (): Promise<StorefrontPageLayoutView | null> => {
			await runtimeConfigReady;
			const token = cookieValue(this.request?.headers?.cookie, PREVIEW_COOKIE);
			if (!token) return null;
			return firstValueFrom(
				this.http.get<StorefrontPageLayoutView>(`${runtimeConfig.apiUrl}/storefront/preview/layout`, {
					params: { token, locale: this.locale },
				}),
			).catch(() => null);
		},
	}));

	readonly sections = computed(() => this.query.data()?.sections ?? null);
}
