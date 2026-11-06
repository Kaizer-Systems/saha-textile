/**
 * One hop off an old WordPress or WooCommerce address.
 *
 * Order is fixed: junk patterns, then an exact redirect row, then a same-path
 * English prefix only when that page exists, otherwise 410 on the original URL.
 * The homepage is never the fallback.
 *
 * The address is normalised first: lower case, no trailing slash, no `/page/N`, no shop
 * filters. Rows are stored without a language; the target takes the request's language.
 */

export interface SeoRedirectRow {
	sourcePath: string;
	statusCode: 301 | 302 | 410;
	targetPath?: string;
}

export interface LegacyResolution {
	status: 301 | 302 | 410;
	/** Absent when the answer is 410. */
	location?: string;
}

const LOCALES = ['en', 'fr'] as const;

function split(pathAndQuery: string): { pathname: string; query: string } {
	const queryAt = pathAndQuery.indexOf('?');
	const raw = queryAt === -1 ? pathAndQuery : pathAndQuery.slice(0, queryAt);
	const pathname = raw.startsWith('/') ? raw : `/${raw}`;
	return { pathname, query: queryAt === -1 ? '' : pathAndQuery.slice(queryAt) };
}

function stripSlash(pathname: string): string {
	if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
	return pathname;
}

function withoutLocale(pathname: string): string {
	const parts = stripSlash(pathname).split('/').filter(Boolean);
	if ((LOCALES as readonly string[]).includes(parts[0] ?? '')) {
		const rest = parts.slice(1);
		return rest.length ? `/${rest.join('/')}` : '/';
	}
	return stripSlash(pathname);
}

/** Old WordPress shapes. A locale prefix does not turn one of these into a new-site page. */
function legacyShape(pathname: string): boolean {
	const path = stripSlash(pathname);
	return (
		path.startsWith('/product-category') ||
		path.startsWith('/product-tag') ||
		path.startsWith('/wp-') ||
		path === '/xmlrpc.php' ||
		path.endsWith('/feed') ||
		path.includes('sitemap')
	);
}

function localeOf(pathname: string): string | null {
	const first = stripSlash(pathname).split('/').filter(Boolean)[0] ?? '';
	return (LOCALES as readonly string[]).includes(first) ? first : null;
}

/** Lower case, with any `/page/N` tail gone. */
function normalise(pathname: string): string {
	return stripSlash(pathname.toLowerCase().replace(/\/page\/\d+\/?$/, '')) || '/';
}

/** A stored target in the language of the request. An unprefixed request lands in English. */
function inLocale(targetPath: string, locale: string | null): string {
	const bare = withoutLocale(targetPath);
	return `/${locale ?? 'en'}${bare === '/' ? '' : bare}`;
}

function isAsset(pathname: string): boolean {
	const last = pathname.split('/').pop() ?? '';
	return last.includes('.') && !pathname.includes('/wp-');
}

function queryValue(query: string, key: string): string | null {
	const body = query.startsWith('?') ? query.slice(1) : query;
	if (!body) return null;
	for (const pair of body.split('&')) {
		const eq = pair.indexOf('=');
		const name = eq === -1 ? pair : pair.slice(0, eq);
		const value = eq === -1 ? '' : pair.slice(eq + 1);
		if (name === key && value) {
			try {
				return decodeURIComponent(value.replace(/\+/g, ' '));
			} catch {
				return null;
			}
		}
	}
	return null;
}

function findRow(rows: readonly SeoRedirectRow[], pathname: string): SeoRedirectRow | undefined {
	const bare = withoutLocale(pathname);
	return rows.find((row) => withoutLocale(row.sourcePath) === bare);
}

function fromRow(row: SeoRedirectRow, locale: string | null): LegacyResolution {
	if (row.statusCode === 410 || !row.targetPath) return { status: 410 };
	return { status: row.statusCode, location: inLocale(row.targetPath, locale) };
}

/** Public redirect list: source, status, and target. Internal ids never leave the API. */
export function publicRedirectView(row: {
	sourcePath: string;
	statusCode: 301 | 302 | 410;
	targetPath?: string;
	entityId?: string;
	entityType?: string;
}): { sourcePath: string; statusCode: 301 | 302 | 410; targetPath?: string } {
	return {
		sourcePath: row.sourcePath,
		statusCode: row.statusCode,
		...(row.targetPath ? { targetPath: row.targetPath } : {}),
	};
}

/**
 * WordPress paths that never have a redirect row. Returns null to continue.
 * `path` is normalised and locale-free.
 */
function wordpressPattern(
	path: string,
	query: string,
	locale: string | null,
	rows: readonly SeoRedirectRow[],
): LegacyResolution | null {
	if (
		path.startsWith('/wp-content') ||
		path.startsWith('/wp-admin') ||
		path.startsWith('/wp-login') ||
		path.startsWith('/wp-json') ||
		path === '/xmlrpc.php' ||
		path.endsWith('/feed') ||
		(path.includes('sitemap') && path !== SITEMAP_PATH)
	) {
		return { status: 410 };
	}

	const home = path === '/';
	const search = queryValue(query, 's');
	if (search && home) {
		return { status: 301, location: `/${locale ?? 'en'}/search?search=${encodeURIComponent(search)}` };
	}

	if (path === '/cart' && !locale) return { status: 302, location: '/en/cart' };
	if (path === '/checkout' && !locale) return { status: 302, location: '/en/checkout' };
	if (path === '/my-account' || path.startsWith('/my-account/')) {
		return { status: 302, location: `/${locale ?? 'en'}/account` };
	}

	const postId = queryValue(query, 'p');
	if (postId && /^\d+$/.test(postId) && home) return { status: 410 };

	if (
		query.includes('porto_builder=') ||
		query.includes('elementskit_template=') ||
		query.includes('page_id=') ||
		query.includes('attachment_id=') ||
		query.includes('post_type=')
	) {
		return { status: 410 };
	}

	const added = queryValue(query, 'add-to-cart');
	if (added) {
		const row = findRow(rows, `/?add-to-cart=${added}`);
		return row ? fromRow(row, locale) : { status: 410 };
	}

	return null;
}

/** The one sitemap this site serves. Every other sitemap address is a WordPress leftover. */
export const SITEMAP_PATH = '/sitemap.xml';

/**
 * Resolve an old or current address.
 *
 * `null` means the request is already a page this site should render.
 * `livePath` is true when the unprefixed path is a real page on the new site.
 */
export function resolveLegacyAddress(
	pathAndQuery: string,
	rows: readonly SeoRedirectRow[],
	livePath: (pathname: string) => boolean,
): LegacyResolution | null {
	const { pathname, query } = split(pathAndQuery);
	const cleaned = withoutWooFilters(query);
	const locale = localeOf(pathname.toLowerCase());
	const path = withoutLocale(normalise(pathname));

	const pattern = wordpressPattern(path, query, locale, rows);
	if (pattern) return pattern;
	if (isAsset(pathname)) return null;

	const row = findRow(rows, path);
	if (row) return fromRow(row, locale);

	if (legacyShape(path)) return { status: 410 };
	if (path === '/') return null;

	const live = livePath(path);
	if (locale) {
		// A live page reached by an untidy address has one clean home.
		const clean = `/${locale}${path}`;
		return live && pathname !== clean ? { status: 301, location: `${clean}${cleaned}` } : null;
	}
	return live ? { status: 301, location: `/en${path}${cleaned}` } : { status: 410 };
}

export interface CollapsedRedirect {
	statusCode: 301 | 302 | 410;
	targetPath?: string;
}

const WOO_FILTER = /^(orderby|order|min_price|max_price|rating_filter|query_type_|filter_)/;

/** Sort and filter queries are not part of the address. `p` and builder keys stay. */
function withoutWooFilters(query: string): string {
	if (!query) return '';
	const raw = query.startsWith('?') ? query.slice(1) : query;
	const kept = raw.split('&').filter((part) => part && !WOO_FILTER.test(part.split('=')[0] ?? ''));
	return kept.length > 0 ? `?${kept.join('&')}` : '';
}

/**
 * Follow a target through existing rows so the stored row jumps once.
 * A loop, or a target that is itself only a redirect, is rejected.
 */
export function collapseRedirectTarget(
	sourcePath: string,
	targetPath: string | undefined,
	statusCode: 301 | 302 | 410,
	rows: readonly SeoRedirectRow[],
): CollapsedRedirect | { error: 'loop' } {
	if (statusCode === 410 || !targetPath) return { statusCode: 410 };
	if (statusCode === 302) {
		if (withoutLocale(targetPath) === withoutLocale(sourcePath)) return { error: 'loop' };
		return { statusCode: 302, targetPath: stripSlash(targetPath) };
	}
	const seen = new Set<string>([withoutLocale(sourcePath)]);
	let current = stripSlash(targetPath);
	for (let hop = 0; hop < rows.length + 1; hop += 1) {
		const bare = withoutLocale(current);
		if (seen.has(bare)) return { error: 'loop' };
		seen.add(bare);
		const next = findRow(rows, bare);
		if (!next) return { statusCode: 301, targetPath: current };
		if (next.statusCode === 410 || !next.targetPath) return { statusCode: 410 };
		current = stripSlash(next.targetPath);
	}
	return { error: 'loop' };
}

/** The stored form of a source: lower case, no language, no trailing slash. */
export function normaliseSourcePath(path: string): string {
	return withoutLocale(normalise(path));
}

/** Rows that pointed at `saved.sourcePath` and now must jump straight to where it leads. */
export function repointedRows<T extends SeoRedirectRow>(rows: readonly T[], saved: SeoRedirectRow): T[] {
	const source = withoutLocale(stripSlash(saved.sourcePath));
	return rows
		.filter((row) => row.targetPath && withoutLocale(stripSlash(row.targetPath)) === source)
		.map((row) => {
			if (saved.statusCode === 410 || !saved.targetPath) {
				const { targetPath: _gone, ...rest } = row;
				return { ...rest, statusCode: 410 } as T;
			}
			return { ...row, targetPath: saved.targetPath };
		});
}

/**
 * A retired collection forwards to its nearest live parent, or is gone when it has none.
 * `path` is the collection path without `/collections/`; products inside are not moved.
 */
export function retiredCollectionRow(path: string, live: ReadonlySet<string>): SeoRedirectRow {
	const sourcePath = `/collections/${path}`;
	const parts = path.split('/');
	for (let end = parts.length - 1; end > 0; end -= 1) {
		const parent = parts.slice(0, end).join('/');
		if (live.has(parent)) return { sourcePath, statusCode: 301, targetPath: `/collections/${parent}` };
	}
	return { sourcePath, statusCode: 410 };
}
