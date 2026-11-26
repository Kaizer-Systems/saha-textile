import { defineEventHandler, getCookie, sendRedirect, setResponseHeaders } from 'h3';

import { productPathForCode, readShortAddress } from '../../app/core/catalog/short-address';
import { legacyCatalogReady, refreshLegacyCatalog, storefrontAddress } from '../../app/core/i18n/legacy-address';
import {
	DEFAULT_LOCALE,
	LOCALE_COOKIE,
	localeOfPath,
	refreshSupportedLocales,
	supportedLocales,
} from '../../app/core/i18n/locale';
import { serverApiUrl } from '../api-url';

/**
 * Puts every page request under its locale before it reaches the renderer (`DEC-I18N-ROUTES`).
 *
 * The rules live in `storefrontAddress` (legacy resolver, then the locale law). This file only
 * adapts them to h3: page reads (GET/HEAD) only, and `/`'s answer varies by cookie, so it must
 * never be cached for someone else. A 410 keeps the status and renders the gone page.
 *
 * It reads the path the visitor ASKED for. In development Vite's SPA fallback has already
 * rewritten `req.url` to `/index.html` by the time middleware runs; the original survives on
 * `originalUrl`, which is also what Analog's renderer reads. Production sets no `originalUrl`.
 *
 * Returns `true` once it has answered. The dev server calls the next handler on any falsy
 * result, which would render a page into a response that has already been sent.
 *
 * Keep this file free of TypeScript-only syntax (annotations, `import type`, casts): the dev
 * server loads middleware without compiling it, and a single annotation takes the server down.
 * Types still flow in by inference from h3.
 */
export default defineEventHandler(async (event) => {
	if (event.method !== 'GET' && event.method !== 'HEAD') return;

	const req = event.node.req;
	const path = 'originalUrl' in req && typeof req.originalUrl === 'string' ? req.originalUrl : event.path;

	// A short `/p/<code>` address from a caption: straight to the product page, whatever the language.
	const short = readShortAddress(path);
	const productPath = short && (await productPathForCode(serverApiUrl(), short.code));
	if (short && productPath) {
		setResponseHeaders(event, { 'Cache-Control': 'public, max-age=300' });
		await sendRedirect(event, `${productPath}${short.query}`, 301);
		return true;
	}

	// The shop's languages (from the API, at most once a minute), handed on to the renderer.
	await refreshSupportedLocales(serverApiUrl());
	Object.assign(req, { shopLocales: supportedLocales() });

	await refreshLegacyCatalog(serverApiUrl());
	const redirect = storefrontAddress(path, getCookie(event, LOCALE_COOKIE));
	if (!redirect) return;

	if ('status' in redirect && redirect.status === 410 && !('location' in redirect)) {
		// Before the catalogue has loaded this 410 may be wrong, so nothing may cache it.
		setResponseHeaders(event, {
			'Cache-Control': legacyCatalogReady() ? 'public, max-age=3600' : 'no-store',
			'X-Robots-Tag': 'noindex',
		});
		event.node.res.statusCode = 410;
		const gone = `/${localeOfPath(path) ?? DEFAULT_LOCALE}/gone`;
		event.node.req.url = gone;
		if ('originalUrl' in req) req.originalUrl = gone;
		return;
	}

	if (redirect.status === 302) {
		setResponseHeaders(event, { 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
	}
	// A switched-off language's 301: kept an hour, so switching it back on brings its pages back.
	if ('cacheSeconds' in redirect && typeof redirect.cacheSeconds === 'number') {
		setResponseHeaders(event, { 'Cache-Control': `public, max-age=${redirect.cacheSeconds}` });
	}
	const location = redirect.location;
	if (typeof location !== 'string') return;
	await sendRedirect(event, location, redirect.status);
	return true;
});
