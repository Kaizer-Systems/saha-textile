/**
 * The critical CSS plugin's request flow, with Beasties' worker and the page helpers stood in for. This file sits beside
 * `critical-css.ts`, never in `plugins/`: Nitro registers every file in that folder as a plugin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import criticalCss from './plugins/critical-css';

type Listener = (value: unknown) => void;
const fake = vi.hoisted(() => ({
	exists: true,
	workers: [] as Array<{
		source: string;
		options: { eval: boolean; workerData: Record<string, unknown> };
		listeners: Record<string, (value: unknown) => void>;
		posted: unknown[];
		unref: () => void;
	}>,
}));

vi.mock('node:fs', async (original) => ({
	...(await original<typeof import('node:fs')>()),
	existsSync: () => fake.exists,
}));
vi.mock('node:worker_threads', () => ({
	Worker: class {
		listeners: Record<string, Listener> = {};
		posted: unknown[] = [];
		unref = vi.fn();
		constructor(
			public source: string,
			public options: { eval: boolean; workerData: Record<string, unknown> },
		) {
			fake.workers.push(this);
		}
		on(name: string, listener: Listener) {
			this.listeners[name] = listener;
		}
		postMessage(message: unknown) {
			this.posted.push(message);
		}
	},
}));
vi.mock('h3', () => ({
	getRequestURL: (event: { path: string }) => new URL(event.path, 'https://shop.test'),
	getResponseStatus: (event: { status: number }) => event.status,
	setResponseHeader: (event: { headers: Record<string, string> }, name: string, value: string) => {
		event.headers[name] = value;
	},
}));
vi.mock('./critical-css', () => ({
	BEASTIES_OPTIONS: { pruneSource: false },
	MAX_SAMPLES: 2,
	stylesheetLinks: () => [{ href: '/a.css' }],
	criticalKey: (path: string) => (path === '/no-key' ? null : `key:${path}`),
	pageShape: (html: string) => new Set(html.match(/\bs\d\b/g) ?? []),
	covers: (answer: Set<string>, page: Set<string>) => [...page].every((part) => answer.has(part)),
	inlineCritical: (_html: string, css: string) => `<!doctype html>inlined:${css}`,
	sampleBody: (html: string) => html.slice(-2),
	samplesDocument: (_html: string, samples: string[]) => `doc:${samples.join('+')}`,
	addedStyles: (_input: string, output: string) => output,
	fontPreloads: () => new Set<string>(),
	preloadedFontsOnly: (css: string) => (css === 'empty' ? '' : css),
}));

type Hook = (event: unknown, response: { body?: unknown }) => void;
const ARGV = process.argv[1];

const boot = () => {
	let hook: Hook | null = null;
	criticalCss({ hooks: { hook: (_name, fn) => (hook = fn as Hook) } });
	return hook as Hook | null;
};
const visit = (hook: Hook, path: string, body: unknown = '<!doctype html> s1', over: Record<string, unknown> = {}) => {
	const event = { method: 'GET', status: 200, path, headers: {} as Record<string, string>, ...over };
	const response = { body };
	hook(event, response);
	return { header: event.headers['x-st-critical'], body: response.body };
};
const answer = (message: Record<string, unknown>, worker = fake.workers.at(-1)) =>
	worker?.listeners['message']?.(message);

beforeEach(() => {
	process.argv[1] = '/srv/shop/server/index.mjs';
	fake.exists = true;
	fake.workers.length = 0;
	delete process.env['ST_CRITICAL_CSS'];
});
afterEach(() => {
	process.argv[1] = ARGV as string;
	delete process.env['ST_CRITICAL_CSS'];
});

describe('critical CSS plugin', () => {
	it('stays out when there is no server entry, no public folder, or it is switched off', () => {
		process.argv[1] = '';
		expect(boot()).toBeNull();
		process.argv[1] = '/srv/shop/server/index.mjs';
		fake.exists = false;
		expect(boot()).toBeNull();
		fake.exists = true;
		process.env['ST_CRITICAL_CSS'] = 'off';
		expect(boot()).toBeNull();
	});

	it('passes non-GET requests, non-text bodies, non-200 answers, non-HTML and pages without a key untouched', () => {
		const hook = boot() as Hook;
		expect(visit(hook, '/a', undefined, { method: 'POST' }).header).toBeUndefined();
		expect(visit(hook, '/a', { json: true }).header).toBeUndefined();
		expect(visit(hook, '/a', '<!doctype html>', { status: 404 }).header).toBeUndefined();
		expect(visit(hook, '/a', '{"not":"html"}').header).toBeUndefined();
		expect(visit(hook, '/no-key').header).toBeUndefined();
		expect(fake.workers).toHaveLength(0);
	});

	it('works a new page out in one worker, then inlines the answer for pages it covers', () => {
		const hook = boot() as Hook;
		expect(visit(hook, '/saree', '<html> s1').header).toBe('pending');
		const [worker] = fake.workers;
		expect(worker?.options).toMatchObject({
			eval: true,
			workerData: { publicDir: '/srv/shop/public', options: { pruneSource: false } },
		});
		expect(worker?.unref).toHaveBeenCalled();
		expect(worker?.posted).toEqual([{ key: 'key:/saree', html: 'doc:s1' }]);

		// A second visit while it works sends nothing new.
		expect(visit(hook, '/saree').header).toBe('pending');
		expect(worker?.posted).toHaveLength(1);

		answer({ key: 'key:/saree', html: 'css-one' });
		const inlined = visit(hook, '/saree');
		expect(inlined).toEqual({ header: 'inlined', body: '<!doctype html>inlined:css-one' });
		expect(fake.workers).toHaveLength(1);
	});

	it('adds a page with something new to the samples, until it holds the most it may', () => {
		const hook = boot() as Hook;
		visit(hook, '/p', '<!doctype html> s1');
		answer({ key: 'key:/p', html: 'css-one' });
		expect(visit(hook, '/p', '<!doctype html> s2').header).toBe('pending');
		expect(fake.workers[0]?.posted.at(-1)).toEqual({ key: 'key:/p', html: 'doc:s1+s2' });
		answer({ key: 'key:/p', html: 'css-two' });
		expect(visit(hook, '/p', '<!doctype html> s1 s2').header).toBe('inlined');
		expect(visit(hook, '/p', '<!doctype html> s3').header).toBe('uncovered');
	});

	it('keeps nothing from a failed answer, an empty one or one it never asked for', () => {
		const hook = boot() as Hook;
		visit(hook, '/a');
		answer({ key: 'key:/a', error: 'Beasties failed' });
		expect(visit(hook, '/a').header).toBe('pending');
		answer({ key: 'key:/a', html: 'empty' });
		expect(visit(hook, '/a').header).toBe('pending');
		answer({ key: 'key:/unknown', html: 'css' });
		expect(visit(hook, '/unknown').header).toBe('pending');
	});

	it('keeps at most 32 answers, dropping the oldest', () => {
		const hook = boot() as Hook;
		for (let n = 0; n <= 32; n++) {
			visit(hook, `/page-${n}`);
			answer({ key: `key:/page-${n}`, html: `css-${n}` });
		}
		expect(visit(hook, '/page-32').header).toBe('inlined');
		expect(visit(hook, '/page-0').header).toBe('pending');
	});

	it('starts a fresh worker after one fails, forgetting the work in flight', () => {
		const hook = boot() as Hook;
		visit(hook, '/a');
		fake.workers[0]?.listeners['error']?.(new Error('crashed'));
		expect(visit(hook, '/a').header).toBe('pending');
		expect(fake.workers).toHaveLength(2);
		expect(fake.workers[1]?.posted).toEqual([{ key: 'key:/a', html: 'doc:s1' }]);
	});
});
