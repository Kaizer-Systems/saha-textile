import { afterEach, describe, expect, it, vi } from 'vitest';

import { backupsScreen, dropletScreen, volumeScreen } from './do-compute.js';

import type { ProductCtx, Sent } from './kit.js';

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
		key: `do-compute-key-${i}`,
		id: null,
		range: '24h',
		repo: { id: 'shop', environments: [] },
		envTags: () => ({}),
		writeKey: async () => `do-compute-write-${i}`,
		...over,
	} as unknown as ProductCtx;
};
const write = (values: Record<string, unknown>, id: string | null = null, confirm = '') =>
	({ pin: '123456', confirm, id, values }) as never;
const shown = (v: unknown) => JSON.stringify(v);
const writes = (sent: string[]) => sent.filter((s) => !s.startsWith('GET'));
/** Runs each follow-up step once, as the console's job runner would. */
const follow = async (sent: Sent | undefined) => {
	for (const step of sent?.follow ?? []) await step.check('follow-key');
};

const WEB = {
	id: 1,
	name: 'web',
	status: 'active',
	size_slug: 's-1vcpu-1gb',
	size: { price_monthly: 6 },
	vcpus: 1,
	memory: 1024,
	disk: 25,
	region: { slug: 'blr1' },
	image: { slug: 'ubuntu-24-04-x64', distribution: 'Ubuntu', name: '24.04' },
	tags: ['web'],
	features: ['backups', 'monitoring'],
	created_at: '2026-11-01T00:00:00Z',
};
const IDLE = { id: 2, name: 'idle', status: 'off', size_slug: 's-1vcpu-1gb', region: 'blr1', tags: [], features: [] };
const DAILY = { id: 3, name: 'db', status: 'active', size_slug: 's-2', region: 'blr1', features: ['backups'] };
const DROPLETS = { droplets: [WEB, IDLE, DAILY] };
const ACTIONS: Route[] = [
	[/POST .*\/actions$/, 201, { action: { id: 9 } }],
	[/GET .*\/v2\/actions\/9/, 200, { action: { status: 'completed' } }],
];
const ONE: Route[] = [
	[/GET .*\/droplets\/1$/, 200, { droplet: WEB }],
	[/GET .*\/droplets\/2$/, 200, { droplet: IDLE }],
	[/GET .*\/droplets\/3$/, 200, { droplet: DAILY }],
];
const LIST: Route = [/GET .*\/droplets\?/, 200, DROPLETS];

afterEach(() => vi.unstubAllGlobals());

describe('one droplet', () => {
	it('shows its volumes, the firewalls that cover it by tag, and its backups and agent', async () => {
		digitalocean([
			...ONE,
			[/\/droplets\/\d+\/snapshots/, 403, {}],
			LIST,
			[/volumes/, 200, { volumes: [{ id: 'v1', name: 'data', droplet_ids: [1] }] }],
			[/firewalls/, 200, { firewalls: [{ id: 'f1', name: 'web', tags: ['web', 'other'], status: 'succeeded' }] }],
		]);
		const web = shown(await dropletScreen.tabs['detail']?.(ctx({ id: '1' })));
		expect(web).toContain('1 volume"');
		expect(web).toContain('"by":"tag web"');
		expect(web).toContain('["Backups","on","ok"]');
		const idle = shown(await dropletScreen.tabs['detail']?.(ctx({ id: '2' })));
		expect(idle).toContain('0 volumes');
		expect(idle).toContain('["Monitoring agent","off","amber"]');
	});

	it('offers the sizes of its region, renames it, and resizes it with or without powering it off', async () => {
		const sent = digitalocean([
			...ACTIONS,
			...ONE,
			LIST,
			[
				/sizes/,
				200,
				{
					sizes: [
						{ slug: 's-1vcpu-1gb', available: true, regions: ['blr1'], price_monthly: 6 },
						{ slug: 's-2vcpu-2gb', available: true, regions: ['blr1'], price_monthly: 18 },
						{ slug: 's-elsewhere', available: true, regions: ['nyc1'] },
						{ slug: 's-gone', available: false, regions: ['blr1'] },
					],
				},
			],
		]);
		const view = shown(await dropletScreen.tabs['edit']?.(ctx({ id: '1' })));
		expect(view).toContain('$6.00 a month · now');
		expect(view).toContain('s-2vcpu-2gb');
		expect(view).not.toContain('s-elsewhere');
		const edit = dropletScreen.forms?.['edit'];
		await expect(edit?.send(ctx(), write({ name: 'web' }))).rejects.toThrow('Choose a droplet.');
		await expect(edit?.send(ctx(), write({ name: 'web', size: 's-1vcpu-1gb' }, '1'))).rejects.toThrow(
			'Nothing changed.',
		);
		const renamed = await edit?.send(ctx({ id: '1' }), write({ name: 'web-2', size: 's-1vcpu-1gb' }));
		expect(renamed?.follow).toHaveLength(1);
		const resized = await edit?.send(ctx(), write({ name: 'web', size: 's-2vcpu-2gb', disk: true }, '1'));
		expect(resized?.follow?.map((f) => f.label)).toEqual(['Powered off', 'Resized to s-2vcpu-2gb', 'Powered on']);
		await follow(resized);
		const off = await edit?.send(ctx(), write({ name: 'idle', size: 's-2vcpu-2gb' }, '2'));
		expect(off?.follow?.map((f) => f.label)).toEqual(['Resized to s-2vcpu-2gb']);
		expect(writes(sent).some((s) => s.includes('"type":"power_off"'))).toBe(true);
	});

	it('reboots or rebuilds it once its name is typed, and refuses an unknown operation', async () => {
		const sent = digitalocean([...ACTIONS, ...ONE]);
		const op = dropletScreen.forms?.['op'];
		await expect(op?.send(ctx(), write({ op: 'reboot' }, null, 'web'))).rejects.toThrow('Choose a droplet.');
		await expect(op?.send(ctx(), write({ op: 'explode' }, '1', 'web'))).rejects.toThrow('Choose an operation.');
		await follow(await op?.send(ctx({ id: '1' }), write({ op: 'reboot' }, null, 'web')));
		expect((await op?.send(ctx(), write({ op: 'rebuild', image: 'ubuntu-24-04-x64' }, '1', 'web')))?.message).toBe(
			'Rebuild from an image: web',
		);
		expect(writes(sent)[1]).toContain('"type":"rebuild","image":"ubuntu-24-04-x64"');
	});

	it('charts what the agent reports', async () => {
		digitalocean([
			LIST,
			[
				/monitoring\/metrics\/droplet\/cpu/,
				200,
				{
					data: {
						result: [
							{
								metric: { mode: 'idle' },
								values: [
									[1, '50'],
									[2, '60'],
								],
							},
							{
								metric: { mode: 'user' },
								values: [
									[1, '50'],
									[2, '80'],
								],
							},
						],
					},
				},
			],
		]);
		expect(shown(await dropletScreen.tabs['monitor']?.(ctx({ id: '1' })))).toContain('"name":"CPU"');
	});

	it('shows the backup plan when backups are on, and offers backups and snapshots to restore from', async () => {
		digitalocean([
			LIST,
			...ONE,
			[
				/droplets\/1\/backups\/policy/,
				200,
				{ policy: { backup_policy: { plan: 'daily', weekday: 'SUN', hour: 4 } } },
			],
			[/droplets\/3\/backups\/policy/, 200, { policy: {} }],
			[/droplets\/1\/backups/, 200, { backups: [{ id: 5, name: 'nightly', size_gigabytes: 3 }] }],
			[/droplets\/1\/snapshots/, 200, { snapshots: [{ id: 's1', name: 'before', size_gigabytes: 2 }] }],
			[/droplets\/\d\/(backups|snapshots)/, 200, {}],
		]);
		const web = shown(await dropletScreen.tabs['backup']?.(ctx({ id: '1' })));
		expect(web).toContain('daily · SUN · 4:00 UTC');
		expect(web).toContain('Turn backups off');
		expect(shown(await dropletScreen.tabs['backup']?.(ctx({ id: '3' })))).toContain('"weekly"');
		const idle = shown(await dropletScreen.tabs['backup']?.(ctx({ id: '2' })));
		expect(idle).toContain('backups off');
		expect(idle).toContain('Turn backups on');
		expect(shown(await dropletScreen.forms?.['restore']?.read(ctx({ id: '1' })))).toContain('"value":"backup:5"');
		expect(shown(await dropletScreen.forms?.['restore']?.read(ctx({ id: '2' })))).toContain(
			'no backups or snapshots to restore from',
		);
	});

	it('restores from a backup or a snapshot, refuses anything else, and takes a snapshot', async () => {
		const sent = digitalocean([...ACTIONS, ...ONE]);
		const restore = dropletScreen.forms?.['restore'];
		await expect(restore?.send(ctx(), write({ from: 'backup:5' }, null, 'web'))).rejects.toThrow(
			'Choose a droplet.',
		);
		await expect(restore?.send(ctx(), write({ from: 'backup' }, '1', 'web'))).rejects.toThrow(
			'Choose what to restore',
		);
		await expect(restore?.send(ctx(), write({ from: 'image:5' }, '1', 'web'))).rejects.toThrow(
			'Choose what to restore',
		);
		await follow(await restore?.send(ctx({ id: '1' }), write({ from: 'backup:5' }, null, 'web')));
		await restore?.send(ctx(), write({ from: 'snapshot:77' }, '1', 'web'));
		expect(writes(sent)[0]).toContain('"type":"restore","image":5');
		expect(writes(sent)[1]).toContain('"type":"rebuild","image":77');
		const snapshot = dropletScreen.forms?.['snapshot'];
		await expect(snapshot?.send(ctx(), write({ name: 'before-change' }))).rejects.toThrow('Choose a droplet.');
		await follow(await snapshot?.send(ctx({ id: '1' }), write({ name: 'before-change' })));
	});
});

describe('volumes', () => {
	const VOLUMES = {
		volumes: [
			{
				id: 'v1',
				name: 'shop-data',
				droplet_ids: [1],
				region: { slug: 'blr1' },
				size_gigabytes: 100,
				filesystem_type: 'ext4',
				filesystem_label: 'data',
			},
			{ id: 'v2', name: 'spare', droplet_ids: [], region: 'blr1', size_gigabytes: 10 },
		],
	};
	const ONE_VOLUME: Route[] = [
		[/GET .*\/volumes\/v1$/, 200, { volume: VOLUMES.volumes[0] }],
		[/GET .*\/volumes\/v2$/, 200, { volume: VOLUMES.volumes[1] }],
	];

	it('suggests a region with volumes, and creates one with or without a filesystem and a droplet', async () => {
		const regions = (list: string[]) => ({
			regions: [
				...list.map((slug) => ({ slug, name: slug, available: true, features: ['storage'] })),
				{ slug: 'old', available: true, features: [] },
			],
		});
		digitalocean([LIST, [/regions/, 200, regions(['sgp1', 'blr1'])]]);
		expect(shown(await volumeScreen.forms?.['create']?.read(ctx()))).toContain('"value":"blr1"');
		digitalocean([LIST, [/regions/, 200, regions(['sgp1'])]]);
		expect(shown(await volumeScreen.forms?.['create']?.read(ctx()))).toContain('"value":"sgp1"');
		const sent = digitalocean([
			[/POST .*\/volumes\/v9\/actions/, 201, { action: { id: 9 } }],
			[/POST .*\/volumes$/, 201, { volume: { id: 'v9' } }],
			...ACTIONS,
		]);
		const create = volumeScreen.forms?.['create'];
		const plain = await create?.send(ctx(), write({ name: 'data', size: 10, region: 'blr1', fs: '', droplet: '' }));
		expect(plain?.follow).toHaveLength(1);
		const attached = await create?.send(
			ctx(),
			write({ name: 'data', size: 10, region: 'blr1', fs: 'ext4', droplet: '1' }),
		);
		await follow(attached);
		await follow(attached);
		expect(writes(sent)[0]).not.toContain('filesystem_type');
		expect(writes(sent)[1]).toContain('"filesystem_type":"ext4"');
		expect(writes(sent)[2]).toContain('"type":"attach","droplet_id":1');
	});

	it('shows an attached and a detached volume, and charts only the attached one', async () => {
		digitalocean([
			...ONE_VOLUME,
			[/volumes\/v\d\/snapshots/, 403, {}],
			[/GET .*\/volumes\?/, 200, VOLUMES],
			LIST,
			[
				/monitoring\/metrics\/droplet/,
				200,
				{ data: { result: [{ metric: { mountpoint: '/mnt/shop_data' }, values: [[1, '5']] }] } },
			],
		]);
		const attached = shown(await volumeScreen.tabs['detail']?.(ctx({ id: 'v1' })));
		expect(attached).toContain('ext4 · label data');
		expect(attached).toContain('/mnt/shop_data');
		const spare = shown(await volumeScreen.tabs['detail']?.(ctx({ id: 'v2' })));
		expect(spare).toContain('not formatted');
		expect(spare).toContain('["Attached to","nothing",null]');
		expect(shown(await volumeScreen.tabs['monitor']?.(ctx({ id: 'v2' })))).toContain('Detached: nothing writes');
		const attach = shown(await volumeScreen.forms?.['op']?.read(ctx({ id: 'v2' })));
		expect(attach).toContain('"submit":"Attach"');
		expect(attach).toContain('"label":"web"');
		expect(shown(await volumeScreen.tabs['monitor']?.(ctx({ id: 'v1' })))).toContain('Used on /mnt/shop_data');
	});

	it('refuses every change with no volume chosen, and destroys one with its detach and snapshots', async () => {
		for (const key of ['edit', 'op', 'snapshot', 'destroy'])
			await expect(volumeScreen.forms?.[key]?.send(ctx(), write({ size: 200 }))).rejects.toThrow(
				'Choose a volume.',
			);
		const sent = digitalocean([
			...ONE_VOLUME,
			[/POST .*\/volumes\/v1\/actions/, 201, { action: { id: 9 } }],
			[/volumes\/v1\/snapshots/, 200, { snapshots: [{ id: 's1', name: 'old' }] }],
			[/volumes\/v2\/snapshots/, 403, {}],
			[/DELETE/, 204, null],
			...ACTIONS,
		]);
		const destroy = volumeScreen.forms?.['destroy'];
		const gone = await destroy?.send(ctx({ id: 'v1' }), write({ snapshots: true }, null, 'shop-data'));
		expect(gone?.follow?.map((f) => f.label)).toEqual([
			'Detached from droplet 1',
			'Volume shop-data deleted',
			'Snapshot old deleted',
		]);
		await follow(gone);
		const refused = await destroy?.send(ctx(), write({ snapshots: true }, 'v2', 'spare'));
		expect(refused?.follow?.map((f) => f.label)).toEqual(['Volume spare deleted']);
		expect(writes(sent).filter((s) => s.startsWith('DELETE'))).toHaveLength(2);
	});
});

describe('backups and snapshots across the account', () => {
	it('lists DigitalOcean backups with their regions', async () => {
		digitalocean([
			[
				/droplets\/1\/backups/,
				200,
				{ backups: [{ id: 5, name: 'nightly', regions: ['blr1'], size_gigabytes: 3 }] },
			],
			[/droplets\/\d\/backups/, 403, {}],
			LIST,
			[/snapshots/, 200, { snapshots: [] }],
			[/volumes/, 403, {}],
		]);
		expect(shown(await backupsScreen.tabs['list']?.(ctx()))).toContain('"where":"blr1"');
	});

	it('takes a snapshot of a volume or a droplet, and refuses anything else', async () => {
		const sent = digitalocean([[/POST/, 201, { action: { id: 9 } }], ...ACTIONS]);
		const take = backupsScreen.forms?.['take'];
		expect((await take?.send(ctx(), write({ of: 'volume:v1', name: 'data-copy' })))?.message).toBe(
			'Snapshot data-copy taken',
		);
		await follow(await take?.send(ctx(), write({ of: 'droplet:1', name: 'web-copy' })));
		await expect(take?.send(ctx(), write({ of: 'droplet', name: 'x' }))).rejects.toThrow(
			'Choose what to snapshot.',
		);
		await expect(take?.send(ctx(), write({ of: 'image:1', name: 'x' }))).rejects.toThrow(
			'Choose what to snapshot.',
		);
		expect(writes(sent)[0]).toMatch(/^POST .*\/volumes\/v1\/snapshots/);
	});

	it('restores a volume snapshot as a new volume, a droplet snapshot over a typed droplet, and refuses the rest', async () => {
		const sent = digitalocean([
			[
				/GET .*\/snapshots\/s1$/,
				200,
				{ snapshot: { name: 'data-copy', min_disk_size: 0, size_gigabytes: 20, regions: ['blr1'] } },
			],
			[/POST .*\/volumes$/, 201, { volume: { id: 'v9' } }],
			...ACTIONS,
			...ONE,
		]);
		const restore = backupsScreen.forms?.['restore'];
		expect((await restore?.send(ctx(), write({ from: 'volume:s1' })))?.productId).toBe('v9');
		expect(writes(sent)[0]).toContain('"size_gigabytes":20');
		await expect(
			restore?.send(ctx(), write({ from: 'droplet:77', to: '1', confirmTarget: 'idle' })),
		).rejects.toThrow('Type web to confirm.');
		await follow(await restore?.send(ctx(), write({ from: 'droplet:77', to: '1', confirmTarget: 'web' })));
		await expect(restore?.send(ctx(), write({ from: 'volume' }))).rejects.toThrow('Choose what to restore from.');
		await expect(restore?.send(ctx(), write({ from: 'image:1' }))).rejects.toThrow('Choose what to restore from.');
		await expect(backupsScreen.forms?.['destroy']?.send(ctx(), write({}))).rejects.toThrow('Choose a snapshot.');
	});
});
