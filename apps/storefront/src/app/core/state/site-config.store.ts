import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';

import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap } from 'rxjs';

import { ISiteConfig } from '@data-access/interfaces/site-config.interface';
import { SiteConfigService } from '@data-access/services/site-config.service';

/**
 * Site config + session flags (replaces NGXS SiteConfigState + its
 * GetSiteConfig/UpdateSession actions). Hybrid shell state → SignalStore:
 *  - `site_config` is server config, (re)loaded via loadSiteConfig() (rxMethod).
 *  - `cookies` is a one-shot flag (cookie consent dismissed), persisted to localStorage
 *    so it doesn't re-trigger on reload. SSR-guarded. The newsletter popup keeps its own
 *    `st_newsletter` cookie and session flag; the theme's exit-intent modal was removed
 *    (owner log § Media → Newsletter popup).
 *
 * Note: mutable UI fields like preloader/theme_color live on SiteConfigService,
 * not here, and are untouched.
 */
interface SiteConfigStateModel {
	siteConfig: ISiteConfig | null;
	cookies: boolean;
}

const SESSION_KEY = 'site_config_session';

export const SiteConfigStore = signalStore(
	{ providedIn: 'root' },
	withState<SiteConfigStateModel>({
		siteConfig: null,
		cookies: true,
	}),
	withMethods((store, siteConfigService = inject(SiteConfigService), platformId = inject(PLATFORM_ID)) => ({
		loadSiteConfig: rxMethod<void>(
			pipe(
				switchMap(() =>
					siteConfigService
						.getSiteConfig()
						.pipe(tap((result) => patchState(store, { siteConfig: result.options }))),
				),
			),
		),
		updateSession(slug: string, value: boolean): void {
			patchState(store, {
				cookies: slug == 'cookies' ? value : store.cookies(),
			});
			if (isPlatformBrowser(platformId)) {
				localStorage.setItem(
					SESSION_KEY,
					JSON.stringify({
						cookies: store.cookies(),
					}),
				);
			}
		},
	})),
	withHooks({
		onInit(store) {
			if (isPlatformBrowser(inject(PLATFORM_ID))) {
				const saved = localStorage.getItem(SESSION_KEY);
				if (saved) patchState(store, { cookies: (JSON.parse(saved) as { cookies?: boolean }).cookies ?? true });
			}
		},
	}),
);
