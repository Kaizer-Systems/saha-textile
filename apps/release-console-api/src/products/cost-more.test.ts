import { afterEach, describe, expect, it, vi } from 'vitest';

import { PRODUCT_SCREENS } from './registry.js';

import type { ProductCtx } from './kit.js';

/** DigitalOcean answers locally by method and address; the first matching route wins. */
type Route = [RegExp, number, unknown];
function digitalocean(routes: Route[]) {
	const sent: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const line = `${init?.method ?? 'GET'} ${url}`;
			sent.push(line);
			const hit = routes.find(([re]) => re.test(line));
			const status = hit?.[1] ?? 200;
			return new Response(status === 204 ? null : JSON.stringify(hit?.[2] ?? {}), { status });
		}),
	);
	return sent;
}
let n = 0;
const ctx = (over: Partial<ProductCtx> = {}): ProductCtx =>
	({ key: `cost-key-${++n}`, id: null, writeKey: async () => `cost-write-${n}`, ...over }) as unknown as ProductCtx;
const write = (values: Record<string, unknown>, id: string | null = null) =>
	({ pin: '123456', confirm: '', id, values }) as never;
const form = (screen: string, key: string) => PRODUCT_SCREENS[screen]?.forms?.[key];

afterEach(() => vi.unstubAllGlobals());

describe('cost forms', () => {
	it('turns a server’s weekly backups on and off, with its price', async () => {
		digitalocean([
			[
				/GET .*\/droplets\?per_page/,
				200,
				{
					droplets: [
						{ id: 1, name: 'web', size: { price_monthly: 24 }, backup_ids: [], features: ['backups'] },
						{ id: 2, name: 'db', size: { price_monthly: 12 } },
					],
				},
			],
			[/POST/, 201, { action: { id: 9 } }],
		]);
		const backups = form('droplets', 'backups');
		expect(JSON.stringify(await backups?.read(ctx({ id: '2' })))).toContain('$2.40 a month on top of $12.00');
		expect(JSON.stringify(await backups?.read(ctx({ id: '1' })))).toContain('Turn backups off');
		expect((await backups?.send(ctx(), write({}, '1')))?.message).toBe('web: backups off');
		expect((await backups?.send(ctx({ id: '2' }), write({})))?.message).toBe('db: backups on');
		await expect(backups?.send(ctx(), write({}, '9'))).rejects.toThrow('Choose a server.');
		digitalocean([[/droplets/, 200, { droplets: [] }]]);
		expect(JSON.stringify(await backups?.read(ctx()))).toContain('No servers yet.');
	});

	it('adds a read replica to a cluster, and refuses a missing cluster or a bad name', async () => {
		digitalocean([
			[
				/GET .*\/databases/,
				200,
				{ databases: [{ id: 'db1', name: 'shop', engine: 'pg', size: 'db-s-1vcpu-1gb', region: 'blr1' }] },
			],
			[/POST/, 201, {}],
		]);
		const replica = form('databases', 'replica');
		expect(JSON.stringify(await replica?.read(ctx()))).toContain('shop-replica');
		await expect(replica?.send(ctx(), write({ name: 'x' }))).rejects.toThrow('Choose a database cluster.');
		await expect(
			replica?.send(ctx(), write({ name: 'Bad Name', region: 'blr1', size: 's' }, 'db1')),
		).rejects.toThrow('lowercase');
		expect(
			(await replica?.send(ctx({ id: 'db1' }), write({ name: 'shop-replica', region: 'blr1', size: 's' })))
				?.message,
		).toBe('Replica shop-replica is being made');
		digitalocean([[/databases/, 200, { databases: [] }]]);
		expect(JSON.stringify(await replica?.read(ctx()))).toContain('No managed databases yet.');
	});

	it('adds a node pool with or without autoscaling, and refuses a bad name or size', async () => {
		digitalocean([
			[/GET .*kubernetes\/clusters/, 200, { kubernetes_clusters: [{ id: 'k1', name: 'shop', region: 'blr1' }] }],
			[
				/GET .*\/sizes/,
				200,
				{
					sizes: [
						{ slug: 's-2vcpu-4gb', available: true, regions: ['blr1'], price_monthly: 24 },
						{ slug: 's-old', available: false },
					],
				},
			],
			[/POST/, 201, {}],
		]);
		const pool = form('kubernetes', 'nodepool');
		expect(JSON.stringify(await pool?.read(ctx()))).toContain('s-2vcpu-4gb');
		await expect(pool?.send(ctx(), write({ name: 'p' }))).rejects.toThrow('Choose a cluster.');
		await expect(pool?.send(ctx(), write({ name: 'P!' }, 'k1'))).rejects.toThrow('lowercase');
		await expect(pool?.send(ctx(), write({ name: 'pool', size: 'nope' }, 'k1'))).rejects.toThrow('Choose a size.');
		expect((await pool?.send(ctx(), write({ name: 'pool', size: 's-2vcpu-4gb', count: 3 }, 'k1')))?.message).toBe(
			'Node pool pool: 3 × s-2vcpu-4gb ($72.00/month)',
		);
		expect(
			(await pool?.send(ctx({ id: 'k1' }), write({ name: 'pool', size: 's-2vcpu-4gb', auto: true })))?.message,
		).toContain('2 ×');
		expect(
			(
				await pool?.send(
					ctx({ id: 'k1' }),
					write({ name: 'pool', size: 's-2vcpu-4gb', auto: 'true', min: '2', max: '5' }),
				)
			)?.message,
		).toContain('2 ×');
		digitalocean([
			[/kubernetes/, 200, { kubernetes_clusters: [] }],
			[/sizes/, 200, { sizes: [{ slug: 'a', available: true }] }],
		]);
		expect(JSON.stringify(await pool?.read(ctx()))).toContain('No Kubernetes clusters yet.');
	});

	it('turns the Spaces CDN on, changes its cache time, and turns it off', async () => {
		const origin = 'media.sgp1.digitaloceanspaces.com';
		const sent = digitalocean([
			[/GET .*cdn\/endpoints/, 200, { endpoints: [{ id: 'e1', origin }] }],
			[/spaces\/buckets/, 403, {}],
			[/(POST|PUT)/, 200, {}],
			[/DELETE/, 204, null],
		]);
		const cdn = form('spaces', 'cdnonoff');
		expect(JSON.stringify(await cdn?.read(ctx()))).toContain('cdnonoff');
		await expect(cdn?.send(ctx(), write({ origin: 'nope' }))).rejects.toThrow('A bucket address');
		expect((await cdn?.send(ctx(), write({ origin, on: 'on', ttl: 600 })))?.message).toBe(`CDN on for ${origin}`);
		expect((await cdn?.send(ctx(), write({ origin, on: 'on' })))?.message).toBe(`CDN on for ${origin}`);
		expect(
			(await cdn?.send(ctx(), write({ origin: 'other.sgp1.digitaloceanspaces.com', on: 'on' })))?.message,
		).toContain('CDN on');
		expect((await cdn?.send(ctx(), write({ origin, on: 'off' })))?.message).toBe(`CDN off for ${origin}`);
		expect(
			(await cdn?.send(ctx(), write({ origin: 'other.sgp1.digitaloceanspaces.com', on: 'off' })))?.message,
		).toContain('CDN off');
		expect(sent.filter((s) => /^(POST|PUT|DELETE)/.test(s))).toHaveLength(4);
		digitalocean([
			[/cdn\/endpoints/, 200, { endpoints: [] }],
			[/spaces\/buckets/, 200, { buckets: [] }],
		]);
		expect(JSON.stringify(await cdn?.read(ctx()))).toContain('"value":"off"');
	});
});
