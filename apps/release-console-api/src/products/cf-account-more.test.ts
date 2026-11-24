import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	cfAccountScreen,
	cfAgentScreen,
	cfAiCrawlScreen,
	cfBuildScreen,
	cfDomainsScreen,
	cfProtectScreen,
	cfZeroTrustScreen,
} from './cf-account.js';

import type { ProductCtx } from './kit.js';

/**
 * Cloudflare and the shop answer locally by method and address; the first matching route wins.
 * Cloudflare answers are wrapped in its envelope; a string is sent as it is; OFFLINE throws.
 */
const OFFLINE = Symbol('offline');
type Route = [RegExp, number, unknown];
const ZONE: Route = [
	/zones\?name=/,
	200,
	[{ id: 'z1', name: 'example.test', account: { id: 'a1' }, plan: { name: 'Free' } }],
];
function vendors(routes: Route[]) {
	const sent: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const line = `${init?.method ?? 'GET'} ${String(url)}`;
			sent.push(line);
			const hit = [ZONE, ...routes].find(([re]) => re.test(line));
			if (!hit) return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
			const [, status, body] = hit;
			if (body === OFFLINE) throw new Error('offline');
			if (status === 204) return new Response(null, { status });
			if (typeof body === 'string') return new Response(body, { status });
			const envelope =
				status >= 400
					? { success: false, errors: [{ code: 9000, message: 'Refused' }] }
					: { success: true, result: body };
			return new Response(JSON.stringify(envelope), { status });
		}),
	);
	return sent;
}
let n = 0;
const ctx = (over: Partial<ProductCtx> = {}): ProductCtx =>
	({
		key: `cf-account-key-${++n}`,
		zones: ['example.test'],
		id: null,
		range: '24h',
		writeKey: async () => `cf-account-write-${n}`,
		repo: { environments: [] },
		envTags: () => ({}),
		...over,
	}) as unknown as ProductCtx;
const write = (values: Record<string, unknown>, id: string | null = null, confirm = '') =>
	({ pin: '123456', confirm, id, values }) as never;
const shown = (v: unknown) => JSON.stringify(v);

afterEach(() => vi.unstubAllGlobals());

describe('registered domains', () => {
	it('saves auto-renew and the lock for the domain in the address, and refuses with none', async () => {
		const sent = vendors([[/PUT .*registrar\/domains/, 200, {}]]);
		const edit = cfDomainsScreen.forms?.['edit'];
		await expect(edit?.send(ctx(), write({}))).rejects.toThrow('Choose a domain.');
		expect((await edit?.send(ctx({ id: 'example.test' }), write({ auto: true })))?.message).toBe(
			'example.test: auto-renew on, lock off',
		);
		expect(sent.some((s) => s.startsWith('PUT') && s.includes('/registrar/domains/example.test'))).toBe(true);
	});
});

describe('what the account builds with', () => {
	it('counts lists Cloudflare wraps in buckets, issues or widgets, and ones it wraps in nothing', async () => {
		vendors([
			[/workers\/scripts/, 200, { buckets: [{ name: 'a' }] }],
			[/pages\/projects/, 200, { issues: [{ id: 'b' }, { id: 'c' }] }],
			[/\/queues/, 200, { widgets: [{ id: 'd' }] }],
			[/durable_objects/, 200, {}],
			[/workflows/, 403, null],
		]);
		const view = shown(await cfBuildScreen.tabs['compute']?.(ctx()));
		expect(view).toContain('Workers');
		expect(view).toContain('Pages projects');
	});

	it('shows how many Cloudflare Images the account holds', async () => {
		vendors([[/images\/v1\/stats/, 200, { count: { current: 3, allowed: 100 } }]]);
		expect(shown(await cfBuildScreen.tabs['media']?.(ctx()))).toContain('3 of 100');
	});

	it('marks high and critical Security Center findings red', async () => {
		vendors([
			[
				/security-center\/insights/,
				200,
				[
					{ id: 'i1', issue_type: 'exposed_infrastructure', severity: 'High', subject: 'example.test' },
					{ id: 'i2', issue_type: 'weak_cipher', severity: 'low', subject: 'example.test' },
				],
			],
		]);
		const view = shown(await cfProtectScreen.tabs['threat']?.(ctx()));
		expect(view).toContain('"tone":"red"');
		expect(view).toContain('"tone":"amber"');
	});
});

describe('Zero Trust', () => {
	const TUNNELS: Route = [
		/GET .*cfd_tunnel\?is_deleted/,
		200,
		[{ id: 't1', name: 'web', status: 'healthy', connections: [{ colo_name: 'BLR' }] }],
	];

	it('lists tunnels with their public hostnames and private network', async () => {
		vendors([
			TUNNELS,
			[
				/GET .*cfd_tunnel\/t1\/configurations/,
				200,
				{
					config: {
						ingress: [
							{ hostname: 'grafana.example.test', service: 'http://localhost:3000' },
							{ service: 'x' },
						],
						'warp-routing': { enabled: true },
					},
				},
			],
		]);
		const view = shown(await cfZeroTrustScreen.tabs['tunnels']?.(ctx()));
		expect(view).toContain('grafana.example.test → http://localhost:3000');
		expect(view).toContain('"warp":"on"');
	});

	it('shows no service tokens when Zero Trust is on but they may not be read', async () => {
		vendors([
			[/access\/apps/, 200, []],
			[/access\/service_tokens/, 403, null],
		]);
		expect(shown(await cfZeroTrustScreen.tabs['access']?.(ctx()))).toContain('No service tokens yet.');
	});

	it('says which Zero Trust areas this key may not read, and survives one that fails', async () => {
		vendors([
			[/access\/apps/, 200, [{ id: 'app' }]],
			[/teamnet\/routes/, 403, null],
			[/gateway\/rules/, 500, null],
		]);
		const view = shown(await cfZeroTrustScreen.tabs['menu']?.(ctx()));
		expect(view).toContain('switched on');
		expect(view).toContain('not readable with this key');
	});

	it('adds a public hostname to a tunnel, keeping its other hostnames and catch-all', async () => {
		const sent = vendors([
			TUNNELS,
			[
				/GET .*cfd_tunnel\/t1\/configurations/,
				200,
				{
					config: {
						ingress: [
							{ hostname: 'old.example.test', service: 'http://localhost:1' },
							{ hostname: 'grafana.example.test', service: 'http://localhost:2' },
							{ service: 'http_status:404' },
						],
					},
				},
			],
			[/PUT .*configurations/, 200, {}],
			[/GET .*dns_records\?name=/, 200, []],
			[/POST .*dns_records/, 200, { id: 'r1' }],
		]);
		const edit = cfZeroTrustScreen.forms?.['edit'];
		await expect(edit?.send(ctx(), write({ hostname: 'a.example.test', service: 'x' }))).rejects.toThrow(
			'Choose a tunnel.',
		);
		await expect(
			edit?.send(ctx({ id: 't1' }), write({ hostname: 'grafana.elsewhere.test', service: 'x' })),
		).rejects.toThrow('must be under example.test');
		await expect(
			edit?.send(ctx({ id: 't1' }), write({ hostname: 'grafana.example.test', service: 'https://example.org' })),
		).rejects.toThrow('an address on the server itself');
		expect(
			(
				await edit?.send(
					ctx({ id: 't1' }),
					write({ hostname: 'Grafana.example.test', service: 'http://localhost:3000' }),
				)
			)?.message,
		).toBe('grafana.example.test → http://localhost:3000 through the tunnel');
		expect(sent.filter((s) => s.startsWith('POST'))).toHaveLength(1);
	});

	it('adds a 404 catch-all when the tunnel has none, and keeps a DNS record that is already there', async () => {
		const sent = vendors([
			[/GET .*cfd_tunnel\/t1\/configurations/, 200, { config: {} }],
			[/PUT .*configurations/, 200, {}],
			[/GET .*dns_records\?name=/, 200, [{ id: 'r1' }]],
		]);
		expect(
			(
				await cfZeroTrustScreen.forms?.['edit']?.send(
					ctx(),
					write({ hostname: 'ssh.example.test', service: 'ssh://localhost:22' }, 't1'),
				)
			)?.productId,
		).toBe('t1');
		expect(sent.filter((s) => s.startsWith('POST'))).toHaveLength(0);
	});

	it('deletes the tunnel in the address once its name is typed', async () => {
		vendors([
			[/GET .*cfd_tunnel\?is_deleted/, 200, [{ id: 't1', name: 'web', connections: [] }]],
			[/DELETE/, 200, {}],
		]);
		expect(
			(await cfZeroTrustScreen.forms?.['destroy']?.send(ctx({ id: 't1' }), write({}, null, 'web')))?.message,
		).toBe('Tunnel web deleted');
	});
});

describe('the account', () => {
	it('lists tokens with and without an end date, and who did what in the audit log', async () => {
		vendors([
			[/tokens\/verify/, 200, { id: 'mine' }],
			[
				/accounts\/a1\/tokens\?/,
				200,
				[
					{ id: 'mine', name: 'console', status: 'active', expires_on: '2027-01-01T00:00:00Z' },
					{ id: 'old', name: 'old', status: 'active' },
				],
			],
			[/members/, 200, []],
			[
				/audit_logs/,
				200,
				[
					{ when: '2026-11-24T00:00:00Z', actor: { email: 'owner@example.test' }, action: { type: 'login' } },
					{ when: '2026-11-24T00:00:00Z', actor: { type: 'system' }, action: { type: 'rotate' } },
				],
			],
		]);
		const tokens = shown(await cfAccountScreen.tabs['tokens']?.(ctx()));
		expect(tokens).toContain('no expiry');
		expect(tokens).toContain('console (this console)');
		const audit = shown(await cfAccountScreen.tabs['audit']?.(ctx()));
		expect(audit).toContain('owner@example.test');
		expect(audit).toContain('"who":"system"');
	});

	it('revokes the token in the address, and refuses the one the console uses', async () => {
		vendors([
			[/tokens\/verify/, 200, { id: 'mine' }],
			[
				/GET .*accounts\/a1\/tokens\?/,
				200,
				[
					{ id: 'mine', name: 'console' },
					{ id: 'old', name: 'old' },
				],
			],
			[/DELETE/, 200, {}],
		]);
		const destroy = cfAccountScreen.forms?.['destroy'];
		await expect(destroy?.send(ctx({ id: 'mine' }), write({}, null, 'console'))).rejects.toThrow(
			'the token the console is using',
		);
		expect((await destroy?.send(ctx({ id: 'old' }), write({}, null, 'old')))?.message).toBe('Token old revoked');
	});
});

describe('AI Crawl Control', () => {
	it('says when AI crawlers are blocked, and lists only rules aimed at crawlers', async () => {
		vendors([
			[/bot_management/, 200, { ai_bots_protection: 'block' }],
			[
				/http_request_firewall_custom/,
				200,
				{
					rules: [
						{
							id: 'r1',
							description: 'Block AI bots',
							expression: 'cf.verified_bot_category',
							action: 'block',
						},
						{ id: 'r2', description: 'Office', expression: 'ip.src eq 1.2.3.4', action: 'skip' },
					],
				},
			],
		]);
		expect(shown(await cfAiCrawlScreen.tabs['overview']?.(ctx()))).toContain('AI crawlers blocked');
		const rules = shown(await cfAiCrawlScreen.tabs['security']?.(ctx()));
		expect(rules).toContain('Block AI bots');
		expect(rules).not.toContain('Office');
	});

	it('reads the shop’s robots.txt: unreachable, a signal past line 80, and one near the top', async () => {
		vendors([[/robots\.txt/, 200, OFFLINE]]);
		expect(shown(await cfAiCrawlScreen.tabs['optimization']?.(ctx()))).toContain('answered nothing');
		const long = [...Array.from({ length: 90 }, (_, i) => `# line ${i}`), 'Content-Signal: ai-train=no'].join('\n');
		vendors([[/robots\.txt/, 200, long]]);
		expect(shown(await cfAiCrawlScreen.tabs['optimization']?.(ctx()))).toContain(`"Content signals","present"`);
		vendors([[/robots\.txt/, 200, 'User-agent: *\nContent-Signal: search=yes']]);
		expect(shown(await cfAiCrawlScreen.tabs['optimization']?.(ctx()))).toContain('Content-Signal: search=yes');
	});
});

describe('Agent Readiness', () => {
	const PAGE = `<main><h1>Sarees</h1>${'x'.repeat(6000)}<script>{"@type": "Store"}</script></main>`;

	it('counts every check ready when the shop answers well, and none when it is offline', async () => {
		vendors([
			[/example\.test\/$/, 200, PAGE],
			[/robots\.txt/, 200, 'User-agent: *'],
			[/sitemap\.xml/, 200, '<urlset></urlset>'],
			[/llms\.txt/, 200, '# Shop'],
		]);
		const ready = shown(await cfAgentScreen.tabs['overview']?.(ctx()));
		expect(ready).toContain('6 of 6 ready');
		expect(ready).toContain('Store');
		vendors([[/example\.test/, 200, OFFLINE]]);
		const offline = shown(await cfAgentScreen.tabs['overview']?.(ctx()));
		expect(offline).toContain('no answer');
		expect(offline).toContain('0 of 6 ready');
	});

	it('reads one page the way an agent would, and says when it does not answer', async () => {
		vendors([[/example\.test\/en\/sarees/, 200, PAGE]]);
		const page = shown(await cfAgentScreen.tabs['diagnostics']?.(ctx({ id: '/en/sarees' })));
		expect(page).toContain(`"Structured data","Store"`);
		expect(page).toContain('https://example.test/en/sarees');
		vendors([[/example\.test/, 200, OFFLINE]]);
		expect(shown(await cfAgentScreen.tabs['diagnostics']?.(ctx()))).toContain('no answer');
	});
});
