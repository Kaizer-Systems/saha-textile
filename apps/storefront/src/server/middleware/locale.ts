import { defineEventHandler, getCookie, sendRedirect, setResponseHeaders } from 'h3';

import { LOCALE_COOKIE, localeRedirectFor } from '../../app/core/i18n/locale';

/**
 * Puts every page request under its locale before it reaches the renderer (`DEC-I18N-ROUTES`).
 *
 * The rules live in `localeRedirectFor`, shared with the app. This file only adapts them to h3:
 * page reads (GET/HEAD) only, and `/`'s answer varies by cookie, so it must never be cached for
 * someone else.
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

	const redirect = localeRedirectFor(path, getCookie(event, LOCALE_COOKIE));
	if (!redirect) return;

	if (redirect.status === 302) {
		setResponseHeaders(event, { 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
	}
	await sendRedirect(event, redirect.location, redirect.status);
	return true;
});
