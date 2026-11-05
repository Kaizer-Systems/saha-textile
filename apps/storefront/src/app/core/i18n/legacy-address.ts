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

const CATALOG_TTL_MS = 15_000;

export function setLegacyRedirectRows(next: readonly SeoRedirectRow[]): void {
	rows = [...next];
}

/** Slugs and collection paths that are real pages. A prefix alone is not enough. */
export function setLiveCatalog(next: { products?: readonly string[]; collections?: readonly string[] }): void {
	if (next.products) productSlugs = new Set(next.products);
	if (next.collections) collectionPaths = new Set(next.collections);
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

/** Reloads redirect rows and the live catalogue. A save is visible on the next refresh. */
export async function refreshLegacyCatalog(apiUrl: string): Promise<void> {
	if (Date.now() - loadedAt < CATALOG_TTL_MS) return;
	loadedAt = Date.now();
	const signal = AbortSignal.timeout(3000);
	try {
		const response = await fetch(`${apiUrl}/catalog/products/legacy-redirects`, { signal });
		if (response.ok) {
			const body: unknown = await response.json();
			if (Array.isArray(body)) {
				setLegacyRedirectRows(
					body.flatMap((row) => {
						if (!row || typeof row !== 'object') return [];
						const sourcePath = 'sourcePath' in row ? row.sourcePath : undefined;
						const statusCode = 'statusCode' in row ? row.statusCode : undefined;
						const targetPath = 'targetPath' in row ? row.targetPath : undefined;
						if (typeof sourcePath !== 'string') return [];
						if (statusCode !== 301 && statusCode !== 302 && statusCode !== 410) return [];
						return [
							{
								sourcePath,
								statusCode,
								targetPath: typeof targetPath === 'string' ? targetPath : undefined,
							},
						];
					}),
				);
			}
		}
	} catch {
		loadedAt = 0;
	}
	try {
		const response = await fetch(`${apiUrl}/catalog/live-paths`, { signal });
		if (!response.ok) return;
		const body: unknown = await response.json();
		if (!body || typeof body !== 'object') return;
		const products =
			'products' in body && Array.isArray(body.products)
				? body.products.filter((slug) => typeof slug === 'string')
				: [];
		const collections =
			'collections' in body && Array.isArray(body.collections)
				? body.collections.filter((path) => typeof path === 'string')
				: [];
		setLiveCatalog({ products, collections });
	} catch {
		loadedAt = 0;
	}
}
