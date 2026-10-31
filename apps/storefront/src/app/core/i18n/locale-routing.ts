import { APP_BASE_HREF, DOCUMENT } from '@angular/common';
import { inject, provideAppInitializer, provideEnvironmentInitializer } from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { runtimeConfigReady } from '@core/config/runtime-config';

import { ACTIVE_LOCALE } from './active-locale';
import { LocaleSeo } from './locale-seo';

/**
 * Serves the whole app under `/<locale>` (`DEC-I18N-ROUTES`).
 *
 * `APP_BASE_HREF` rather than a `[locale]` route segment: routes, `routerLink`s, menu data and
 * `navigateByUrl` calls stay locale-free, and Angular's `Location` adds and strips the prefix.
 * The document's own `<base href="/">` is untouched, so relative asset URLs still resolve from
 * the site root.
 *
 * The initializer renders the page IN its language on the server: it waits for the runtime
 * config (the loader needs the real site origin), then loads that locale's dictionary before
 * the first render, so French arrives as French HTML instead of being swapped in on hydration.
 * Waiting is never allowed to fail the render; see the catch below.
 */
export function provideLocaleRouting() {
	return [
		{ provide: APP_BASE_HREF, useFactory: () => `/${inject(ACTIVE_LOCALE)}` },
		provideAppInitializer(async () => {
			const locale = inject(ACTIVE_LOCALE);
			const transloco = inject(TranslocoService);
			inject(DOCUMENT).documentElement.lang = locale;

			await runtimeConfigReady;
			transloco.setActiveLang(locale);
			try {
				await firstValueFrom(transloco.load(locale));
			} catch {
				// A dictionary that cannot be fetched must not take the page down with it: the
				// render goes ahead on Transloco's missing-key fallback, as it did before this
				// initializer waited. (Seen locally when the built server runs on plain HTTP while
				// `siteUrl` says https — the loader's fetch fails and every page was a 500.)
			}
		}),
		// Subscribes to navigation before the initial one, so the first render carries its tags.
		provideEnvironmentInitializer(() => inject(LocaleSeo)),
	];
}
