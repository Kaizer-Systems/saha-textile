import { InjectionToken, TransferState, inject, makeStateKey } from '@angular/core';

import { REQUEST } from '@analogjs/router/tokens';

import { DEFAULT_LOCALE, Locale, localeOfPath, setSupportedLocales, supportedLocales } from './locale';

/** The active languages, carried from the server render to the browser. */
export const SHOP_LOCALES_STATE = makeStateKey<readonly string[]>('st-shop-locales');

/**
 * The language this page was requested in — read once, from the URL, for the life of the app.
 *
 * Fixed per document on purpose. Switching language is a full navigation to the other prefix
 * (see the header switcher), so the server renders the new language and nothing has to re-key
 * at runtime. An unprefixed path only reaches the app if the locale middleware was bypassed;
 * it renders in English rather than failing.
 *
 * It first adopts the shop's language list: on the server from the request (the locale
 * middleware attaches what the API answered), in the browser from the server render's state.
 */
export const ACTIVE_LOCALE = new InjectionToken<Locale>('ACTIVE_LOCALE', {
	providedIn: 'root',
	factory: () => {
		const request = inject(REQUEST, { optional: true }) as { shopLocales?: unknown } | null;
		const state = inject(TransferState, { optional: true });
		if (request?.shopLocales) {
			setSupportedLocales(request.shopLocales);
			state?.set(SHOP_LOCALES_STATE, supportedLocales());
		} else if (state?.hasKey(SHOP_LOCALES_STATE)) {
			setSupportedLocales(state.get(SHOP_LOCALES_STATE, []));
		}
		const path = request
			? ((request as { originalUrl?: string; url?: string }).originalUrl ??
				(request as { url?: string }).url ??
				'/')
			: typeof window !== 'undefined'
				? window.location.pathname
				: '/';
		return localeOfPath(path) ?? DEFAULT_LOCALE;
	},
});
