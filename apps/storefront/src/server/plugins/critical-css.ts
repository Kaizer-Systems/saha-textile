import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { type H3Event, getRequestURL, getResponseStatus, setResponseHeader } from 'h3';

import {
	BEASTIES_OPTIONS,
	MAX_SAMPLES,
	addedStyles,
	covers,
	criticalKey,
	fontPreloads,
	inlineCritical,
	pageShape,
	preloadedFontsOnly,
	sampleBody,
	samplesDocument,
	stylesheetLinks,
} from '../critical-css';

/** At most this many answers are kept (page type × language × stylesheet set; a handful in practice). */
const MAX_ENTRIES = 32;

/**
 * One answer: its CSS, and the shapes and sample bodies it was worked out from. It lasts as long as the build: its key
 * holds the stylesheets' hashed names, and new content is handled by the shape check, not by time.
 */
interface Entry {
	css: string;
	shape: Set<string>;
	samples: string[];
}

interface Work {
	input: string;
	shape: Set<string>;
	samples: string[];
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
const beasties = new Beasties({ ...workerData.options, path: workerData.publicDir, publicPath: '/' });
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
	const pending = new Map<string, Work>();
	let worker: Worker | null = null;

	const work = (key: string, job: Work) => {
		if (pending.has(key)) return;
		pending.set(key, job);
		worker ??= (() => {
			const started = new Worker(WORKER_SOURCE, {
				eval: true,
				workerData: { base: import.meta.url, publicDir: folder, options: BEASTIES_OPTIONS },
			});
			started.unref();
			started.on('message', (answer: { key: string; html?: string; error?: string }) => {
				const job = pending.get(answer.key);
				pending.delete(answer.key);
				if (!answer.html || !job) return;
				const css = preloadedFontsOnly(addedStyles(job.input, answer.html), fontPreloads(job.input));
				if (!css) return;
				cache.set(answer.key, { css, shape: job.shape, samples: job.samples });
				while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
			});
			started.on('error', () => {
				worker = null;
				pending.clear();
			});
			return started;
		})();
		worker.postMessage({ key, html: job.input });
	};

	nitroApp.hooks.hook('beforeResponse', (event, response) => {
		if (event.method !== 'GET' || typeof response.body !== 'string') return;
		// Only real pages: a not-found or gone page must never become a sample of its type's answer.
		if (getResponseStatus(event) !== 200) return;
		const html = response.body;
		if (!html.startsWith('<!') && !html.startsWith('<html')) return;
		const links = stylesheetLinks(html);
		const key = criticalKey(getRequestURL(event).pathname, links, html);
		if (!key) return;
		const entry = cache.get(key);
		const shape = pageShape(html);
		if (entry && covers(entry.shape, shape)) {
			response.body = inlineCritical(html, entry.css, links);
			setResponseHeader(event, 'x-st-critical', 'inlined');
			return;
		}
		// Something on this page is new to the answer: it keeps its blocking stylesheets, and its shape joins the
		// samples, until the answer holds MAX_SAMPLES shapes.
		const samples = entry?.samples ?? [];
		if (samples.length >= MAX_SAMPLES) {
			setResponseHeader(event, 'x-st-critical', 'uncovered');
			return;
		}
		const joined = [...samples, sampleBody(html)];
		work(key, {
			input: samplesDocument(html, joined),
			shape: new Set([...(entry?.shape ?? []), ...shape]),
			samples: joined,
		});
		setResponseHeader(event, 'x-st-critical', 'pending');
	});
}
