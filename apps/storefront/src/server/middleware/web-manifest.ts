import { defineEventHandler, getQuery, send, setResponseHeaders } from 'h3';

import { DEFAULT_LOCALE, isLocale } from '../../app/core/i18n/locale';
import { MANIFEST_PATH, webManifest } from '../../app/core/pwa/web-manifest';
import { serverApiUrl } from '../api-url';

/**
 * `/manifest.webmanifest`, built from the Brand Kit so a shop's name and icons change without a
 * rebuild. Middleware for the same reasons as `seo-files`, with the same rules: no TypeScript-only
 * syntax, and answer with `true`.
 *
 * An unreachable API still answers with the built-in icons, but uncached, so the real brand
 * returns as soon as the API does.
 */
export default defineEventHandler(async (event) => {
	if (event.method !== 'GET' && event.method !== 'HEAD') return;
	const req = event.node.req;
	const url = 'originalUrl' in req && typeof req.originalUrl === 'string' ? req.originalUrl : event.path;
	if (url.split('?')[0] !== MANIFEST_PATH) return;

	const { lang } = getQuery(event);
	const locale = isLocale(lang) ? lang : DEFAULT_LOCALE;

	let brand = null;
	try {
		const response = await fetch(`${serverApiUrl()}/storefront/brand`, { signal: AbortSignal.timeout(3000) });
		if (response.ok) brand = await response.json();
	} catch {
		// Falls through to the built-in icons.
	}

	setResponseHeaders(event, { 'Cache-Control': brand ? 'public, max-age=300' : 'no-store' });
	await send(event, JSON.stringify(webManifest(brand, locale)), 'application/manifest+json; charset=utf-8');
	return true;
});
