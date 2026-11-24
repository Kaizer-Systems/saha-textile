import { afterEach, describe, expect, it, vi } from 'vitest';

import * as more from './cf-zone-more.js';

import type { ProductCtx, ProductFormSpec, ProductScreen } from './kit.js';

/**
 * One Cloudflare zone answers every read the zone extras make; changes succeed. Two settings of
 * the same zone (`on`, `off`) flip each read the forms compare against.
 */
type Route = [RegExp, number, unknown];
let mode: 'on' | 'off' = 'on';
let imports = 0;
const world = (): Route[] => [
	[/zones\?name=/, 200, [{ id: 'z1', name: 'example.test', account: { id: 'a1' } }]],
	[
		/graphql/,
		200,
		{
			viewer: {
				zones: [
					{ firewallEventsAdaptive: [{ action: 'block', clientIP: '1.2.3.4' }, { action: 'challenge' }] },
				],
			},
		},
	],
	// The DNS import answers in turn: imported, refused with a reason, and a gateway error.
	[
		/^POST .*dns_records\/import/,
		...((
			[
				[200, { recs_added: 2, total_records_parsed: 3 }],
				[400, { success: false, errors: [{ message: 'Bad zone file' }] }],
				[502, 'Bad gateway'],
			] as const
		)[imports++ % 3] as [number, unknown]),
	] as Route,
	[/^(POST|PUT|PATCH|DELETE) /, 200, {}],
	[
		/\/dnssec/,
		200,
		mode === 'on' ? { status: 'active', ds: 'example.test. 3600 IN DS 2371 13 2 ABC' } : { status: 'disabled' },
	],
	[/\/dns_settings/, 200, mode === 'on' ? { flatten_all_cnames: true, ns_ttl: 3600 } : {}],
	[
		/\/workers\/routes/,
		200,
		[
			{ id: 'rt1', pattern: 'example.test/api/*', script: 'edge' },
			{ id: 'rt2', pattern: 'example.test/x', script: '' },
		],
	],
	[
		/\/email\/routing\/rules\/catch_all/,
		200,
		{
			enabled: mode === 'on',
			actions: [mode === 'on' ? { type: 'drop' } : { type: 'forward', value: ['owner@mail.example'] }],
		},
	],
	[
		/\/email\/routing\/rules/,
		200,
		[
			{
				id: 'er1',
				name: '',
				matchers: [{ value: 'hi@example.test' }],
				actions: [{ type: 'forward', value: ['owner@mail.example'] }],
			},
			{
				id: 'er2',
				name: 'Worker',
				matchers: [{ value: 'w@example.test' }],
				actions: [{ type: 'worker', value: ['mailer'] }],
			},
			{ id: 'er3', name: 'Odd', matchers: [{ value: 'o@example.test' }], actions: [{ type: '' }] },
		],
	],
	[
		/\/email\/routing\/addresses/,
		200,
		[
			{ id: 'ad1', email: 'owner@mail.example', verified: '2026-11-01T00:00:00Z' },
			{ id: 'ad2', email: 'new@mail.example', verified: '' },
		],
	],
	[/\/email\/routing/, 200, { enabled: mode === 'on', status: 'ready' }],
	[/\/ssl\/universal\/settings/, 200, { enabled: mode === 'on' }],
	[
		/\/custom_hostnames\/fallback_origin/,
		200,
		{ origin: 'origin.example.test', status: mode === 'on' ? 'active' : 'pending' },
	],
	[
		/\/custom_hostnames/,
		200,
		[{ id: 'ch1', hostname: 'shop.partner.example', ssl: { status: 'active', method: 'http' } }],
	],
	[
		/\/firewall\/ua_rules/,
		200,
		[
			{ id: 'ua1', description: '', configuration: { value: 'BadBot' }, mode: 'block' },
			{ id: 'ua2', description: 'Scrapers', configuration: { value: 'Scraper' }, mode: 'challenge' },
		],
	],
	[
		/\/firewall\/access_rules\/rules/,
		200,
		[{ id: 'ip1', configuration: { target: 'ip', value: '203.0.113.7' }, mode: 'block', notes: 'x' }],
	],
	[
		/\/access\/apps/,
		200,
		[
			{
				id: 'app1',
				name: 'Admin',
				domain: 'admin.example.test',
				type: 'self_hosted',
				policies: [
					{
						include: [
							{ email: { email: 'owner@example.test' } },
							{ email_domain: { domain: 'example.test' } },
						],
					},
				],
			},
			{ id: 'ssh1', name: 'SSH', domain: 'ssh.example.test', type: 'ssh' },
			{ id: 'other', name: 'Other', domain: 'x.other.test', type: 'self_hosted' },
		],
	],
	[
		/http_custom_errors\/entrypoint/,
		200,
		{ id: 'rsE', rules: [{ id: 'ce1', description: 'Down', action_parameters: { status_code: 503 } }] },
	],
	[/\/cache\/tiered_cache_smart_topology_enable/, 200, { value: mode }],
	[/\/argo\/smart_routing/, 200, { value: mode, editable: mode === 'on' }],
	[/\/accounts\/a1\/workers\/scripts/, 200, [{ id: 'edge' }]],
];
const sent: string[] = [];
vi.stubGlobal(
	'fetch',
	vi.fn(async (url: string, init?: RequestInit) => {
		const line = `${init?.method ?? 'GET'} ${String(url)}`;
		sent.push(line);
		const hit = world().find(([re]) => re.test(line));
		const status = hit?.[1] ?? 200;
		const body = hit ? hit[2] : [];
		if (typeof body === 'string') return new Response(body, { status });
		if (/graphql/.test(line)) return new Response(JSON.stringify({ data: body }), { status });
		return new Response(JSON.stringify(status >= 400 ? body : { success: true, result: body }), { status });
	}),
);

let n = 0;
const ctx = (id: string | null): ProductCtx => {
	const i = ++n;
	return {
		key: `cfzm-key-${i}`,
		zones: ['example.test'],
		id,
		range: '24h',
		writeKey: async () => `cfzm-write-${i}`,
	} as unknown as ProductCtx;
};
const write = (values: Record<string, unknown>, id: string | null, confirm = '') =>
	({ pin: '123456', confirm, id, values }) as never;

const EXTRAS = Object.entries(more).filter(
	(e): e is [string, more.ScreenExtra] =>
		typeof e[1] === 'object' && e[1] !== null && ('forms' in e[1] || 'tabs' in e[1]),
);
const IDS = [
	null,
	'new',
	'rt1',
	'er1',
	'er2',
	'rule:er1',
	'address:ad2',
	'ch1',
	'ua1',
	'ua:ua1',
	'ip:ip1',
	'app1',
	'ssh1',
	'ce1',
	'nope',
];
/** Values that take each form down its paths: good ones, refused ones, and the other choices. */
const VALUES: Array<Record<string, unknown>> = [
	{},
	{ dnssec: 'on', flatten: 'all', nsTtl: 3600 },
	{ dnssec: 'off', flatten: 'apex', nsTtl: '86400' },
	{ dnssec: 'on', nsTtl: '10' },
	{ zone: 'example.test. 300 IN A 203.0.113.7', file: 'example.test. 300 IN A 203.0.113.7' },
	{ zonefile: 'example.test. 300 IN A 203.0.113.7', proxied: true },
	{ ua: 'BadBot', mode: 'block', description: '' },
	{ pattern: 'example.test/api/*', script: 'edge' },
	{ pattern: 'example.test/api/*' },
	{ address: 'hi@example.test', action: 'forward', to: 'owner@mail.example', name: '' },
	{ address: 'hi@example.test', action: 'forward', to: 'not-mail', name: 'Hi' },
	{ address: 'hi@example.test', action: 'forward', to: '' },
	{ address: 'w@example.test', action: 'worker', to: 'mailer' },
	{ address: 'w@example.test', action: 'worker', to: '' },
	{ address: 'd@example.test', action: 'drop' },
	{ address: 'd@example.test', action: 'bounce' },
	{ address: 'someone@other.test', action: 'drop' },
	{ on: 'on', catchAll: true, action: 'drop' },
	{ on: 'off', catchAll: false },
	{ email: 'new@mail.example' },
	{ hostname: 'shop.partner.example', method: 'txt' },
	{ hostname: 'Not A Host', method: 'http' },
	{ origin: 'origin.example.test' },
	{ value: 'BadBot', mode: 'block', description: '' },
	{ value: 'BadBot', mode: 'explode' },
	{ mode: 'challenge', notes: 'checked' },
	{ mode: 'explode' },
	{ name: 'Admin', domain: 'admin.example.test', emails: 'owner@example.test', domains: '', session: '' },
	{ name: 'Admin', domain: 'admin.example.test', emails: '', domains: 'example.test', session: '6h' },
	{ name: 'Admin', domain: 'admin.example.test', emails: 'owner', domains: '' },
	{ name: 'Admin', domain: 'admin.example.test', emails: '', domains: '' },
	{ description: 'Down', expression: 'true', status: '503', content: '<h1>Back soon</h1>', contentType: '' },
	{ description: 'Down', expression: 'true', status: 'abc', content: 'x' },
	{ description: 'Down', expression: 'true', status: '503', content: 'x'.repeat(10_241) },
	{ url: 'https://example.test/', region: '', weekly: true },
	{ url: 'https://example.test/', region: 'mars-1', weekly: false },
	{ url: 'https://example.test/', region: 'asia-south1' },
	{ enabled: 'off' },
	{ smart: 'on' },
	{ smart: 'off' },
	{ on: 'on' },
	{ on: 'off' },
];
const CONFIRMS = [
	'',
	'example.test/api/*',
	'hi@example.test',
	'new@mail.example',
	'shop.partner.example',
	'BadBot',
	'203.0.113.7',
	'Admin',
];

async function sweep() {
	let ran = 0;
	for (const [, extra] of EXTRAS) {
		for (const read of Object.values(extra.tabs ?? {})) for (const id of IDS) await read(ctx(id)).catch(() => null);
		for (const [key, spec] of Object.entries(extra.forms ?? {}) as Array<[string, ProductFormSpec]>)
			for (const id of IDS) {
				await spec.read(ctx(id)).catch(() => null);
				for (const values of VALUES) {
					// The item in the form's own field, and in the address.
					await spec.send(ctx(null), write(values, id)).catch(() => null);
					await spec.send(ctx(id), write(values, null)).catch(() => null);
					ran += 2;
				}
				if (/destroy|delete/.test(key))
					for (const confirm of CONFIRMS) await spec.send(ctx(id), write({}, id, confirm)).catch(() => null);
			}
	}
	return ran;
}

afterEach(() => {
	mode = 'on';
});

describe('the zone extras', () => {
	it('adds buttons only to tabs the screen has, and only to views', () => {
		const screen: ProductScreen = {
			vendor: 'cloudflare',
			tabs: {
				list: async () => ({ type: 'view', picker: null, view: { actions: [] } }) as never,
				edit: async () => ({ type: 'form', picker: null, form: {} }) as never,
			},
		};
		const out = more.extend(screen, {
			buttons: {
				list: [{ label: 'Add', form: 'add', tone: 'primary' }] as never,
				edit: [{ label: 'X', form: 'x' }] as never,
				missing: [{ label: 'Y', form: 'y' }] as never,
			},
		});
		expect(out.tabs['missing']).toBeUndefined();
		return Promise.all([out.tabs['list']?.(ctx(null)), out.tabs['edit']?.(ctx(null))]).then(([list, edit]) => {
			expect(JSON.stringify(list)).toContain('"form":"add"');
			expect(JSON.stringify(edit)).not.toContain('"form":"x"');
		});
	});

	it('reads and sends every form of the zone extras, against a zone with things on and with them off', async () => {
		expect(await sweep()).toBeGreaterThan(0);
		mode = 'off';
		expect(await sweep()).toBeGreaterThan(0);
		expect(sent.some((s) => s.startsWith('PATCH'))).toBe(true);
	}, 300_000);
});
