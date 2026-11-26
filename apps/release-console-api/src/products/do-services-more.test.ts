import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	certificatesScreen,
	doAccountScreen,
	doDnsScreen,
	inferenceScreen,
	loadBalancersScreen,
	monitoringScreen,
	securityScreen,
	spacesScreen,
} from './do-services.js';

import type { ProductCtx } from './kit.js';

/**
 * DigitalOcean and Spaces answer locally by method and address; the first matching route wins.
 * A string body is sent as it is (Spaces speaks XML); anything else as JSON.
 */
type Route = [RegExp, number, unknown];
function vendors(routes: Route[]) {
	const sent: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string | URL, init?: RequestInit) => {
			const line = `${init?.method ?? 'GET'} ${String(url)}`;
			sent.push(`${line} ${typeof init?.body === 'string' ? init.body : ''}`.trim());
			const hit = routes.find(([re]) => re.test(line));
			const status = hit?.[1] ?? 200;
			const body = hit?.[2] ?? {};
			if (status === 204) return new Response(null, { status });
			return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
		}),
	);
	return sent;
}
let n = 0;
const ctx = (over: Partial<ProductCtx> = {}, spacesKeys = true): ProductCtx => {
	const i = ++n;
	return {
		key: `do-services-key-${i}`,
		id: null,
		range: '24h',
		repo: { id: 'shop', environments: [] },
		keyRefs: [],
		consoleKey: (name: string) => (spacesKeys ? `value-of-${name}` : null),
		envTags: () => ({}),
		writeKey: async () => `do-services-write-${i}`,
		...over,
	} as unknown as ProductCtx;
};
const write = (values: Record<string, unknown>, id: string | null = null, confirm = '') =>
	({ pin: '123456', confirm, id, values }) as never;
const shown = (v: unknown) => JSON.stringify(v);
const writes = (sent: string[]) => sent.filter((s) => !s.startsWith('GET'));

afterEach(() => vi.unstubAllGlobals());

describe('load balancers', () => {
	const LBS = {
		load_balancers: [
			{ id: 'lb1', name: 'shop-lb', tag: 'shop', region: { slug: 'blr1' }, size_unit: 2, status: 'active' },
			{ id: 'lb2', name: 'api-lb', droplet_ids: [1, 2], region: 'blr1', status: 'new' },
		],
	};

	it('says where each one sends traffic, and orders one to droplets, a tag or nothing yet', async () => {
		const sent = vendors([
			[/POST .*load_balancers/, 202, { load_balancer: { id: 'lb9' } }],
			[/load_balancers/, 200, LBS],
		]);
		const list = shown(await loadBalancersScreen.tabs['list']?.(ctx()));
		expect(list).toContain('tag shop');
		expect(list).toContain('2 droplets');
		const create = loadBalancersScreen.forms?.['create'];
		const order = (values: Record<string, unknown>) =>
			create?.send(ctx(), write({ name: 'shop-lb', region: 'blr1', nodes: 1, ...values }));
		expect((await order({ droplets: '1, 2', tag: 'shop' }))?.productId).toBe('lb9');
		await order({ tag: 'shop' });
		await order({ tag: '' });
		const bodies = writes(sent);
		expect(bodies[0]).toContain('"droplet_ids":[1,2]');
		expect(bodies[1]).toContain('"tag":"shop"');
		expect(bodies[2]).not.toMatch(/"tag"|"droplet_ids"/);
	});

	it('saves its node count, and charts what DigitalOcean measured', async () => {
		const sent = vendors([
			[/PUT/, 200, {}],
			[/frontend_requests_per_second/, 200, { data: { result: [{ values: [[1_700_000_000, '1.234']] }] } }],
			[/load_balancers/, 200, LBS],
		]);
		expect((await loadBalancersScreen.forms?.['edit']?.send(ctx(), write({ nodes: 3 }, 'lb1')))?.message).toBe(
			'shop-lb saved',
		);
		expect(writes(sent)[0]).toContain('"region":"blr1","size_unit":3');
		const monitor = shown(await loadBalancersScreen.tabs['monitor']?.(ctx({ id: 'lb1' })));
		expect(monitor).toContain('[1700000000,1.23]');
		expect(monitor).not.toContain('Connections');
	});
});

describe('DigitalOcean DNS records', () => {
	const DOMAINS: Route = [/GET .*\/domains\?/, 200, { domains: [{ name: 'example.test', ttl: 1800 }] }];

	it('adds and changes records on the domain in the address, and refuses with none', async () => {
		const sent = vendors([[/(POST|PUT|DELETE)/, 200, {}], [/records/, 200, { domain_records: [] }], DOMAINS]);
		expect(shown(await doDnsScreen.forms?.['edit']?.read(ctx()))).toContain('This domain has no records.');
		const create = doDnsScreen.forms?.['create'];
		await expect(create?.send(ctx(), write({ type: 'A', name: '@', data: '203.0.113.7' }))).rejects.toThrow(
			'Choose a domain.',
		);
		expect(
			(
				await create?.send(
					ctx({ id: 'example.test' }),
					write({ type: 'A', name: 'www', data: '203.0.113.7', ttl: 600 }),
				)
			)?.message,
		).toBe('A www → 203.0.113.7 on example.test');
		await doDnsScreen.forms?.['edit']?.send(
			ctx(),
			write({ type: 'TXT', name: '@', data: 'hello', ttl: 600, record: '5' }, 'example.test'),
		);
		expect(writes(sent)[0]).toMatch(/^POST .*\/domains\/example\.test\/records /);
		expect(writes(sent)[1]).toMatch(/^PUT .*\/domains\/example\.test\/records\/5 /);
		expect(
			(await doDnsScreen.forms?.['destroy']?.send(ctx(), write({}, 'example.test', 'example.test')))?.message,
		).toContain('deleted');
		expect(writes(sent)[2]).toMatch(/^DELETE .*\/domains\/example\.test/);
	});
});

describe('certificates, alert policies, uptime checks and AI agents', () => {
	it('warns about a certificate that runs out within three weeks', async () => {
		const soon = new Date(Date.now() + 5 * 86_400_000).toISOString();
		vendors([[/certificates/, 200, { certificates: [{ id: 'c1', name: 'shop', not_after: soon }] }]]);
		expect(shown(await certificatesScreen.tabs['list']?.(ctx()))).toContain('shop expires');
	});

	it('lists alert policies with the droplets they watch, saves and deletes one, and adds an uptime check', async () => {
		const sent = vendors([
			[/POST .*uptime\/checks/, 201, { check: { id: 'c9', name: 'shop-shop' } }],
			[/(PUT|DELETE)/, 200, {}],
			[
				/monitoring\/alerts/,
				200,
				{
					policies: [
						{
							uuid: 'p1',
							description: 'CPU',
							type: 'v1/insights/droplet/cpu',
							compare: 'LessThan',
							value: 5,
							window: '5m',
							entities: ['123'],
							alerts: { email: ['owner@example.test'] },
							enabled: true,
						},
					],
				},
			],
		]);
		const list = shown(await monitoringScreen.tabs['list']?.(ctx()));
		expect(list).toContain('CPU % < 5 for 5m');
		expect(list).toContain('"on":"123"');
		expect(shown(await monitoringScreen.tabs['create']?.(ctx()))).toContain('"value":"v1/insights/droplet/cpu"');
		expect(
			(
				await monitoringScreen.forms?.['edit']?.send(
					ctx(),
					write({ value: 90, window: '10m', enabled: true }, 'p1'),
				)
			)?.message,
		).toBe('CPU saved');
		expect((await monitoringScreen.forms?.['destroy']?.send(ctx(), write({}, 'p1', 'CPU')))?.message).toContain(
			'deleted',
		);
		const add = monitoringScreen.forms?.['uptime-add'];
		await expect(add?.send(ctx(), write({ name: 'shop', target: 'example.test' }))).rejects.toThrow(
			'must start with https://',
		);
		expect((await add?.send(ctx(), write({ name: 'shop-shop', target: 'https://example.test/' })))?.message).toBe(
			'Uptime check shop-shop added',
		);
		expect(writes(sent).map((s) => s.split(' ')[0])).toEqual(['PUT', 'DELETE', 'POST']);
	});

	it('shows each uptime check’s 30-day figure, and whether one with no answer yet is on', async () => {
		vendors([
			[
				/uptime\/checks\/c1\/state/,
				200,
				{ state: { regions: { us_east: { status: 'up', thirty_day_uptime_percentage: 99.987 } } } },
			],
			[
				/uptime\/checks/,
				200,
				{
					checks: [
						{ id: 'c1', name: 'shop', regions: ['us_east'] },
						{ id: 'c2', name: 'api', enabled: true },
						{ id: 'c3', name: 'old' },
					],
				},
			],
		]);
		const view = shown(await monitoringScreen.tabs['uptime']?.(ctx()));
		expect(view).toContain('99.99%');
		expect(view).toContain('"now":"checking"');
		expect(view).toContain('"now":"paused"');
	});

	it('saves an agent’s instructions and deletes it', async () => {
		const sent = vendors([
			[/(PUT|DELETE)/, 200, {}],
			[/gen-ai\/agents/, 200, { agents: [{ uuid: 'ag1', name: 'helper', instruction: 'Be kind' }] }],
		]);
		expect(
			(await inferenceScreen.forms?.['edit']?.send(ctx(), write({ instruction: 'Answer in English' }, 'ag1')))
				?.message,
		).toBe('helper saved');
		expect((await inferenceScreen.forms?.['destroy']?.send(ctx(), write({}, 'ag1', 'helper')))?.message).toContain(
			'deleted',
		);
		expect(writes(sent)).toHaveLength(2);
	});
});

describe('Spaces', () => {
	const BUCKETS =
		'<ListAllMyBucketsResult><Buckets><Bucket><Name>media</Name><CreationDate>2026-01-01T00:00:00Z</CreationDate></Bucket><Bucket><Name>photos</Name></Bucket></Buckets></ListAllMyBucketsResult>';
	const LISTED: Route = [/GET https:\/\/sgp1\.digitaloceanspaces\.com\/$/, 200, BUCKETS];

	it('lists buckets with their CDN, environment and age, and keeps going when versioning cannot be read', async () => {
		vendors([
			LISTED,
			[/cdn\/endpoints/, 200, { endpoints: [{ id: 'e1', origin: 'media.sgp1.digitaloceanspaces.com' }] }],
			[
				/media\.sgp1.*\?versioning/,
				200,
				'<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>',
			],
			[/photos\.sgp1.*\?versioning/, 403, '<Error><Code>AccessDenied</Code></Error>'],
		]);
		const tagged = ctx({ envTags: () => ({ 'do:spaces:media': 'production' }) });
		const list = shown(await spacesScreen.tabs['buckets']?.(tagged));
		expect(list).toContain('"env":"production"');
		expect(list).toContain('"env":"no environment"');
		expect(list).toContain('"cdn":"on"');
		expect(list).toContain('"cdn":"off"');
		expect(list).toContain('"at":"—"');
		const backup = shown(await spacesScreen.tabs['backup']?.(ctx()));
		expect(backup).toContain('"v":"Enabled"');
		expect(backup).toContain('"v":"off"');
		expect(shown(await spacesScreen.tabs['history']?.(ctx()))).toContain('Bucket photos (sgp1)');
		vendors([LISTED, [/cdn\/endpoints/, 403, {}]]);
		expect(shown(await spacesScreen.tabs['buckets']?.(ctx()))).toContain('"cdn":"off"');
	});

	it('reads one bucket: its files, versioning, lifecycle and CORS, missing settings included', async () => {
		vendors([
			LISTED,
			[
				/media\.sgp1.*list-type=2/,
				200,
				'<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>a.jpg</Key><Size>2048</Size><LastModified>2026-11-24T10:00:00Z</LastModified></Contents></ListBucketResult>',
			],
			[/media\.sgp1.*\?versioning/, 200, '<Status>Enabled</Status>'],
			[/media\.sgp1.*\?lifecycle/, 200, '<Rule><ID>old</ID></Rule>'],
			[/media\.sgp1.*\?cors/, 404, '<Error><Code>NoSuchCORSConfiguration</Code></Error>'],
			[/photos\.sgp1.*list-type=2/, 200, '<ListBucketResult></ListBucketResult>'],
			[/photos\.sgp1.*\?versioning/, 500, ''],
			[/photos\.sgp1.*\?lifecycle/, 404, '<Code>NoSuchLifecycleConfiguration</Code>'],
			[/photos\.sgp1.*\?cors/, 200, '<CORSRule></CORSRule>'],
		]);
		const media = shown(await spacesScreen.tabs['bucket']?.(ctx()));
		expect(media).toContain('versioning on');
		expect(media).toContain('first 50 files shown');
		expect(media).toContain('["Lifecycle rules","1",null]');
		expect(media).toContain('["CORS rules","none",null]');
		const photos = shown(await spacesScreen.tabs['bucket']?.(ctx({ id: 'photos' })));
		expect(photos).toContain('versioning off');
		expect(photos).toContain('0 files');
		expect(photos).toContain('["Lifecycle rules","none",null]');
		expect(photos).toContain('["CORS rules","1",null]');
		vendors([LISTED, [/media\.sgp1.*list-type=2/, 200, ''], [/media\.sgp1/, 500, '']]);
		expect(shown(await spacesScreen.tabs['bucket']?.(ctx()))).toContain('["CORS rules","none",null]');
		vendors([[/sgp1\.digitaloceanspaces\.com\/$/, 200, '<ListAllMyBucketsResult></ListAllMyBucketsResult>']]);
		expect(shown(await spacesScreen.tabs['bucket']?.(ctx()))).toContain('No buckets.');
	});

	it('finds buckets from key targets, key grants and CDN origins when the key may not list them', async () => {
		vendors([
			[/sgp1\.digitaloceanspaces\.com\/$/, 403, '<Error><Code>AccessDenied</Code></Error>'],
			[/spaces\/keys/, 200, { keys: [{ grants: [{ bucket: 'photos' }, { bucket: 'media' }, { bucket: '' }] }] }],
			[
				/cdn\/endpoints/,
				200,
				{
					endpoints: [
						{ id: 'e1', origin: 'assets.sfo3.digitaloceanspaces.com' },
						{ id: 'e2', origin: 'cdn.example.test' },
					],
				},
			],
		]);
		const limited = ctx({
			keyRefs: [
				{ kind: 'spaces-key', target: 'blr1/media' },
				{ kind: 'spaces-key', target: 'blr1' },
				{ kind: 'spaces-key', target: '' },
				{ kind: 'do-token', target: 'sgp1/other' },
			] as never,
		});
		const list = shown(await spacesScreen.tabs['buckets']?.(limited));
		expect(list).toContain('"name":"media","cdn":"off","region":"blr1"');
		expect(list).toContain('"name":"photos","cdn":"off","region":"sgp1"');
		expect(list).toContain('"name":"assets","cdn":"on","region":"sfo3"');
		expect(list).not.toContain('other');
	});

	it('says what Spaces refused, and that the console needs its Spaces key', async () => {
		vendors([[/sgp1\.digitaloceanspaces\.com\/$/, 500, '<Error><Code>InternalError</Code></Error>']]);
		await expect(spacesScreen.tabs['buckets']?.(ctx())).rejects.toThrow('Spaces answered 500 to /: InternalError.');
		vendors([[/sgp1\.digitaloceanspaces\.com\/$/, 502, 'Bad gateway']]);
		await expect(spacesScreen.tabs['history']?.(ctx())).rejects.toThrow('Spaces answered 502 to /.');
		await expect(spacesScreen.tabs['history']?.(ctx({}, false))).rejects.toThrow('CONSOLE_SPACES_ACCESS_KEY');
	});

	it('lists what each Spaces key may do, and changes the CDN cache time', async () => {
		const sent = vendors([
			[/PUT/, 200, {}],
			[
				/spaces\/keys/,
				200,
				{
					keys: [
						{
							access_key: 'AK1',
							name: 'media',
							grants: [
								{ permission: 'read', bucket: 'media' },
								{ permission: 'fullaccess', bucket: '' },
							],
						},
					],
				},
			],
		]);
		expect(shown(await spacesScreen.tabs['keys']?.(ctx()))).toContain('read on media, fullaccess on all buckets');
		expect((await spacesScreen.forms?.['edit']?.send(ctx(), write({ endpoint: 'e1', ttl: 600 })))?.message).toBe(
			'CDN cache time set to 600 s',
		);
		expect(writes(sent)[0]).toMatch(/^PUT .*cdn\/endpoints\/e1 \{"ttl":600\}/);
	});
});

describe('security posture', () => {
	const FINDINGS: Route[] = [
		[/databases\/d1\/firewall/, 200, { rules: [] }],
		[/databases\/d2\/firewall/, 200, { rules: [{ type: 'ip_addr' }] }],
		[
			/droplets/,
			200,
			{
				droplets: [
					{ id: 1, name: 'web-production', tags: ['web'], features: ['monitoring'], vpc_uuid: 'v1' },
					{ id: 2, name: 'worker', tags: [], features: [] },
				],
			},
		],
		[
			/firewalls/,
			200,
			{
				firewalls: [
					{
						id: 'f1',
						name: 'web',
						droplet_ids: [],
						tags: ['web'],
						inbound_rules: [
							{ ports: '22', sources: { addresses: ['0.0.0.0/0'] } },
							{ ports: '', sources: { addresses: ['::/0'] } },
							{ ports: '443', sources: { addresses: ['0.0.0.0/0'] } },
							{ ports: '22', sources: { addresses: ['10.0.0.0/8'] } },
						],
					},
				],
			},
		],
		[
			/volumes/,
			200,
			{
				volumes: [
					{ id: 'v1', name: 'data', droplet_ids: [] },
					{ id: 'v2', droplet_ids: [1] },
				],
			},
		],
		[/reserved_ips/, 200, { reserved_ips: [{ ip: '203.0.113.7' }, { ip: '203.0.113.8', droplet: { id: 1 } }] }],
		[
			/databases/,
			200,
			{
				databases: [
					{ id: 'd1', name: 'shop' },
					{ id: 'd2', name: 'cache' },
				],
			},
		],
		[/account\/keys/, 200, { ssh_keys: Array.from({ length: 6 }, (_, i) => ({ id: i })) }],
	];

	it('finds open SSH, missing firewalls, agents, backups and VPCs, idle volumes and addresses, open databases', async () => {
		vendors(FINDINGS);
		const view = shown(await securityScreen.tabs['list']?.(ctx()));
		for (const what of [
			'SSH open to the whole internet',
			'No Cloud Firewall',
			'Monitoring agent off',
			'DigitalOcean backups off on production',
			'Not in a VPC',
			'Volume not attached',
			'Reserved IP unassigned',
			'Database open to any address',
			'6 SSH keys on the account',
		])
			expect(view).toContain(what);
		expect(view).not.toContain('"where":"cache"');
		vendors([[/firewalls/, 403, {}], ...FINDINGS]);
		expect(shown(await securityScreen.tabs['list']?.(ctx()))).toContain('"where":"web-production"');
	});
});

describe('the account', () => {
	it('lists the project’s keys with their expiry, and adds and removes an SSH key', async () => {
		const tokens = shown(
			await doAccountScreen.tabs['tokens']?.(
				ctx({
					keyRefs: [
						{
							id: 'k1',
							label: 'DO',
							kind: 'do-token',
							envNames: ['DO_TOKEN'],
							state: 'expired',
							expiresAt: '2026-01-01',
						},
						{ id: 'k2', label: 'CF', kind: 'cf', envNames: [], state: 'ok', expiresAt: null },
					] as never,
				}),
			),
		);
		expect(tokens).toContain('no expiry');
		expect(tokens).toContain('"tone":"red"');
		const sent = vendors([
			[/POST/, 201, { ssh_key: { id: 7, name: 'laptop' } }],
			[/DELETE/, 204, null],
		]);
		await expect(
			doAccountScreen.forms?.['key-add']?.send(
				ctx(),
				write({ name: 'laptop', key: '-----BEGIN OPENSSH PRIVATE KEY-----' }),
			),
		).rejects.toThrow('Never paste a private key.');
		expect(
			(
				await doAccountScreen.forms?.['key-add']?.send(
					ctx(),
					write({ name: 'laptop', key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 owner@laptop' }),
				)
			)?.message,
		).toBe('SSH key laptop added');
		expect((await doAccountScreen.forms?.['key-remove']?.send(ctx(), write({ id: '7' })))?.message).toBe(
			'SSH key removed from the account',
		);
		expect(writes(sent)[1]).toMatch(/^DELETE .*account\/keys\/7/);
	});
});
