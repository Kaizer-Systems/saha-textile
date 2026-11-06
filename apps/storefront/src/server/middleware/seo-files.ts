import { defineEventHandler, getRequestURL, send, setResponseHeaders } from 'h3';

import { environment } from '../../../public/environments/environment';

/**
 * `/sitemap.xml` and `/robots.txt`. Middleware rather than a server route, because Analog puts
 * every route under `/api`. Keep this file free of TypeScript-only syntax and answer with `true`,
 * for the same reasons as the locale middleware.
 */
function originOf(event) {
	const { headers } = event.node.req;
	// HTTP/2 carries the host in `:authority`, which the plain URL helper does not read.
	const host = headers['x-forwarded-host'] ?? headers[':authority'] ?? headers.host;
	const url = getRequestURL(event, { xForwardedProto: true });
	return host ? `${url.protocol}//${host}` : url.origin;
}

async function sitemap(event) {
	const response = await fetch(`${environment.apiUrl}/catalog/sitemap`, { signal: AbortSignal.timeout(5000) });
	if (!response.ok) {
		event.node.res.statusCode = 503;
		setResponseHeaders(event, { 'Cache-Control': 'no-store', 'Retry-After': '60' });
		return send(event, 'The sitemap is unavailable.', 'text/plain; charset=utf-8');
	}
	const { paths } = await response.json();
	const origin = originOf(event);
	const urls = paths.map((path) => `<url><loc>${origin}${path}</loc></url>`).join('');
	setResponseHeaders(event, { 'Cache-Control': 'public, max-age=3600' });
	return send(
		event,
		`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
		'application/xml; charset=utf-8',
	);
}

function robots(event) {
	setResponseHeaders(event, { 'Cache-Control': 'public, max-age=3600' });
	return send(
		event,
		`User-agent: *\nAllow: /\n\nSitemap: ${originOf(event)}/sitemap.xml\n`,
		'text/plain; charset=utf-8',
	);
}

export default defineEventHandler(async (event) => {
	if (event.method !== 'GET' && event.method !== 'HEAD') return;
	const req = event.node.req;
	const url = 'originalUrl' in req && typeof req.originalUrl === 'string' ? req.originalUrl : event.path;
	const path = url.split('?')[0];
	if (path === '/sitemap.xml') await sitemap(event);
	else if (path === '/robots.txt') await robots(event);
	else return;
	return true;
});
