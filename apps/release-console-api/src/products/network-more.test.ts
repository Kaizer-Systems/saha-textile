import { afterEach, describe, expect, it, vi } from 'vitest';

import { PRODUCT_SCREENS } from './registry.js';

import type { ProductCtx } from './kit.js';

/** DigitalOcean and Cloudflare's address lists answer locally; the first matching route wins. */
type Route = [RegExp, number, unknown];
function vendors(routes: Route[]) {
	const sent: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const line = `${init?.method ?? 'GET'} ${String(url)}`;
			sent.push(line);
			const hit = routes.find(([re]) => re.test(line));
			const status = hit?.[1] ?? 200;
			const body = hit?.[2] ?? {};
			return new Response(status === 204 ? null : typeof body === 'string' ? body : JSON.stringify(body), {
				status,
			});
		}),
	);
	return sent;
}
const RANGES = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22'];
const CF_IPS: Route[] = [
	[/ips-v4/, 200, RANGES.join('\n')],
	[/ips-v6/, 200, '2400:cb00::/32'],
];
let n = 0;
const ctx = (over: Partial<ProductCtx> = {}): ProductCtx =>
	({
		key: `net-key-${++n}`,
		id: null,
		repo: { id: 'shop', environments: [] },
		writeKey: async () => `net-write-${n}`,
		envTags: () => ({}),
		...over,
	}) as unknown as ProductCtx;
const write = (values: Record<string, unknown>, id: string | null = null, confirm = '') =>
	({ pin: '123456', confirm, id, values }) as never;
const net = () => PRODUCT_SCREENS['cloudnet'];
const ALL = [...RANGES, '2400:cb00::/32'];
const FIREWALLS = {
	firewalls: [
		{
			id: 'f1',
			name: 'web',
			status: 'succeeded',
			droplet_ids: [1],
			tags: ['web'],
			inbound_rules: [
				{ protocol: 'tcp', ports: '443', sources: { addresses: ALL } },
				{ protocol: 'tcp', ports: '22', sources: { addresses: ['0.0.0.0/0'] } },
				{ protocol: 'tcp', ports: '8000-9999', sources: { addresses: ['::/0'] } },
				{
					protocol: 'tcp',
					ports: '443',
					sources: {
						addresses: ['1.2.3.4', '5.6.7.8', '9.9.9.9', '8.8.8.8'],
						tags: ['a'],
						droplet_ids: [2],
						load_balancer_uids: ['lb'],
					},
				},
				{ protocol: 'icmp', sources: { addresses: ['10.0.0.1'] } },
			],
			outbound_rules: [],
		},
		{
			id: 'f2',
			name: 'empty',
			status: 'waiting',
			inbound_rules: [],
			outbound_rules: [{ protocol: 'tcp', ports: '0', destinations: { addresses: ['0.0.0.0/0'] } }],
		},
	],
};
const DROPLETS = {
	droplets: [
		{ id: 1, name: 'web-production', tags: [] },
		{ id: 2, name: 'worker', tags: ['web'] },
		{ id: 3, name: 'loose', tags: [] },
	],
};

afterEach(() => vi.unstubAllGlobals());

describe('DigitalOcean networking', () => {
	it('lists firewalls with what they let in, what they cover and what breaks the plan', async () => {
		vendors([...CF_IPS, [/firewalls/, 200, FIREWALLS], [/droplets/, 200, DROPLETS]]);
		const view = JSON.stringify(await net()?.tabs['firewalls']?.(ctx()));
		expect(view).toContain('SSH (port 22) is open to the whole internet');
		expect(view).toContain('the API (port 9000) is open to the whole internet');
		expect(view).toContain('HTTPS misses');
		expect(view).toContain('TCP 443 from Cloudflare');
		expect(view).toContain('7 sources');
		expect(view).toContain('loose has no Cloud Firewall');
		vendors([
			[/ips-v/, 500, ''],
			[/firewalls/, 200, { firewalls: [] }],
			[/droplets/, 200, { droplets: [] }],
		]);
		expect(JSON.stringify(await net()?.tabs['firewalls']?.(ctx()))).toContain('No Cloud Firewalls');
	});

	it('creates a firewall from a preset, and refuses when Cloudflare’s list cannot be read', async () => {
		const sent = vendors([
			...CF_IPS,
			[/POST .*\/firewalls$/, 200, { firewall: { id: 'f9' } }],
			[/droplets/, 200, DROPLETS],
		]);
		const create = net()?.forms?.['create'];
		expect(JSON.stringify(await create?.read(ctx()))).toContain('cloudflare-https');
		for (const inbound of ['cloudflare-https', 'cloudflare-web', 'none'])
			expect(
				(await create?.send(ctx(), write({ name: 'fw', inbound, tags: 'web', droplets: '1, x' })))?.productId,
			).toBe('f9');
		expect(sent.filter((s) => s.startsWith('POST'))).toHaveLength(3);
		vendors([
			[/ips-v4/, 200, ''],
			[/ips-v6/, 200, ''],
		]);
		await expect(create?.send(ctx(), write({ name: 'fw', inbound: 'cloudflare-https' }))).rejects.toThrow(
			'could not be read',
		);
	});

	it('adds a rule that keeps the plan, and refuses one that opens a private port', async () => {
		vendors([...CF_IPS, [/firewalls/, 200, FIREWALLS], [/POST .*\/rules/, 204, null]]);
		const rule = net()?.forms?.['rule'];
		expect(JSON.stringify(await rule?.read(ctx()))).toContain('Add a rule');
		await expect(rule?.send(ctx(), write({}))).rejects.toThrow('Choose a firewall.');
		await expect(rule?.send(ctx(), write({ direction: 'inbound', protocol: 'gre' }, 'f1'))).rejects.toThrow(
			'TCP, UDP or ICMP',
		);
		await expect(
			rule?.send(ctx(), write({ direction: 'inbound', protocol: 'tcp', ports: 'lots' }, 'f1')),
		).rejects.toThrow('Ports: one port');
		await expect(
			rule?.send(
				ctx(),
				write({ direction: 'inbound', protocol: 'tcp', ports: '443', addresses: 'example.com' }, 'f1'),
			),
		).rejects.toThrow('is not an address');
		await expect(
			rule?.send(ctx(), write({ direction: 'inbound', protocol: 'tcp', ports: '443' }, 'f1')),
		).rejects.toThrow('at least one address or tag');
		await expect(
			rule?.send(
				ctx(),
				write({ direction: 'inbound', protocol: 'tcp', ports: '22', addresses: '0.0.0.0/0' }, 'f1'),
			),
		).rejects.toThrow('Refused: SSH');
		expect(
			(
				await rule?.send(
					ctx(),
					write({ direction: 'inbound', protocol: 'tcp', ports: '443', addresses: 'cloudflare' }, 'f1'),
				)
			)?.message,
		).toContain('TCP 443 inbound');
		expect(
			(await rule?.send(ctx({ id: 'f1' }), write({ direction: 'outbound', protocol: 'icmp', tags: 'web' })))
				?.message,
		).toBe('Rule added: ICMP  outbound');
	});

	it('lists private networks with their members, and reserved addresses with what they are on', async () => {
		vendors([
			[/vpcs\/v1\/members/, 200, { members: [{ name: 'web' }] }],
			[/vpcs\/v2\/members/, 403, {}],
			[
				/GET .*\/vpcs/,
				200,
				{
					vpcs: [
						{ id: 'v1', name: 'net', default: true },
						{ id: 'v2', name: 'quiet' },
					],
				},
			],
			[
				/reserved_ips/,
				200,
				{ reserved_ips: [{ ip: '203.0.113.7', droplet: { id: 1, name: 'web' } }, { ip: '203.0.113.8' }] },
			],
			[/reserved_ipv6/, 403, {}],
			[/droplets/, 200, DROPLETS],
		]);
		const vpcView = JSON.stringify(await net()?.tabs['vpc']?.(ctx()));
		expect(vpcView).toContain('"members":"web"');
		expect(vpcView).toContain('"members":"none"');
		expect(JSON.stringify(await net()?.tabs['ips']?.(ctx()))).toContain('unassigned');
		vendors([
			[/reserved_ips/, 403, {}],
			[
				/reserved_ipv6/,
				200,
				{ reserved_ipv6s: [{ ip: '2001:db8::1', droplet: { id: 1, name: 'web' } }, { ip: '2001:db8::2' }] },
			],
			[/droplets/, 200, DROPLETS],
		]);
		expect(JSON.stringify(await net()?.tabs['ips']?.(ctx()))).toContain('2001:db8::2');
	});

	it('creates a VPC, reserves an address, and lists the changes DigitalOcean dates', async () => {
		vendors([
			[
				/GET .*\/regions/,
				200,
				{
					regions: [
						{ slug: 'blr1', name: 'Bangalore', available: true },
						{ slug: 'old', available: false },
					],
				},
			],
			[/POST .*\/vpcs/, 200, { vpc: { id: 'v1', name: 'shop-staging' } }],
			[
				/GET .*\/vpcs/,
				200,
				{ vpcs: [{ id: 'v1', name: 'net', ip_range: '10.0.0.0/20', created_at: '2026-11-01' }] },
			],
			[/GET .*\/droplets/, 200, DROPLETS],
			[/POST .*reserved_ips/, 200, { reserved_ip: { ip: '203.0.113.7' } }],
			[/firewalls/, 200, FIREWALLS],
		]);
		const vpc = net()?.forms?.['vpc'];
		expect(JSON.stringify(await vpc?.read(ctx()))).toContain('Bangalore · blr1');
		await expect(vpc?.send(ctx(), write({ name: 'net', region: 'blr1', range: '10.0.0.0' }))).rejects.toThrow(
			'Range: like',
		);
		expect((await vpc?.send(ctx(), write({ name: 'net', region: 'blr1', range: '10.20.0.0/20' })))?.message).toBe(
			'VPC shop-staging created',
		);
		expect((await vpc?.send(ctx(), write({ name: 'net', region: 'blr1' })))?.productId).toBe('v1');
		const reserve = net()?.forms?.['reserve'];
		expect(JSON.stringify(await reserve?.read(ctx()))).toContain('web-production');
		expect((await reserve?.send(ctx(), write({ droplet: '1' })))?.message).toBe('Reserved 203.0.113.7');
		expect(JSON.stringify(await net()?.tabs['history']?.(ctx()))).toContain('Firewall web created');
	});

	it('deletes a firewall only when no production droplet would be left without one', async () => {
		vendors([
			[/GET .*\/firewalls\/f1/, 200, { firewall: FIREWALLS.firewalls[0] }],
			[/GET .*\/firewalls\/f2/, 200, { firewall: FIREWALLS.firewalls[1] }],
			[/GET .*\/firewalls/, 200, FIREWALLS],
			[/GET .*\/droplets/, 200, DROPLETS],
			[/DELETE/, 204, null],
		]);
		const destroy = net()?.forms?.['destroy'];
		expect(JSON.stringify(await destroy?.read(ctx({ id: 'f1' })))).toContain(
			'It stops protecting web-production, worker.',
		);
		expect(JSON.stringify(await destroy?.read(ctx({ id: 'f2' })))).toContain('It stops protecting nothing.');
		await expect(destroy?.send(ctx(), write({}))).rejects.toThrow('Choose a firewall.');
		await expect(destroy?.send(ctx(), write({}, 'f1', 'web'))).rejects.toThrow(
			'web-production would be left with no firewall',
		);
		expect((await destroy?.send(ctx({ id: 'f2' }), write({}, null, 'empty')))?.message).toBe(
			'Firewall empty deleted',
		);
		vendors([
			[/firewalls/, 200, { firewalls: [] }],
			[/droplets/, 200, { droplets: [] }],
		]);
		expect(JSON.stringify(await destroy?.read(ctx()))).toContain('No Cloud Firewalls on this account.');
	});
});
