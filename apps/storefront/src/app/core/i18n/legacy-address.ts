import { resolveLegacyAddress } from '@saha-textile/core-domain/legacy-resolve';

import { localeRedirectFor, type LocaleRedirect } from './locale';

/**
 * Storefront adapter for the core address rules. The rules themselves live in
 * core-domain. This file only keeps the in-process copies the middleware reads,
 * because the published core-domain build is CommonJS and Vite SSR cannot load it.
 */

interface SeoRedirectRow {
	sourcePath: string;
	statusCode: 301 | 302 | 410;
	targetPath?: string;
}

const LIVE_EXACT = new Set([
	'/about-us',
	'/contact-us',
	'/faq',
	'/blogs',
	'/offer',
	'/privacy-policy',
	'/terms-conditions',
	'/refund-returns',
	'/shipping-policy',
	'/search',
	'/cart',
	'/checkout',
	'/wishlist',
	'/compare',
	'/account',
	'/collections',
]);

let rows: SeoRedirectRow[] = [];
let productSlugs = new Set<string>();
let collectionPaths = new Set<string>();
let loadedAt = 0;
let retryAt = 0;
let backoffMs = 0;
let catalogReady = false;
let refreshing: Promise<void> | null = null;

const CATALOG_TTL_MS = 15_000;
const MAX_BACKOFF_MS = 60_000;

export function setLegacyRedirectRows(next: readonly SeoRedirectRow[]): void {
	rows = [...next];
}

/** Slugs and collection paths that are real pages. A prefix alone is not enough. */
export function setLiveCatalog(next: { products?: readonly string[]; collections?: readonly string[] }): void {
	if (next.products) productSlugs = new Set(next.products);
	if (next.collections) collectionPaths = new Set(next.collections);
}

/** False until the live catalogue has loaded once, so a 410 cannot yet be trusted. */
export function legacyCatalogReady(): boolean {
	return catalogReady;
}

export function isLiveStorefrontPath(pathname: string): boolean {
	if (LIVE_EXACT.has(pathname)) return true;
	if (pathname.startsWith('/blog/')) return true;
	if (pathname.startsWith('/account/')) return true;
	if (pathname.startsWith('/auth/')) return true;
	if (pathname.startsWith('/product/')) {
		const slug = pathname.slice('/product/'.length).split('/')[0] ?? '';
		return slug.length > 0 && productSlugs.has(slug);
	}
	if (pathname.startsWith('/collections/')) {
		const rest = pathname.slice('/collections/'.length);
		return rest.length > 0 && collectionPaths.has(rest);
	}
	return false;
}

export function storefrontAddress(
	pathAndQuery: string,
	rememberedLocale: string | undefined,
): LocaleRedirect | { status: 410 } | null {
	const legacy = resolveLegacyAddress(pathAndQuery, rows, isLiveStorefrontPath);
	if (legacy?.status === 410) return { status: 410 };
	if (legacy && legacy.location) return { status: legacy.status, location: legacy.location };
	return localeRedirectFor(pathAndQuery, rememberedLocale);
}

interface LiveCatalog {
	rows: SeoRedirectRow[];
	products: string[];
	collections: string[];
}

async function readJson(url: string, signal: AbortSignal): Promise<unknown> {
	const response = await fetch(url, { signal });
	if (!response.ok) throw new Error(`${response.status} ${url}`);
	return response.json();
}

function toRows(body: unknown): SeoRedirectRow[] {
	if (!Array.isArray(body)) return [];
	return body.flatMap((row) => {
		if (!row || typeof row !== 'object') return [];
		const sourcePath = 'sourcePath' in row ? row.sourcePath : undefined;
		const statusCode = 'statusCode' in row ? row.statusCode : undefined;
		const targetPath = 'targetPath' in row ? row.targetPath : undefined;
		if (typeof sourcePath !== 'string') return [];
		if (statusCode !== 301 && statusCode !== 302 && statusCode !== 410) return [];
		return [{ sourcePath, statusCode, targetPath: typeof targetPath === 'string' ? targetPath : undefined }];
	});
}

const strings = (body: unknown, key: string): string[] => {
	const value = body && typeof body === 'object' && key in body ? (body as Record<string, unknown>)[key] : null;
	return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
};

async function loadCatalog(apiUrl: string): Promise<LiveCatalog> {
	const signal = AbortSignal.timeout(3000);
	const [redirects, live] = await Promise.all([
		readJson(`${apiUrl}/catalog/products/legacy-redirects`, signal),
		readJson(`${apiUrl}/catalog/live-paths`, signal),
	]);
	return { rows: toRows(redirects), products: strings(live, 'products'), collections: strings(live, 'collections') };
}

async function refresh(apiUrl: string): Promise<void> {
	try {
		const next = await loadCatalog(apiUrl);
		setLegacyRedirectRows(next.rows);
		setLiveCatalog(next);
		catalogReady = true;
		loadedAt = Date.now();
		backoffMs = 0;
	} catch {
		// A failed read keeps the last good copy and waits longer each time.
		backoffMs = Math.min(Math.max(backoffMs * 2, 1000), MAX_BACKOFF_MS);
		retryAt = Date.now() + backoffMs;
	} finally {
		refreshing = null;
	}
}

/**
 * Reloads redirect rows and the live catalogue. A save shows up on the next refresh. Only the
 * very first load holds a request back; after that a stale copy keeps serving while it refreshes.
 */
export async function refreshLegacyCatalog(apiUrl: string): Promise<void> {
	const now = Date.now();
	if (now - loadedAt >= CATALOG_TTL_MS && now >= retryAt) refreshing ??= refresh(apiUrl);
	if (!catalogReady && refreshing) await refreshing;
}

/** Back to a server that has loaded nothing. */
export function resetLegacyCatalog(): void {
	rows = [];
	productSlugs = new Set();
	collectionPaths = new Set();
	loadedAt = 0;
	retryAt = 0;
	backoffMs = 0;
	catalogReady = false;
	refreshing = null;
}
