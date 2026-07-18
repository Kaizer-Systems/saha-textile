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
 *  - `exit` / `cookies` / `newsletter` are one-shot session flags (cookie-consent
 *    dismissed, exit-intent/newsletter shown). Persisted to localStorage so they
 *    don't re-trigger on reload — the NGXS storage plugin persisted the whole
 *    site_config state. SSR-guarded.
 *
 * Note: mutable UI fields like preloader/theme_color live on SiteConfigService,
 * not here, and are untouched.
 */
interface SiteConfigStateModel {
	siteConfig: ISiteConfig | null;
	exit: boolean;
	cookies: boolean;
	newsletter: boolean;
}

const SESSION_KEY = 'site_config_session';

export const SiteConfigStore = signalStore(
	{ providedIn: 'root' },
	withState<SiteConfigStateModel>({
		siteConfig: null,
		exit: true,
		cookies: true,
		newsletter: true,
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
				exit: slug == 'exit' ? value : store.exit(),
				newsletter: slug == 'newsletter' ? value : store.newsletter(),
			});
			if (isPlatformBrowser(platformId)) {
				localStorage.setItem(
					SESSION_KEY,
					JSON.stringify({
						exit: store.exit(),
						cookies: store.cookies(),
						newsletter: store.newsletter(),
					}),
				);
			}
		},
	})),
	withHooks({
		onInit(store) {
			if (isPlatformBrowser(inject(PLATFORM_ID))) {
				const saved = localStorage.getItem(SESSION_KEY);
				if (saved) patchState(store, JSON.parse(saved));
			}
		},
	}),
);
