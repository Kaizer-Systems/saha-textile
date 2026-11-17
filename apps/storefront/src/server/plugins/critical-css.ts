import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { type H3Event, getRequestURL, setResponseHeader } from 'h3';

import { addedStyles, criticalKey, inlineCritical, stylesheetLinks } from '../critical-css';

/** How long an answer is reused before it is worked out again in the background (content and pictures change). */
const REFRESH_MS = 6 * 60 * 60 * 1000;
/** At most this many answers are kept (page type × language × stylesheet set; a handful in practice). */
const MAX_ENTRIES = 32;

interface Entry {
	css: string;
	at: number;
}

/**
 * The worker that runs Beasties, off the request path: it reads the stylesheets from the shop's public folder and
 * answers with the CSS a page's elements need. One worker, one page at a time, so a burst of new pages after a
 * release costs one core, never the requests being served.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { createRequire } = require('node:module');
const load = createRequire(workerData.base);
const mod = load('beasties');
const Beasties = mod.default ?? mod;
const beasties = new Beasties({
	path: workerData.publicDir,
	publicPath: '/',
	preload: false,
	mergeStylesheets: false,
	pruneSource: false,
	inlineFonts: false,
	reduceInlineStyles: false,
	compress: true,
	logLevel: 'silent',
});
parentPort.on('message', async ({ key, html }) => {
	try {
		parentPort.postMessage({ key, html: await beasties.process(html) });
	} catch (error) {
		parentPort.postMessage({ key, error: String(error) });
	}
});
`;

/** The shop's public folder next to the built server (`dist/analog/public`), or null when it cannot be found. */
function publicDir(): string | null {
	const entry = process.argv[1];
	if (!entry) return null;
	const candidate = join(dirname(entry), '..', 'public');
	return existsSync(candidate) ? candidate : null;
}

interface NitroAppLike {
	hooks: { hook(name: 'beforeResponse', fn: (event: H3Event, response: { body?: unknown }) => void): void };
}

/**
 * Critical CSS for server-drawn pages (see `../critical-css.ts`). On a page's first visit after a release it is sent
 * as drawn and its critical CSS is worked out in the worker; later visits get it inlined, with the full stylesheets
 * loading without blocking the first paint. Pages that take no part, and every non-HTML answer, pass untouched.
 */
export default function criticalCss(nitroApp: NitroAppLike): void {
	const folder = publicDir();
	if (!folder || process.env['ST_CRITICAL_CSS'] === 'off') return;
	const cache = new Map<string, Entry>();
	const pending = new Map<string, string>();
	let worker: Worker | null = null;

	const work = (key: string, html: string) => {
		if (pending.has(key)) return;
		pending.set(key, html);
		worker ??= (() => {
			const started = new Worker(WORKER_SOURCE, {
				eval: true,
				workerData: { base: import.meta.url, publicDir: folder },
			});
			started.unref();
			started.on('message', (answer: { key: string; html?: string; error?: string }) => {
				const input = pending.get(answer.key) ?? '';
				pending.delete(answer.key);
				if (!answer.html) return;
				const css = addedStyles(input, answer.html);
				if (!css) return;
				cache.set(answer.key, { css, at: Date.now() });
				while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
			});
			started.on('error', () => {
				worker = null;
				pending.clear();
			});
			return started;
		})();
		worker.postMessage({ key, html });
	};

	nitroApp.hooks.hook('beforeResponse', (event, response) => {
		if (event.method !== 'GET' || typeof response.body !== 'string') return;
		const html = response.body;
		if (!html.startsWith('<!') && !html.startsWith('<html')) return;
		const links = stylesheetLinks(html);
		const key = criticalKey(getRequestURL(event).pathname, links, html);
		if (!key) return;
		const entry = cache.get(key);
		if (!entry || Date.now() - entry.at > REFRESH_MS) work(key, html);
		if (!entry) {
			setResponseHeader(event, 'x-st-critical', 'pending');
			return;
		}
		response.body = inlineCritical(html, entry.css, links);
		setResponseHeader(event, 'x-st-critical', 'inlined');
	});
}
