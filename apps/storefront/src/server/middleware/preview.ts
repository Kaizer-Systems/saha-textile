import { createError, defineEventHandler, getCookie, getQuery, sendRedirect, setCookie, setResponseHeaders } from 'h3';

import { serverApiUrl } from '../api-url';

/**
 * The builder's preview address, `/{locale}/__preview/{pageType}` (Page Builder step 6, FX-5).
 *
 * The builder opens it with a one-time code (`?code=`, a minute). This middleware swaps the code with the API for a
 * session, keeps the session in a cookie limited to this language's preview path (an hour; never readable by
 * scripts), and sends the browser to the same address without the code, so no pass stays in an address that
 * history, logs or the Referer header keep. Without a live session the address is a plain 404. Every preview answer
 * is kept out of search engines and caches, sends no referrer, and may be framed only by the admin.
 *
 * Keep this file free of TypeScript-only syntax: the dev server loads middleware without compiling it.
 */
const PREVIEW_PATH = /^\/([a-z]{2,3}(?:-[a-z]{2})?)\/__preview\/[a-z_]+\/?$/;
export const PREVIEW_COOKIE = 'st_preview';

export default defineEventHandler(async (event) => {
	const req = event.node.req;
	const full = 'originalUrl' in req && typeof req.originalUrl === 'string' ? req.originalUrl : event.path;
	const path = full.split('?')[0];
	const match = PREVIEW_PATH.exec(path);
	if (!match) return;

	setResponseHeaders(event, {
		'X-Robots-Tag': 'noindex, nofollow',
		'Cache-Control': 'no-store',
		'Referrer-Policy': 'no-referrer',
		'Content-Security-Policy': `frame-ancestors ${process.env['ADMIN_ORIGIN'] || "'self'"}`,
	});

	const code = getQuery(event)['code'];
	if (typeof code === 'string' && code.length >= 32) {
		const answer = await fetch(`${serverApiUrl()}/storefront/preview/exchange`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ code }),
		}).catch(() => null);
		if (!answer || !answer.ok) throw createError({ statusCode: 404, statusMessage: 'No such preview' });
		const session = await answer.json();
		setCookie(event, PREVIEW_COOKIE, session.token, {
			path: `/${match[1]}/__preview`,
			httpOnly: true,
			secure: true,
			sameSite: 'none',
			maxAge: 3600,
		});
		await sendRedirect(event, path, 302);
		return true;
	}

	if (!getCookie(event, PREVIEW_COOKIE)) throw createError({ statusCode: 404, statusMessage: 'No such preview' });
});
