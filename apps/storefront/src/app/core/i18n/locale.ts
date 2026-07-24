/**
 * Locale routing seam.
 *
 * The KB locks a locale segment on EVERY URL (`/{locale}/product/{slug}`, etc.)
 * for clean per-locale canonicals + hreflang + sitemaps. The full site-wide
 * migration (all routes under `[locale]`, switcher, redirects) is a dedicated
 * later pass; for now the new PDP ships at the literal `/en/...` shape so it is
 * already SEO-correct and a non-breaking rename (`en/` -> `[locale]/`) later.
 *
 * Route through `localizedPath()` / `LOCALE_PREFIX` so that migration is a
 * single-seam change rather than a find-replace across the app.
 */
export const DEFAULT_LOCALE = 'en';

/** Leading path segment for the default locale, e.g. `/en`. */
export const LOCALE_PREFIX = `/${DEFAULT_LOCALE}`;

/**
 * Build a locale-prefixed absolute path from URL segments.
 * `localizedPath('product', slug)` -> `/en/product/<slug>`.
 */
export function localizedPath(...segments: (string | number)[]): string {
	const tail = segments
		.map((segment) => `${segment}`.replace(/^\/+|\/+$/g, ''))
		.filter(Boolean)
		.join('/');
	return tail ? `${LOCALE_PREFIX}/${tail}` : LOCALE_PREFIX;
}
