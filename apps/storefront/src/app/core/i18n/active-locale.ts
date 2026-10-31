import { InjectionToken, inject } from '@angular/core';

import { REQUEST } from '@analogjs/router/tokens';

import { DEFAULT_LOCALE, Locale, localeOfPath } from './locale';

/**
 * The language this page was requested in — read once, from the URL, for the life of the app.
 *
 * Fixed per document on purpose. Switching language is a full navigation to the other prefix
 * (see the header switcher), so the server renders the new language and nothing has to re-key
 * at runtime. An unprefixed path only reaches the app if the locale middleware was bypassed;
 * it renders in English rather than failing.
 */
export const ACTIVE_LOCALE = new InjectionToken<Locale>('ACTIVE_LOCALE', {
	providedIn: 'root',
	factory: () => {
		const request = inject(REQUEST, { optional: true });
		const path = request
			? (request.originalUrl ?? request.url ?? '/')
			: typeof window !== 'undefined'
				? window.location.pathname
				: '/';
		return localeOfPath(path) ?? DEFAULT_LOCALE;
	},
});
