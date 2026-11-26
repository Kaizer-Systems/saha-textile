import { afterEach, describe, expect, it, vi } from 'vitest';

import { ZT_EXTRA } from './cf-zt-more.js';

import type { ProductCtx } from './kit.js';

/** Cloudflare answers locally in its envelope by method and address; the first matching route wins. */
type Route = [RegExp, number, unknown];
const ZONE: Route = [/zones\?name=/, 200, [{ id: 'z1', name: 'example.test', account: { id: 'a1' } }]];
const ACCOUNT_ZONES: Route = [/zones\?account\.id=/, 200, [{ name: 'example.test' }]];
function cloudflare(routes: Route[]) {
	const sent: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const line = `${init?.method ?? 'GET'} ${String(url)}`;
			sent.push(`${line} ${typeof init?.body === 'string' ? init.body : ''}`.trim());
			const hit = [ZONE, ...routes, ACCOUNT_ZONES].find(([re]) => re.test(line));
			const status = hit?.[1] ?? 200;
			const body =
				status >= 400
					? { success: false, errors: [{ code: 9000, message: 'Refused' }] }
					: { success: true, result: hit ? hit[2] : [] };
			return new Response(JSON.stringify(body), { status });
		}),
	);
	return sent;
}
let n = 0;
const ctx = (over: Partial<ProductCtx> = {}): ProductCtx => {
	const i = ++n;
	return {
		key: `cf-zt-key-${i}`,
		zones: ['example.test'],
		id: null,
		writeKey: async () => `cf-zt-write-${i}`,
		...over,
	} as unknown as ProductCtx;
};
const write = (values: Record<string, unknown>, id: string | null = null, confirm = '') =>
	({ pin: '123456', confirm, id, values }) as never;
const shown = (v: unknown) => JSON.stringify(v);
const writes = (sent: string[]) => sent.filter((s) => !s.startsWith('GET'));
const form = (key: string) => ZT_EXTRA.forms?.[key];

const PEOPLE = {
	emails: 'owner@example.test',
	domains: 'example.test',
	ips: '203.0.113.0/24',
	countries: 'in',
};
const SELF_HOSTED = {
	id: 'app1',
	name: 'Admin',
	type: 'self_hosted',
	domain: 'admin.example.test',
	session_duration: '6h',
	policies: [
		{
			include: [
				{ email: { email: 'owner@example.test' } },
				{ email_domain: { domain: 'example.test' } },
				{ ip: { ip: '203.0.113.0/24' } },
				{ geo: { country_code: 'IN' } },
			],
		},
	],
};
const SSH_APP = { id: 'ssh1', name: 'SSH web', type: 'ssh', domain: 'ssh-web.example.test' };

const env = process.env['CONSOLE_ORIGIN'];
afterEach(() => {
	vi.unstubAllGlobals();
	if (env === undefined) delete process.env['CONSOLE_ORIGIN'];
	else process.env['CONSOLE_ORIGIN'] = env;
});

describe('Access applications and groups', () => {
	it('fills an application’s form from its people rule, and keeps server sign-ins out of reach', async () => {
		delete process.env['CONSOLE_ORIGIN'];
		cloudflare([
			[
				/access\/apps/,
				200,
				[SELF_HOSTED, SSH_APP, { id: 'w', type: 'warp' }, { id: 'app3', name: 'Bare', type: 'self_hosted' }],
			],
		]);
		const view = shown(await ZT_EXTRA.tabs?.['apps']?.(ctx({ id: 'app1' })));
		expect(view).toContain('Edit Admin · admin.example.test');
		expect(view).toContain('"value":"IN"');
		expect(view).toContain('"value":"6h"');
		expect(view).toContain('Bare · self_hosted');
		expect(shown(await ZT_EXTRA.tabs?.['apps']?.(ctx({ id: 'ssh1' })))).toContain('cannot lock you out');
		expect(shown(await ZT_EXTRA.tabs?.['apps']?.(ctx()))).toContain('New Access application');
	});

	it('keeps the console’s own sign-in out of reach, and reads a broken console address as none', async () => {
		process.env['CONSOLE_ORIGIN'] = 'https://admin.example.test';
		cloudflare([[/access\/apps/, 200, [SELF_HOSTED]]]);
		await expect(
			form('apps')?.send(ctx(), write({ name: 'Admin', domain: 'admin.example.test' }, 'app1')),
		).rejects.toThrow('cannot lock you out');
		process.env['CONSOLE_ORIGIN'] = 'not an address';
		cloudflare([
			[/access\/apps/, 200, [SELF_HOSTED]],
			[/PUT/, 200, {}],
		]);
		expect(
			(await form('apps')?.send(ctx(), write({ name: 'Admin', domain: 'admin.example.test', ...PEOPLE }, 'app1')))
				?.message,
		).toBe('Access application Admin saved');
	});

	it('creates an application on the account’s domains, and refuses bad people, places or addresses', async () => {
		delete process.env['CONSOLE_ORIGIN'];
		const sent = cloudflare([
			[/POST/, 200, { id: 'app2' }],
			[/access\/apps/, 200, []],
		]);
		const apps = form('apps');
		const send = (values: Record<string, unknown>) => apps?.send(ctx(), write({ name: 'Grafana', ...values }));
		await expect(send({ domain: 'grafana.other.test', ...PEOPLE })).rejects.toThrow('An address on example.test.');
		await expect(send({ domain: 'grafana.example.test', emails: 'owner' })).rejects.toThrow('People: email');
		await expect(send({ domain: 'grafana.example.test', ips: '203.0.113.7' })).rejects.toThrow('IP ranges');
		await expect(send({ domain: 'grafana.example.test', countries: 'IND' })).rejects.toThrow('Countries');
		await expect(send({ domain: 'grafana.example.test' })).rejects.toThrow('Name who is let in.');
		expect((await send({ domain: 'Grafana.example.test/internal', ...PEOPLE, session: '12h' }))?.message).toBe(
			'Access application Grafana created',
		);
		expect(await send({ domain: 'grafana.example.test', emails: 'owner@example.test' })).toBeTruthy();
		const posts = writes(sent);
		expect(posts[0]).toContain('"session_duration":"12h"');
		expect(posts[1]).toContain('"session_duration":"24h"');
		await expect(apps?.send(ctx(), write({ name: 'x', domain: 'x.example.test' }, 'gone'))).rejects.toThrow(
			'That Access application is gone',
		);
		cloudflare([
			[/zones\?account\.id=/, 403, null],
			[/access\/apps/, 200, []],
		]);
		await expect(send({ domain: 'grafana.example.test', ...PEOPLE })).rejects.toThrow('An address on .');
	});

	it('creates and saves a group of people', async () => {
		const sent = cloudflare([
			[/(POST|PUT)/, 200, {}],
			[
				/access\/groups/,
				200,
				[{ id: 'g1', name: 'Team', include: [{ email: { email: 'owner@example.test' } }] }],
			],
		]);
		expect(shown(await ZT_EXTRA.tabs?.['groups']?.(ctx({ id: 'g1' })))).toContain('owner@example.test');
		expect((await form('groups')?.send(ctx(), write({ name: 'Team', emails: 'a@example.test' })))?.message).toBe(
			'Access group Team created',
		);
		expect(
			(await form('groups')?.send(ctx(), write({ name: 'Team', domains: 'example.test' }, 'g1')))?.message,
		).toBe('Access group Team saved');
		expect(writes(sent)[0]).toMatch(/^POST .*access\/groups /);
		expect(writes(sent)[1]).toMatch(/^PUT .*access\/groups\/g1 /);
	});
});

describe('private routes, Gateway policies and lists', () => {
	it('adds a route through a tunnel, saves only its note after, and refuses a bad network', async () => {
		const sent = cloudflare([
			[/(POST|PATCH)/, 200, {}],
			[/teamnet\/routes/, 200, [{ id: 'r1', network: '10.122.0.0/20', tunnel_name: 'web' }]],
			[/cfd_tunnel/, 200, [{ id: 't1', name: 'web' }]],
		]);
		expect(shown(await ZT_EXTRA.tabs?.['routes']?.(ctx()))).toContain('10.122.0.0/20 · web');
		expect(shown(await ZT_EXTRA.tabs?.['routes']?.(ctx({ id: 'r1' })))).toContain('"readOnly":true');
		const routes = form('routes');
		await expect(routes?.send(ctx(), write({ network: '10.122.0.0', tunnel: 't1' }))).rejects.toThrow(
			'Network like',
		);
		expect((await routes?.send(ctx(), write({ network: '10.130.0.0/20', tunnel: 't1' })))?.message).toBe(
			'Private network route created',
		);
		expect((await routes?.send(ctx(), write({ comment: 'servers' }, 'r1')))?.message).toBe(
			'Private network route saved',
		);
		expect(writes(sent)[1]).toMatch(/^PATCH .*teamnet\/routes\/r1 \{"comment":"servers"\}/);
	});

	it('saves a Gateway policy whose action fits its kind, and refuses odd expressions', async () => {
		const sent = cloudflare([
			[/(POST|PUT)/, 200, {}],
			[
				/gateway\/rules/,
				200,
				[{ id: 'g1', name: 'No socials', filters: ['http'], action: 'block', precedence: 5, enabled: false }],
			],
		]);
		const view = shown(await ZT_EXTRA.tabs?.['gateway']?.(ctx({ id: 'g1' })));
		expect(view).toContain('No socials (http)');
		expect(view).toContain('"value":5');
		expect(shown(await ZT_EXTRA.tabs?.['gateway']?.(ctx()))).toContain('"value":1000');
		const gateway = form('gateway');
		const send = (values: Record<string, unknown>, id: string | null = null) =>
			gateway?.send(ctx(), write({ name: 'Block', traffic: 'any(dns.domains[*] == "x.test")', ...values }, id));
		await expect(send({ kind: 'dns', action: 'off' })).rejects.toThrow('A dns policy can block, allow');
		await expect(send({ kind: 'mail', action: 'block' })).rejects.toThrow('A mail policy can');
		await expect(send({ kind: 'dns', action: 'block', traffic: 'a; b' })).rejects.toThrow('characters');
		await expect(send({ kind: 'dns', action: 'block', traffic: 'x'.repeat(4001) })).rejects.toThrow('characters');
		expect((await send({ kind: 'dns', action: 'block', enabled: true }))?.message).toBe(
			'Gateway policy Block created',
		);
		expect((await send({ action: 'noscan', precedence: 7 }, 'g1'))?.message).toBe('Gateway policy Block saved');
		expect(writes(sent)[0]).toContain('"precedence":1000,"enabled":true');
		expect(writes(sent)[1]).toContain('"filters":["http"]');
		expect(writes(sent)[1]).toContain('"precedence":7,"enabled":false');
	});

	it('makes and saves a list with its entries, and refuses a kind it does not know', async () => {
		const sent = cloudflare([
			[/(POST|PUT)/, 200, {}],
			[/gateway\/lists\/l1\/items/, 200, [[{ value: 'a.example.test' }, { value: 'b.example.test' }]]],
			[
				/gateway\/lists/,
				200,
				[
					{ id: 'l1', name: 'Blocked', type: 'DOMAIN', count: 2 },
					{ id: 'l2', name: 'New', type: 'IP' },
				],
			],
		]);
		const view = shown(await ZT_EXTRA.tabs?.['lists']?.(ctx({ id: 'l1' })));
		expect(view).toContain('a.example.test\\nb.example.test');
		expect(view).toContain('New (IP, 0)');
		const lists = form('lists');
		await expect(lists?.send(ctx(), write({ name: 'X', type: 'HOST' }))).rejects.toThrow('Choose a kind.');
		expect(
			(
				await lists?.send(
					ctx(),
					write({ name: 'Mail', type: 'EMAIL', items: 'a@example.test\n\n b@example.test ' }),
				)
			)?.message,
		).toBe('Zero Trust list Mail created');
		expect((await lists?.send(ctx(), write({ name: 'Blocked' }, 'l1')))?.message).toBe(
			'Zero Trust list Blocked saved',
		);
		expect(writes(sent)[0]).toContain(
			'"type":"EMAIL","items":[{"value":"a@example.test"},{"value":"b@example.test"}]',
		);
		expect(writes(sent)[1]).not.toContain('"type"');
	});
});

describe('devices, sign-in methods and the split tunnel', () => {
	it('reads the split tunnel in either mode, and saves addresses and hostnames with their notes', async () => {
		cloudflare([
			[
				/devices\/policy/,
				200,
				{ include: [{ address: '10.0.0.0/8', description: 'servers' }, { host: 'db.example.test' }] },
			],
		]);
		const view = shown(await form('split')?.read(ctx()));
		expect(view).toContain('"value":"include"');
		expect(view).toContain('10.0.0.0/8 # servers\\ndb.example.test');
		cloudflare([[/devices\/policy/, 200, { exclude: [{ address: '192.168.0.0/16' }] }]]);
		expect(shown(await form('split')?.read(ctx()))).toContain('"value":"exclude"');
		const sent = cloudflare([[/PUT/, 200, {}]]);
		expect(
			(
				await form('split')?.send(
					ctx(),
					write({ mode: 'exclude', entries: '10.1.0.0/16 # net # two\n203.0.113.7\n\nhost.example.test' }),
				)
			)?.message,
		).toBe('Split tunnel: exclude 3 entries');
		expect(writes(sent)[0]).toContain('"address":"203.0.113.7/32"');
		expect(writes(sent)[0]).toContain('"description":"net # two"');
		await expect(form('split')?.send(ctx(), write({ mode: 'include', entries: 'not valid!' }))).rejects.toThrow(
			'an address range or a hostname',
		);
	});

	it('lists devices and sign-in methods, adds the email code once, and signs a device out', async () => {
		cloudflare([
			[
				/devices/,
				200,
				[
					{
						id: 'd1',
						name: 'laptop',
						user: { email: 'owner@example.test' },
						device_type: 'mac',
						os_version: '15',
					},
					{ id: 'd2', name: 'phone', os_distro_name: 'Android', os_version: '16' },
				],
			],
			[/identity_providers/, 200, [{ id: 'i1', name: '', type: 'onetimepin' }]],
		]);
		const devices = shown(await ZT_EXTRA.tabs?.['devices']?.(ctx()));
		expect(devices).toContain('mac 15');
		expect(devices).toContain('Android 16');
		expect(devices).toContain('"name":"onetimepin"');
		expect((await form('emailcode')?.send(ctx(), write({})))?.message).toBe(
			'Sign-in by email code was already there',
		);
		cloudflare([
			[/POST .*identity_providers/, 200, {}],
			[/identity_providers/, 200, []],
		]);
		expect(shown(await form('emailcode')?.read(ctx()))).toContain('Sign-in by email code');
		expect((await form('emailcode')?.send(ctx(), write({})))?.message).toBe('Sign-in by email code added');
		cloudflare([
			[/POST .*revoke/, 200, {}],
			[/devices/, 200, [{ id: 'd1', name: 'laptop', user: { email: 'owner@example.test' } }]],
		]);
		expect(shown(await form('revoke')?.read(ctx()))).toContain('laptop · owner@example.test');
		await expect(form('revoke')?.send(ctx(), write({}, 'd9'))).rejects.toThrow('Choose a device.');
		expect((await form('revoke')?.send(ctx({ id: 'd1' }), write({}, null, 'laptop')))?.message).toContain(
			'laptop signed out',
		);
		cloudflare([[/devices/, 403, null]]);
		expect(shown(await form('revoke')?.read(ctx()))).toContain('No devices.');
		await expect(form('revoke')?.send(ctx(), write({}, 'd1'))).rejects.toThrow('Choose a device.');
	});
});

describe('deleting a Zero Trust item', () => {
	it('offers what was made here, names what goes public, and refuses server sign-ins', async () => {
		delete process.env['CONSOLE_ORIGIN'];
		const sent = cloudflare([
			[/DELETE/, 200, {}],
			[/access\/apps/, 200, [SELF_HOSTED, SSH_APP]],
			[/teamnet\/routes/, 200, [{ id: 'r1', network: '10.122.0.0/20' }]],
		]);
		const del = form('ztdelete');
		const first = shown(await del?.read(ctx()));
		expect(first).toContain('admin.example.test becomes public again.');
		expect(first).not.toContain('SSH web');
		const route = shown(await del?.read(ctx({ id: 'routes:r1' })));
		expect(route).toContain('"confirmName":"10.122.0.0/20"');
		expect(route).toContain('"notes":[]');
		await expect(del?.send(ctx(), write({}))).rejects.toThrow('Choose what to delete.');
		await expect(del?.send(ctx(), write({}, 'nothing:1'))).rejects.toThrow('Choose what to delete.');
		await expect(del?.send(ctx(), write({}, 'apps:ssh1', 'SSH web'))).rejects.toThrow('go with their server');
		expect((await del?.send(ctx({ id: 'routes:r1' }), write({}, null, '10.122.0.0/20')))?.message).toBe(
			'private network route 10.122.0.0/20 ·  deleted',
		);
		expect((await del?.send(ctx(), write({}, 'apps:app1', 'Admin')))?.message).toContain('deleted');
		expect(writes(sent)).toHaveLength(2);
		cloudflare([]);
		expect(shown(await del?.read(ctx()))).toContain('Nothing made here to delete.');
	});
});
