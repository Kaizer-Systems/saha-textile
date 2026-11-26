import { afterEach, describe, expect, it, vi } from 'vitest';

import { ACCOUNT_EXTRA, DATABASES_EXTRA, DODNS_EXTRA, MONITORING_EXTRA, NET_EXTRA, REGISTRY_EXTRA } from './do-more.js';

import type { ProductCtx } from './kit.js';

/** DigitalOcean answers locally by method and address; the first matching route wins. */
type Route = [RegExp, number, unknown];
function digitalocean(routes: Route[]) {
	const sent: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const line = `${init?.method ?? 'GET'} ${String(url)}`;
			sent.push(`${line} ${typeof init?.body === 'string' ? init.body : ''}`.trim());
			const hit = routes.find(([re]) => re.test(line));
			const status = hit?.[1] ?? 200;
			return new Response(status === 204 ? null : JSON.stringify(hit?.[2] ?? {}), { status });
		}),
	);
	return sent;
}
let n = 0;
const ctx = (over: Partial<ProductCtx> = {}): ProductCtx =>
	({
		key: `do-more-key-${++n}`,
		id: null,
		writeKey: async () => `do-more-write-${n}`,
		...over,
	}) as unknown as ProductCtx;
const write = (values: Record<string, unknown>, id: string | null = null, confirm = '') =>
	({ pin: '123456', confirm, id, values }) as never;
const shown = (v: unknown) => JSON.stringify(v);
const writes = (sent: string[]) => sent.filter((s) => !s.startsWith('GET'));

afterEach(() => vi.unstubAllGlobals());

const FIREWALLS = {
	firewalls: [
		{
			id: 'f1',
			name: 'web',
			droplet_ids: [1],
			tags: ['old'],
			inbound_rules: [{ protocol: 'tcp', ports: '443', sources: { addresses: ['1.2.3.4'] } }],
			outbound_rules: [{ protocol: 'udp', ports: '', destinations: { tags: ['dns'] } }],
		},
	],
};

describe('firewall rules, attachments and reserved addresses', () => {
	it('removes an inbound or an outbound rule, and refuses no pick or a gone one', async () => {
		const sent = digitalocean([
			[/DELETE/, 204, null],
			[/firewalls/, 200, FIREWALLS],
		]);
		const remove = NET_EXTRA.forms?.['ruleremove'];
		expect(shown(await remove?.read(ctx()))).toContain('web · in tcp 443 1.2.3.4');
		await expect(remove?.send(ctx(), write({}))).rejects.toThrow('Choose one.');
		await expect(remove?.send(ctx(), write({}, 'f1:in:9'))).rejects.toThrow('That one is gone');
		expect((await remove?.send(ctx(), write({}, 'f1:in:0')))?.message).toBe(
			'Rule removed: web · in tcp 443 1.2.3.4',
		);
		expect((await remove?.send(ctx({ id: 'f1:out:0' }), write({})))?.message).toContain('out udp all dns');
		expect(writes(sent)[0]).toContain('"inbound_rules"');
		expect(writes(sent)[1]).toContain('"outbound_rules"');
	});

	it('moves a firewall to the servers and tags asked for', async () => {
		const sent = digitalocean([
			[/(POST|DELETE)/, 204, null],
			[/firewalls/, 200, FIREWALLS],
			[/droplets/, 200, { droplets: [{ id: 1, name: 'web' }] }],
		]);
		const attach = NET_EXTRA.forms?.['fwattach'];
		expect(shown(await attach?.read(ctx()))).toContain('"value":"1"');
		expect((await attach?.send(ctx(), write({ droplets: '2', tags: 'web' }, 'f1')))?.message).toBe('web: +2 −2');
		expect(writes(sent)).toHaveLength(4);
		expect((await attach?.send(ctx(), write({ droplets: '1', tags: 'old' }, 'f1')))?.message).toBe('web: +0 −0');
	});

	it('assigns, unassigns and releases a reserved address, and refuses anything else', async () => {
		const sent = digitalocean([
			[/(POST|DELETE)/, 204, null],
			[
				/reserved_ips/,
				200,
				{ reserved_ips: [{ ip: '203.0.113.7', droplet: { id: 1, name: 'web' } }, { ip: '203.0.113.8' }] },
			],
			[/droplets/, 200, { droplets: [{ id: 1, name: 'web' }] }],
		]);
		const op = NET_EXTRA.forms?.['ipop'];
		const view = shown(await op?.read(ctx({ id: '203.0.113.7' })));
		expect(view).toContain('203.0.113.8 · not assigned');
		expect(view).toContain('"value":"unassign"');
		expect(shown(await op?.read(ctx({ id: '203.0.113.8' })))).toContain('"value":"assign"');
		expect((await op?.send(ctx(), write({ what: 'assign', droplet: '1' }, '203.0.113.8')))?.message).toBe(
			'203.0.113.8: assign',
		);
		expect((await op?.send(ctx(), write({ what: 'unassign' }, '203.0.113.7')))?.message).toBe(
			'203.0.113.7: unassign',
		);
		expect((await op?.send(ctx(), write({ what: 'release' }, '203.0.113.8')))?.message).toBe(
			'203.0.113.8: release',
		);
		await expect(op?.send(ctx(), write({ what: 'sell' }, '203.0.113.8'))).rejects.toThrow('Choose what to do.');
		expect(writes(sent)).toHaveLength(3);
	});
});

describe('DigitalOcean DNS', () => {
	it('adds a domain with or without an apex address, and refuses a name that is no domain', async () => {
		const sent = digitalocean([[/POST/, 201, {}]]);
		const add = DODNS_EXTRA.forms?.['domain'];
		expect(shown(await add?.read(ctx()))).toContain('New domain');
		await expect(add?.send(ctx(), write({ name: 'shop' }))).rejects.toThrow('A domain like example.com.');
		expect((await add?.send(ctx(), write({ name: 'Shop.Example.test', ip: '203.0.113.7' }, 'new')))?.message).toBe(
			'shop.example.test added to DigitalOcean DNS',
		);
		expect((await add?.send(ctx(), write({ name: 'blog.example.test' })))?.message).toContain('blog.example.test');
		expect(writes(sent)[0]).toContain('"ip_address":"203.0.113.7"');
		expect(writes(sent)[1]).not.toContain('ip_address');
	});

	it('deletes a record once its name is typed', async () => {
		digitalocean([
			[/DELETE/, 204, null],
			[
				/domains\/example\.test\/records/,
				200,
				{ domain_records: [{ id: 5, name: 'www', type: 'A', data: '203.0.113.7' }] },
			],
			[/domains/, 200, { domains: [{ name: 'example.test' }] }],
		]);
		const del = DODNS_EXTRA.forms?.['recorddelete'];
		expect(shown(await del?.read(ctx()))).toContain('"confirmName":"www.example.test"');
		await expect(del?.send(ctx(), write({}, 'example.test:5', 'wrong'))).rejects.toThrow();
		expect((await del?.send(ctx(), write({}, 'example.test:5', 'www.example.test')))?.message).toBe(
			'Deleted www.example.test · A 203.0.113.7',
		);
	});
});

describe('uptime checks, projects and registry tags', () => {
	it('saves a check over http or https, deletes one, and refuses an address with no scheme', async () => {
		const sent = digitalocean([
			[/(PUT|DELETE)/, 200, {}],
			[
				/uptime\/checks/,
				200,
				{ checks: [{ id: 'c1', name: 'shop', target: 'https://example.test', enabled: false }] },
			],
		]);
		const edit = MONITORING_EXTRA.forms?.['uptimeedit'];
		expect(shown(await edit?.read(ctx()))).toContain('"value":false');
		expect((await edit?.send(ctx(), write({ delete: true }, 'c1')))?.message).toBe(
			'shop · https://example.test deleted',
		);
		await expect(edit?.send(ctx(), write({ name: 'shop', target: 'example.test' }, 'c1'))).rejects.toThrow(
			'starting with https://',
		);
		expect((await edit?.send(ctx(), write({ name: 'shop', target: 'http://example.test' }, 'c1')))?.message).toBe(
			'shop saved',
		);
		await edit?.send(ctx(), write({ name: 'shop', target: 'https://example.test', enabled: true }, 'c1'));
		const puts = sent.filter((s) => s.startsWith('PUT'));
		expect(puts[0]).toContain('"type":"http"');
		expect(puts[1]).toContain('"type":"https"');
	});

	it('makes a project, saves one, and deletes an empty one that is not the default', async () => {
		const sent = digitalocean([
			[/(POST|PATCH|DELETE)/, 200, {}],
			[
				/projects/,
				200,
				{
					projects: [
						{ id: 'p0', name: 'Default', is_default: true, purpose: 'Web', environment: 'Staging' },
						{ id: 'p1', name: 'old' },
					],
				},
			],
		]);
		const project = ACCOUNT_EXTRA.forms?.['project'];
		expect(shown(await project?.read(ctx({ id: 'p0' })))).toContain('Default (default)');
		expect((await project?.send(ctx(), write({ name: 'Shop' })))?.message).toBe('Project Shop made');
		expect(
			(await project?.send(ctx(), write({ name: 'Shop', purpose: 'Store', environment: 'Staging' }, 'p1')))
				?.message,
		).toBe('Project Shop saved');
		expect(writes(sent)[0]).toContain('"purpose":"Web Application"');
		const del = ACCOUNT_EXTRA.forms?.['projectdelete'];
		expect(shown(await del?.read(ctx()))).not.toContain('Default');
		expect((await del?.send(ctx(), write({}, 'p1', 'old')))?.message).toBe('Project old deleted');
	});

	it('lists tags across repositories, deletes one, and lists none when the registry may not be read', async () => {
		const sent = digitalocean([
			[/DELETE/, 204, null],
			[/repositories\/shop%2Fapi\/tags/, 200, { tags: [{ tag: 'v1', compressed_size_bytes: 2_097_152 }] }],
			[/repositoriesV2/, 200, { repositories: [{ name: 'shop/api' }] }],
			[/registry/, 200, { registry: { name: 'reg' } }],
		]);
		const del = REGISTRY_EXTRA.forms?.['tagdelete'];
		expect(shown(await del?.read(ctx()))).toContain('shop/api:v1 · 2 MB');
		expect((await del?.send(ctx(), write({}, 'reg|shop/api|v1', 'shop/api:v1')))?.message).toBe(
			'shop/api:v1 deleted; run Clean up to free the space',
		);
		expect(writes(sent)[0]).toContain('/registry/reg/repositories/shop%2Fapi/tags/v1');
		digitalocean([
			[/repositories\/shop%2Fapi\/tags/, 403, {}],
			[/repositoriesV2/, 200, { repositories: [{ name: 'shop/api' }] }],
			[/registry/, 200, { registry: { name: 'reg' } }],
		]);
		expect(shown(await del?.read(ctx()))).toContain('Nothing here yet.');
		digitalocean([
			[/repositoriesV2/, 403, {}],
			[/registry/, 200, { registry: { name: 'reg' } }],
		]);
		expect(shown(await del?.read(ctx()))).toContain('Nothing here yet.');
		digitalocean([[/registry/, 404, {}]]);
		expect(shown(await del?.read(ctx()))).toContain('Nothing here yet.');
	});
});

describe('inside a managed database cluster', () => {
	it('adds and drops databases and pools, sets the maintenance window, and refuses bad input', async () => {
		const sent = digitalocean([
			[/(POST|PUT|DELETE)/, 200, {}],
			[
				/databases/,
				200,
				{
					databases: [
						{
							id: 'd1',
							name: 'shop',
							engine: 'pg',
							maintenance_window: { day: 'monday', hour: '02:00:00' },
						},
					],
				},
			],
		]);
		const inside = DATABASES_EXTRA.forms?.['dbinside'];
		const view = shown(await inside?.read(ctx()));
		expect(view).toContain('"value":"monday"');
		expect(view).toContain('"value":"02:00"');
		const go = (values: Record<string, unknown>) => inside?.send(ctx(), write(values, 'd1'));
		await expect(go({ what: 'db', name: 'Bad-Name' })).rejects.toThrow('Name: lowercase');
		expect((await go({ what: 'db', name: 'orders' }))?.message).toBe('shop · pg: db orders');
		expect((await go({ what: 'dbdrop', name: 'orders' }))?.message).toBe('shop · pg: dbdrop orders');
		expect((await go({ what: 'pool', name: 'p1', poolDb: 'shop doadmin', size: 12 }))?.message).toBe(
			'shop · pg: pool p1',
		);
		expect((await go({ what: 'pool', name: 'p2', poolDb: 'shop' }))?.message).toBe('shop · pg: pool p2');
		expect((await go({ what: 'pooldrop', name: 'p1' }))?.message).toBe('shop · pg: pooldrop p1');
		await expect(go({ what: 'maint', hour: 'noon' })).rejects.toThrow('Hour like 20:30.');
		expect((await go({ what: 'maint', day: 'monday', hour: '03:00' }))?.message).toBe('shop · pg: maint');
		await expect(go({ what: 'resize' })).rejects.toThrow('Choose what to do.');
		const pools = writes(sent).filter((s) => s.includes('/pools') && s.startsWith('POST'));
		expect(pools[0]).toContain('"size":12,"db":"shop","user":"doadmin"');
		expect(pools[1]).toContain('"size":10,"db":"shop","user":""');
		digitalocean([[/databases/, 200, { databases: [{ id: 'd2', name: 'cache', engine: 'redis' }] }]]);
		const fresh = shown(await inside?.read(ctx()));
		expect(fresh).toContain('"value":"sunday"');
		expect(fresh).toContain('"value":"20:30"');
	});
});
