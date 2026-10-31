/**
 * Locale URL law (`DEC-I18N-ROUTES`, locked 2026-10-31).
 *
 * Every storefront page lives under its language: `/en/…`, `/fr/…` (and `/bn/…` once Bengali
 * ships). The locale is the router's BASE, not a route segment — the app's routes, links and
 * menu data stay locale-free (`/cart`, `/product/<slug>`), and Angular's `APP_BASE_HREF` puts
 * the prefix on every URL it writes. One switch of base, not a prefix threaded through every
 * `routerLink`.
 *
 * Deliberately dependency-free: the Nitro middleware (`src/server/middleware/locale.ts`) imports
 * this file too, so the redirect rules and the app's reading of the URL cannot drift apart.
 */

/** en + fr through development; Bengali is a data change added once development completes. */
export const SUPPORTED_LOCALES = ['en', 'fr'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * The visitor's last explicit choice from the language switcher.
 *
 * Read only to answer `/`. Nothing redirects on it anywhere else, and nothing writes it except the
 * switcher — a browser language or an IP never decides the language (the locked rule).
 */
export const LOCALE_COOKIE = 'st_locale';

export function isLocale(value: unknown): value is Locale {
	return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
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
 * page keeps its trailing slash — `/fr/`, never `/fr` — so each page has exactly one address.
 */
export function withLocale(locale: Locale, appUrl: string): string {
	return `/${locale}${appUrl.startsWith('/') ? appUrl : `/${appUrl}`}`;
}

/**
 * Paths that are never indexed and carry no language alternates.
 *
 * They are still locale-prefixed (the law covers every route), so a French customer stays in
 * French through checkout — they are just not pages a search engine should hold.
 */
const PRIVATE_PREFIXES = ['/account', '/auth', '/cart', '/checkout', '/wishlist', '/compare', '/search'];

export function isPrivatePath(appPath: string): boolean {
	const path = appPath.split(/[?#]/)[0];
	return PRIVATE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Requests the locale rules leave alone: assets, the API, Vite and Nitro internals. */
function isPagePath(pathname: string): boolean {
	if (/^\/(api|_analog|@[\w-]+|__[\w-]*|node_modules|src|assets|\.well-known)(\/|$)/.test(pathname)) return false;
	const last = pathname.split('/').pop() ?? '';
	return !last.includes('.');
}

export interface LocaleRedirect {
	location: string;
	/** 301 where the answer never changes; 302 where it depends on the visitor (`/`). */
	status: 301 | 302;
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
