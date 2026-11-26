import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	RULE_KINDS,
	type RuleKind,
	USER_TOKEN,
	anyRuleDestroy,
	cloudConnector,
	managedTransforms,
	headerLines,
	pageActions,
	pageRules,
	ruleKindForm,
	snippetsForm,
} from './cf-rules.js';

import type { ProductCtx } from './kit.js';

/**
 * Cloudflare answers locally by method and address; the first matching route wins. A success is
 * wrapped in its envelope, a refusal is sent as given, and a string is sent as it is.
 */
type Route = [RegExp, number, unknown];
const ZONE: Route = [/zones\?name=/, 200, [{ id: 'z1', name: 'example.test', account: { id: 'a1' } }]];
function cloudflare(routes: Route[]) {
	const sent: Array<{ line: string; body: unknown; auth: string }> = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const line = `${init?.method ?? 'GET'} ${String(url)}`;
			const headers = new Headers(init?.headers);
			sent.push({ line, body: init?.body, auth: headers.get('authorization') ?? '' });
			const hit = [ZONE, ...routes].find(([re]) => re.test(line));
			const status = hit?.[1] ?? 200;
			const body = hit ? hit[2] : [];
			if (typeof body === 'string') return new Response(body, { status });
			const envelope = status >= 400 ? body : { success: true, result: body };
			return new Response(JSON.stringify(envelope), { status });
		}),
	);
	return sent;
}
let n = 0;
const ctx = (over: Partial<ProductCtx> = {}, tokens: Record<string, string> = {}): ProductCtx => {
	const i = ++n;
	return {
		key: `cf-rules-key-${i}`,
		zones: ['example.test'],
		id: null,
		writeKey: async () => `cf-rules-write-${i}`,
		consoleKey: (name: string) => tokens[name] ?? null,
		...over,
	} as unknown as ProductCtx;
};
const write = (values: Record<string, unknown>, id: string | null = null, confirm = '') =>
	({ pin: '123456', confirm, id, values }) as never;
const shown = (v: unknown) => JSON.stringify(v);
const changes = (sent: Array<{ line: string }>) => sent.filter((s) => !s.line.startsWith('GET')).map((s) => s.line);
const kind = (tab: string) => ruleKindForm(RULE_KINDS.find((k) => k.tab === tab) as RuleKind);
const refused = (message: string) => ({ success: false, errors: [{ code: 1011, message }] });

afterEach(() => vi.unstubAllGlobals());

describe('rules kept in a ruleset phase', () => {
	const REWRITES: Route = [
		/GET .*http_request_transform\/entrypoint/,
		200,
		{
			id: 'rs1',
			rules: [
				{
					id: 'r1',
					description: 'Old path',
					expression: 'true',
					action_parameters: {
						uri: {
							path: { expression: 'concat("/en", http.request.uri.path)' },
							query: { value: 'lang=en' },
						},
					},
				},
				{ id: 'r2', enabled: false },
			],
		},
	];

	it('fills a rewrite rule’s form from the rule, and names a rule with no description by its kind', async () => {
		cloudflare([REWRITES]);
		const view = shown(await kind('rewrite').read(ctx({ id: 'r1' })));
		expect(view).toContain('"value":"dynamic"');
		expect(view).toContain('"value":"static"');
		const bare = shown(await kind('rewrite').read(ctx({ id: 'r2' })));
		expect(bare).toContain('Edit URL rewrite rule');
		expect(bare).toContain('"label":"r2"');
	});

	it('creates and saves rewrites in the place asked for, and refuses rewrites Cloudflare would not take', async () => {
		const sent = cloudflare([[/(POST|PATCH)/, 200, {}], REWRITES]);
		const send = (values: Record<string, unknown>, id: string | null = null) =>
			kind('rewrite').send(ctx(), write({ description: 'Move', expression: 'true', ...values }, id));
		await expect(send({ pathMode: 'static', path: 'en' })).rejects.toThrow('The new path starts with /.');
		await expect(send({ pathMode: 'dynamic', path: '' })).rejects.toThrow('Give the path expression.');
		await expect(send({ queryMode: 'dynamic', query: 'a; b' })).rejects.toThrow('characters Cloudflare rules');
		await expect(send({ queryMode: 'dynamic', query: 'x'.repeat(4001) })).rejects.toThrow('characters');
		await expect(send({})).rejects.toThrow('Rewrite the path, the query string or both.');
		await expect(send({ pathMode: 'static', path: '/en' }, 'r9')).rejects.toThrow('That rule is gone');
		expect((await send({ pathMode: 'static', path: '/en', position: 'first' }))?.message).toBe(
			'URL rewrite rule “Move” created',
		);
		expect((await send({ queryMode: 'dynamic', query: 'http.host', position: 'last' }, 'r1'))?.message).toBe(
			'URL rewrite rule “Move” saved',
		);
		await send({ queryMode: 'static', query: '' }, 'new');
		expect(changes(sent)).toEqual([
			expect.stringMatching(/^POST .*rulesets\/rs1\/rules$/),
			expect.stringMatching(/^PATCH .*rulesets\/rs1\/rules\/r1$/),
			expect.stringMatching(/^POST .*rulesets\/rs1\/rules$/),
		]);
	});

	it('shows header rules as lines, and saves origin, configuration and compression rules', async () => {
		cloudflare([
			[
				/http_request_late_transform\/entrypoint/,
				200,
				{
					id: 'rs2',
					rules: [
						{
							id: 'h1',
							action_parameters: {
								headers: {
									'X-Old': { operation: 'remove' },
									'X-Shop': { operation: 'set', value: 'saree' },
									'X-Country': { operation: 'set', expression: 'ip.src.country' },
								},
							},
						},
					],
				},
			],
			[
				/http_config_settings\/entrypoint/,
				200,
				{
					id: 'rs3',
					rules: [
						{
							id: 'c1',
							action_parameters: {
								ssl: 'full',
								automatic_https_rewrites: true,
								bic: false,
								disable_apps: true,
							},
						},
					],
				},
			],
			[
				/http_response_compression\/entrypoint/,
				200,
				{ id: 'rs4', rules: [{ id: 'z1', action_parameters: { algorithms: [{ name: 'gzip' }] } }] },
			],
			[/(POST|PUT)/, 200, {}],
		]);
		expect(shown(await kind('reqheaders').read(ctx({ id: 'h1' })))).toContain(
			'remove X-Old\\nset X-Shop: saree\\nset X-Country = ip.src.country',
		);
		const config = shown(await kind('config').read(ctx({ id: 'c1' })));
		expect(config).toContain('"value":"full"');
		expect(config).toContain('"value":"on"');
		expect(config).toContain('"value":"off"');
		expect(shown(await kind('compress').read(ctx({ id: 'z1' })))).toContain('"value":"gzip"');
		const origin = (values: Record<string, unknown>) =>
			kind('origin').send(ctx(), write({ description: 'API', expression: 'true', ...values }));
		await expect(origin({})).rejects.toThrow('Change the host header, the DNS record, the port or the SNI.');
		await expect(origin({ port: 70_000 })).rejects.toThrow('Port: a whole number');
		expect((await origin({ host: 'api.example.test', port: 8443 }))?.message).toBe('Origin rule “API” created');
		expect(await origin({ hostHeader: 'api.example.test' })).toBeTruthy();
		expect(await origin({ port: '8443' })).toBeTruthy();
		expect(await origin({ host: 'api.example.test' })).toBeTruthy();
		const sendConfig = (values: Record<string, unknown>) =>
			kind('config').send(ctx(), write({ description: 'Speed', expression: 'true', ...values }));
		await expect(sendConfig({})).rejects.toThrow('Change at least one setting.');
		await expect(sendConfig({ ssl: 'extreme' })).rejects.toThrow('Choose a value for SSL');
		expect((await sendConfig({ ssl: 'full', rocket_loader: 'off', disable_apps: true }))?.message).toBe(
			'Configuration rule “Speed” created',
		);
		expect(
			await kind('compress').send(ctx(), write({ description: 'Zip', expression: 'true', algorithms: 'gzip' })),
		).toBeTruthy();
		const headers = (lines: string) =>
			kind('reqheaders').send(ctx(), write({ description: 'Tag', expression: 'true', headers: lines }));
		await expect(headers('rename X-A')).rejects.toThrow('Each line: set Name: value');
		await expect(headers('set X-A')).rejects.toThrow('X-A: give a value');
		await expect(headers('set X-A:')).rejects.toThrow('X-A: give a value');
		expect(await headers('remove X-Old\nset X-Country = ip.src.country\nadd X-Shop: saree')).toBeTruthy();
		expect(await origin({ sni: 'api.example.test' })).toBeTruthy();
	});
});

describe('managed transforms', () => {
	it('names known and new transforms, marks clashes, and saves only a change', async () => {
		const sent = cloudflare([
			[/PATCH/, 200, {}],
			[
				/managed_headers/,
				200,
				{
					managed_request_headers: [
						{
							id: 'add_true_client_ip_headers',
							enabled: false,
							has_conflict: true,
							conflicts_with: ['remove_visitor_ip_headers'],
						},
					],
					managed_response_headers: [{ id: 'add_new_thing', enabled: true }],
				},
			],
		]);
		const view = shown(await managedTransforms.read(ctx()));
		expect(view).toContain('Request · Add True-Client-IP header');
		expect(view).toContain('Clashes with remove_visitor_ip_headers');
		expect(view).toContain('Response · add new thing');
		await expect(
			managedTransforms.send(ctx(), write({ 'managed_response_headers:add_new_thing': true })),
		).rejects.toThrow('Nothing changed.');
		expect(
			(
				await managedTransforms.send(
					ctx(),
					write({
						'managed_request_headers:add_true_client_ip_headers': true,
						'managed_response_headers:add_new_thing': false,
					}),
				)
			)?.message,
		).toBe('Managed transforms: Add True-Client-IP header on, add new thing off');
		expect(changes(sent)).toHaveLength(1);
	});
});

describe('snippets and the Cloud Connector', () => {
	const SNIPPETS: Route[] = [
		[/PUT .*snippets\/snippet_rules/, 200, {}],
		[
			/GET .*snippets\/snippet_rules/,
			200,
			[
				{ snippet_name: 'geo', expression: 'http.host eq "x"', enabled: false },
				{ snippet_name: 'other', expression: 'false' },
			],
		],
		[/GET .*snippets$/, 200, [{ snippet_name: 'geo' }, { snippet_name: 'lonely' }]],
	];

	it('fills a snippet’s form from its rule, and offers a new one', async () => {
		cloudflare(SNIPPETS);
		const geo = shown(await snippetsForm.read(ctx({ id: 'geo' })));
		expect(geo).toContain('Edit snippet geo');
		expect(geo).toContain('Leave empty to keep the current code');
		expect(geo).toContain('"value":"http.host eq \\"x\\""');
		expect(shown(await snippetsForm.read(ctx()))).toContain('"submit":"Create snippet"');
		expect(shown(await snippetsForm.read(ctx({ id: 'lonely' })))).toContain('"value":"true"');
	});

	it('uploads a new snippet with its rule, saves an existing one without new code, and words what Cloudflare refused', async () => {
		const sent = cloudflare([[/PUT .*snippets\/(fresh|geo)$/, 200, {}], ...SNIPPETS]);
		await expect(snippetsForm.send(ctx(), write({ name: 'Geo!' }))).rejects.toThrow('Snippet name');
		await expect(snippetsForm.send(ctx(), write({ name: 'fresh' }))).rejects.toThrow('Give the snippet’s code.');
		expect(
			(await snippetsForm.send(ctx(), write({ name: 'fresh', code: 'export default {}', enabled: true }, 'new')))
				?.message,
		).toBe('Snippet fresh created');
		expect((await snippetsForm.send(ctx({ id: 'geo' }), write({ name: 'geo' })))?.message).toBe(
			'Snippet geo saved',
		);
		expect(changes(sent)).toEqual([
			expect.stringMatching(/PUT .*snippets\/fresh$/),
			expect.stringMatching(/PUT .*snippet_rules$/),
			expect.stringMatching(/PUT .*snippet_rules$/),
		]);
		cloudflare([[/PUT .*snippets\/fresh$/, 403, refused('Snippets are not on this plan')]]);
		await expect(snippetsForm.send(ctx(), write({ name: 'fresh', code: 'x' }))).rejects.toThrow(
			'Cloudflare answered 403: Snippets are not on this plan.',
		);
		cloudflare([[/PUT .*snippets\/fresh$/, 500, 'Bad gateway']]);
		await expect(snippetsForm.send(ctx(), write({ name: 'fresh', code: 'x' }))).rejects.toThrow(
			'Cloudflare answered 500.',
		);
	});

	it('names a connector rule by its expression when it has no name, and creates or saves one', async () => {
		const sent = cloudflare([
			[/PUT/, 200, {}],
			[
				/cloud_connector\/rules/,
				200,
				[
					{
						id: 'c1',
						expression: 'true',
						provider: 'aws_s3',
						parameters: { host: 'b.example.test' },
						enabled: true,
					},
					{ id: 'c2', description: 'Docs', expression: 'false', enabled: false },
				],
			],
		]);
		const c1 = shown(await cloudConnector.read(ctx({ id: 'c1' })));
		expect(c1).toContain('Edit connector rule');
		expect(c1).toContain('"label":"true"');
		expect(shown(await cloudConnector.read(ctx({ id: 'c2' })))).toContain('Edit Docs');
		const values = {
			description: 'Media',
			provider: 'cloudflare_r2',
			host: 'media.example.test',
			expression: 'true',
		};
		expect((await cloudConnector.send(ctx(), write(values)))?.message).toBe('Connector rule “Media” created');
		expect((await cloudConnector.send(ctx({ id: 'c1' }), write(values)))?.message).toBe(
			'Connector rule “Media” saved',
		);
		const [created, saved] = sent.filter((s) => s.line.startsWith('PUT')).map((s) => JSON.parse(String(s.body)));
		expect(created).toHaveLength(3);
		expect(saved).toHaveLength(2);
		expect(saved[0]).toMatchObject({ description: 'Media' });
	});
});

describe('page rules', () => {
	const PAGE_RULES = [
		{
			id: 'p1',
			targets: [{ constraint: { value: '*example.test/old/*' } }],
			actions: [{ id: 'forwarding_url', value: { status_code: 301, url: 'https://example.test/$1' } }],
			status: 'active',
			priority: 2,
		},
		{
			id: 'p2',
			targets: [{ constraint: { value: 'example.test/media/*' } }],
			actions: [{ id: 'always_use_https' }, { id: 'cache_level', value: 'bypass' }],
			status: 'disabled',
			priority: 1,
		},
	];

	it('reads each setting the way a slot shows it, with the personal token when there is one', async () => {
		const sent = cloudflare([[/pagerules/, 200, PAGE_RULES]]);
		const p1 = shown(await pageRules.read(ctx({ id: 'p1' }, { [USER_TOKEN]: 'personal-token' })));
		expect(p1).toContain('"value":"301 https://example.test/$1"');
		// What the slot shows goes back through unchanged.
		expect(pageActions(write({ setting1: 'forwarding_url', value1: '301 https://example.test/$1' }))).toEqual([
			{ id: 'forwarding_url', value: { status_code: 301, url: 'https://example.test/$1' } },
		]);
		const p2 = shown(await pageRules.read(ctx({ id: 'p2' })));
		expect(p2).toContain('"value":"bypass"');
		expect(p2).toContain('"key":"value1","label":"Value 1","type":"text","options":[],"value":""');
		expect(sent[1]?.auth).toBe('Bearer personal-token');
	});

	it('says page rules need a personal token when Cloudflare refuses the account token', async () => {
		cloudflare([[/pagerules/, 403, refused('Page rules do not support account owned tokens')]]);
		expect(shown(await pageRules.read(ctx()))).toContain('Page rules need a personal Cloudflare token');
		cloudflare([[/pagerules/, 500, 'Bad gateway']]);
		await expect(pageRules.read(ctx())).rejects.toThrow('Cloudflare answered 500.');
	});

	it('turns the setting slots into actions, and refuses settings or values Cloudflare would not take', () => {
		const actions = (values: Record<string, unknown>) => pageActions(write(values));
		expect(() => actions({})).toThrow('Choose at least one setting.');
		expect(() => actions({ setting1: 'teleport' })).toThrow('Setting 1: choose a setting.');
		expect(() => actions({ setting1: 'rocket_loader', value1: 'maybe' })).toThrow('Rocket Loader: on or off.');
		expect(() => actions({ setting1: 'edge_cache_ttl', value1: '-1' })).toThrow('seconds as a whole number');
		expect(() => actions({ setting1: 'ssl', value1: 'extreme' })).toThrow('SSL: one of off, flexible');
		expect(() => actions({ setting1: 'forwarding_url', value1: 'https://x' })).toThrow(
			'Forwarding URL: 301 or 302',
		);
		expect(() =>
			actions({ setting1: 'forwarding_url', value1: '301 https://example.test', setting2: 'always_use_https' }),
		).toThrow('only setting');
		expect(
			actions({
				setting1: 'always_use_https',
				setting2: 'rocket_loader',
				value2: 'on',
				setting3: 'edge_cache_ttl',
				value3: '600',
				setting5: 'ssl',
				value5: 'full',
			}),
		).toEqual([
			{ id: 'always_use_https' },
			{ id: 'rocket_loader', value: 'on' },
			{ id: 'edge_cache_ttl', value: 600 },
			{ id: 'ssl', value: 'full' },
		]);
	});

	it('creates and saves page rules in the place asked for, and refuses an odd pattern', async () => {
		const sent = cloudflare([
			[/(POST|PUT)/, 200, {}],
			[/pagerules/, 200, PAGE_RULES],
		]);
		const send = (values: Record<string, unknown>, id: string | null = null) =>
			pageRules.send(
				ctx(),
				write({ pattern: 'example.test/sale/*', setting1: 'always_use_https', active: true, ...values }, id),
			);
		await expect(send({ pattern: 'example.test/a b' })).rejects.toThrow('characters page rules do not use');
		expect((await send({ position: 'first' }))?.message).toBe('Page rule example.test/sale/* created');
		expect((await send({ position: 'first' }, 'p1'))?.message).toBe('Page rule example.test/sale/* saved');
		await send({ position: 'last' }, 'p2');
		await send({ active: false }, 'p1');
		await send({}, 'new');
		const bodies = sent.filter((s) => !s.line.startsWith('GET')).map((s) => JSON.parse(String(s.body)));
		expect(bodies.map((b) => b.priority)).toEqual([3, 2, 1, 2, undefined]);
		expect(bodies[3].status).toBe('disabled');
		cloudflare([[/pagerules/, 500, 'Bad gateway']]);
		await expect(send({})).rejects.toThrow('Cloudflare answered 500.');
	});
});

describe('deleting any rule', () => {
	const EVERY: Route[] = [
		[/(PUT|DELETE)/, 200, {}],
		[/http_request_dynamic_redirect\/entrypoint/, 200, { id: 'rsr', rules: [{ id: 'x1', expression: 'true' }] }],
		[/GET .*snippets\/snippet_rules/, 200, [{ snippet_name: 'geo', expression: 'true' }]],
		[/GET .*snippets$/, 200, [{ snippet_name: 'geo' }, { snippet_name: 'lonely' }]],
		[
			/pagerules/,
			200,
			[{ id: 'p1', targets: [{ constraint: { value: '*example.test/old/*' } }], actions: [], status: 'active' }],
		],
	];

	it('lists rules, snippets and page rules, and deletes each the way it is stored', async () => {
		const sent = cloudflare(EVERY);
		const view = shown(await anyRuleDestroy.read(ctx({ id: 'snippet:lonely' })));
		expect(view).toContain('not run by any rule');
		expect(view).toContain('x1 (redirect rule)');
		await expect(anyRuleDestroy.send(ctx(), write({}, 'nothing:1'))).rejects.toThrow('Choose a rule.');
		expect(
			(await anyRuleDestroy.send(ctx({ id: 'http_request_dynamic_redirect:x1' }), write({}, null, 'x1')))
				?.message,
		).toBe('x1 (redirect rule) deleted');
		await anyRuleDestroy.send(ctx(), write({}, 'snippet:geo', 'geo'));
		await anyRuleDestroy.send(ctx(), write({}, 'snippet:lonely', 'lonely'));
		await anyRuleDestroy.send(
			ctx({}, { [USER_TOKEN]: 'personal-token' }),
			write({}, 'page:p1', '*example.test/old/*'),
		);
		await anyRuleDestroy.send(ctx(), write({}, 'page:p1', '*example.test/old/*'));
		const done = sent.filter((s) => !s.line.startsWith('GET'));
		expect(done.map((s) => s.line.replace(/^(\w+) .*\/client\/v4/, '$1 '))).toEqual([
			'DELETE /zones/z1/rulesets/rsr/rules/x1',
			'PUT /zones/z1/snippets/snippet_rules',
			'DELETE /zones/z1/snippets/geo',
			'DELETE /zones/z1/snippets/lonely',
			'DELETE /zones/z1/pagerules/p1',
			'DELETE /zones/z1/pagerules/p1',
		]);
		expect(done[4]?.auth).toBe('Bearer personal-token');
		expect(done[5]?.auth).toMatch(/^Bearer cf-rules-write-/);
		cloudflare([[/pagerules/, 403, refused('no')]]);
		expect(shown(await anyRuleDestroy.read(ctx()))).toContain('No rules on this domain.');
	});
});

describe('header lines', () => {
	it('refuses a box with no line in it', () => {
		expect(() => headerLines('')).toThrow('Give at least one header line.');
		expect(() => headerLines('\n  \n')).toThrow('Give at least one header line.');
	});
});
