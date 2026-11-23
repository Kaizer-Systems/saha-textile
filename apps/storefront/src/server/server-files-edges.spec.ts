import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOCAL_ADMIN_ORIGIN, previewAdminOrigin } from './admin-origin';
import locale from './middleware/locale';
import preview from './middleware/preview';
import seoFiles from './middleware/seo-files';

const h3 = vi.hoisted(() => ({
	getCookie: vi.fn(() => undefined as string | undefined),
	createError: vi.fn((input: { statusCode: number }) => Object.assign(new Error('h3'), input)),
	getQuery: vi.fn((): Record<string, unknown> => ({})),
	getRequestURL: vi.fn(() => ({ protocol: 'https:', origin: 'https://origin.test' })),
	send: vi.fn(async () => undefined),
	sendRedirect: vi.fn(async () => undefined),
	setCookie: vi.fn(),
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
	delete process.env['ADMIN_ORIGIN'];
	delete process.env['DEPLOY_ENV'];
});

describe('locale middleware: short addresses', () => {
	const run = (input: unknown) => (locale as unknown as Handler)(input);

	it('sends a short address to its product page, query kept, for good', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ slug: 'red-saree' }))),
		);
		expect(await run(event('/p/AB12?utm_source=ig'))).toBe(true);
		expect(h3.sendRedirect).toHaveBeenCalledWith(expect.anything(), '/product/red-saree?utm_source=ig', 301);
	});

	it('carries on with a short address no live product has', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 404 })),
		);
		expect(await run(event('/p/ZZ99'))).toBeUndefined();
		expect(h3.sendRedirect).not.toHaveBeenCalled();
	});
});

describe('preview middleware: the remaining cases', () => {
	const run = (input: unknown) => (preview as unknown as Handler)(input);
	const code = 'c'.repeat(43);

	it('reads the address the visitor asked for, lets no one frame it without an admin, and treats an API that is away as a refusal', async () => {
		process.env['DEPLOY_ENV'] = 'production';
		h3.getQuery.mockReturnValue({ code });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new Error('down'))),
		);
		await expect(run(event('/index.html', { originalUrl: '/en/__preview/home' }))).rejects.toMatchObject({
			statusCode: 404,
		});
		expect(h3.setResponseHeaders).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ 'Content-Security-Policy': "frame-ancestors 'none'" }),
		);
	});
});

describe('the admin origin outside Node', () => {
	it('uses the local admin where there is no process at all', () => {
		const saved = globalThis.process;
		(globalThis as { process?: unknown }).process = undefined;
		try {
			expect(previewAdminOrigin()).toBe(LOCAL_ADMIN_ORIGIN);
		} finally {
			globalThis.process = saved;
		}
	});
});

describe('the sitemap: addresses without a language', () => {
	const run = (input: unknown) => (seoFiles as unknown as Handler)(input);

	it('lists an address the API gives without a language as it is', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) =>
				url.endsWith('/catalog/faq')
					? new Response('[]')
					: new Response(JSON.stringify({ paths: ['/legacy-page'] })),
			),
		);
		await run(event('/sitemap.xml', {}, { host: 'shop.test' }));
		const body = (h3.send.mock.calls.at(-1) as unknown as [unknown, string])[1];
		expect(body).toContain('<loc>https://shop.test/legacy-page</loc>');
	});
});
