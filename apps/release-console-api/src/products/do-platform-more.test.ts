import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	appsScreen,
	autoscaleScreen,
	functionsScreen,
	imagesScreen,
	kubernetesScreen,
	nfsScreen,
	registryScreen,
} from './do-platform.js';

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
			if (status === 204) return new Response(null, { status });
			return new Response(JSON.stringify(hit?.[2] ?? {}), { status });
		}),
	);
	return sent;
}
let n = 0;
const ctx = (over: Partial<ProductCtx> = {}): ProductCtx => {
	const i = ++n;
	return {
		key: `do-platform-key-${i}`,
		id: null,
		range: '24h',
		repo: { id: 'shop', environments: [] },
		envTags: () => ({}),
		setEnvTag: () => undefined,
		writeKey: async () => `do-platform-write-${i}`,
		...over,
	} as unknown as ProductCtx;
};
const write = (values: Record<string, unknown>, id: string | null = null, confirm = '') =>
	({ pin: '123456', confirm, id, values }) as never;
const shown = (v: unknown) => JSON.stringify(v);
const writes = (sent: string[]) => sent.filter((s) => !s.startsWith('GET'));

afterEach(() => vi.unstubAllGlobals());

describe('autoscale pools', () => {
	const POOLS = {
		autoscale_pools: [
			{
				id: 'p1',
				name: 'web',
				status: 'active',
				active_resources_count: 2,
				config: { min_instances: 1, max_instances: 3, target_cpu_utilization: 0.6, cooldown_minutes: 0 },
				droplet_template: { size: 's-1vcpu-1gb', region: 'blr1', image: 'ubuntu' },
				current_utilization: { cpu: 0.3, memory: 0.4 },
				created_at: '2026-11-01T00:00:00Z',
			},
			{ id: 'p2', name: 'fixed', config: { target_number_instances: 2 } },
		],
	};
	const ROUTES: Route[] = [
		[
			/autoscale\/p1\/members/,
			200,
			{ droplets: [{ droplet_id: 11, health_status: 'healthy', current_utilization: { cpu: 0.25 } }] },
		],
		[
			/autoscale\/p1\/history/,
			200,
			{
				history: [
					{
						created_at: '2026-11-02T00:00:00Z',
						current_instance_count: 1,
						desired_instance_count: 2,
						reason: 'cpu_high',
						status: 'success',
					},
				],
			},
		],
		[/autoscale\/p2\/(members|history)/, 403, {}],
		[/GET .*droplets\/autoscale/, 200, POOLS],
		[/regions/, 200, { regions: [{ slug: 'blr1', name: 'Bangalore', available: true }, { slug: 'old' }] }],
		[
			/sizes/,
			200,
			{
				sizes: [
					{ slug: 's-1vcpu-1gb', available: true, vcpus: 1, memory: 1024, price_monthly: 6 },
					{ slug: 'c-2', available: true },
					{ slug: 's-gone', available: false },
				],
			},
		],
		[/account\/keys/, 200, { ssh_keys: [{ id: 7, name: 'laptop' }] }],
	];

	it('lists pools with their droplet range, members, targets and scaling history', async () => {
		digitalocean(ROUTES);
		const list = shown(await autoscaleScreen.tabs['list']?.(ctx()));
		expect(list).toContain('2 of 1–3');
		expect(list).toContain('0 of 2–2');
		const web = shown(await autoscaleScreen.tabs['detail']?.(ctx({ id: 'p1' })));
		expect(web).toContain('CPU 30% · memory 40%');
		expect(web).toContain('"health":"healthy"');
		expect(shown(await autoscaleScreen.tabs['detail']?.(ctx({ id: 'p2' })))).toContain('No members.');
		expect(shown(await autoscaleScreen.tabs['history']?.(ctx({ id: 'p1' })))).toContain('1 → 2 droplets: cpu high');
		expect(shown(await autoscaleScreen.tabs['history']?.(ctx({ id: 'p2' })))).not.toContain('droplets:');
		expect(shown(await autoscaleScreen.tabs['monitor']?.(ctx({ id: 'p1' })))).toContain(
			'Charts of the first member',
		);
		expect(shown(await autoscaleScreen.tabs['monitor']?.(ctx({ id: 'p2' })))).toContain('no droplets yet');
	});

	it('creates, saves and destroys a pool', async () => {
		const sent = digitalocean([
			[/POST .*droplets\/autoscale/, 201, { autoscale_pool: { id: 'p9' } }],
			[/(PUT|DELETE)/, 204, null],
			...ROUTES,
		]);
		const create = shown(await autoscaleScreen.tabs['create']?.(ctx()));
		expect(create).toContain('Bangalore · blr1');
		expect(create).toContain('s-1vcpu-1gb · 1 vCPU');
		expect(create).not.toContain('c-2');
		expect(create).toContain('"value":["7"]');
		expect(shown(await autoscaleScreen.tabs['edit']?.(ctx({ id: 'p1' })))).toMatch(
			/"key":"cooldown"[^}]*"value":5,/,
		);
		expect(
			(
				await autoscaleScreen.forms?.['create']?.send(
					ctx(),
					write({
						name: 'web',
						min: 2,
						max: 4,
						cpu: 60,
						size: 's-1vcpu-1gb',
						region: 'blr1',
						image: 'ubuntu',
					}),
				)
			)?.message,
		).toBe('Pool web created (2–4 droplets)');
		expect(
			(await autoscaleScreen.forms?.['edit']?.send(ctx(), write({ min: 1, max: 5, cpu: 70, cooldown: 10 }, 'p1')))
				?.message,
		).toBe('Pool web saved');
		expect((await autoscaleScreen.forms?.['destroy']?.send(ctx(), write({}, 'p2', 'fixed')))?.message).toContain(
			'deleted',
		);
		expect(writes(sent).map((s) => s.split(' ')[0])).toEqual(['POST', 'PUT', 'DELETE']);
		expect(writes(sent)[2]).toContain('/droplets/autoscale/p2/dangerous');
	});
});

describe('Kubernetes, apps and functions', () => {
	it('shows high availability, and keeps the maintenance hour or the default when saving', async () => {
		const sent = digitalocean([
			[/PUT/, 202, {}],
			[
				/kubernetes\/clusters/,
				200,
				{
					kubernetes_clusters: [
						{
							id: 'k1',
							name: 'shop',
							ha: true,
							node_pools: [{ id: 'np1', name: 'pool', count: 2 }],
							maintenance_policy: { day: 'sunday' },
						},
					],
				},
			],
		]);
		expect(shown(await kubernetesScreen.tabs['detail']?.(ctx({ id: 'k1' })))).toContain(
			'["High availability","on",null]',
		);
		await kubernetesScreen.forms?.['edit']?.send(ctx(), write({ day: 'monday', count: 3, auto: true }, 'k1'));
		expect(writes(sent)[0]).toContain('"start_time":"20:00"');
		expect(writes(sent)[1]).toMatch(/node_pools\/np1 .*"count":3/);
	});

	it('scales an app’s first service, refuses one with none, redeploys or rolls back, and charts it', async () => {
		const sent = digitalocean([
			[/(PUT|POST)/, 200, {}],
			[
				/monitoring\/metrics\/apps\/cpu_percentage/,
				200,
				{ data: { result: [{ values: [[1_700_000_000, '12.345']] }] } },
			],
			[/apps\/a1\/deployments/, 200, { deployments: [] }],
			[
				/GET .*\/apps/,
				200,
				{
					apps: [
						{ id: 'a1', spec: { name: 'blog', services: [{ name: 'web', instance_count: 1 }] } },
						{ id: 'a2', spec: { name: 'static' } },
					],
				},
			],
		]);
		await expect(appsScreen.forms?.['edit']?.send(ctx(), write({ count: 2, size: 'basic' }, 'a2'))).rejects.toThrow(
			'This app has no service to scale.',
		);
		expect((await appsScreen.forms?.['edit']?.send(ctx(), write({ count: 2, size: 'basic' }, 'a1')))?.message).toBe(
			'blog saved; deploying',
		);
		expect(
			(await appsScreen.forms?.['op']?.send(ctx(), write({ what: 'rollback', to: 'd1' }, 'a1')))?.message,
		).toBe('Rolling back blog');
		expect((await appsScreen.forms?.['op']?.send(ctx(), write({ what: 'redeploy' }, 'a1')))?.message).toBe(
			'Redeploying blog',
		);
		expect(writes(sent)[1]).toMatch(/apps\/a1\/rollback .*"deployment_id":"d1"/);
		expect(writes(sent)[2]).toMatch(/apps\/a1\/deployments .*"force_build":true/);
		const monitor = shown(await appsScreen.tabs['monitor']?.(ctx({ id: 'a1' })));
		expect(monitor).toContain('[1700000000,12.35]');
	});

	it('names a namespace by its label or id, and saves a trigger with a five-field schedule only', async () => {
		const sent = digitalocean([
			[/PUT/, 200, {}],
			[
				/namespaces\/fn-1\/triggers/,
				200,
				{
					triggers: [
						{
							name: 'nightly',
							function: 'clean',
							scheduled_details: { cron: '0 3 * * *' },
							is_enabled: true,
						},
					],
				},
			],
			[
				/functions\/namespaces/,
				200,
				{
					namespaces: [
						{ namespace: 'fn-1', label: '' },
						{ namespace: 'fn-2', label: 'jobs' },
					],
				},
			],
		]);
		const list = shown(await functionsScreen.tabs['list']?.(ctx()));
		expect(list).toContain('"name":"fn-1"');
		expect(list).toContain('"name":"jobs"');
		const edit = functionsScreen.forms?.['edit'];
		await expect(edit?.send(ctx(), write({ trigger: 'nightly', cron: 'every night' }, 'fn-1'))).rejects.toThrow(
			'five cron fields',
		);
		expect(
			(await edit?.send(ctx(), write({ trigger: 'nightly', cron: '0 4 * * *', on: true }, 'fn-1')))?.message,
		).toBe('Trigger nightly saved');
		expect(writes(sent)[0]).toContain('"scheduled_details":{"cron":"0 4 * * *","body":{}}');
	});
});

describe('network file shares', () => {
	const ROUTES: Route[] = [
		[
			/nfs\?region=blr1/,
			200,
			{
				shares: [
					{ id: 's1', name: 'files', host: '10.0.0.5', mount_path: '/files', size_gib: 50 },
					{ id: 's2', name: 'other', region: 'nyc1', size_gib: 60 },
				],
			},
		],
		[/nfs\?region=sgp1/, 403, {}],
		[/nfs\/snapshots/, 403, {}],
		[
			/regions/,
			200,
			{ regions: [{ slug: 'blr1', available: true }, { slug: 'sgp1', available: true }, { slug: 'old' }] },
		],
	];

	it('finds shares in every open region, with their mount line when they have a host', async () => {
		digitalocean(ROUTES);
		const list = shown(await nfsScreen.tabs['list']?.(ctx()));
		expect(list).toContain('10.0.0.5:/files');
		expect(list).toContain('"region":"nyc1"');
		expect(list).toContain('"region":"blr1"');
		expect(shown(await nfsScreen.tabs['detail']?.(ctx({ id: 's1' })))).toContain(
			'mount -t nfs 10.0.0.5:/files /mnt/files',
		);
		expect(shown(await nfsScreen.tabs['detail']?.(ctx({ id: 's2' })))).toContain('["Mount","—",null]');
		expect(shown(await nfsScreen.tabs['backup']?.(ctx({ id: 's1' })))).toContain('No snapshots.');
		expect(shown(await nfsScreen.tabs['history']?.(ctx({ id: 's1' })))).toContain('Share files created');
	});

	it('grows a share and snapshots it', async () => {
		const sent = digitalocean([[/POST/, 200, {}], ...ROUTES]);
		expect((await nfsScreen.forms?.['edit']?.send(ctx(), write({ size: 100 }, 's1')))?.message).toBe(
			'Growing files to 100 GiB',
		);
		expect((await nfsScreen.forms?.['op']?.send(ctx(), write({ name: 'files-copy' }, 's1')))?.message).toBe(
			'Snapshot of files started',
		);
		expect(writes(sent)).toHaveLength(2);
	});
});

describe('the rest: shares made and removed, the registry and custom images', () => {
	it('creates a share in a VPC, shows its form fields and snapshots, and removes it', async () => {
		const sent = digitalocean([
			[/POST .*\/nfs$/, 201, { share: { id: 's9', name: 'files' } }],
			[/DELETE/, 204, null],
			[/nfs\?region=blr1/, 200, { shares: [{ id: 's1', name: 'files', size_gib: 50, vpc_ids: ['v1', 'v2'] }] }],
			[/nfs\/snapshots/, 200, { snapshots: [{ id: 'n1', name: 'files-copy', size_gib: 50 }] }],
			[/regions/, 200, { regions: [{ slug: 'blr1', available: true }] }],
			[/vpcs/, 200, { vpcs: [{ id: 'v1', name: 'net', region: 'blr1' }] }],
		]);
		expect(shown(await nfsScreen.tabs['create']?.(ctx()))).toContain('net · blr1');
		expect(
			(
				await nfsScreen.forms?.['create']?.send(
					ctx(),
					write({ name: 'files', size: 50, region: 'blr1', vpc: 'v1' }),
				)
			)?.message,
		).toBe('Share files created');
		expect(shown(await nfsScreen.tabs['detail']?.(ctx({ id: 's1' })))).toContain('["VPCs","v1, v2",null]');
		expect(shown(await nfsScreen.tabs['edit']?.(ctx({ id: 's1' })))).toContain('"min":51');
		expect(shown(await nfsScreen.tabs['op']?.(ctx({ id: 's1' })))).toContain('files-');
		expect(shown(await nfsScreen.tabs['backup']?.(ctx({ id: 's1' })))).toContain('files-copy');
		expect(shown(await nfsScreen.tabs['monitor']?.(ctx({ id: 's1' })))).toContain(
			'does not publish share throughput',
		);
		expect((await nfsScreen.forms?.['destroy']?.send(ctx(), write({}, 's1', 'files')))?.message).toContain(
			'deleted',
		);
		expect(writes(sent)[1]).toMatch(/^DELETE .*\/nfs\/s1\?region=blr1/);
	});

	it('removes a Functions namespace', async () => {
		const sent = digitalocean([
			[/DELETE/, 204, null],
			[/functions\/namespaces/, 200, { namespaces: [{ namespace: 'fn-2', label: 'jobs' }] }],
		]);
		expect((await functionsScreen.forms?.['destroy']?.send(ctx(), write({}, 'fn-2', 'jobs')))?.message).toContain(
			'deleted',
		);
		expect(writes(sent)[0]).toMatch(/functions\/namespaces\/fn-2/);
	});

	it('cleans up and destroys the registry', async () => {
		const sent = digitalocean([
			[/(POST|DELETE)/, 204, null],
			[/GET .*\/registry$/, 200, { registry: { name: 'shop-reg', region: 'blr1' } }],
		]);
		expect(
			(await registryScreen.forms?.['op']?.send(ctx(), write({ type: 'untagged manifests only' }, 'shop-reg')))
				?.message,
		).toBe('Garbage collection started on shop-reg');
		expect(
			(await registryScreen.forms?.['destroy']?.send(ctx(), write({}, 'shop-reg', 'shop-reg')))?.message,
		).toContain('deleted');
		expect(writes(sent).map((s) => s.split(' ')[0])).toEqual(['POST', 'DELETE']);
	});

	it('imports, edits, copies and deletes a custom image', async () => {
		const sent = digitalocean([
			[/POST .*\/images\/5\/actions/, 201, { action: { id: 9 } }],
			[/POST .*\/images$/, 202, { image: { id: 6, name: 'base' } }],
			[/GET .*\/v2\/actions\/9/, 200, { action: { status: 'completed' } }],
			[/(PUT|DELETE)/, 200, {}],
			[/images/, 200, { images: [{ id: 5, name: 'base', regions: ['blr1'] }] }],
			[/regions/, 200, { regions: [{ slug: 'sgp1', available: true }] }],
		]);
		const create = imagesScreen.forms?.['create'];
		await expect(create?.send(ctx(), write({ name: 'base', url: 'http://x', region: 'blr1' }))).rejects.toThrow(
			'must start with https://',
		);
		expect(
			(
				await create?.send(
					ctx(),
					write({
						name: 'base',
						url: 'https://example.test/base.img',
						region: 'blr1',
						distribution: 'Ubuntu',
					}),
				)
			)?.message,
		).toBe('Importing base');
		expect(
			(await imagesScreen.forms?.['edit']?.send(ctx(), write({ name: 'base-2', distribution: 'Ubuntu' }, '5')))
				?.message,
		).toBe('Image base-2 saved');
		const copied = await imagesScreen.forms?.['op']?.send(ctx(), write({ region: 'sgp1' }, '5'));
		expect(copied?.message).toBe('Copying base to sgp1');
		for (const step of copied?.follow ?? []) expect(await step.check('follow-key')).toBe(true);
		expect((await imagesScreen.forms?.['destroy']?.send(ctx(), write({}, '5', 'base')))?.message).toContain(
			'deleted',
		);
		expect(writes(sent)).toHaveLength(4);
	});
});
