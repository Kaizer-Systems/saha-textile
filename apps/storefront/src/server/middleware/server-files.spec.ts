import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import locale from './locale';
import seoFiles from './seo-files';

const h3 = vi.hoisted(() => ({
	getCookie: vi.fn(() => undefined as string | undefined),
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
vi.mock('../../app/core/i18n/legacy-address', () => address);
vi.mock('../../../public/environments/environment', () => ({ environment: { apiUrl: 'https://api.test' } }));

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
		const french = event('/fr/old', { originalUrl: '/fr/old' });
		expect(await run(french)).toBeUndefined();
		expect(french.node.res.statusCode).toBe(410);
		expect(french.node.req.url).toBe('/fr/gone');
		expect(french.node.req).toHaveProperty('originalUrl', '/fr/gone');
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
		address.storefrontAddress.mockReturnValue({ status: 302, location: '/fr/' });
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
