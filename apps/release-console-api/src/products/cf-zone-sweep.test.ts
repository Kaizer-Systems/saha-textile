import { afterEach, describe, expect, it, vi } from 'vitest';

import * as zone from './cf-zone.js';

import type { ProductCtx, ProductFormSpec, ProductScreen } from './kit.js';

/**
 * One Cloudflare zone, with its DigitalOcean server and GitHub deploys, answers every read the
 * zone screens make; changes succeed. `mode` flips each setting the screens word differently.
 */
type Route = [RegExp, number, unknown];
let mode: 'on' | 'off' | 'null' = 'on';
const on = () => mode === 'on';
const ALL_RECORDS = [
	{ id: 'd1', type: 'A', name: 'example.test', content: '203.0.113.9', proxied: true, ttl: 1 },
	{ id: 'd2', type: 'CNAME', name: 'www.example.test', content: 'example.test', proxied: false, ttl: 300 },
	{ id: 'd3', type: 'MX', name: 'example.test', content: 'mail.example.test', priority: 10 },
	{ id: 'd4', type: 'TXT', name: 'example.test', content: 'v=spf1 include:_spf.example.test ~all' },
	{ id: 'd5', type: 'TXT', name: '_dmarc.example.test', content: 'v=DMARC1; p=none' },
	{ id: 'd6', type: 'AAAA', name: 'example.test', content: '2001:db8::1', proxied: true },
];
const SETTINGS = [
	{ id: 'development_mode', value: on() ? 'on' : 'off', modified_on: '2026-11-01T00:00:00Z', editable: true },
	{ id: 'security_header', value: { strict_transport_security: { enabled: on(), max_age: 31_536_000 } } },
	{ id: 'ssl', value: 'strict', editable: true, modified_on: '2026-11-02T00:00:00Z' },
	{ id: 'min_tls_version', value: '1.2', modified_on: '' },
	{ id: 'always_use_https', value: 'on' },
	{ id: 'brotli', value: 'on', modified_on: '2026-11-03T00:00:00Z' },
	{ id: 'early_hints', value: 'on', modified_on: '2026-11-04T00:00:00Z' },
	{ id: 'polish', value: { lossless: true }, modified_on: '2026-11-05T00:00:00Z' },
	{ id: 'rocket_loader', value: 'off' },
];
const RULES = {
	id: 'rs1',
	rules: [
		{
			id: 'w1',
			description: 'Block bad',
			expression: 'ip.src eq 1.2.3.4',
			action: 'block',
			ratelimit: { period: 60 },
			action_parameters: { response: {} },
			enabled: true,
		},
		{ id: 'w2', description: '', expression: 'true', action: 'skip', enabled: false },
		{ id: 'w3', description: '', expression: 'true', action: 'execute', action_parameters: { id: 'managed-1' } },
	],
};
const world = (): Route[] => [
	[
		/zones\?name=/,
		200,
		[
			{
				id: 'z1',
				name: 'example.test',
				account: { id: 'a1' },
				plan: { name: on() ? 'Business' : 'Free', legacy_id: on() ? 'business' : 'free' },
				development_mode: on() ? 1800 : 0,
				name_servers: ['a.ns.example'],
			},
		],
	],
	[
		/graphql/,
		200,
		{
			viewer: {
				zones: [
					{
						httpRequests1hGroups: TRAFFIC,
						httpRequests1dGroups: TRAFFIC,
						firewallEventsAdaptive: [{ action: 'block' }],
					},
				],
			},
		},
	],
	...(mode === 'null'
		? ([
				[/GET .*\/(dns_records|rules\/lists|access\/apps)/, 200, null],
				[/\/pagerules/, 500, { success: false, errors: [{ message: 'Internal error' }] }],
				[/\/(load_balancers|waiting_rooms)/, 403, null],
			] as Route[])
		: []),
	...(mode !== 'off'
		? ([
				[
					/\/subscription/,
					200,
					{
						rate_plan: { id: 'business' },
						component_values: [
							{ name: 'load_balancing', value: 1 },
							{ name: 'argo', value: 1 },
							{ name: 'waiting_rooms', value: 1 },
						],
					},
				],
			] as Route[])
		: ([
				[/\/subscription/, 403, null],
				[/\/(load_balancers|waiting_rooms)/, 403, null],
				[/\/email\/routing\/rules/, 403, null],
				[
					/\/pagerules/,
					400,
					{
						success: false,
						errors: [{ code: 1011, message: 'Page rules do not support account owned tokens' }],
					},
				],
				[
					/\/access\/apps/,
					403,
					{ success: false, errors: [{ code: 10000, message: 'Access is not enabled' }] },
				],
			] as Route[])),
	[
		/\/speed_api\/pages/,
		200,
		[
			{ url: 'example.test/', tests: { performanceScore: 91 }, region: { value: 'asia-south1' } },
			{ url: 'example.test/en', latest: {}, region: {} },
		],
	],
	[/^POST .*\/zones$/, 200, { id: 'z2', name_servers: ['a.ns.example', 'b.ns.example'] }],
	[/^(POST|PUT|PATCH|DELETE) /, 200, { id: 'new' }],
	[/\/rulesets\/zs1$/, 200, RULES],
	[
		/\/email\/routing\/rules/,
		200,
		[{ id: 'er1', name: 'Hi', actions: [{ value: ['owner@mail.example'] }], enabled: false }],
	],
	[/\/access\/apps/, 200, [{ id: 'app1', name: 'Admin', domain: 'admin.example.test', type: 'self_hosted' }]],
	[/\/argo\/smart_routing/, 200, mode === 'null' ? {} : { value: mode, editable: on() }],
	[/\/dns_records/, 200, on() ? ALL_RECORDS : ALL_RECORDS.filter((r) => ['d1', 'd6'].includes(r.id))],
	[/\/dnssec/, 200, { status: on() ? 'active' : 'pending' }],
	[/\/dns_settings/, 200, on() ? { flatten_all_cnames: true } : {}],
	[/\/settings\/[a-z_]+/, 200, SETTINGS[0]],
	[/\/settings/, 200, SETTINGS],
	[/\/rulesets\/phases\/[a-z_]+\/entrypoint/, 200, on() ? RULES : { id: 'rs1', rules: [] }],
	[
		/\/rulesets/,
		200,
		[
			{
				id: 'managed-1',
				name: 'Cloudflare Managed Ruleset',
				kind: 'managed',
				phase: 'http_request_firewall_managed',
			},
			{ id: 'zs1', name: 'custom', kind: 'zone', phase: 'http_request_firewall_custom' },
		],
	],
	[
		/\/custom_pages/,
		200,
		[
			{
				id: '500_errors',
				url: on() ? 'https://example.test/500.html' : '',
				state: on() ? 'customized' : 'default',
				modified_on: '2026-11-01T00:00:00Z',
			},
			{ id: '1000_errors', state: 'default' },
		],
	],
	[/\/bot_management/, 200, { fight_mode: on(), enable_js: on(), ai_bots_protection: on() ? 'block' : 'disabled' }],
	[
		/\/firewall\/access_rules\/rules/,
		200,
		[{ id: 'ip1', configuration: { target: 'ip', value: '1.2.3.4' }, mode: 'block' }],
	],
	[/\/ssl\/certificate_packs/, 200, [{ id: 'cp1', type: 'universal', status: 'active', hosts: ['example.test'] }]],
	[/\/origin_tls_client_auth\/settings/, 200, { enabled: on() }],
	[/\/argo\/(tiered_caching|smart_routing)/, 200, { value: mode, editable: on() }],
	[/\/email\/routing/, 200, on() ? { enabled: true } : {}],
	[
		/\/audit_logs/,
		200,
		[
			{
				when: '2026-11-24T00:00:00Z',
				actor: { email: 'owner@example.test' },
				action: { type: 'login', result: true },
			},
			{ when: '2026-11-24T00:00:00Z', actor: { type: 'system' }, action: { type: 'purge', result: false } },
		],
	],
	[
		/\/rules\/lists/,
		200,
		[
			{ id: 'l1', name: 'old-urls', kind: 'redirect', num_items: 2 },
			{ id: 'l2', name: 'old_urls', kind: 'redirect' },
		],
	],
	[
		/api\.digitalocean\.com\/v2\/droplets/,
		200,
		{
			droplets: [
				{
					name: 'shop-production',
					networks: { v4: on() ? [{ type: 'public', ip_address: '203.0.113.9' }] : [] },
				},
			],
		},
	],
	[
		/api\.github\.com/,
		200,
		{ workflow_runs: on() ? [{ display_title: 'Deploy production abc', conclusion: 'success' }] : [] },
	],
];
const TRAFFIC = [
	{
		dimensions: { datetime: '2026-11-24T00:00:00Z', date: '2026-11-24' },
		sum: {
			requests: 0,
			cachedRequests: 0,
			encryptedRequests: 0,
			countryMap: [{ clientCountryName: 'IN', requests: 0 }],
		},
		uniq: { uniques: 0 },
	},
	{
		dimensions: { datetime: '2026-11-24T01:00:00Z', date: '2026-11-25' },
		sum: {
			requests: 10,
			cachedRequests: 4,
			encryptedRequests: 9,
			clientSSLMap: [{ clientSSLProtocol: 'TLSv1.3', requests: 8 }],
			countryMap: [
				{ clientCountryName: 'IN', requests: 6 },
				{ clientCountryName: 'GB', requests: 4 },
			],
		},
		uniq: { uniques: 3 },
	},
];
const sent: string[] = [];
vi.stubGlobal(
	'fetch',
	vi.fn(async (url: string, init?: RequestInit) => {
		const line = `${init?.method ?? 'GET'} ${String(url)}`;
		sent.push(line);
		if (mode === 'null' && /digitalocean|github/.test(line)) throw new Error('offline');
		const hit = world().find(([re]) => re.test(line));
		if (mode === 'null' && hit && hit[2] === null && hit[1] === 200) return new Response('null');
		const status = hit?.[1] ?? 200;
		const body = hit ? hit[2] : [];
		if (/graphql|digitalocean|github/.test(line))
			return new Response(JSON.stringify(/graphql/.test(line) ? { data: body } : body), { status });
		return new Response(
			JSON.stringify(status >= 400 ? (body ?? { success: false, errors: [] }) : { success: true, result: body }),
			{ status },
		);
	}),
);

const SWITCH = `Switched example.test to 203.0.113.9 · before: ${JSON.stringify([
	{ type: 'A', name: 'example.test', content: '198.51.100.1', proxied: true, ttl: 300 },
	{ type: 'CNAME', name: 'www.example.test', content: 'example.test' },
])} (owner)`;
let n = 0;
const ctx = (id: string | null, envs?: unknown[]): ProductCtx => {
	const i = ++n;
	return {
		key: `cfz-key-${i}`,
		projectId: 'shop',
		repository: 'owner/shop',
		zones: ['example.test'],
		id,
		range: on() ? '24h' : '7d',
		repo: {
			id: 'shop',
			environments: envs ?? [
				{ name: 'production', label: 'Production', domains: ['example.test'], cloudId: 'c1' },
				{ name: 'staging', label: 'Staging', domains: ['staging.example.test'], cloudId: 'c1' },
			],
		},
		consoleKey: (name: string) =>
			on() || (mode === 'off' && name === 'CONSOLE_DO_WRITE_TOKEN')
				? `console-${name}`
				: mode === 'null' && name !== 'CONSOLE_CF_USER_TOKEN'
					? 'k'
					: null,
		recent: (kind: string) =>
			kind === 'dns-switch' && on() ? [{ at: '2026-11-24T00:00:00Z', detail: SWITCH }] : [],
		recentAll: () => [],
		auditLog: () => [],
		envTags: () => ({}),
		setEnvTag: () => undefined,
		pruneEnvTags: () => undefined,
		writeKey: async () => `cfz-write-${i}`,
	} as unknown as ProductCtx;
};
const write = (values: Record<string, unknown>, id: string | null, confirm = '') =>
	({ pin: '123456', confirm, id, values }) as never;

const SCREENS = Object.entries(zone).filter(
	(e): e is [string, ProductScreen] => typeof e[1] === 'object' && e[1] !== null && 'tabs' in e[1],
);
const IDS = [null, 'new', 'd1', 'd3', 'w1', 'w2', 'w3', 'cp1', 'ip1', '500_errors', 'brotli', 'nope'];
const VALUES: Array<Record<string, unknown>> = [
	{},
	{ dev: true },
	{ dev: false },
	{ type: 'A', name: 'www', content: '203.0.113.9', proxied: true, ttl: 300 },
	{ type: 'MX', name: '', content: 'mail.example.test', priority: 10, proxied: true },
	{ type: 'A', name: 'www', content: '203.0.113.9' },
	{ backup: true, wordpress: true, ip: '203.0.113.9' },
	{ backup: true, wordpress: false, ip: '203.0.113.9' },
	{ backup: true, wordpress: true, ip: 'nope' },
	{ rua: 'reports@example.test', now: true, policy: 'quarantine' },
	{ rua: 'reports@example.test', now: false },
	{ rua: 'bad address' },
	{ enabled: true, maxAge: 31_536_000, subdomains: true, preload: false },
	{ enabled: false },
	{ action: 'block', description: 'Block bad', expression: 'ip.src eq 1.2.3.4' },
	{ action: 'skip', description: 'Let in', expression: 'true' },
	{ action: 'weird', description: 'x', expression: 'true' },
	{ fight_mode: true, ai: 'block', js: true },
	{ fight_mode: false, ai: 'allow' },
	{ sensitivity: 'low', action: 'block' },
	{ everything: true },
	{ urls: 'https://example.test/a\nhttps://example.test/b' },
	{ url: 'https://example.test/500.html', page: '500_errors' },
	{ value: 'on' },
	{ value: 'off' },
	{ mode: 'strict' },
	{ mode: 'full' },
	{ type: 'A', name: 'www', content: '203.0.113.9', ttl: 300 },
	{ policy: 'reject', rua: 'bad address' },
	{ policy: 'quarantine', rua: 'reports@example.test' },
	{ enabled: true, max_age: 31_536_000, include_subdomains: true },
	{ enabled: false, max_age: 0 },
	{ ai: 'block', fight_mode: true, robots: true },
	{ ai: 'disabled', fight_mode: false },
	{ ai: 'sometimes' },
	{ description: 'Sign-in', path: '/api/auth/', requests: 20, action: 'block' },
	{ description: 'Sign-in', path: 'api', requests: 20, action: 'block' },
	{ what: 'everything' },
	{ what: 'prefixes', list: 'https://example.test/a' },
	{ what: 'files', list: 'https://example.test/a.css' },
	{ what: 'files', list: '' },
	{ description: 'Old', from: '/old', to: 'https://example.test/new', status: 302, query: true, expression: 'true' },
	{ description: 'Old', from: '/old', to: 'http://example.test/new' },
	{ description: 'Old', from: 'old', to: 'https://example.test/new' },
	{ list: 'old_urls', rows: '/a, https://example.test/b, 302\n/c, https://example.test/d\n\n' },
	{ list: 'fresh_list', rows: '/a, https://example.test/b' },
	{ list: 'old_urls', rows: '/a, http://x' },
	{ list: 'old_urls', rows: '\n' },
	{ list: 'Bad Name', rows: '/a, https://example.test/b' },
	{ list: 'old_urls', rows: '/a' },
	{ list: 'old_urls', rows: ', https://example.test/b' },
	{ name: 'newshop.example' },
];
const CONFIRMS = ['', 'production', 'example.test', 'Block bad', 'w2', 'cp1'];

async function sweep() {
	let ran = 0;
	for (const [, screen] of SCREENS) {
		for (const read of Object.values(screen.tabs)) for (const id of IDS) await read(ctx(id)).catch(() => null);
		for (const [key, spec] of Object.entries(screen.forms ?? {}) as Array<[string, ProductFormSpec]>)
			for (const id of IDS) {
				await spec.read(ctx(id)).catch(() => null);
				for (const values of VALUES) {
					await spec.send(ctx(null), write(values, id, 'production')).catch(() => null);
					await spec.send(ctx(id), write(values, null, 'example.test')).catch(() => null);
					ran += 2;
				}
				if (/destroy|delete|flip|remove/.test(key))
					for (const confirm of CONFIRMS) await spec.send(ctx(id), write({}, id, confirm)).catch(() => null);
			}
	}
	return ran;
}

afterEach(() => {
	mode = 'on';
});

describe('the zone screens', () => {
	it('reads and sends every screen against a zone with things on and with them off', async () => {
		expect(await sweep()).toBeGreaterThan(0);
		mode = 'off';
		expect(await sweep()).toBeGreaterThan(0);
		mode = 'null';
		expect(await sweep()).toBeGreaterThan(0);
		expect(sent.some((s) => s.startsWith('PATCH') || s.startsWith('PUT'))).toBe(true);
	}, 300_000);

	it('offers the flip back with no domain to name', async () => {
		const flip = SCREENS.flatMap(([, s]) => Object.entries(s.forms ?? {})).find(([key]) => key === 'flipback')?.[1];
		expect(JSON.stringify(await flip?.read({ ...ctx(null), zones: [] } as ProductCtx))).toContain(
			'"confirmName":null',
		);
	});

	it('reads the switch screen with no DigitalOcean or GitHub key at all', async () => {
		for (const [, screen] of SCREENS)
			for (const read of Object.values(screen.tabs))
				await read({ ...ctx(null), consoleKey: () => null } as ProductCtx).catch(() => null);
		expect(sent.length).toBeGreaterThan(0);
	});

	it('reads the switch screen without a production server', async () => {
		for (const [, screen] of SCREENS)
			for (const read of Object.values(screen.tabs)) await read(ctx(null, [])).catch(() => null);
		expect(sent.length).toBeGreaterThan(0);
	});
});
