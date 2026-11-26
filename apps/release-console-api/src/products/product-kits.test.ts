import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	addRule,
	cfAll,
	cfSoft,
	counts,
	entrypoint,
	expression,
	rulesTable,
	settingsForm,
	settingsView,
	traffic,
} from './cf-kit.js';
import { actionDone, doAll, dropletName, dropletSeries, laterAction } from './do-kit.js';
import { ago, bytes, forget, read, soft, write, yes } from './kit.js';

import type { ProductCtx } from './kit.js';

/** Every vendor answers locally, by method and address; the first matching route wins. */
type Route = [RegExp, number, unknown];
function vendor(routes: Route[]) {
	const sent: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const line = `${init?.method ?? 'GET'} ${url}`;
			sent.push(line);
			const hit = routes.find(([re]) => re.test(line));
			if (!hit) return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
			const [, status, body] = hit;
			if (status === 204) return new Response(null, { status });
			return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
		}),
	);
	return sent;
}
const cf = (result: unknown, extra: Record<string, unknown> = {}) => ({ success: true, result, ...extra });
let n = 0;
/** A fresh key per call, so the read cache never answers for another test. */
const key = () => `kit-key-${++n}`;
const ctx = (over: Partial<ProductCtx> = {}): ProductCtx =>
	({
		key: key(),
		zones: ['example.com'],
		range: '1h',
		writeKey: async () => 'write-key',
		repo: { environments: [] },
		envTags: () => ({}),
		...over,
	}) as unknown as ProductCtx;
const ZONE = [
	/zones\?name=example\.com/,
	200,
	cf([{ id: 'z1', name: 'example.com', account: { id: 'a1' }, plan: { name: 'Pro' } }]),
] as Route;

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('the product kit: reading and writing', () => {
	it('words refusals with Cloudflare’s permission hint, the vendor’s own message or nothing', async () => {
		vendor([[/zones\/z1\/settings/, 403, { errors: [{ message: 'Unauthorized' }] }]]);
		await expect(
			read('Cloudflare', 'https://api.cloudflare.com/client/v4/zones/z1/settings', key()),
		).rejects.toThrow('Add the permission Zone › Zone Settings › Edit');
		vendor([[/droplets/, 401, 'not json']]);
		await expect(read('DigitalOcean', 'https://api.digitalocean.com/v2/droplets?x=1', key())).rejects.toThrow(
			'The key needs that permission.',
		);
		vendor([[/droplets/, 500, { message: 'Boom' }]]);
		await expect(read('DigitalOcean', 'https://api.digitalocean.com/v2/droplets', key())).rejects.toThrow(
			'DigitalOcean answered 500 to /v2/droplets: Boom.',
		);
		vendor([[/droplets/, 502, {}]]);
		await expect(soft('DigitalOcean', 'https://api.digitalocean.com/v2/droplets', key())).rejects.toThrow(
			'DigitalOcean answered 502 to /v2/droplets.',
		);
		vendor([[/zones/, 404, {}]]);
		expect(await soft('Cloudflare', 'https://api.cloudflare.com/client/v4/zones', key())).toBeNull();
	});

	it('sends a change with or without a body, and forgets cached reads for its key', async () => {
		const sent = vendor([
			[/^DELETE .*fail/, 409, { errors: [{ message: 'In use' }] }],
			[/^DELETE/, 204, ''],
			[/^POST/, 200, { ok: true }],
		]);
		expect(await write('Cloudflare', 'POST', 'https://api.cloudflare.com/client/v4/x', 'k')).toEqual({ ok: true });
		expect(await write('Cloudflare', 'DELETE', 'https://api.cloudflare.com/client/v4/x', 'k')).toBeNull();
		await write('Cloudflare', 'DELETE', 'https://api.cloudflare.com/client/v4/x', 'k', { id: 1 });
		await expect(write('Cloudflare', 'DELETE', 'https://api.cloudflare.com/client/v4/fail', 'k')).rejects.toThrow(
			'In use',
		);
		forget('k');
		expect(sent).toHaveLength(4);
	});

	it('writes sizes, ages and switches in plain words', () => {
		expect([bytes(null), bytes(Number.NaN), bytes(500), bytes(2048), bytes(50 * 1024 ** 2)]).toEqual([
			'—',
			'—',
			'500 B',
			'2.0 KB',
			'50 MB',
		]);
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(Date.parse('2026-11-24T12:00:00Z'));
		expect(
			[
				null,
				'soon',
				'2026-11-24T11:59:30Z',
				'2026-11-24T11:30:00Z',
				'2026-11-24T06:00:00Z',
				'2026-11-20T00:00:00Z',
				'2026-01-01T00:00:00Z',
			].map(ago),
		).toEqual(['—', 'soon', 'just now', '30 min ago', '6 h ago', '5 days ago', '2026-01-01']);
		expect([yes(true), yes(false), yes(null)]).toEqual(['on', 'off', '—']);
	});
});

describe('the DigitalOcean kit', () => {
	it('reads every page, and answers null or what it has when a soft read is refused', async () => {
		vendor([
			[
				/droplets\?per_page=200$/,
				200,
				{
					droplets: [{ id: 1 }],
					links: { pages: { next: 'https://api.digitalocean.com/v2/droplets?page=2&per_page=200' } },
				},
			],
			[
				/droplets\?page=2/,
				200,
				{ droplets: [{ id: 2 }], links: { pages: { next: 'https://elsewhere.example/next' } } },
			],
			[/volumes\?per_page=200$/, 403, {}],
			[
				/images\?per_page=200$/,
				200,
				{ images: [{ id: 3 }], links: { pages: { next: 'https://api.digitalocean.com/v2/images?page=2' } } },
			],
			[/images\?page=2/, 403, {}],
		]);
		expect((await doAll('/droplets', 'droplets', key())).map((d) => d['id'])).toEqual([1, 2]);
		expect(await doAll('/volumes', 'volumes', key(), true)).toBeNull();
		expect(await doAll('/images', 'images', key(), true)).toEqual([{ id: 3 }]);
		expect(dropletName([{ id: 1, name: 'web' }], 9)).toBe('9');
	});

	it('follows an action until it completes, and a later action only once it starts', async () => {
		vendor([
			[/actions\/1$/, 200, { action: { status: 'in-progress' } }],
			[/actions\/2$/, 200, { action: { status: 'completed' } }],
			[/actions\/3$/, 200, { action: { status: 'errored' } }],
		]);
		expect(await actionDone('Resize', () => null).check(key())).toBe(true);
		expect(await actionDone('Resize', () => 1).check(key())).toBe(false);
		expect(await actionDone('Resize', () => 2).check(key())).toBe(true);
		await expect(actionDone('Resize', () => 3).check(key())).rejects.toThrow('reports resize failed');
		const later = laterAction('Power on', async () => 2);
		expect(await later.check(key())).toBe(false);
		expect(await later.check(key())).toBe(true);
	});

	it('draws a droplet’s charts from DigitalOcean’s monitoring, and nothing it cannot read', async () => {
		const series = (values: Array<[number, string]>, metric: Record<string, string> = {}) => ({
			data: { result: [{ metric, values }] },
		});
		vendor([
			[
				/metrics\/droplet\/cpu/,
				200,
				{
					data: {
						result: [
							{
								metric: { mode: 'idle' },
								values: [
									[1, '10'],
									[2, '15'],
								],
							},
							{
								metric: { mode: 'user' },
								values: [
									[1, '5'],
									[2, '10'],
									[3, '10'],
									[4, '20'],
								],
							},
						],
					},
				},
			],
			[
				/memory_available/,
				200,
				series([
					[1, '50'],
					[2, '25'],
				]),
			],
			[/memory_total/, 200, series([[1, '100']])],
			[/filesystem_free/, 403, {}],
			[/metrics/, 200, series([[1, '1.234']])],
		]);
		const charts = await dropletSeries(ctx(), '42', '/');
		const cpu = charts.find((c) => c.name === 'CPU');
		expect(cpu?.points.length).toBeGreaterThan(0);
		expect(charts.find((c) => c.name === 'Memory used')?.points).toEqual([[1, 50]]);
	});
});

describe('the Cloudflare kit', () => {
	it('reads lists page by page, without paging when Cloudflare refuses it, and stops at the end', async () => {
		vendor([[/x\/a/, 403, {}]]);
		expect(await cfSoft('/x/a', key())).toBeNull();
		vendor([
			[/list\/one\?per_page=50&page=1/, 200, cf([{ id: 1 }], { result_info: { total_pages: 2 } })],
			[/list\/one\?per_page=50&page=2/, 400, { errors: [{ message: 'Page bigger than the number of pages' }] }],
			[/list\/two\?per_page/, 400, { errors: [{ message: 'Invalid list options' }] }],
			[/list\/two$/, 200, cf({ buckets: [{ name: 'b' }] })],
			[/list\/three/, 500, { errors: [{ message: 'Boom' }] }],
			[/list\/four\?per_page=50&page=1/, 200, cf([{ id: 4 }], { result_info: { total_pages: 2 } })],
			[/list\/four\?per_page=50&page=2/, 403, {}],
			[/list\/five/, 403, {}],
		]);
		expect(await cfAll('/list/one', key())).toEqual([{ id: 1 }]);
		expect(await cfAll('/list/two', key())).toEqual([{ name: 'b' }]);
		await expect(cfAll('/list/three', key(), false)).rejects.toThrow('Boom');
		expect(await cfAll('/list/four', key())).toEqual([{ id: 4 }]);
		expect(await cfAll('/list/five', key())).toBeNull();
	});

	it('shows zone settings with who may change them, and changes only what moved', async () => {
		const settings = [
			{ id: 'ssl', value: 'full', editable: true, modified_on: '2026-11-01T00:00:00Z' },
			{ id: 'ttl', value: 14400, editable: true },
			{ id: 'waf', value: { mode: 'on' }, editable: false },
			{ id: 'odd', value: null, editable: true },
			{ id: 'images', value: 'on', editable: false },
		];
		const sent = vendor([ZONE, [/settings$/, 200, cf(settings)], [/^PATCH/, 200, cf({})]]);
		const specs = [
			{
				id: 'ssl',
				label: 'SSL',
				options: [
					['full', 'Full'],
					['strict', 'Strict'],
				] as Array<[string, string]>,
				help: 'How it encrypts.',
			},
			{
				id: 'ttl',
				label: 'Browser cache',
				options: [
					['14400', '4 h'],
					['7200', '2 h'],
				] as Array<[string, string]>,
			},
			{ id: 'waf', label: 'WAF' },
			{ id: 'polish', label: 'Polish', plan: 'Pro' },
			{ id: 'odd', label: 'Odd' },
			{ id: 'images', label: 'Images', plan: 'Business' },
		];
		const v = await settingsView(ctx(), 'Settings', specs);
		expect(JSON.stringify(v)).toContain('needs Pro');
		const f = settingsForm('edit', 'Edit', specs);
		expect(JSON.stringify(await f.read(ctx()))).toContain('Polish needs Pro.');
		const w = (values: Record<string, unknown>) => ({ pin: '123456', confirm: '', id: null, values }) as never;
		await expect(f.send(ctx(), w({ ssl: 'nope' }))).rejects.toThrow('choose one of the listed values');
		await expect(f.send(ctx(), w({ ssl: 'full', waf: 'off' }))).rejects.toThrow('Nothing changed.');
		const done = await f.send(ctx(), w({ ssl: 'strict', ttl: '7200', odd: 'on' }));
		expect(done.message).toContain('SSL → strict');
		expect(sent.filter((s) => s.startsWith('PATCH'))).toHaveLength(3);
		vendor([ZONE, [/settings$/, 200, cf([])]]);
		expect(JSON.stringify(await settingsForm('edit', 'Edit', [{ id: 'ssl', label: 'SSL' }]).read(ctx()))).toContain(
			'None of these settings can be changed',
		);
	});

	it('reads and adds rules, and builds a rule expression from simple parts', async () => {
		const z = { id: 'z1', name: 'example.com', account: 'a1', plan: 'Pro', raw: {} };
		vendor([
			[/^(POST|PUT)/, 200, cf({})],
			[/phases\/none/, 404, {}],
			[/phases\/some\/entrypoint/, 200, cf({ id: 'rs1', rules: [] })],
		]);
		expect(await entrypoint(ctx(), z, 'none')).toBeNull();
		await addRule(key(), z, 'some', { description: 'x' });
		await addRule(key(), z, 'none', { description: 'x' });
		const t = rulesTable(
			'Rules',
			[
				{ id: 'r1', enabled: false },
				{ id: 'r2', description: 'Block bots' },
			],
			'None.',
		);
		expect(t.rows.map((r) => r.name)).toEqual(['r1', 'Block bots']);
		const w = (values: Record<string, unknown>) => ({ values }) as never;
		expect(expression(w({ expression: ' (http.host eq "a") ' }))).toBe('(http.host eq "a")');
		expect(() => expression(w({ expression: 'a; b' }))).toThrow('characters Cloudflare rules do not use');
		expect(() => expression(w({ field: 'nope' }))).toThrow('Choose a field.');
		expect(() => expression(w({ field: 'http.host', value: '' }))).toThrow('Give a value.');
		expect(expression(w({ field: 'cf.client.bot' }))).toBe('cf.client.bot');
		expect(expression(w({ field: 'ip.src', operator: 'eq', value: '1.2.3.4' }))).toBe('(ip.src eq 1.2.3.4)');
		expect(expression(w({ field: 'ip.src.country', operator: 'eq', value: 'IN' }))).toBe(
			'(ip.src.country eq "IN")',
		);
		expect(expression(w({ field: 'http.host', operator: 'contains', value: 'a' }))).toBe(
			'(http.host contains "a")',
		);
		expect(expression(w({ field: 'http.host', operator: 'starts', value: 'a' }))).toBe(
			'(starts_with(http.host, "a"))',
		);
		expect(expression(w({ field: 'ip.src', operator: 'in', value: '1.1.1.1, 2.2.2.2' }))).toBe(
			'(ip.src in {1.1.1.1 2.2.2.2})',
		);
		expect(expression(w({ field: 'http.host', operator: 'in', value: 'a b' }))).toBe('(http.host in {"a" "b"})');
		expect(() => expression(w({ field: 'http.host', operator: 'like', value: 'a' }))).toThrow(
			'Choose how to compare.',
		);
	});

	it('counts each product, and reads TLS 1.3 traffic from the analytics', async () => {
		const t = await counts([
			['Workers', Promise.resolve([1]), 'code'],
			['R2', Promise.resolve([]), 'storage'],
			['KV', Promise.reject(new Error('refused')), 'keys'],
		]);
		expect(t.rows.map((r) => [r.cells['n'], r.tone])).toEqual([
			[1, 'ok'],
			[0, null],
			['not readable with this key', 'muted'],
		]);
		vendor([
			[
				/graphql/,
				200,
				{
					data: {
						viewer: {
							zones: [
								{
									httpRequests1hGroups: [
										{
											dimensions: { datetime: '2026-11-24T00:00:00Z' },
											sum: {
												requests: 10,
												clientSSLMap: [
													{ clientSSLProtocol: 'TLSv1.3', requests: 7 },
													{ clientSSLProtocol: 'TLSv1.2', requests: 3 },
												],
												countryMap: [{ clientCountryName: 'IN', requests: 10 }],
											},
											uniq: { uniques: 4 },
										},
									],
								},
							],
						},
					},
				},
			],
		]);
		const rows = await traffic(ctx(), { id: 'z1', name: 'example.com', account: 'a1', plan: 'Pro', raw: {} });
		expect(rows?.[0]).toMatchObject({ requests: 10, tls13: 7, uniques: 4, countries: { IN: 10 } });
	});
});
