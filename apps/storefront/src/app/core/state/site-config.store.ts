import { inject, PLATFORM_ID } from '@angular/core';

import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap } from 'rxjs';

import { ISiteConfig } from '@data-access/interfaces/site-config.interface';
import { SiteConfigService } from '@data-access/services/site-config.service';

/**
 * Site config + session flags (replaces NGXS SiteConfigState + its
 * GetSiteConfig/UpdateSession actions). Hybrid shell state → SignalStore:
 *  - `site_config` is server config, (re)loaded via loadSiteConfig() (rxMethod).
 *
 * Note: mutable UI fields like preloader/theme_color live on SiteConfigService,
 * not here, and are untouched.
 */
interface SiteConfigStateModel {
	siteConfig: ISiteConfig | null;
}

export const SiteConfigStore = signalStore(
	{ providedIn: 'root' },
	withState<SiteConfigStateModel>({
		siteConfig: null,
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
	})),
);
