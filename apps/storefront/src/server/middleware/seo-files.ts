import { defineEventHandler, getRequestURL, send, setResponseHeaders } from 'h3';

import { environment } from '../../../public/environments/environment';

/**
 * `/sitemap.xml` and `/robots.txt`. Middleware rather than a server route, because Analog puts
 * every route under `/api`. Keep this file free of TypeScript-only syntax and answer with `true`,
 * for the same reasons as the locale middleware.
 */
export default defineEventHandler(async (event) => {
	if (event.method !== 'GET' && event.method !== 'HEAD') return;
	const req = event.node.req;
	const url = 'originalUrl' in req && typeof req.originalUrl === 'string' ? req.originalUrl : event.path;
	const path = url.split('?')[0];

	const originOf = () => {
		const { headers } = req;
		// HTTP/2 carries the host in `:authority`, which the plain URL helper does not read.
		const host = headers['x-forwarded-host'] ?? headers[':authority'] ?? headers.host;
		const requestUrl = getRequestURL(event, { xForwardedProto: true });
		return host ? `${requestUrl.protocol}//${host}` : requestUrl.origin;
	};

	if (path === '/sitemap.xml') {
		const response = await fetch(`${environment.apiUrl}/catalog/sitemap`, { signal: AbortSignal.timeout(5000) });
		if (!response.ok) {
			event.node.res.statusCode = 503;
			setResponseHeaders(event, { 'Cache-Control': 'no-store', 'Retry-After': '60' });
			await send(event, 'The sitemap is unavailable.', 'text/plain; charset=utf-8');
			return true;
		}
		const { paths } = await response.json();
		const origin = originOf();
		let urls = '';
		for (const entry of paths) urls += `<url><loc>${origin}${entry}</loc></url>`;
		setResponseHeaders(event, { 'Cache-Control': 'public, max-age=3600' });
		await send(
			event,
			`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
			'application/xml; charset=utf-8',
		);
		return true;
	}

	if (path === '/robots.txt') {
		setResponseHeaders(event, { 'Cache-Control': 'public, max-age=3600' });
		await send(
			event,
			`User-agent: *\nAllow: /\n\nSitemap: ${originOf()}/sitemap.xml\n`,
			'text/plain; charset=utf-8',
		);
		return true;
	}
});
