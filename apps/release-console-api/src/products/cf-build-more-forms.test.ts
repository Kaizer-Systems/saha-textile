import { afterEach, describe, expect, it, vi } from 'vitest';

import { ALERTS_EXTRA, ANALYTICS_EXTRA, BUILD_EXTRA, MEMBERS_FORMS, TURNSTILE_EXTRA } from './cf-build-more.js';

import type { ProductCtx, ProductFormSpec } from './kit.js';

/**
 * Cloudflare answers locally by method and address; the first matching route wins. A success is
 * wrapped in its envelope, a refusal is sent as given, and a string is sent as it is.
 */
type Route = [RegExp, number, unknown];
const ZONE: Route = [/zones\?name=/, 200, [{ id: 'z1', name: 'example.test', account: { id: 'a1' } }]];
const LISTS: Route[] = [
	[/GET .*workers\/scripts\?/, 200, [{ id: 'edge-worker', compatibility_date: '2026-01-01' }]],
	[/GET .*r2\/buckets\/media-bucket\/domains\/managed/, 200, { enabled: true }],
	[/GET .*r2\/buckets\/media-bucket\/cors/, 200, { rules: [{ allowed: { origins: ['https://example.test'] } }] }],
	[/GET .*r2\/buckets\?/, 200, { buckets: [{ name: 'media-bucket', location: 'apac' }] }],
	[/GET .*storage\/kv\/namespaces\?/, 200, [{ id: 'ns1', title: 'cache' }]],
	[/GET .*d1\/database\?/, 200, [{ uuid: 'd1', name: 'shopdb' }]],
	[/GET .*queues\?/, 200, [{ queue_id: 'q1', queue_name: 'jobs' }]],
	[/GET .*pages\/projects\?/, 200, [{ name: 'blog', subdomain: 'blog.pages.dev', production_branch: 'main' }]],
	[/GET .*challenges\/widgets\?/, 200, [{ sitekey: 'sk1', name: 'login', domains: ['example.test'] }]],
	[
		/GET .*alerting\/v3\/available_alerts/,
		200,
		{
			Origin: [
				{ type: 'health_check', display_name: 'Health check', description: 'x' },
				{ type: 't2', display_name: '' },
			],
		},
	],
	[
		/GET .*alerting\/v3\/policies\?/,
		200,
		[
			{
				id: 'al1',
				name: 'Down',
				alert_type: 'health_check',
				mechanisms: { email: [{ id: 'owner@example.test' }] },
				enabled: false,
			},
		],
	],
	[
		/GET .*\/members\?/,
		200,
		[
			{
				id: 'm1',
				user: { email: 'owner@example.test' },
				roles: [{ id: 'r1', name: 'Super Administrator - All Privileges' }],
				status: 'accepted',
			},
			{
				id: 'm2',
				user: { email: 'staff@example.test' },
				roles: [{ id: 'r2', name: 'Administrator' }],
				status: 'pending',
			},
		],
	],
	[/GET .*\/roles\?/, 200, [{ id: 'r2', name: 'Administrator', description: 'Everything but billing' }]],
	[
		/GET .*rules\/lists\?/,
		200,
		[
			{ id: 'l1', name: 'old-urls', kind: 'redirect', num_items: 3 },
			{ id: 'l2', name: 'blocked', kind: 'ip' },
			{ id: 'l3', name: 'fresh-list', kind: 'redirect' },
		],
	],
	[
		/GET .*vectorize\/v2\/indexes\?/,
		200,
		[{ name: 'search', config: { dimensions: 768, metric: 'cosine' } }, { name: 'bare' }],
	],
];
function cloudflare(routes: Route[]) {
	const sent: Array<{ line: string; body: unknown; type: string }> = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const line = `${init?.method ?? 'GET'} ${String(url)}`;
			sent.push({ line, body: init?.body, type: new Headers(init?.headers).get('content-type') ?? '' });
			const hit = [ZONE, ...routes, ...LISTS].find(([re]) => re.test(line));
			const status = hit?.[1] ?? 200;
			const body = hit ? hit[2] : {};
			if (typeof body === 'string') return new Response(body, { status });
			return new Response(JSON.stringify(status >= 400 ? body : { success: true, result: body }), { status });
		}),
	);
	return sent;
}
let n = 0;
const ctx = (id: string | null = null): ProductCtx => {
	const i = ++n;
	return {
		key: `cf-build-key-${i}`,
		zones: ['example.test'],
		id,
		writeKey: async () => `cf-build-write-${i}`,
	} as unknown as ProductCtx;
};
const write = (values: Record<string, unknown>, id: string | null = null, confirm = '') =>
	({ pin: '123456', confirm, id, values }) as never;
const form = (key: string) =>
	(BUILD_EXTRA.forms?.[key] ?? MEMBERS_FORMS[key as keyof typeof MEMBERS_FORMS]) as ProductFormSpec;
const changes = (sent: Array<{ line: string }>) =>
	sent.filter((s) => !s.line.startsWith('GET')).map((s) => s.line.replace(/ .*\/client\/v4\/accounts\/a1/, ' '));

afterEach(() => vi.unstubAllGlobals());

describe('Workers, R2 and KV', () => {
	it('deploys new code, saves settings without it, and refuses a new Worker with none or a bad name', async () => {
		const sent = cloudflare([[/^(PUT|POST|DELETE)/, 200, {}]]);
		const worker = form('worker');
		await expect(worker.send(ctx(), write({ name: 'Edge Worker', code: 'x' }))).rejects.toThrow('Name: lowercase');
		await expect(worker.send(ctx(), write({ name: 'fresh' }))).rejects.toThrow('Give the Worker’s code.');
		expect(
			(await worker.send(ctx(), write({ name: 'fresh', code: 'export default {}', workersDev: true })))?.message,
		).toBe('Worker fresh deployed');
		expect((await worker.send(ctx('edge-worker'), write({ date: '2026-11-01' })))?.message).toBe(
			'Worker edge-worker saved',
		);
		expect(changes(sent)).toEqual([
			'PUT /workers/scripts/fresh',
			'POST /workers/scripts/fresh/subdomain',
			'POST /workers/scripts/edge-worker/subdomain',
		]);
		expect(sent.find((s) => s.line.includes('scripts/fresh') && s.line.startsWith('PUT'))?.type).not.toContain(
			'text/plain',
		);
	});

	it('words what Cloudflare refused when uploading, with or without a reason', async () => {
		cloudflare([[/PUT .*workers\/scripts\/fresh$/, 400, { success: false, errors: [{ message: 'Bad module' }] }]]);
		await expect(form('worker').send(ctx(), write({ name: 'fresh', code: 'x' }))).rejects.toThrow(
			'Cloudflare answered 400: Bad module.',
		);
		cloudflare([[/PUT .*workers\/scripts\/fresh$/, 502, 'Bad gateway']]);
		await expect(form('worker').send(ctx(), write({ name: 'fresh', code: 'x' }))).rejects.toThrow(
			'Cloudflare answered 502.',
		);
	});

	it('makes and saves R2 buckets with their address and CORS, and refuses bad names or sites', async () => {
		const sent = cloudflare([
			[/^(PUT|POST)/, 200, {}],
			[/DELETE .*\/cors/, 500, { errors: [] }],
		]);
		const r2 = form('r2');
		const existing = JSON.stringify(await r2.read(ctx('media-bucket')));
		expect(existing).toContain('"value":"https://example.test"');
		expect(existing).not.toContain('"key":"location"');
		expect(JSON.stringify(await r2.read(ctx()))).toContain('"key":"location"');
		await expect(r2.send(ctx(), write({ name: 'X' }))).rejects.toThrow('Bucket name');
		await expect(r2.send(ctx('media-bucket'), write({ origins: 'example.test' }))).rejects.toThrow(
			'CORS sites like',
		);
		expect(
			(await r2.send(ctx(), write({ name: 'photos', location: 'apac', origins: 'https://example.test' })))
				?.message,
		).toBe('R2 bucket photos made');
		expect((await r2.send(ctx(), write({ name: 'plain' })))?.message).toBe('R2 bucket plain made');
		expect((await r2.send(ctx('media-bucket'), write({ public: true })))?.message).toBe(
			'R2 bucket media-bucket saved',
		);
		expect(changes(sent)).toEqual([
			'PUT /r2/buckets/media-bucket/domains/managed',
			'POST /r2/buckets',
			'PUT /r2/buckets/photos/domains/managed',
			'PUT /r2/buckets/photos/cors',
			'POST /r2/buckets',
			'PUT /r2/buckets/plain/domains/managed',
			'PUT /r2/buckets/media-bucket/domains/managed',
			'DELETE /r2/buckets/media-bucket/cors',
		]);
	});

	it('makes and renames KV namespaces, and writes or deletes a value', async () => {
		const sent = cloudflare([[/^(PUT|POST|DELETE)/, 200, {}]]);
		expect((await form('kv').send(ctx(), write({ title: 'sessions' })))?.message).toBe(
			'KV namespace sessions made',
		);
		expect((await form('kv').send(ctx('ns1'), write({ title: 'cache-2' })))?.message).toBe(
			'KV namespace cache-2 renamed',
		);
		const value = form('kvvalue');
		expect(JSON.stringify(await value.read(ctx()))).toContain('"value":"ns1"');
		await expect(value.send(ctx(), write({ ns: 'nope', key: 'a' }))).rejects.toThrow('Choose a namespace.');
		expect((await value.send(ctx(), write({ ns: 'ns1', key: 'a b', value: '1' })))?.message).toBe(
			'cache: a b saved',
		);
		expect((await value.send(ctx(), write({ ns: 'ns1', key: 'a', delete: true })))?.message).toBe(
			'cache: a deleted',
		);
		const put = sent.find((s) => s.line.includes('/values/a%20b'));
		expect(put?.type).toBe('text/plain');
	});
});

describe('D1, queues, Pages and Vectorize', () => {
	it('makes a D1 database but never renames one, and runs SQL', async () => {
		const sent = cloudflare([
			[/POST .*d1\/database\/d1\/query/, 200, [{ results: [{ a: 1 }], meta: { changes: 2 } }]],
			[/^(PUT|POST)/, 200, {}],
		]);
		const d1 = form('d1');
		expect(JSON.stringify(await d1.read(ctx('d1')))).toContain('"readOnly":true');
		expect(JSON.stringify(await d1.read(ctx()))).toContain('"key":"location"');
		await expect(d1.send(ctx('d1'), write({ name: 'x' }))).rejects.toThrow('keeps its name');
		await expect(d1.send(ctx(), write({ name: 'Shop DB' }))).rejects.toThrow('Name: lowercase');
		expect((await d1.send(ctx(), write({ name: 'reports', location: 'apac' })))?.message).toBe(
			'D1 database reports made',
		);
		expect((await d1.send(ctx(), write({ name: 'notes' })))?.message).toBe('D1 database notes made');
		const query = form('d1query');
		await expect(query.send(ctx(), write({ db: 'nope', sql: 'select 1' }))).rejects.toThrow('Choose a database.');
		expect((await query.send(ctx(), write({ db: 'd1', sql: 'select 1' })))?.message).toBe(
			'shopdb: 1 rows · [{"a":1}] · 2 changed',
		);
		cloudflare([[/POST .*d1\/database\/d1\/query/, 200, [{ results: [] }]]]);
		expect((await query.send(ctx(), write({ db: 'd1', sql: 'delete from x' })))?.message).toBe(
			'shopdb: 0 rows · 0 changed',
		);
		expect(changes(sent)).toContain('POST /d1/database');
	});

	it('makes and renames queues, saves a Pages project, and refuses a new one', async () => {
		cloudflare([[/^(PATCH|POST)/, 200, {}]]);
		await expect(form('queue').send(ctx(), write({ name: 'Jobs!' }))).rejects.toThrow('Name: lowercase');
		expect((await form('queue').send(ctx(), write({ name: 'mail' })))?.message).toBe('Queue mail made');
		expect((await form('queue').send(ctx('q1'), write({ name: 'jobs-2' })))?.message).toBe('Queue jobs-2 renamed');
		await expect(form('pages').send(ctx(), write({ branch: 'main' }))).rejects.toThrow('made on Cloudflare’s page');
		expect((await form('pages').send(ctx('blog'), write({ branch: 'dev' })))?.message).toBe(
			'Pages project blog saved',
		);
		cloudflare([[/GET .*pages\/projects\?/, 200, []]]);
		expect(JSON.stringify(await form('pages').read(ctx()))).toContain('made on Cloudflare’s page');
	});

	it('makes a Vectorize index of the shape asked for, never reshapes one, and keeps a list’s note', async () => {
		const sent = cloudflare([[/^(PUT|POST)/, 200, {}]]);
		const index = form('vectorize');
		await expect(index.send(ctx('search'), write({}))).rejects.toThrow('keeps its shape');
		await expect(index.send(ctx(), write({ name: 'Search!' }))).rejects.toThrow('Name: lowercase');
		expect((await index.send(ctx(), write({ name: 'faq', dimensions: 384, metric: 'euclidean' })))?.message).toBe(
			'Vectorize index faq made',
		);
		expect((await index.send(ctx(), write({ name: 'plain' })))?.message).toBe('Vectorize index plain made');
		const bodies = sent
			.filter((s) => s.line.includes('vectorize') && !s.line.startsWith('GET'))
			.map((s) => String(s.body));
		expect(bodies[0]).toContain('"dimensions":384,"metric":"euclidean"');
		expect(bodies[1]).toContain('"dimensions":768,"metric":"cosine"');
		expect(JSON.stringify(await form('redirectlist').read(ctx()))).toContain('old-urls · 3 redirects');
		expect((await form('redirectlist').send(ctx('l1'), write({ description: 'Old shop' })))?.message).toBe(
			'List saved',
		);
	});
});

describe('Turnstile, alerts, Web Analytics and members', () => {
	it('saves a widget’s mode, defaulting to managed, and refuses a mode it does not know', async () => {
		cloudflare([[/PUT/, 200, {}]]);
		const widget = TURNSTILE_EXTRA.forms?.['turnstile'] as ProductFormSpec;
		expect(JSON.stringify(await widget.read(ctx('sk1')))).toContain('"value":"managed"');
		await expect(
			widget.send(ctx('sk1'), write({ name: 'login', domains: 'example.test', mode: 'loud' })),
		).rejects.toThrow('Choose a mode.');
		expect(
			(await widget.send(ctx('sk1'), write({ name: 'login', domains: 'example.test', mode: 'invisible' })))
				?.message,
		).toBe('Turnstile widget login saved');
	});

	it('makes and saves alerts that email the team, and refuses one with no address', async () => {
		const sent = cloudflare([[/^(PUT|POST)/, 200, {}]]);
		const alert = ALERTS_EXTRA.forms?.['alert'] as ProductFormSpec;
		expect(JSON.stringify(await alert.read(ctx()))).toContain('"value":"health_check"');
		expect(JSON.stringify(await alert.read(ctx('al1')))).toContain('"value":false');
		await expect(alert.send(ctx(), write({ name: 'Down', type: 't2', emails: '' }))).rejects.toThrow(
			'Email to: addresses.',
		);
		await expect(alert.send(ctx(), write({ name: 'Down', type: 't2', emails: 'owner' }))).rejects.toThrow(
			'Email to',
		);
		expect(
			(await alert.send(ctx(), write({ name: 'Down', type: 't2', emails: 'owner@example.test' })))?.message,
		).toBe('Alert Down made');
		expect(
			(await alert.send(ctx('al1'), write({ name: 'Down 2', emails: 'owner@example.test', enabled: true })))
				?.message,
		).toBe('Alert Down 2 saved');
		expect(changes(sent)).toEqual(['POST /alerting/v3/policies', 'PUT /alerting/v3/policies/al1']);
	});

	it('turns Web Analytics on for a new site, off for an existing one, and leaves a missing one off', async () => {
		const analytics = ANALYTICS_EXTRA.forms?.['webanalytics'] as ProductFormSpec;
		let sent = cloudflare([
			[/^(PUT|POST)/, 200, {}],
			[/rum\/site_info\/list/, 200, [{ site_tag: 's1', host: 'example.test', ruleset: { enabled: false } }]],
		]);
		expect(JSON.stringify(await analytics.read(ctx()))).toContain('"value":"off"');
		expect((await analytics.send(ctx(), write({ on: 'off' })))?.message).toBe('Web Analytics off for example.test');
		expect(changes(sent)).toEqual(['PUT /rum/site_info/s1']);
		sent = cloudflare([
			[/^(PUT|POST)/, 200, {}],
			[/rum\/site_info\/list/, 200, []],
		]);
		expect((await analytics.send(ctx(), write({ on: 'on' })))?.message).toBe('Web Analytics on for example.test');
		expect((await analytics.send(ctx(), write({ on: 'off' })))?.message).toBe('Web Analytics off for example.test');
		expect(changes(sent)).toEqual(['POST /rum/site_info']);
	});

	it('shows Web Analytics on for a site with nothing switched off', async () => {
		cloudflare([[/rum\/site_info\/list/, 200, [{ site_tag: 's1', host: 'example.test', ruleset: {} }]]]);
		expect(
			JSON.stringify(await (ANALYTICS_EXTRA.forms?.['webanalytics'] as ProductFormSpec).read(ctx())),
		).toContain('"value":"on"');
	});

	it('deletes anything across the Build, Turnstile, alert, list and index screens once its name is typed', async () => {
		const sent = cloudflare([[/DELETE/, 200, {}]]);
		const cases: Array<[ProductFormSpec, string, string]> = [
			[form('builddelete'), 'worker:edge-worker', 'edge-worker'],
			[form('builddelete'), 'r2:media-bucket', 'media-bucket'],
			[form('builddelete'), 'kv:ns1', 'cache'],
			[form('builddelete'), 'd1:d1', 'shopdb'],
			[form('builddelete'), 'queue:q1', 'jobs'],
			[form('builddelete'), 'pages:blog', 'blog'],
			[TURNSTILE_EXTRA.forms?.['turnstiledelete'] as ProductFormSpec, 'turnstile:sk1', 'login'],
			[ALERTS_EXTRA.forms?.['alertdelete'] as ProductFormSpec, 'alert:al1', 'Down'],
			[form('redirectlistdelete'), 'redirectlist:l1', 'old-urls'],
			[form('vectorizedelete'), 'vectorize:search', 'search'],
		];
		for (const [spec, id, name] of cases) {
			expect(JSON.stringify(await spec.read(ctx(id)))).toContain(`"confirmName":"${name}"`);
			expect((await spec.send(ctx(), write({}, id, name)))?.message).toContain('deleted');
		}
		expect(changes(sent)).toHaveLength(cases.length);
		expect(JSON.stringify(await form('vectorizedelete').read(ctx('vectorize:bare')))).toContain('bare · 0 dims');
		expect(JSON.stringify(await form('redirectlistdelete').read(ctx('redirectlist:l3')))).toContain(
			'fresh-list · 0 redirects',
		);
	});

	it('invites and re-roles members, and never offers a super administrator for removal', async () => {
		const sent = cloudflare([[/^(PUT|POST|DELETE)/, 200, {}]]);
		const member = form('member');
		expect(JSON.stringify(await member.read(ctx('m2')))).toContain('Everything but billing');
		await expect(member.send(ctx(), write({ role: 'r2', email: 'nobody' }))).rejects.toThrow('An email address.');
		expect((await member.send(ctx(), write({ role: 'r2', email: 'New@Example.test' })))?.message).toBe(
			'new@example.test: Cloudflare emailed the invitation',
		);
		expect((await member.send(ctx('m2'), write({ role: 'r2' })))?.message).toBe('Member role changed');
		const remove = form('memberdelete');
		const view = JSON.stringify(await remove.read(ctx()));
		expect(view).toContain('staff@example.test');
		expect(view).not.toContain('owner@example.test');
		await expect(remove.send(ctx(), write({}, 'member:m1', 'owner@example.test'))).rejects.toThrow(
			'Choose what to delete.',
		);
		expect((await remove.send(ctx('member:m2'), write({}, null, 'staff@example.test')))?.message).toContain(
			'deleted',
		);
		expect(changes(sent).at(-1)).toBe('DELETE /members/m2');
	});
});
