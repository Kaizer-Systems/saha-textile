/**
 * Locale URL law (`DEC-I18N-ROUTES`, locked 2026-10-31).
 *
 * Every storefront page lives under its language: `/en/…` and `/bn/…`. The locale is the router's BASE, not a route segment — the app's routes, links and
 * menu data stay locale-free (`/cart`, `/product/<slug>`), and Angular's `APP_BASE_HREF` puts
 * the prefix on every URL it writes. One switch of base, not a prefix threaded through every
 * `routerLink`.
 *
 * Deliberately free of Angular: the Nitro middleware (`src/server/middleware/locale.ts`) imports
 * this file too, so the redirect rules and the app's reading of the URL cannot drift apart. Its
 * only import is the shared, browser-safe language rules.
 */

import { intlLocale, isLocaleCode, parseLanguageList, PRIMARY_LOCALE } from '@saha-textile/core-domain/languages';

/**
 * The shop's languages come from the API (`GET /storefront/languages`), the one list the admin
 * reads too: English until it has answered once. The server's middleware refreshes it
 * (`refreshSupportedLocales`) and hands it to the renderer on the request; the server render hands
 * it to the browser (`ACTIVE_LOCALE`). Nothing here names a language but English.
 */
export type Locale = string;

export const DEFAULT_LOCALE: Locale = PRIMARY_LOCALE;

let locales: readonly Locale[] = [PRIMARY_LOCALE];
/** Languages the shop showed once and no longer shows: their addresses answer 301 to English. */
let retired: readonly Locale[] = [];
let loaded = false;
let loadedAt = 0;
let refreshing: Promise<void> | null = null;
const LOCALES_TTL_MS = 60_000;
/** After a failed answer, ask again soon: until the list has loaded once, prefixes are trusted. */
const RETRY_MS = 5_000;

/** The active languages, English first. */
export function supportedLocales(): readonly Locale[] {
	return locales;
}

/** Adopts a list that came with the request or the page (`ACTIVE_LOCALE`), or from a test. */
export function setSupportedLocales(next: unknown): void {
	const list = parseLanguageList(next);
	if (!list) return;
	locales = list;
	loaded = true;
	loadedAt = Date.now();
}

/** Languages switched off or deleted in Settings › Languages after the shop showed them. */
export function retiredLocales(): readonly Locale[] {
	return retired;
}

/** Adopts the API's `redirect` list (or a test's); never English, never a language still shown. */
export function setRetiredLocales(next: unknown): void {
	const list = Array.isArray(next) ? next : (next as { redirect?: unknown } | null)?.redirect;
	retired = Array.isArray(list)
		? list.filter((code): code is string => isLocaleCode(code) && code !== PRIMARY_LOCALE && !locales.includes(code))
		: [];
}

/** True once the API's list has arrived. */
export function supportedLocalesReady(): boolean {
	return loaded;
}

/** Fetches the list from the API at most once a minute. A failure keeps the last list. */
export function refreshSupportedLocales(apiUrl: string, now: number = Date.now()): Promise<void> {
	if (now - loadedAt < LOCALES_TTL_MS) return Promise.resolve();
	refreshing ??= (async () => {
		try {
			const answer = await fetch(`${apiUrl}/storefront/languages`);
			const body: unknown = answer.ok ? await answer.json() : null;
			const list = parseLanguageList(body);
			if (list) {
				setSupportedLocales(list);
				setRetiredLocales(body);
			} else loadedAt = Date.now() - LOCALES_TTL_MS + RETRY_MS;
		} catch {
			loadedAt = Date.now() - LOCALES_TTL_MS + RETRY_MS;
		} finally {
			refreshing = null;
		}
	})();
	return refreshing;
}

/** Back to English alone, as before the API answered (tests). */
export function resetSupportedLocales(): void {
	locales = [PRIMARY_LOCALE];
	retired = [];
	loaded = false;
	loadedAt = 0;
	refreshing = null;
}

/**
 * The Open Graph name of a language (`og:locale`), so WhatsApp, Facebook and other link previews
 * know what language a shared page is in: the Indian variant the shop writes (`en_IN`, `bn_IN`).
 */
export function openGraphLocale(locale: Locale): string {
	return `${locale.split('-')[0]}_IN`;
}

/**
 * The visitor's last explicit choice from the language switcher.
 *
 * Read only to answer `/`. Nothing redirects on it anywhere else, and nothing writes it except the
 * switcher — a browser language or an IP never decides the language (the locked rule).
 */
export const LOCALE_COOKIE = 'st_locale';

/** The locale to hand to `Intl` for a page language (the BN-3 digits rule; shared with the admin). */
export { intlLocale };

/**
 * True for an active language. Until the API's list has arrived, any well-formed language code
 * counts, so an outage at start-up can never send `/bn/…` on a permanent redirect to `/en/bn/…`.
 */
export function isLocale(value: unknown): value is Locale {
	if (typeof value !== 'string') return false;
	return locales.includes(value) || (!loaded && isLocaleCode(value));
}

/** The locale a path is published under, or null when its first segment is not one. */
export function localeOfPath(pathname: string): Locale | null {
	const first = pathname.split(/[?#]/)[0].split('/').filter(Boolean)[0];
	return isLocale(first) ? first : null;
}

/**
 * The same page under another language.
 *
 * Takes a locale-free app URL (what `Router.url` reports), query and fragment included. The home
 * page keeps its trailing slash — `/bn/`, never `/bn` — so each page has exactly one address.
 */
export function withLocale(locale: Locale, appUrl: string): string {
	return `/${locale}${appUrl.startsWith('/') ? appUrl : `/${appUrl}`}`;
}

/**
 * Paths that are never indexed and carry no language alternates.
 *
 * They are still locale-prefixed (the law covers every route), so a Bengali customer stays in
 * Bengali through checkout — they are just not pages a search engine should hold.
 */
// `/maintenance` is shown while the shop is down; it is never a page to be found.
const PRIVATE_PREFIXES = [
	'/account',
	'/auth',
	'/cart',
	'/checkout',
	'/wishlist',
	'/compare',
	'/search',
	'/maintenance',
];

export function isPrivatePath(appPath: string): boolean {
	const path = appPath.split(/[?#]/)[0];
	return PRIVATE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Requests the locale rules leave alone: assets, the API, Vite and Nitro internals. */
function isPagePath(pathname: string): boolean {
	if (/^\/(api|_analog|@[\w-]+|__[\w-]*|node_modules|src|assets|\.well-known)(\/|$)/.test(pathname)) return false;
	const last = pathname.split('/').pop() as string;
	return !last.includes('.');
}

export interface LocaleRedirect {
	location: string;
	/** 301 where the answer never changes; 302 where it depends on the visitor (`/`). */
	status: 301 | 302;
	/**
	 * How long browsers and the edge may keep this answer. Set on a switched-off language's 301:
	 * permanent for search engines, yet a language switched back on returns within the hour.
	 */
	cacheSeconds?: number;
}

/** A switched-off language's 301 is kept this long (see `LocaleRedirect.cacheSeconds`). */
export const RETIRED_LOCALE_CACHE_SECONDS = 3600;

/**
 * A page under a language the shop no longer shows goes to the same page in English, for good
 * (owner decision round 2026-11-15, Settings › Languages): `/bn/product/x` → `/en/product/x`.
 */
export function retiredLocaleRedirect(pathAndQuery: string): LocaleRedirect | null {
	const queryAt = pathAndQuery.indexOf('?');
	const pathname = queryAt === -1 ? pathAndQuery : pathAndQuery.slice(0, queryAt);
	const query = queryAt === -1 ? '' : pathAndQuery.slice(queryAt);
	if (!isPagePath(pathname)) return null;
	const first = pathname.split('/')[1] ?? '';
	if (!retired.includes(first) || locales.includes(first)) return null;
	const rest = pathname.slice(first.length + 1) || '/';
	return {
		location: `/${DEFAULT_LOCALE}${rest}${query}`,
		status: 301,
		cacheSeconds: RETIRED_LOCALE_CACHE_SECONDS,
	};
}

/**
 * What a request for `pathAndQuery` must be redirected to, or null to serve it.
 *
 * - `/` → the remembered locale, else English. A 302: it differs per visitor.
 * - `/en` → `/en/`, so the home page has one address.
 * - Any other unprefixed page → its `/en/` address, permanently. That covers today's unprefixed
 *   links and any old WooCommerce URL whose path survives unchanged; renamed legacy paths are the
 *   job of the `seoRedirects` map, which runs before this rule once it exists.
 */
export function localeRedirectFor(pathAndQuery: string, rememberedLocale: string | undefined): LocaleRedirect | null {
	const queryAt = pathAndQuery.indexOf('?');
	const pathname = queryAt === -1 ? pathAndQuery : pathAndQuery.slice(0, queryAt);
	const query = queryAt === -1 ? '' : pathAndQuery.slice(queryAt);

	if (!isPagePath(pathname)) return null;

	const retiredLanguage = retiredLocaleRedirect(pathAndQuery);
	if (retiredLanguage) return retiredLanguage;

	if (pathname === '/') {
		const locale = isLocale(rememberedLocale) ? rememberedLocale : DEFAULT_LOCALE;
		return { location: `/${locale}/${query}`, status: 302 };
	}

	const locale = localeOfPath(pathname);
	if (locale) {
		return pathname === `/${locale}` ? { location: `/${locale}/${query}`, status: 301 } : null;
	}

	return { location: `/${DEFAULT_LOCALE}${pathname}${query}`, status: 301 };
}
