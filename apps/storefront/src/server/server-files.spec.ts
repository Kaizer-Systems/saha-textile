import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { serverApiUrl } from './api-url';
import locale from './middleware/locale';
import seoFiles from './middleware/seo-files';
import webManifest from './middleware/web-manifest';

const h3 = vi.hoisted(() => ({
	getCookie: vi.fn(() => undefined as string | undefined),
	getQuery: vi.fn((): Record<string, unknown> => ({})),
	getRequestURL: vi.fn(() => ({ protocol: 'https:', origin: 'https://origin.test' })),
	send: vi.fn(async () => undefined),
	sendRedirect: vi.fn(async () => undefined),
	setResponseHeaders: vi.fn(),
}));

const address = vi.hoisted(() => ({
	legacyCatalogReady: vi.fn(() => true),
	refreshLegacyCatalog: vi.fn(async () => {}),
	storefrontAddress: vi.fn((): unknown => null),
}));

vi.mock('h3', () => ({ ...h3, defineEventHandler: (handler: unknown) => handler }));
vi.mock('../app/core/i18n/legacy-address', () => address);
vi.mock('../../public/environments/environment', () => ({ environment: { apiUrl: 'https://api.test' } }));

type Handler = (event: unknown) => Promise<unknown>;

const event = (path: string, overrides: Record<string, unknown> = {}, headers: Record<string, string> = {}) => ({
	method: 'GET',
	path,
	node: { req: { url: path, headers, ...overrides }, res: { statusCode: 200 } },
});

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env['SAHA_TEXTILE_PUBLIC_CONFIG'];
});

describe('serverApiUrl', () => {
	it("reads the deployment's config, which Angular's start-up never applies here", () => {
		process.env['SAHA_TEXTILE_PUBLIC_CONFIG'] = JSON.stringify({ apiUrl: 'https://api.shop.test' });
		expect(serverApiUrl()).toBe('https://api.shop.test');
	});

	it('falls back to the local default when the config is missing, empty or broken', () => {
		expect(serverApiUrl()).toBe('https://api.test');
		for (const value of ['', '{"siteUrl":"https://shop.test"}', '{"apiUrl":5}', '{"apiUrl":""}', 'not json']) {
			process.env['SAHA_TEXTILE_PUBLIC_CONFIG'] = value;
			expect(serverApiUrl()).toBe('https://api.test');
		}
	});
});

describe('locale middleware', () => {
	const run = (input: unknown) => (locale as unknown as Handler)(input);

	it('leaves anything but a page read alone', async () => {
		expect(await run({ ...event('/x'), method: 'POST' })).toBeUndefined();
		expect(address.refreshLegacyCatalog).not.toHaveBeenCalled();
	});

	it('passes through a page that needs no change', async () => {
		expect(await run(event('/en/'))).toBeUndefined();
		expect(address.storefrontAddress).toHaveBeenCalledWith('/en/', undefined);
	});

	it('reads the path the visitor asked for', async () => {
		await run({ ...event('/index.html', { originalUrl: '/asked' }), method: 'HEAD' });
		expect(address.storefrontAddress).toHaveBeenCalledWith('/asked', undefined);
		await run(event('/index.html', { originalUrl: 5 }));
		expect(address.storefrontAddress).toHaveBeenLastCalledWith('/index.html', undefined);
	});

	it('renders the gone page for a 410, in the language of the address', async () => {
		address.storefrontAddress.mockReturnValue({ status: 410 });
		const bengali = event('/bn/old', { originalUrl: '/bn/old' });
		expect(await run(bengali)).toBeUndefined();
		expect(bengali.node.res.statusCode).toBe(410);
		expect(bengali.node.req.url).toBe('/bn/gone');
		expect(bengali.node.req).toHaveProperty('originalUrl', '/bn/gone');
		expect(h3.setResponseHeaders).toHaveBeenCalledWith(expect.anything(), {
			'Cache-Control': 'public, max-age=3600',
			'X-Robots-Tag': 'noindex',
		});
		const english = event('/old');
		await run(english);
		expect(english.node.req.url).toBe('/en/gone');
		expect(english.node.req).not.toHaveProperty('originalUrl');
	});

	it('refuses to cache a 410 before the catalogue has loaded', async () => {
		address.storefrontAddress.mockReturnValue({ status: 410 });
		address.legacyCatalogReady.mockReturnValue(false);
		await run(event('/old'));
		expect(h3.setResponseHeaders).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ 'Cache-Control': 'no-store' }),
		);
		address.legacyCatalogReady.mockReturnValue(true);
	});

	it('redirects, keeping a 302 private', async () => {
		address.storefrontAddress.mockReturnValue({ status: 302, location: '/bn/' });
		expect(await run(event('/'))).toBe(true);
		expect(h3.setResponseHeaders).toHaveBeenCalledWith(expect.anything(), {
			'Cache-Control': 'private, no-store',
			Vary: 'Cookie',
		});
		address.storefrontAddress.mockReturnValue({ status: 301, location: '/en/x' });
		h3.setResponseHeaders.mockClear();
		expect(await run(event('/x'))).toBe(true);
		expect(h3.setResponseHeaders).not.toHaveBeenCalled();
		expect(h3.sendRedirect).toHaveBeenLastCalledWith(expect.anything(), '/en/x', 301);
	});

	it('does nothing with an answer that has no address', async () => {
		address.storefrontAddress.mockReturnValue({ status: 301 });
		expect(await run(event('/x'))).toBeUndefined();
		expect(h3.sendRedirect).not.toHaveBeenCalled();
	});
});

describe('SEO files', () => {
	const run = (input: unknown) => (seoFiles as unknown as Handler)(input);

	it('ignores other methods and paths', async () => {
		expect(await run({ ...event('/robots.txt'), method: 'POST' })).toBeUndefined();
		expect(await run(event('/other?x=1'))).toBeUndefined();
	});

	it('serves robots with the host the visitor used', async () => {
		expect(await run(event('/robots.txt', {}, { host: 'shop.test' }))).toBe(true);
		expect(h3.send).toHaveBeenLastCalledWith(
			expect.anything(),
			expect.stringContaining('Sitemap: https://shop.test/sitemap.xml'),
			expect.any(String),
		);
		await run(event('/robots.txt?x=1', {}, { 'x-forwarded-host': 'edge.test', host: 'shop.test' }));
		expect(h3.send).toHaveBeenLastCalledWith(
			expect.anything(),
			expect.stringContaining('https://edge.test/'),
			expect.any(String),
		);
		await run({ ...event('/robots.txt', {}, { ':authority': 'h2.test' }), method: 'HEAD' });
		expect(h3.send).toHaveBeenLastCalledWith(
			expect.anything(),
			expect.stringContaining('https://h2.test/'),
			expect.any(String),
		);
		await run(event('/robots.txt'));
		expect(h3.send).toHaveBeenLastCalledWith(
			expect.anything(),
			expect.stringContaining('https://origin.test/'),
			expect.any(String),
		);
	});

	it('reads the path the visitor asked for', async () => {
		expect(await run(event('/index.html', { originalUrl: '/robots.txt' }))).toBe(true);
		expect(await run(event('/index.html', { originalUrl: 5 }))).toBeUndefined();
	});

	it('lists the live addresses', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ paths: ['/en/', '/en/product/red'] }))),
		);
		await run(event('/sitemap.xml', {}, { host: 'shop.test' }));
		const body = (h3.send.mock.calls.at(-1) as unknown as [unknown, string])[1];
		expect(body).toContain('<loc>https://shop.test/en/product/red</loc>');
	});

	it('names the other-language version of each address, with English as the default', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ paths: ['/bn/product/red', '/en/product/red', '/en/about'] })),
			),
		);
		await run(event('/sitemap.xml', {}, { host: 'shop.test' }));
		const body = (h3.send.mock.calls.at(-1) as unknown as [unknown, string])[1];
		const pair =
			'<xhtml:link rel="alternate" hreflang="en" href="https://shop.test/en/product/red"/>' +
			'<xhtml:link rel="alternate" hreflang="bn" href="https://shop.test/bn/product/red"/>' +
			'<xhtml:link rel="alternate" hreflang="x-default" href="https://shop.test/en/product/red"/>';
		expect(body).toContain(`<loc>https://shop.test/bn/product/red</loc>${pair}</url>`);
		expect(body).toContain(`<loc>https://shop.test/en/product/red</loc>${pair}</url>`);
		expect(body).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
	});

	const sitemapWith = (faq: () => Promise<Response>) =>
		vi.fn(async (url: string) =>
			url.endsWith('/catalog/faq')
				? faq()
				: new Response(JSON.stringify({ paths: ['/en/', '/en/contact-us', '/bn/blog/bn-only'] })),
		);
	const sitemapBody = () => (h3.send.mock.calls.at(-1) as unknown as [unknown, string])[1];

	it("adds the shop's own pages in every language, once each, leaving out an empty FAQ", async () => {
		vi.stubGlobal(
			'fetch',
			sitemapWith(async () => new Response('[]')),
		);
		await run(event('/sitemap.xml', {}, { host: 'shop.test' }));
		const body = sitemapBody();
		for (const page of [
			'/blogs',
			'/collections',
			'/contact-us',
			'/privacy-policy',
			'/terms-conditions',
			'/videos',
		]) {
			expect(body).toContain(`<loc>https://shop.test/en${page}</loc>`);
			expect(body).toContain(`<loc>https://shop.test/bn${page}</loc>`);
		}
		expect(body.split('<loc>https://shop.test/en/contact-us</loc>')).toHaveLength(2);
		expect(body).not.toContain('/faq');
		expect(body).not.toContain('/about-us');
		// A page in Bengali only names itself, with no English default to point at.
		expect(body).toContain(
			'<loc>https://shop.test/bn/blog/bn-only</loc><xhtml:link rel="alternate" hreflang="bn" href="https://shop.test/bn/blog/bn-only"/></url>',
		);
	});

	it('lists the FAQ once it has questions, and not when it cannot be read', async () => {
		vi.stubGlobal(
			'fetch',
			sitemapWith(async () => new Response('[{"id":"q1"}]')),
		);
		await run(event('/sitemap.xml', {}, { host: 'shop.test' }));
		expect(sitemapBody()).toContain('<loc>https://shop.test/bn/faq</loc>');
		vi.stubGlobal(
			'fetch',
			sitemapWith(async () => new Response('', { status: 500 })),
		);
		await run(event('/sitemap.xml', {}, { host: 'shop.test' }));
		expect(sitemapBody()).not.toContain('/faq');
		vi.stubGlobal(
			'fetch',
			sitemapWith(async () => {
				throw new Error('down');
			}),
		);
		await run(event('/sitemap.xml', {}, { host: 'shop.test' }));
		expect(sitemapBody()).not.toContain('/faq');
	});

	it('answers 503 when the list cannot be read', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('', { status: 500 })),
		);
		const request = event('/sitemap.xml');
		await run(request);
		expect(request.node.res.statusCode).toBe(503);
		expect(h3.setResponseHeaders).toHaveBeenLastCalledWith(expect.anything(), {
			'Cache-Control': 'no-store',
			'Retry-After': '60',
		});
	});
});

describe('web manifest middleware', () => {
	const run = (input: unknown) => (webManifest as unknown as Handler)(input);
	const sent = () => JSON.parse((h3.send.mock.calls as unknown[][])[0][1] as string) as Record<string, unknown>;
	const brand = {
		shopName: 'Sample Shop',
		icons: { '192': 'https://cdn.test/192.png', '512': 'https://cdn.test/512.png' },
	};

	it('leaves everything else alone', async () => {
		expect(await run({ ...event('/manifest.webmanifest'), method: 'POST' })).toBeUndefined();
		expect(await run(event('/en/'))).toBeUndefined();
		expect(h3.send).not.toHaveBeenCalled();
	});

	it('serves the Brand Kit in the language asked for', async () => {
		h3.getQuery.mockReturnValue({ lang: 'bn' });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => brand })),
		);
		expect(await run(event('/manifest.webmanifest?lang=bn'))).toBe(true);
		expect(fetch).toHaveBeenCalledWith('https://api.test/storefront/brand', expect.anything());
		expect(sent()).toMatchObject({ name: 'Sample Shop', start_url: '/bn/' });

		process.env['SAHA_TEXTILE_PUBLIC_CONFIG'] = JSON.stringify({ apiUrl: 'https://api.shop.test' });
		await run(event('/manifest.webmanifest?lang=bn'));
		expect(fetch).toHaveBeenLastCalledWith('https://api.shop.test/storefront/brand', expect.anything());
		expect(h3.setResponseHeaders).toHaveBeenCalledWith(expect.anything(), {
			'Cache-Control': 'public, max-age=300',
		});
		expect((h3.send.mock.calls as unknown[][])[0][2]).toBe('application/manifest+json; charset=utf-8');
	});

	it('reads the path the visitor asked for, and refuses an unknown language', async () => {
		h3.getQuery.mockReturnValue({ lang: 'de' });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => brand })),
		);
		const input = { ...event('/index.html', { originalUrl: '/manifest.webmanifest?lang=de' }), method: 'HEAD' };
		expect(await run(input)).toBe(true);
		expect(sent()).toMatchObject({ start_url: '/en/' });
	});

	it('still answers, uncached, when the API fails or refuses', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false })),
		);
		await run(event('/manifest.webmanifest'));
		expect(sent()).toMatchObject({ name: 'Saha Textile' });
		expect(h3.setResponseHeaders).toHaveBeenLastCalledWith(expect.anything(), { 'Cache-Control': 'no-store' });

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new Error('down'))),
		);
		expect(await run(event('/manifest.webmanifest'))).toBe(true);
		expect(h3.setResponseHeaders).toHaveBeenLastCalledWith(expect.anything(), { 'Cache-Control': 'no-store' });
	});
});
