import { defineEventHandler, getRequestURL, send, setResponseHeaders } from 'h3';

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../../app/core/i18n/locale';
import { serverApiUrl } from '../api-url';

/**
 * Pages the storefront itself owns, listed in every language beside the API's products,
 * categories and posts. About Us and Offer still hold the theme's demo content and stay out
 * (they are `noindex`); FAQ is added only once it has questions.
 */
const STATIC_PAGES = [
	'/blogs',
	'/collections',
	'/contact-us',
	'/privacy-policy',
	'/refund-returns',
	'/shipping-policy',
	'/terms-conditions',
	'/videos',
];

/** Whether the shop FAQ has any questions; an empty FAQ page is `noindex`. */
const faqHasRows = async () => {
	try {
		const response = await fetch(`${serverApiUrl()}/catalog/faq`, { signal: AbortSignal.timeout(5000) });
		if (!response.ok) return false;
		const rows = await response.json();
		return Array.isArray(rows) && rows.length > 0;
	} catch {
		return false;
	}
};

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
		const [response, withFaq] = await Promise.all([
			fetch(`${serverApiUrl()}/catalog/sitemap`, { signal: AbortSignal.timeout(5000) }),
			faqHasRows(),
		]);
		if (!response.ok) {
			event.node.res.statusCode = 503;
			setResponseHeaders(event, { 'Cache-Control': 'no-store', 'Retry-After': '60' });
			await send(event, 'The sitemap is unavailable.', 'text/plain; charset=utf-8');
			return true;
		}
		const own = withFaq ? [...STATIC_PAGES, '/faq'] : STATIC_PAGES;
		const paths = [
			...new Set([
				...(await response.json()).paths,
				...SUPPORTED_LOCALES.flatMap((locale) => own.map((page) => `/${locale}${page}`)),
			]),
		].sort();
		const origin = originOf();
		// Each address names its other-language versions, the same pairs as the page heads.
		const listed = new Set(paths);
		let urls = '';
		for (const entry of paths) {
			const rest = entry.replace(/^\/[a-z]{2}(?=\/|$)/, '');
			let alternates = '';
			for (const locale of SUPPORTED_LOCALES) {
				const sibling = `/${locale}${rest}`;
				if (listed.has(sibling)) {
					alternates += `<xhtml:link rel="alternate" hreflang="${locale}" href="${origin}${sibling}"/>`;
				}
			}
			const fallback = `/${DEFAULT_LOCALE}${rest}`;
			if (alternates && listed.has(fallback)) {
				alternates += `<xhtml:link rel="alternate" hreflang="x-default" href="${origin}${fallback}"/>`;
			}
			urls += `<url><loc>${origin}${entry}</loc>${alternates}</url>`;
		}
		setResponseHeaders(event, { 'Cache-Control': 'public, max-age=3600' });
		await send(
			event,
			`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`,
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
