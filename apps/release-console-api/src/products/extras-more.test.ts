import { afterEach, describe, expect, it, vi } from 'vitest';

import { PRODUCT_SCREENS } from './registry.js';

import type { ProductCtx } from './kit.js';

/** Every vendor answers locally by method and address; the first matching route wins. */
type Route = [RegExp, number, unknown];
function vendors(routes: Route[]) {
	const sent: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: URL | string, init?: RequestInit) => {
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
let n = 0;
const ctx = (over: Partial<ProductCtx> = {}): ProductCtx =>
	({
		key: `extras-key-${++n}`,
		id: null,
		zones: ['example.com'],
		keyRefs: [],
		repo: { id: 'shop', environments: [] },
		repository: 'example/shop',
		consoleKey: (name: string) => `value-of-${name}`,
		writeKey: async () => `extras-write-${n}`,
		helper: vi.fn(async () => ({})),
		envTags: () => ({}),
		pruneEnvTags: vi.fn(),
		...over,
	}) as unknown as ProductCtx;
const write = (values: Record<string, unknown>, id: string | null = null, confirm = '') =>
	({ pin: '123456', confirm, id, values }) as never;
const screen = (name: string) => PRODUCT_SCREENS[name];
const ZONE: Route = [
	/zones\?name=example\.com/,
	200,
	{ success: true, result: [{ id: 'z1', name: 'example.com', account: { id: 'a1' } }] },
];

afterEach(() => vi.unstubAllGlobals());

describe('DigitalOcean extras', () => {
	it('holds an autoscale pool at a fixed size', async () => {
		vendors([
			[/GET .*droplets\/autoscale\/p1/, 200, { autoscale_pool: { id: 'p1', name: 'web' } }],
			[/GET .*droplets\/autoscale\/none/, 200, {}],
			[
				/GET .*droplets\/autoscale/,
				200,
				{ autoscale_pools: [{ id: 'p1', name: 'web', active_resources_count: 0 }] },
			],
			[/PUT/, 200, {}],
		]);
		const op = screen('doautoscale')?.forms?.['op'];
		expect(JSON.stringify(await op?.read(ctx()))).toContain('Hold web at a fixed size');
		expect((await op?.send(ctx(), write({ n: '3' }, 'p1')))?.message).toBe('web held at 3 droplets');
		await expect(op?.send(ctx({ id: 'none' }), write({ n: '3' }))).rejects.toThrow('Choose a pool.');
		vendors([[/autoscale/, 403, {}]]);
		expect(JSON.stringify(await op?.read(ctx()))).toContain('No autoscale pools.');
	});

	it('creates an app, sets the registry plan, renames a peering and creates an agent', async () => {
		vendors([
			[/POST .*\/apps/, 200, { app: { id: 'app1' } }],
			[/registry\/subscription/, 200, { subscription: { tier: { slug: 'basic' } } }],
			[/GET .*vpc_peerings/, 200, { vpc_peerings: [{ id: 'v1', name: 'peer' }] }],
			[/PATCH/, 200, {}],
			[
				/gen-ai\/models/,
				200,
				{ models: [{ uuid: 'm1', name: 'Model', is_foundational: true }, { name: 'skip' }] },
			],
			[/GET .*\/projects/, 200, { projects: [{ id: 'pr1', name: 'Shop', is_default: true }] }],
			[/POST .*gen-ai\/agents/, 200, { agent: { uuid: 'ag1', name: 'Helper' } }],
		]);
		const app = screen('apps')?.forms?.['create'];
		expect(JSON.stringify(await app?.read(ctx()))).toContain('shop-blog');
		await expect(app?.send(ctx(), write({ name: 'blog', repo: 'nope' }))).rejects.toThrow('owner/name');
		const made = await app?.send(
			ctx(),
			write({ name: 'blog', repo: 'example/blog', region: 'blr', branch: 'main', dir: '/', port: '8080' }),
		);
		expect(made?.productId).toBe('app1');
		const registry = screen('registry')?.forms?.['edit'];
		expect(JSON.stringify(await registry?.read(ctx()))).toContain('"value":"basic"');
		await expect(registry?.send(ctx(), write({ tier: 'huge' }))).rejects.toThrow('Choose a plan.');
		expect((await registry?.send(ctx(), write({ tier: 'starter' })))?.message).toBe('Registry plan set to starter');
		const peering = screen('donetadv')?.forms?.['edit'];
		expect(JSON.stringify(await peering?.read(ctx()))).toContain('peer');
		await expect(peering?.send(ctx(), write({ name: 'x' }))).rejects.toThrow('Choose a peering.');
		expect((await peering?.send(ctx({ id: 'v1' }), write({ name: 'new-name' })))?.productId).toBe('v1');
		const agent = screen('inference')?.forms?.['create'];
		expect(JSON.stringify(await agent?.read(ctx()))).toContain('pr1');
		expect(
			(
				await agent?.send(
					ctx(),
					write({ name: 'Helper', model: 'm1', instruction: 'Be kind', project: 'pr1', region: 'tor1' }),
				)
			)?.productId,
		).toBe('ag1');
		vendors([
			[/registry/, 404, {}],
			[/vpc_peerings/, 403, {}],
			[/gen-ai/, 403, {}],
			[/projects/, 403, {}],
		]);
		expect(JSON.stringify(await registry?.read(ctx()))).toContain('No container registry.');
		expect(JSON.stringify(await peering?.read(ctx()))).toContain('No VPC peerings.');
		expect(JSON.stringify(await agent?.read(ctx()))).toContain('No models readable');
	});

	it('picks the droplets behind a load balancer, or says it sends to a tag', async () => {
		const sent = vendors([
			[/GET .*load_balancers\/lb1/, 200, { load_balancer: { name: 'front', droplet_ids: [1, 2] } }],
			[
				/GET .*load_balancers/,
				200,
				{
					load_balancers: [
						{ id: 'lb1', name: 'front', region: { slug: 'blr1' }, droplet_ids: [1] },
						{ id: 'lb2', name: 'tagged', tag: 'web' },
					],
				},
			],
			[
				/GET .*\/droplets/,
				200,
				{
					droplets: [
						{ id: 1, name: 'a', region: { slug: 'blr1' } },
						{ id: 3, name: 'c', region: { slug: 'sgp1' } },
					],
				},
			],
			[/(POST|DELETE)/, 204, null],
		]);
		const op = screen('loadbalancers')?.forms?.['op'];
		expect(JSON.stringify(await op?.read(ctx()))).toContain('"value":"1"');
		expect(JSON.stringify(await op?.read(ctx({ id: 'lb2' })))).toContain('every droplet tagged web');
		expect((await op?.send(ctx(), write({ droplets: ['1', '3'] }, 'lb1')))?.message).toBe('front: +1 −1 droplets');
		expect((await op?.send(ctx(), write({ droplets: ['1', '2'] }, 'lb1')))?.message).toBe('front: +0 −0 droplets');
		expect(sent.filter((s) => /^(POST|DELETE)/.test(s))).toHaveLength(2);
		vendors([
			[/load_balancers/, 403, {}],
			[/droplets/, 200, { droplets: [] }],
		]);
		expect(JSON.stringify(await op?.read(ctx()))).toContain('No load balancers.');
		vendors([[/load_balancers\/null/, 200, { load_balancer: { name: 'none' } }]]);
		expect((await op?.send(ctx(), write({})))?.productId).toBeNull();
	});

	it('creates and deletes Spaces buckets, refusing one that still holds files', async () => {
		vendors([
			[
				/GET https:\/\/sgp1\.digitaloceanspaces\.com\/$/,
				200,
				'<Bucket><Name>media</Name></Bucket><Bucket><Name>full</Name></Bucket>',
			],
			[/GET https:\/\/full\..*list-type=2/, 200, '<Contents><Key>a</Key></Contents>'],
			[/GET https:\/\/media\..*list-type=2/, 500, 'Boom'],
			[/(PUT|DELETE) https:\/\//, 200, ''],
		]);
		const spaces = screen('spaces');
		expect(JSON.stringify(await spaces?.forms?.['create']?.read(ctx()))).toContain('shop-backups-staging');
		await expect(spaces?.forms?.['create']?.send(ctx(), write({ name: 'X', region: 'sgp1' }))).rejects.toThrow(
			'Lowercase',
		);
		expect(
			(await spaces?.forms?.['create']?.send(ctx(), write({ name: 'new-bucket', region: 'sgp1' })))?.message,
		).toBe('Bucket new-bucket created');
		const destroy = spaces?.forms?.['destroy'];
		expect(JSON.stringify(await destroy?.read(ctx({ id: 'full' })))).toContain('still holds files');
		expect(JSON.stringify(await destroy?.read(ctx({ id: 'media' })))).toContain('"blocked":null');
		await expect(destroy?.send(ctx(), write({}, 'gone'))).rejects.toThrow('Choose a bucket.');
		expect((await destroy?.send(ctx({ id: 'media' }), write({}, null, 'media')))?.message).toBe(
			'Bucket media deleted',
		);
		vendors([[/digitaloceanspaces/, 200, '']]);
		expect(JSON.stringify(await destroy?.read(ctx()))).toContain('No buckets.');
		expect(JSON.stringify(await spaces?.forms?.['op']?.read(ctx()))).toContain('Rotate the Spaces key');
		await expect(spaces?.forms?.['op']?.send(ctx(), write({}))).rejects.toThrow('your step on DigitalOcean');
		await expect(screen('functions')?.forms?.['op']?.send(ctx(), write({}))).rejects.toThrow('deploy from code');
		expect(JSON.stringify(await screen('functions')?.forms?.['op']?.read(ctx()))).toContain('Deploy functions');
	});

	it('lists the secret names App Platform apps hold, and sends secrets to Infisical instead', async () => {
		vendors([
			[
				/GET .*\/apps/,
				200,
				{
					apps: [
						{
							id: 'a1',
							updated_at: '2026-11-24T00:00:00Z',
							spec: {
								name: 'blog',
								envs: [{ key: 'TOKEN', type: 'SECRET', scope: 'RUN_TIME' }],
								services: [{ envs: [{ key: 'PLAIN', type: 'GENERAL' }] }],
							},
						},
						{ id: 'a2' },
					],
				},
			],
		]);
		const s = screen('dosecrets');
		expect(JSON.stringify(await s?.tabs['detail']?.(ctx()))).toContain('TOKEN');
		expect(JSON.stringify(await s?.tabs['history']?.(ctx()))).toContain('blog');
		for (const k of ['create', 'edit', 'destroy']) {
			expect(JSON.stringify(await s?.forms?.[k]?.read(ctx()))).toContain('Infisical');
			await expect(s?.forms?.[k]?.send(ctx(), write({}))).rejects.toThrow('Secrets live in Infisical');
		}
		vendors([[/apps/, 403, {}]]);
		expect(JSON.stringify(await s?.tabs['detail']?.(ctx()))).toContain('No App Platform app holds secrets.');
	});
});

describe('Cloudflare billing and GitHub secrets', () => {
	it('reads subscriptions and the billing contact, and says when the key may not', async () => {
		vendors([
			ZONE,
			[
				/subscriptions/,
				200,
				{
					success: true,
					result: [
						{ id: 's1', rate_plan: { id: 'pro', public_name: 'Pro' }, price: 20, frequency: 'monthly' },
					],
				},
			],
			[
				/billing\/profile/,
				200,
				{ success: true, result: { first_name: 'Asha', last_name: 'Roy', payment_gateway: 'stripe' } },
			],
		]);
		const billing = screen('cfaccount')?.tabs['billing'];
		expect(JSON.stringify(await billing?.(ctx()))).toContain('stripe on file');
		vendors([ZONE, [/subscriptions/, 403, {}], [/billing\/profile/, 200, { success: true, result: {} }]]);
		const bare = JSON.stringify(await billing?.(ctx()));
		expect(bare).toContain('not readable with this key');
		expect(bare).toContain('none on file');
		vendors([ZONE, [/subscriptions/, 200, { success: true, result: [] }], [/billing\/profile/, 403, {}]]);
		expect(JSON.stringify(await billing?.(ctx()))).toContain('everything is on free plans');
	});

	it('writes a secret into a GitHub environment through the helper, by a chosen or typed name', async () => {
		vendors([[/environments$/, 200, { environments: [{ name: 'qa' }] }]]);
		const w = screen('secrets')?.forms?.['write'];
		expect(JSON.stringify(await w?.read(ctx()))).toContain('"qa"');
		vendors([[/environments$/, 500, 'not json']]);
		expect(JSON.stringify(await w?.read(ctx()))).toContain('staging');
		await expect(
			w?.send(ctx(), write({ environment: 'staging', name: 'other', other: 'bad name', value: 'x' })),
		).rejects.toThrow('capital letters');
		await expect(
			w?.send(ctx(), write({ environment: 'staging', name: 'CF_ACCESS_CLIENT_ID', value: ' ' })),
		).rejects.toThrow('Type the value.');
		await expect(
			w?.send(ctx(), write({ environment: 'staging', name: 'CF_ACCESS_CLIENT_ID', value: 3 })),
		).rejects.toThrow('Type the value.');
		const c = ctx();
		expect(
			(await w?.send(c, write({ environment: 'staging', name: 'other', other: 'MY_SECRET', value: 'v' })))
				?.productId,
		).toBe('MY_SECRET');
		expect(c.helper).toHaveBeenCalledWith(
			'POST',
			'/github/environment',
			expect.objectContaining({ secrets: { MY_SECRET: 'v' } }),
		);
	});
});
