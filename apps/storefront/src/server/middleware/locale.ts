import { defineEventHandler, getCookie, sendRedirect, setResponseHeaders } from 'h3';

import { environment } from '../../../public/environments/environment';
import { refreshLegacyCatalog, storefrontAddress } from '../../app/core/i18n/legacy-address';
import { LOCALE_COOKIE } from '../../app/core/i18n/locale';

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

	await refreshLegacyCatalog(environment.apiUrl);
	const redirect = storefrontAddress(path, getCookie(event, LOCALE_COOKIE));
	if (!redirect) return;

	if ('status' in redirect && redirect.status === 410 && !('location' in redirect)) {
		setResponseHeaders(event, {
			'Cache-Control': 'public, max-age=3600',
			'X-Robots-Tag': 'noindex',
		});
		event.node.res.statusCode = 410;
		const gone = '/en/gone';
		event.node.req.url = gone;
		if ('originalUrl' in req) req.originalUrl = gone;
		return;
	}

	if (redirect.status === 302) {
		setResponseHeaders(event, { 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
	}
	const location = redirect.location;
	if (typeof location !== 'string') return;
	await sendRedirect(event, location, redirect.status);
	return true;
});
