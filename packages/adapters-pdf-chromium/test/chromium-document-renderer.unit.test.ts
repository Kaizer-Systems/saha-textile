import type { DocumentRenderRequest } from '@saha-textile/core-domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChromiumDocumentRenderer } from '../src/chromium-document-renderer';

const { launch } = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('playwright-core', () => ({ chromium: { launch } }));

const origin = 'https://document.render.invalid';
const bytes = Buffer.from('%PDF-test');
const config = { timeoutMs: 5_000, idleCloseMs: 200, concurrency: 1 };
const request: DocumentRenderRequest = {
	html: '<p>Receipt</p>',
	title: 'Receipt',
	author: 'Saha Textile',
	assets: [{ path: 'receipt style.css', contentType: 'text/css', data: Buffer.from('p{color:black}') }],
	page: { size: 'A4', landscape: false, marginMm: { top: 1, right: 2, bottom: 3, left: 4 } },
};

const browserFixture = () => {
	const page = { pdf: vi.fn(async () => bytes), setDefaultTimeout: vi.fn(), goto: vi.fn(async () => undefined) };
	const context = {
		route: vi.fn(async (_pattern: string, _handle: unknown) => undefined),
		newPage: vi.fn(async () => page),
		close: vi.fn(async () => undefined),
	};
	const browser = {
		on: vi.fn((_event: string, _callback: () => void) => undefined),
		newContext: vi.fn(async () => context),
		close: vi.fn(async () => undefined),
	};
	launch.mockResolvedValue(browser);
	return { browser, context, page };
};

type AssetRequest = {
	request: () => { url: () => string };
	fulfill: (response: { status: number; contentType: string; body: string | Buffer }) => unknown;
	abort: (reason: string) => unknown;
};

function deferred<T>() {
	// The Promise executor sets both callbacks synchronously.
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((settle, refuse) => {
		resolve = settle;
		reject = refuse;
	});
	return { promise, resolve, reject };
}

beforeEach(() => launch.mockReset());
afterEach(() => vi.useRealTimers());

describe('Chromium document renderer', () => {
	it('serves only the in-memory document and its named assets, with no browser scripting', async () => {
		const { browser, context, page } = browserFixture();
		const renderer = new ChromiumDocumentRenderer({
			...config,
			executablePath: '/chrome',
			channel: 'chrome',
			noSandbox: true,
		});
		await expect(renderer.renderPdf({ ...request, footerHtml: '<span>Tax invoice</span>' })).resolves.toEqual(
			new Uint8Array(bytes),
		);
		expect(launch).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				executablePath: '/chrome',
				channel: 'chrome',
				headless: true,
				args: expect.arrayContaining(['--no-sandbox']),
			}),
		);
		expect(browser.newContext).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				javaScriptEnabled: false,
				acceptDownloads: false,
				serviceWorkers: 'block',
			}),
		);
		expect(page.goto).toHaveBeenCalledExactlyOnceWith(`${origin}/`, {
			waitUntil: 'load',
			timeout: config.timeoutMs,
		});
		expect(page.pdf).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				format: 'A4',
				displayHeaderFooter: true,
				footerTemplate: '<span>Tax invoice</span>',
				margin: { top: '1mm', right: '2mm', bottom: '3mm', left: '4mm' },
			}),
		);
		const handle = context.route.mock.calls[0]?.[1] as (route: AssetRequest) => Promise<unknown>;
		const get = async (url: string) => {
			const route = { request: () => ({ url: () => url }), fulfill: vi.fn(), abort: vi.fn() };
			await handle(route);
			return route;
		};
		for (const path of ['/', '/index.html']) {
			const route = await get(`${origin}${path}`);
			expect(route.fulfill).toHaveBeenCalledExactlyOnceWith({
				status: 200,
				contentType: 'text/html; charset=utf-8',
				body: request.html,
			});
		}
		const asset = await get(`${origin}/receipt%20style.css`);
		expect(asset.fulfill).toHaveBeenCalledExactlyOnceWith({
			status: 200,
			contentType: 'text/css',
			body: Buffer.from('p{color:black}'),
		});
		for (const url of [`${origin}/missing.png`, 'https://cdn.example.test/logo.png']) {
			const route = await get(url);
			expect(route.abort).toHaveBeenCalledExactlyOnceWith('blockedbyclient');
			expect(route.fulfill).not.toHaveBeenCalled();
		}
		expect(context.close).toHaveBeenCalledTimes(1);
		await renderer.close();
		expect(browser.close).toHaveBeenCalledTimes(1);
	});

	it('queues renders at the concurrency limit, then closes the reused browser when idle', async () => {
		vi.useFakeTimers();
		const { browser, page } = browserFixture();
		const firstPdf = deferred<typeof bytes>();
		page.pdf.mockReturnValueOnce(firstPdf.promise);
		const renderer = new ChromiumDocumentRenderer(config);
		const first = renderer.renderPdf(request);
		const second = renderer.renderPdf(request);
		await vi.advanceTimersByTimeAsync(0);
		expect(browser.newContext).toHaveBeenCalledTimes(1);
		firstPdf.resolve(bytes);
		await Promise.all([first, second]);
		expect(browser.newContext).toHaveBeenCalledTimes(2);
		expect(launch).toHaveBeenCalledTimes(1);
		expect(page.pdf).toHaveBeenCalledWith(
			expect.objectContaining({ displayHeaderFooter: false, footerTemplate: '<span></span>' }),
		);
		await vi.advanceTimersByTimeAsync(config.idleCloseMs);
		expect(browser.close).toHaveBeenCalledTimes(1);
		await renderer.close();
	});

	it('retries a failed launch, restarts after a disconnect, and preserves a render error during cleanup', async () => {
		const { browser, context, page } = browserFixture();
		const renderer = new ChromiumDocumentRenderer(config);
		const launchError = new Error('browser could not launch');
		launch.mockRejectedValueOnce(launchError);
		await expect(renderer.renderPdf(request)).rejects.toBe(launchError);
		await renderer.renderPdf(request);
		browser.on.mock.calls[0]?.[1]();
		const renderError = new Error('print failed');
		page.pdf.mockRejectedValueOnce(renderError);
		context.close.mockRejectedValueOnce(new Error('context already stopped'));
		await expect(renderer.renderPdf(request)).rejects.toBe(renderError);
		expect(launch).toHaveBeenCalledTimes(3);
		browser.close.mockRejectedValueOnce(new Error('browser already stopped'));
		await expect(renderer.close()).resolves.toBeUndefined();
	});

	it('does not start the idle timer while another concurrent document is printing', async () => {
		vi.useFakeTimers();
		const { browser, page } = browserFixture();
		const secondPdf = deferred<typeof bytes>();
		page.pdf.mockResolvedValueOnce(bytes).mockReturnValueOnce(secondPdf.promise);
		const renderer = new ChromiumDocumentRenderer({ ...config, concurrency: 2 });
		const first = renderer.renderPdf(request);
		const second = renderer.renderPdf(request);
		await vi.advanceTimersByTimeAsync(config.idleCloseMs);
		await first;
		expect(browser.close).not.toHaveBeenCalled();
		secondPdf.resolve(bytes);
		await second;
		await vi.advanceTimersByTimeAsync(config.idleCloseMs);
		expect(browser.close).toHaveBeenCalledTimes(1);
	});

	it('can close while the browser is starting, even if that launch fails', async () => {
		const { browser } = browserFixture();
		const pending = deferred<typeof browser>();
		launch.mockReturnValueOnce(pending.promise);
		const renderer = new ChromiumDocumentRenderer(config);
		const launchError = new Error('launch interrupted');
		const rendered = expect(renderer.renderPdf(request)).rejects.toBe(launchError);
		await Promise.resolve();
		expect(launch).toHaveBeenCalledTimes(1);
		const closed = renderer.close();
		pending.reject(launchError);
		await Promise.all([rendered, closed]);
		expect(browser.close).not.toHaveBeenCalled();
		await renderer.close();
	});
});
