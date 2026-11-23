import type { DocumentRenderRequest, DocumentRendererPort } from '@saha-textile/core-domain';
import { type Browser, type LaunchOptions, chromium } from 'playwright-core';

/**
 * Business documents as PDF through headless Chromium (owner decision 2026-11-17).
 *
 * The browser shapes text with HarfBuzz, so Bengali conjuncts come out right, and honours CSS
 * `@page` rules (size, margins, page counters). It never reaches the network: the document and
 * its files are served from memory under a private origin and every other request is refused,
 * so a value that slipped past escaping still cannot fetch, call home or read a local file.
 */
export interface ChromiumRendererConfig {
	/** A Chromium/Chrome binary; empty uses Playwright's own (`chromium-headless-shell` in the image). */
	executablePath?: string;
	/** A browser channel such as `chrome` (local development uses the installed Chrome). */
	channel?: string;
	/** Longest a single document may take, in milliseconds. */
	timeoutMs: number;
	/** The browser closes after this long without work, so it holds no memory between bursts. */
	idleCloseMs: number;
	/** Documents rendered at the same time; the rest wait their turn. */
	concurrency: number;
	/**
	 * Chromium's own sandbox needs kernel features most containers do not give. Inside the image it
	 * is switched off; what keeps rendering safe there is that documents are our own escaped HTML,
	 * scripts are off and the network is closed. Locally the sandbox stays on.
	 */
	noSandbox?: boolean;
}

/** The private origin documents load from; nothing is ever served from it outside this process. */
const ORIGIN = 'https://document.render.invalid';

export class ChromiumDocumentRenderer implements DocumentRendererPort {
	private browser: Promise<Browser> | null = null;
	private idleTimer: NodeJS.Timeout | null = null;
	private running = 0;
	private readonly waiting: Array<() => void> = [];

	constructor(private readonly config: ChromiumRendererConfig) {}

	private launchOptions(): LaunchOptions {
		return {
			headless: true,
			...(this.config.executablePath ? { executablePath: this.config.executablePath } : {}),
			...(this.config.channel ? { channel: this.config.channel } : {}),
			args: [
				'--disable-dev-shm-usage',
				'--disable-extensions',
				'--disable-background-networking',
				'--no-first-run',
				...(this.config.noSandbox ? ['--no-sandbox'] : []),
			],
		};
	}

	private async open(): Promise<Browser> {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
		this.browser ??= chromium.launch(this.launchOptions()).then((browser) => {
			// A crashed browser is replaced on the next document instead of failing every one after it.
			browser.on('disconnected', () => {
				this.browser = null;
			});
			return browser;
		});
		try {
			return await this.browser;
		} catch (error) {
			this.browser = null;
			throw error;
		}
	}

	private async slot(): Promise<void> {
		if (this.running < Math.max(1, this.config.concurrency)) {
			this.running += 1;
			return;
		}
		await new Promise<void>((resolve) => this.waiting.push(resolve));
		this.running += 1;
	}

	private release(): void {
		this.running -= 1;
		const next = this.waiting.shift();
		if (next) {
			next();
			return;
		}
		if (this.running === 0) {
			this.idleTimer = setTimeout(() => void this.close(), this.config.idleCloseMs);
			this.idleTimer.unref();
		}
	}

	async renderPdf(request: DocumentRenderRequest): Promise<Uint8Array> {
		await this.slot();
		try {
			const browser = await this.open();
			const context = await browser.newContext({
				// The document is ours, built from escaped values; scripts are still off.
				javaScriptEnabled: false,
				acceptDownloads: false,
				serviceWorkers: 'block',
				locale: 'en-IN',
				timezoneId: 'Asia/Kolkata',
			});
			try {
				const files = new Map(request.assets.map((asset) => [asset.path, asset]));
				await context.route('**/*', async (route) => {
					const url = new URL(route.request().url());
					if (url.origin !== ORIGIN) return route.abort('blockedbyclient');
					const path = decodeURIComponent(url.pathname.replace(/^\//, ''));
					if (path === '' || path === 'index.html') {
						return route.fulfill({
							status: 200,
							contentType: 'text/html; charset=utf-8',
							body: request.html,
						});
					}
					const file = files.get(path);
					if (!file) return route.abort('blockedbyclient');
					return route.fulfill({ status: 200, contentType: file.contentType, body: Buffer.from(file.data) });
				});
				const page = await context.newPage();
				page.setDefaultTimeout(this.config.timeoutMs);
				await page.goto(`${ORIGIN}/`, { waitUntil: 'load', timeout: this.config.timeoutMs });
				const margin = request.page.marginMm;
				const pdf = await page.pdf({
					format: request.page.size,
					landscape: request.page.landscape,
					printBackground: true,
					// The document's own @page rules win (they carry the page counters).
					preferCSSPageSize: true,
					margin: {
						top: `${margin.top}mm`,
						right: `${margin.right}mm`,
						bottom: `${margin.bottom}mm`,
						left: `${margin.left}mm`,
					},
					// Tagged for screen readers; an outline only matters for long reports.
					tagged: true,
					outline: false,
					displayHeaderFooter: !!request.footerHtml,
					headerTemplate: '<span></span>',
					footerTemplate: request.footerHtml ?? '<span></span>',
				});
				return new Uint8Array(pdf);
			} finally {
				await context.close().catch(() => undefined);
			}
		} finally {
			this.release();
		}
	}

	async close(): Promise<void> {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = null;
		const browser = this.browser;
		this.browser = null;
		if (browser) await (await browser.catch(() => null))?.close().catch(() => undefined);
	}
}
