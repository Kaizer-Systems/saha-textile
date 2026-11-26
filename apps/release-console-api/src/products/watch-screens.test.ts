import { afterEach, describe, expect, it, vi } from 'vitest';

import * as watch from './watch.js';

import type { ProductCtx, ProductScreen } from './kit.js';
import type { RequestsView } from '@saha-textile/release-console-contracts';

/** The outside TLS checks answer locally; PayPal's always fails, CCAvenue's when asked. */
const tls = vi.hoisted(() => ({ down: false }));
vi.mock('../vendors/tls-check.js', () => ({
	checkHost: async (host: string) =>
		/bad|paypal/.test(host) || (tls.down && /ccavenue/.test(host))
			? { ok: false, error: 'expired' }
			: { ok: true, days: 60, issuer: 'Test CA' },
}));

const SCREENS = Object.entries(watch).filter(
	(e): e is [string, ProductScreen] => typeof e[1] === 'object' && e[1] !== null && 'tabs' in e[1],
);

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const running = (name: string) => ({ name, image: name, state: 'running', status: 'Up', ports: '' });
const timing = (over: Record<string, unknown> = {}) => ({
	count: 100,
	perMinute: 2,
	p50: 80,
	p95: 400,
	p99: 900,
	errorRate: 0.01,
	clientErrorRate: 0.02,
	apdex: 0.9,
	...over,
});
const route = (method: string, path: string, over: Record<string, unknown>) => ({
	...timing(over),
	service: 'api',
	method,
	route: path,
	buckets: [1, 2, 3, 0, 0, 0, 5, 0, 1, 2],
});
const NULLS = { p50: null, p95: null, p99: null };
const VIEW: RequestsView = {
	source: 'edge',
	note: null,
	minutes: 60,
	readAt: iso(NOW),
	services: [timing({ service: 'api' }), timing({ service: 'shop', ...NULLS, errorRate: 0.05 })] as never,
	routes: [
		route('GET', '/products', { p95: 1500, errorRate: 0.05 }),
		route('POST', '/cart', { ...NULLS, errorRate: 0 }),
		route('GET', '/none', { ...NULLS, errorRate: 0 }),
		route('GET', '/slow', { p95: 1500, errorRate: 0 }),
		route('GET', '/', { p95: 300, errorRate: 0 }),
	] as never,
	series: [
		[NOW - 120_000, 2000, 0.05, 40],
		[NOW - 60_000, null, 0, 0],
		[NOW, 120, 0.01, 10],
	],
};
const EMPTY_VIEW: RequestsView = {
	...VIEW,
	source: 'none',
	note: 'The local stack is not running.',
	services: [],
	routes: [],
	series: [],
};
const QUIET_VIEW: RequestsView = { ...VIEW, note: null, routes: [], services: [], series: [] };
const MID_VIEW: RequestsView = { ...VIEW, series: [[NOW, 100, 0.004, 1000]] };
const NULL_VIEW: RequestsView = { ...VIEW, routes: [route('GET', '/x', { ...NULLS, errorRate: 0.1 })] as never };

const SLOW = [
	{
		ns: 'saha_textile_local.products',
		shape: '{"sku":1,"$sort":1}',
		ms: 900,
		plan: 'COLLSCAN',
		docs: 5000,
		returned: 2,
	},
	{
		ns: 'saha_textile_local.products',
		shape: '{"sku":1,"$sort":1}',
		ms: 300,
		plan: 'COLLSCAN',
		docs: 5000,
		returned: 2,
	},
	{ ns: 'saha_textile_local.orders', shape: '', ms: 150, plan: 'IXSCAN', docs: 100, returned: 1 },
	{ ns: 'saha_textile_local.carts', shape: '{"a":1}', ms: 200, plan: 'IXSCAN', docs: 10, returned: 10 },
];
const MONGO = {
	db: 'saha_textile_local',
	stats: {},
	collections: [],
	server: {},
	ops: [],
	profile: { was: 1, slowms: 100 },
	slow: SLOW,
	rs: [],
	migrations: [],
	switches: [],
	settings: [],
	orders: [{ _id: '2026-11-24', n: 3, inr: 4500.4 }],
	payments: [
		{ _id: 'paid', n: 2 },
		{ _id: '', n: 1 },
	],
	stuckAttempts: 2,
	admins: [
		{ email: 'owner@example.test', status: '', lastLoginAt: iso(NOW) },
		{ email: 'manager@example.test', status: 'locked', lastLoginAt: iso(NOW - 86_400_000) },
	],
	sessions: [
		{ _id: 'admin', n: 1 },
		{ _id: '', n: 2 },
	],
	consent: [
		{ d: 'all', n: 4 },
		{ d: 'necessary', n: 1 },
	],
};
const LOGS = {
	lines: [
		`${iso(NOW - 60_000)} error: ECONNREFUSED 127.0.0.1:27018 (attempt 3)`,
		`${iso(NOW - 30_000)} error: ECONNREFUSED 127.0.0.1:27018 (attempt 4)`,
		`${iso(NOW)} {"level":"info","msg":"error handled"}`,
		' error without a time',
		`${iso(NOW)} fine`,
		...Array.from({ length: 12 }, (_, i) => `${iso(NOW - i)} fatal: disk full on /data/${i}`),
	],
};

/** What the Mac helper answers, by path; a function answers from the whole path. */
type Answer = unknown | ((path: string) => unknown);
const BUSY: Record<string, Answer> = {
	'/docker': {
		containers: [
			running('saha-textile-api'),
			running('saha-textile-mongo'),
			running('saha-textile-release-console'),
			{ ...running('saha-textile-old'), state: 'exited' },
		],
		stats: [],
	},
	'/logs': (path: string) => {
		if (path.includes('saha-textile-mongo')) throw new Error('no log');
		return LOGS;
	},
	'/shop-health': { stack: { status: 'up' }, dev: { status: '' } },
	'/inspect/mongo': MONGO,
	'/inspect/mongo/profile': { ok: true },
};
const QUIET: Record<string, Answer> = {
	...BUSY,
	'/docker': { containers: [running('saha-textile-api'), running('saha-textile-mongo')], stats: [] },
	'/logs': { lines: [`${iso(NOW)} fine`] },
	'/shop-health': {},
	'/inspect/mongo': {
		...MONGO,
		profile: { was: 0 },
		slow: [],
		sessions: [],
		consent: [],
		orders: [],
		payments: [],
		admins: [],
		stuckAttempts: 0,
	},
};
const BROKEN_DB: Record<string, Answer> = {
	...BUSY,
	'/inspect/mongo': () => {
		throw new Error('mongo down');
	},
};
let answers: Record<string, Answer> | null = BUSY;
const helper = vi.fn(async (_method: string, path: string) => {
	if (!answers) throw new Error('helper down');
	const key = path.split('?')[0] as string;
	if (!(key in answers)) throw new Error(`no answer for ${key}`);
	const answer = answers[key];
	return typeof answer === 'function' ? (answer as (p: string) => unknown)(path) : answer;
});

/** The shop and Cloudflare answer locally; a host named "down" refuses; analytics when asked. */
let analytics = true;
let deploysKnown = true;
const json = (body: unknown) => new Response(JSON.stringify(body));
vi.stubGlobal(
	'fetch',
	vi.fn(async (url: string, init?: RequestInit) => {
		const u = String(url);
		if (/down\.example/.test(u)) throw new Error('refused');
		if (/zones\?name=/.test(u))
			return json({ success: true, result: [{ id: 'z1', name: 'example.test', account: { id: 'a1' } }] });
		if (/rum\/site_info/.test(u))
			return json({ success: true, result: [{ site_tag: 's1', host: 'example.test', auto_install: true }] });
		if (/graphql/.test(u)) {
			if (!analytics) return json({ errors: [{ message: 'not allowed' }] });
			const query = String(init?.body);
			return json({
				data: {
					viewer: {
						zones: [
							{
								httpRequests1dGroups: [
									{
										dimensions: { date: '2026-11-23' },
										sum: { requests: 0, cachedRequests: 0 },
										uniq: {},
									},
									{
										dimensions: { date: '2026-11-24' },
										sum: { requests: 10, cachedRequests: 4 },
										uniq: {},
									},
								],
							},
						],
						accounts: /rumWebVitals/.test(query)
							? [
									{
										rumWebVitalsEventsAdaptiveGroups: [
											{
												count: 5,
												dimensions: { requestPath: '/' },
												quantiles: { largestContentfulPaintP75: 3_000_000 },
											},
											{
												count: 2,
												dimensions: { requestPath: '/en' },
												quantiles: { largestContentfulPaintP75: 900_000 },
											},
										],
									},
								]
							: [],
					},
				},
			});
		}
		if (/api\.cloudflare\.com/.test(u)) return json({ success: true, result: [] });
		if (/slow\.example/.test(u)) return new Response('busy', { status: 503 });
		return new Response('ok', { status: 200 });
	}),
);

let view: RequestsView = VIEW;
let n = 0;
const ENVS = [
	{ name: 'production', label: 'Production', domains: ['example.test', 'slow.example.test'], cloudId: 'c1' },
	{ name: 'staging', label: 'Staging', domains: ['down.example.test'], cloudId: 'c1' },
	{ name: 'local', label: 'This Mac', domains: ['localhost'], cloudId: null },
];
const ctx = (id: string | null, envs: unknown[] = ENVS): ProductCtx =>
	({
		key: `watch-key-${++n}`,
		id,
		range: '24h',
		zones: ['example.test'],
		repository: 'owner/shop',
		repo: { id: 'shop', environments: envs, sshEmails: ['owner@example.test'] },
		helper,
		localView: () => view,
		localRequests: () => view.series,
		recent: (kind: string) =>
			kind === 'incident-note' ? [{ at: iso(NOW - 600_000), detail: 'Payments slow' }] : [],
		recentAll: (kind: string) =>
			kind === 'local-job-started' && deploysKnown ? [{ at: iso(NOW - 86_400_000), detail: 'deploy local' }] : [],
		auditLog: () => [
			{ at: iso(NOW), action: 'deploy', detail: 'production', ok: true },
			{ at: iso(NOW - 60_000), action: 'pin-refused', detail: 'wrong PIN', ok: false },
		],
		keyRefs: [
			{ id: 'k1', label: 'DO', kind: 'do-token', state: 'ok', envNames: [], expiresAt: iso(NOW + 86_400_000) },
			{ id: 'k2', label: 'CF', kind: 'cf', state: 'expired', envNames: [], expiresAt: null },
		],
		consoleKey: () => 'console-key',
		envTags: () => ({}),
		writeKey: async () => 'write-key',
	}) as unknown as ProductCtx;
const write = (values: Record<string, unknown>, id: string | null = null, confirm = '') =>
	({ pin: '123456', confirm, id, values }) as never;

async function everything(id: string | null, envs: unknown[] = ENVS) {
	const out: string[] = [];
	for (const [name, screen] of SCREENS) {
		for (const [tab, read] of Object.entries(screen.tabs))
			out.push(await read(ctx(id, envs)).then(JSON.stringify, (e: Error) => `${name}.${tab}: ${e.message}`));
		for (const [key, spec] of Object.entries(screen.forms ?? {})) {
			out.push(await spec.read(ctx(id, envs)).then(JSON.stringify, (e: Error) => `${name}.${key}: ${e.message}`));
			out.push(
				await spec
					.send(ctx(id, envs), write({ note: 'Checked the logs', list: '/' }, id))
					.then(JSON.stringify, (e: Error) => `${name}.${key}: ${e.message}`),
			);
		}
	}
	return out.join('\n');
}

afterEach(() => {
	answers = BUSY;
	view = VIEW;
	analytics = true;
	deploysKnown = true;
	tls.down = false;
});

describe('the Watch screens', () => {
	it('reads a busy local stack in every tab, for the first item and for each one by id', async () => {
		const all = await everything(null);
		expect(all).toContain('ECONNREFUSED');
		for (const id of ['0', '1', '2', '3', 'api GET /products', 'api POST /cart', 'staging', 'local'])
			expect(await everything(id)).toBeTruthy();
		expect(await everything(null, [])).toBeTruthy();
	});

	it('reads a quiet stack, other request views, a failing database and a Mac whose helper does not answer', async () => {
		answers = QUIET;
		expect(await everything(null)).toBeTruthy();
		view = QUIET_VIEW;
		expect(await everything(null)).toBeTruthy();
		view = MID_VIEW;
		expect(await everything(null)).toBeTruthy();
		view = NULL_VIEW;
		expect(await everything(null)).toBeTruthy();
		view = EMPTY_VIEW;
		expect(await everything(null)).toContain('The local stack is not running.');
		answers = BROKEN_DB;
		view = VIEW;
		tls.down = true;
		analytics = false;
		expect(await everything(null)).toBeTruthy();
		answers = null;
		expect(await everything(null)).toBeTruthy();
		view = QUIET_VIEW;
		expect(await everything(null)).toBeTruthy();
		answers = BUSY;
		deploysKnown = false;
		expect(await everything(null)).toContain('before the last local release');
	});

	it('refuses an incident note that is too long', async () => {
		const results: unknown[] = [];
		for (const [, screen] of SCREENS)
			for (const spec of Object.values(screen.forms ?? {}))
				results.push(
					await spec
						.send(ctx(null), write({ note: 'x'.repeat(1001), text: 'x'.repeat(1001) }))
						.catch((e: Error) => e.message),
				);
		expect(results).toContain('Keep a note under 1,000 characters.');
	});
});
