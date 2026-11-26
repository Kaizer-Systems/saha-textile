import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { runtimeConfig, runtimeConfigReady } from '@core/config/runtime-config';
import { IShareSettings } from '@data-access/interfaces/share.interface';

/** What the share menu shows before admin has saved Sharing, or while the API is away: every app. */
export const SHARE_DEFAULTS: IShareSettings = {
	xHandle: '',
	hashtags: true,
	apps: ['whatsapp', 'instagram', 'facebook', 'telegram', 'email', 'x', 'linkedin', 'pinterest'],
};

/** Storefront settings › Sharing (`GET /catalog/share-settings`), read when the share menu first opens. */
export function injectShareSettingsQuery() {
	const http = inject(HttpClient);
	return injectQuery(() => ({
		queryKey: ['share-settings'],
		queryFn: async (): Promise<IShareSettings> => {
			await runtimeConfigReady;
			try {
				return await firstValueFrom(http.get<IShareSettings>(`${runtimeConfig.apiUrl}/catalog/share-settings`));
			} catch {
				return SHARE_DEFAULTS;
			}
		},
		staleTime: 10 * 60_000,
	}));
}
