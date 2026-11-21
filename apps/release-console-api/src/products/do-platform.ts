/**
 * DigitalOcean compute and data products (brief v7 lifecycle): autoscale pools, Kubernetes, App
 * Platform, Functions, network file storage, managed databases, the container registry, and images.
 * Reads never carry passwords or kubeconfigs; DigitalOcean's connection secrets are never shown.
 */
import type { ProductCtx } from './kit.js';
import {
	bytes,
	col,
	fact,
	field,
	int,
	list,
	note,
	option,
	row,
	slug,
	stat,
	table,
	text,
	usd,
	view,
	when,
} from './kit.js';
import { actionDone, doAll, doGet, doSend, doSoft, dropletSeries, dropletsOf } from './do-kit.js';
import { type Item, createdRow, resource } from './resource.js';
import { VendorError, arr, num, rec, str } from '../vendors/http.js';

const PORTAL = 'https://cloud.digitalocean.com';

async function regionOptions(ctx: ProductCtx, feature?: string) {
	const regions = (await doAll('/regions', 'regions', ctx.key)) ?? [];
	return regions
		.filter((r) => r['available'] === true && (!feature || arr(r['features']).some((f) => str(f) === feature)))
		.map((r) => option(str(r['slug']), `${str(r['name'])} · ${str(r['slug'])}`));
}
async function sizeOptions(ctx: ProductCtx, prefix = 's-') {
	const sizes = (await doAll('/sizes', 'sizes', ctx.key)) ?? [];
	return sizes
		.filter((s) => s['available'] === true && str(s['slug']).startsWith(prefix))
		.map((s) =>
			option(
				str(s['slug']),
				`${str(s['slug'])} · ${num(s['vcpus'])} vCPU · ${bytes(num(s['memory']) * 1048576)}`,
				`${usd(num(s['price_monthly']))} a month`,
			),
		);
}

/* ===== Autoscale pools ===== */

export const autoscaleScreen = resource({
	vendor: 'digitalocean',
	noun: 'pool',
	nouns: 'autoscale pools',
	items: async (ctx) => (await doAll('/droplets/autoscale', 'autoscale_pools', ctx.key, true)) ?? [],
	id: (p) => str(p['id']),
	name: (p) => str(p['name']),
	status: (p) => str(p['status']),
	columns: [
		['name', 'Pool', false, (p) => str(p['name'])],
		[
			'size',
			'Droplets',
			true,
			(p) =>
				`${num(p['active_resources_count'])} of ${num(rec(p['config'])['min_instances']) || num(rec(p['config'])['target_number_instances'])}–${num(rec(p['config'])['max_instances']) || num(rec(p['config'])['target_number_instances'])}`,
		],
		[
			'template',
			'Template',
			true,
			(p) => `${str(rec(p['droplet_template'])['size'])} · ${str(rec(p['droplet_template'])['region'])}`,
		],
		['target', 'Target', false, (p) => `CPU ${Math.round(num(rec(p['config'])['target_cpu_utilization']) * 100)}%`],
		['at', 'Created', true, (p) => when(str(p['created_at']))],
	],
	empty: 'No autoscale pools. The shop runs on one server per environment today; a pool comes when traffic needs more.',
	notes: () => [
		note(
			'A pool keeps between its minimum and maximum droplets, adding one when average CPU passes the target.',
			'muted',
		),
	],
	facts: (p) => {
		const c = rec(p['config']);
		const t = rec(p['droplet_template']);
		const u = rec(p['current_utilization']);
		return [
			fact('Droplets now', num(p['active_resources_count'])),
			fact('Minimum · maximum', `${num(c['min_instances'])} · ${num(c['max_instances'])}`),
			fact(
				'Target CPU · memory',
				`${Math.round(num(c['target_cpu_utilization']) * 100)}% · ${Math.round(num(c['target_memory_utilization']) * 100)}%`,
			),
			fact('Cooldown', `${num(c['cooldown_minutes'])} min`),
			fact(
				'Now using',
				`CPU ${Math.round(num(u['cpu']) * 100)}% · memory ${Math.round(num(u['memory']) * 100)}%`,
			),
			fact('Template', `${str(t['size'])} · ${str(t['region'])} · ${str(t['image'])}`),
		];
	},
	tables: async (ctx, p) => {
		const m = (await doAll(`/droplets/autoscale/${str(p['id'])}/members`, 'droplets', ctx.key, true)) ?? [];
		return [
			table(
				'Members',
				[
					col('id', 'Droplet', true),
					col('health', 'Health'),
					col('cpu', 'CPU', true),
					col('at', 'Since', true),
				],
				m.map((d) =>
					row(num(d['droplet_id']), String(num(d['droplet_id'])), {
						id: num(d['droplet_id']),
						health: str(d['health_status']),
						cpu: `${Math.round(num(rec(d['current_utilization'])['cpu']) * 100)}%`,
						at: when(str(d['created_at'])),
					}),
				),
				'No members.',
			),
		];
	},
	links: (p) => [{ label: 'Open in DigitalOcean', url: `${PORTAL}/droplets/autoscale/${str(p['id'])}` }],
	create: {
		title: 'New autoscale pool',
		submit: 'Create pool',
		fields: async (ctx) => {
			const keys = (await doAll('/account/keys', 'ssh_keys', ctx.key)) ?? [];
			return [
				field('name', 'Name', 'text', { required: true, value: `${ctx.repo.id}-web` }),
				field('region', 'Region', 'select', { value: 'blr1', options: await regionOptions(ctx) }),
				field('size', 'Droplet size', 'select', { value: 's-2vcpu-4gb', options: await sizeOptions(ctx) }),
				field('image', 'Image', 'text', { value: 'ubuntu-26-04-x64' }),
				field('min', 'Minimum droplets', 'number', { value: 2, min: 1, max: 50 }),
				field('max', 'Maximum droplets', 'number', { value: 4, min: 1, max: 50 }),
				field('cpu', 'Target CPU %', 'number', { value: 60, min: 10, max: 95 }),
				field('keys', 'SSH keys', 'multi', {
					options: keys.map((k) => option(String(num(k['id'])), str(k['name']))),
					value: keys[0] ? [String(num(keys[0]['id']))] : [],
				}),
			];
		},
		cost: 'Each droplet in the pool is billed at its size’s price: the minimum count from the first hour, up to the maximum under load.',
		async send(ctx, w, key) {
			const min = int(w, 'min', 1, 50);
			const max = int(w, 'max', min, 50);
			const body = {
				name: slug(text(w, 'name')),
				config: {
					min_instances: min,
					max_instances: max,
					target_cpu_utilization: int(w, 'cpu', 10, 95) / 100,
					cooldown_minutes: 5,
				},
				droplet_template: {
					size: text(w, 'size'),
					region: text(w, 'region'),
					image: text(w, 'image'),
					ssh_keys: list(w, 'keys'),
					tags: [ctx.repo.id],
					with_droplet_agent: true,
					ipv6: true,
				},
			};
			const p = rec((await doSend('POST', '/droplets/autoscale', key, body))['autoscale_pool']);
			return {
				message: `Pool ${body.name} created (${min}–${max} droplets)`,
				productId: str(p['id']),
				follow: [],
			};
		},
	},
	edit: {
		title: 'Edit',
		submit: 'Save pool',
		fields: (_ctx, p) => {
			const c = rec(p?.['config']);
			return [
				field('min', 'Minimum droplets', 'number', { value: num(c['min_instances']), min: 1, max: 50 }),
				field('max', 'Maximum droplets', 'number', { value: num(c['max_instances']), min: 1, max: 50 }),
				field('cpu', 'Target CPU %', 'number', {
					value: Math.round(num(c['target_cpu_utilization']) * 100),
					min: 10,
					max: 95,
				}),
				field('cooldown', 'Cooldown (minutes)', 'number', {
					value: num(c['cooldown_minutes']) || 5,
					min: 1,
					max: 60,
				}),
			];
		},
		cost: 'A higher minimum is billed from the next hour.',
		async send(_ctx, w, key, p) {
			if (!p) throw new VendorError('Choose a pool.', 400);
			const min = int(w, 'min', 1, 50);
			const body = {
				name: str(p['name']),
				config: {
					min_instances: min,
					max_instances: int(w, 'max', min, 50),
					target_cpu_utilization: int(w, 'cpu', 10, 95) / 100,
					cooldown_minutes: int(w, 'cooldown', 1, 60),
				},
				droplet_template: p['droplet_template'],
			};
			await doSend('PUT', `/droplets/autoscale/${str(p['id'])}`, key, body);
			return { message: `Pool ${str(p['name'])} saved`, productId: str(p['id']), follow: [] };
		},
	},
	destroy: {
		submit: 'Destroy pool',
		notes: [
			note('Every droplet of the pool is destroyed with it. Pool droplets hold no data worth keeping.', 'red'),
		],
		remove: async (_ctx, key, p) => {
			await doSend('DELETE', `/droplets/autoscale/${str(p['id'])}/dangerous`, key);
		},
	},
	monitor: async (ctx, p) => {
		const m = (await doAll(`/droplets/autoscale/${str(p['id'])}/members`, 'droplets', ctx.key, true)) ?? [];
		const first = m[0];
		return first
			? {
					series: (await dropletSeries(ctx, String(num(first['droplet_id'])))).slice(0, 3),
					notes: [note(`Charts of the first member; ${m.length} in the pool.`, 'muted')],
				}
			: { series: [], notes: [note('The pool has no droplets yet.', 'muted')] };
	},
	backup: { none: 'Pool droplets are rebuilt from the template, so they hold no data worth keeping.' },
	history: async (ctx, p) =>
		p
			? ((await doAll(`/droplets/autoscale/${str(p['id'])}/history`, 'history', ctx.key, true)) ?? []).map(
					(h) => ({
						at: str(h['created_at']),
						what: `${num(h['current_instance_count'])} → ${num(h['desired_instance_count'])} droplets: ${str(h['reason']).replace(/_/g, ' ')}`,
						state: str(h['status']),
					}),
				)
			: [],
});

/* ===== Kubernetes ===== */

export const kubernetesScreen = resource({
	vendor: 'digitalocean',
	noun: 'cluster',
	nouns: 'Kubernetes clusters',
	items: async (ctx) => (await doAll('/kubernetes/clusters', 'kubernetes_clusters', ctx.key, true)) ?? [],
	id: (c) => str(c['id']),
	name: (c) => str(c['name']),
	status: (c) => str(rec(c['status'])['state']),
	columns: [
		['name', 'Cluster', false, (c) => str(c['name'])],
		['version', 'Version', true, (c) => str(c['version'])],
		['region', 'Region', true, (c) => str(c['region'])],
		['nodes', 'Nodes', true, (c) => arr(c['node_pools']).reduce<number>((a, p) => a + num(rec(p)['count']), 0)],
		['state', 'State', false, (c) => str(rec(c['status'])['state'])],
		['at', 'Created', true, (c) => when(str(c['created_at']))],
	],
	empty: 'No Kubernetes clusters. The shop runs in Docker on droplets; Kubernetes is here for when that changes.',
	facts: (c) => [
		fact('Version', str(c['version'])),
		fact('Region', str(c['region'])),
		fact('High availability', c['ha'] === true ? 'on' : 'off'),
		fact('Auto upgrade', c['auto_upgrade'] === true ? 'on' : 'off'),
		fact(
			'Maintenance',
			`${str(rec(c['maintenance_policy'])['day'])} ${str(rec(c['maintenance_policy'])['start_time'])} UTC`,
		),
		fact('Endpoint', str(c['endpoint'])),
		fact('VPC', str(c['vpc_uuid'])),
	],
	tables: async (_ctx, c) => [
		table(
			'Node pools',
			[col('name', 'Pool'), col('size', 'Size', true), col('count', 'Nodes', true), col('auto', 'Autoscale')],
			arr(c['node_pools'])
				.map(rec)
				.map((p) =>
					row(str(p['id']), str(p['name']), {
						name: str(p['name']),
						size: str(p['size']),
						count: num(p['count']),
						auto: p['auto_scale'] === true ? `${num(p['min_nodes'])}–${num(p['max_nodes'])}` : 'off',
					}),
				),
			'No node pools.',
		),
	],
	links: (c) => [{ label: 'Open in DigitalOcean', url: `${PORTAL}/kubernetes/clusters/${str(c['id'])}` }],
	create: {
		title: 'New Kubernetes cluster',
		submit: 'Create cluster',
		fields: async (ctx) => {
			const o = rec((await doSoft('/kubernetes/options', ctx.key))?.['options']);
			return [
				field('name', 'Name', 'text', { required: true, value: `${ctx.repo.id}-k8s` }),
				field('region', 'Region', 'select', {
					value: 'blr1',
					options: arr(o['regions'])
						.map(rec)
						.map((r) => option(str(r['slug']), str(r['name']))),
				}),
				field('version', 'Version', 'select', {
					value: str(rec(arr(o['versions'])[0])['slug']),
					options: arr(o['versions'])
						.map(rec)
						.map((v) => option(str(v['slug']), str(v['kubernetes_version']))),
				}),
				field('size', 'Node size', 'select', { value: 's-2vcpu-4gb', options: await sizeOptions(ctx) }),
				field('count', 'Nodes', 'number', { value: 3, min: 1, max: 50 }),
				field('ha', 'High-availability control plane', 'toggle', { value: false, help: '$40 a month extra.' }),
			];
		},
		cost: 'Nodes are billed at their droplet size’s price (3 × s-2vcpu-4gb is $72 a month); a high-availability control plane adds $40 a month.',
		async send(_ctx, w, key) {
			const name = slug(text(w, 'name'));
			const body = {
				name,
				region: text(w, 'region'),
				version: text(w, 'version'),
				ha: w.values['ha'] === true,
				node_pools: [{ size: text(w, 'size'), count: int(w, 'count', 1, 50), name: `${name}-pool` }],
			};
			const c = rec((await doSend('POST', '/kubernetes/clusters', key, body))['kubernetes_cluster']);
			const id = str(c['id']);
			return {
				message: `Cluster ${name} ordered`,
				productId: id,
				follow: [
					{
						label: 'Control plane and nodes running',
						check: async (k: string) =>
							str(
								rec(
									rec((await doGet(`/kubernetes/clusters/${id}`, k))['kubernetes_cluster'])['status'],
								)['state'],
							) === 'running',
					},
				],
			};
		},
	},
	edit: {
		title: 'Edit',
		submit: 'Save cluster',
		fields: (_ctx, c) => {
			const pool = rec(arr(c?.['node_pools'])[0]);
			return [
				field('count', `Nodes in ${str(pool['name'])}`, 'number', {
					value: num(pool['count']),
					min: 1,
					max: 50,
				}),
				field('auto', 'Auto upgrade patch versions', 'toggle', { value: c?.['auto_upgrade'] === true }),
				field('day', 'Maintenance day', 'select', {
					value: str(rec(c?.['maintenance_policy'])['day']) || 'sunday',
					options: ['any', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(
						(d) => option(d, d),
					),
				}),
			];
		},
		cost: 'More nodes are billed from the hour they start.',
		async send(_ctx, w, key, c) {
			if (!c) throw new VendorError('Choose a cluster.', 400);
			const pool = rec(arr(c['node_pools'])[0]);
			const id = str(c['id']);
			await doSend('PUT', `/kubernetes/clusters/${id}`, key, {
				name: str(c['name']),
				auto_upgrade: w.values['auto'] === true,
				maintenance_policy: {
					day: text(w, 'day'),
					start_time: str(rec(c['maintenance_policy'])['start_time']) || '20:00',
				},
			});
			const count = int(w, 'count', 1, 50);
			if (count !== num(pool['count']))
				await doSend('PUT', `/kubernetes/clusters/${id}/node_pools/${str(pool['id'])}`, key, {
					name: str(pool['name']),
					count,
				});
			return { message: `Cluster ${str(c['name'])} saved`, productId: id, follow: [] };
		},
	},
	op: {
		label: 'Upgrade',
		title: 'Upgrade',
		submit: 'Upgrade',
		fields: async (ctx, c) => {
			const ups = arr(
				(await doSoft(`/kubernetes/clusters/${str(c?.['id'])}/upgrades`, ctx.key))?.[
					'available_upgrade_versions'
				],
			).map(rec);
			return [
				field('version', 'To version', 'select', {
					options: ups.map((v) => option(str(v['slug']), str(v['kubernetes_version']))),
					value: str(ups[0]?.['slug']) || null,
					required: true,
				}),
			];
		},
		notes: [
			note('Nodes are replaced one at a time with a surge node, so running pods move without a gap.', 'muted'),
		],
		typed: true,
		async send(_ctx, w, key, c) {
			if (!c) throw new VendorError('Choose a cluster.', 400);
			const id = str(c['id']);
			await doSend('POST', `/kubernetes/clusters/${id}/upgrade`, key, { version: text(w, 'version') });
			return {
				message: `Upgrading ${str(c['name'])}`,
				productId: id,
				follow: [
					{
						label: 'Upgrade finished',
						check: async (k: string) =>
							str(
								rec(
									rec((await doGet(`/kubernetes/clusters/${id}`, k))['kubernetes_cluster'])['status'],
								)['state'],
							) === 'running',
					},
				],
			};
		},
	},
	destroy: {
		submit: 'Destroy cluster',
		notes: [
			note(
				'The cluster and its nodes are destroyed. Its load balancers and volumes are kept unless deleted on their own screens.',
				'red',
			),
		],
		remove: async (_ctx, key, c) => {
			await doSend('DELETE', `/kubernetes/clusters/${str(c['id'])}`, key);
		},
	},
	monitor: async () => ({
		series: [],
		notes: [
			note(
				'DigitalOcean publishes cluster metrics inside the cluster (its metrics server), not through its API; node charts are on each node droplet.',
				'muted',
			),
		],
	}),
	backup: { none: 'DigitalOcean has no built-in cluster backup; volumes have snapshots on the Volumes screen.' },
	history: async (_ctx, c) =>
		c
			? [
					createdRow(c, `Cluster ${str(c['name'])} created`),
					{ at: str(c['updated_at']), what: 'Last change', state: str(rec(c['status'])['state']) },
				]
			: [],
});

/* ===== App Platform ===== */

const appName = (a: Item) => str(rec(a['spec'])['name']);
export const appsScreen = resource({
	vendor: 'digitalocean',
	noun: 'app',
	nouns: 'apps',
	items: async (ctx) => (await doAll('/apps', 'apps', ctx.key, true)) ?? [],
	id: (a) => str(a['id']),
	name: appName,
	status: (a) => str(rec(a['active_deployment'])['phase']) || 'none',
	columns: [
		['name', 'App', false, appName],
		['url', 'Address', true, (a) => str(a['live_url']) || str(a['default_ingress'])],
		['region', 'Region', true, (a) => str(rec(a['region'])['slug'])],
		[
			'deploy',
			'Live deployment',
			false,
			(a) =>
				`${str(rec(a['active_deployment'])['phase']) || '—'} · ${when(str(rec(a['active_deployment'])['created_at']))}`,
		],
	],
	empty: 'No App Platform apps. The shop runs on droplets; App Platform suits a small side site such as a blog.',
	facts: (a) => {
		const s = rec(a['spec']);
		return [
			fact('Address', str(a['live_url'])),
			fact('Region', str(rec(a['region'])['slug'])),
			fact(
				'Components',
				[...arr(s['services']), ...arr(s['static_sites']), ...arr(s['workers']), ...arr(s['jobs'])]
					.map((c) => str(rec(c)['name']))
					.join(', '),
			),
			fact(
				'Domains',
				arr(s['domains'])
					.map((d) => str(rec(d)['domain']))
					.join(', '),
			),
			fact('Tier', str(a['tier_slug'])),
			fact('Updated', when(str(a['updated_at']))),
		];
	},
	tables: async (ctx, a) => {
		const deps = (await doAll(`/apps/${str(a['id'])}/deployments`, 'deployments', ctx.key, true)) ?? [];
		return [
			table(
				'Deployments',
				[col('at', 'When', true), col('cause', 'Why'), col('phase', 'Result')],
				deps
					.slice(0, 20)
					.map((d) =>
						row(
							str(d['id']),
							str(d['id']),
							{ at: when(str(d['created_at'])), cause: str(d['cause']), phase: str(d['phase']) },
							null,
						),
					),
				'No deployments.',
			),
		];
	},
	links: (a) => [{ label: 'Open in DigitalOcean', url: `${PORTAL}/apps/${str(a['id'])}` }],
	edit: {
		title: 'Edit',
		submit: 'Save and deploy',
		fields: (_ctx, a) => {
			const svc = rec(arr(rec(a?.['spec'])['services'])[0]);
			return [
				field('count', `Instances of ${str(svc['name']) || 'the first service'}`, 'number', {
					value: num(svc['instance_count']) || 1,
					min: 1,
					max: 20,
				}),
				field('size', 'Instance size', 'text', { value: str(svc['instance_size_slug']) }),
			];
		},
		notes: [
			note('Saving starts a new deployment; the old one keeps serving until the new one is healthy.', 'muted'),
		],
		cost: 'More or bigger instances are billed from the deployment.',
		async send(_ctx, w, key, a) {
			if (!a) throw new VendorError('Choose an app.', 400);
			const spec = structuredClone(rec(a['spec']));
			const services = arr(spec['services']).map(rec);
			if (!services[0]) throw new VendorError('This app has no service to scale.', 400);
			services[0]['instance_count'] = int(w, 'count', 1, 20);
			services[0]['instance_size_slug'] = text(w, 'size');
			spec['services'] = services;
			await doSend('PUT', `/apps/${str(a['id'])}`, key, { spec });
			return { message: `${appName(a)} saved; deploying`, productId: str(a['id']), follow: [] };
		},
	},
	op: {
		label: 'Redeploy or roll back',
		title: 'Redeploy or roll back',
		submit: 'Run',
		fields: async (ctx, a) => {
			const deps = (await doAll(`/apps/${str(a?.['id'])}/deployments`, 'deployments', ctx.key, true)) ?? [];
			return [
				field('what', 'What', 'cards', {
					value: 'redeploy',
					options: [
						option('redeploy', 'Redeploy the latest code', 'A new build from the branch.'),
						option('rollback', 'Roll back', 'Serve an earlier deployment again.'),
					],
				}),
				field('to', 'Roll back to', 'select', {
					options: deps
						.filter((d) => str(d['phase']) === 'ACTIVE' || str(d['phase']) === 'SUPERSEDED')
						.map((d) => option(str(d['id']), `${when(str(d['created_at']))} · ${str(d['cause'])}`)),
				}),
			];
		},
		async send(_ctx, w, key, a) {
			if (!a) throw new VendorError('Choose an app.', 400);
			const id = str(a['id']);
			if (text(w, 'what') === 'rollback')
				await doSend('POST', `/apps/${id}/rollback`, key, { deployment_id: text(w, 'to'), skip_pin: false });
			else await doSend('POST', `/apps/${id}/deployments`, key, { force_build: true });
			return {
				message: `${text(w, 'what') === 'rollback' ? 'Rolling back' : 'Redeploying'} ${appName(a)}`,
				productId: id,
				follow: [],
			};
		},
	},
	destroy: {
		submit: 'Destroy app',
		notes: [
			note('The app, its deployments and its default address are removed. Attached databases are not.', 'red'),
		],
		remove: async (_ctx, key, a) => {
			await doSend('DELETE', `/apps/${str(a['id'])}`, key);
		},
	},
	monitor: async (ctx, a) => {
		const end = Math.floor(Date.now() / 1000);
		const start = end - ({ '1h': 3600, '24h': 86400, '7d': 604800, '30d': 2592000 } as const)[ctx.range];
		const one = async (m: string, label: string, unit: string) => {
			const b = await doSoft(
				`/monitoring/metrics/apps/${m}?app_id=${str(a['id'])}&start=${start}&end=${end}`,
				ctx.key,
			);
			const r = rec(arr(rec(b?.['data'])['result'])[0]);
			const points = arr(r['values']).map(
				(p) => [num(arr(p)[0]), Math.round(Number(arr(p)[1]) * 100) / 100] as [number, number],
			);
			return points.length ? { name: label, unit, points } : null;
		};
		const s = (
			await Promise.all([
				one('cpu_percentage', 'CPU', '%'),
				one('memory_percentage', 'Memory', '%'),
				one('restart_count', 'Restarts', ''),
			])
		).filter((x) => !!x);
		return { series: s as never };
	},
	backup: {
		none: 'The code is in Git and the app spec is kept by DigitalOcean, so an app can be recreated exactly. Its database is backed up on the database screen.',
	},
	history: async (ctx, a) =>
		a
			? ((await doAll(`/apps/${str(a['id'])}/deployments`, 'deployments', ctx.key, true)) ?? []).map((d) => ({
					at: str(d['created_at']),
					what: `Deployment: ${str(d['cause'])}`,
					state: str(d['phase']),
				}))
			: [],
});

/* ===== Functions ===== */

export const functionsScreen = resource({
	vendor: 'digitalocean',
	noun: 'namespace',
	nouns: 'Functions namespaces',
	items: async (ctx) => (await doAll('/functions/namespaces', 'namespaces', ctx.key, true)) ?? [],
	id: (n) => str(n['namespace']),
	name: (n) => str(n['label']) || str(n['namespace']),
	columns: [
		['name', 'Namespace', false, (n) => str(n['label'])],
		['region', 'Region', true, (n) => str(n['region'])],
		['host', 'API host', true, (n) => str(n['api_host'])],
		['at', 'Created', true, (n) => when(str(n['created_at']))],
	],
	empty: 'No Functions namespaces. Scheduled jobs run inside the stack’s worker today.',
	tables: async (ctx, n) => {
		const t =
			(await doAll(`/functions/namespaces/${str(n['namespace'])}/triggers`, 'triggers', ctx.key, true)) ?? [];
		return [
			table(
				'Triggers',
				[col('name', 'Trigger'), col('fn', 'Function', true), col('cron', 'Schedule', true), col('on', 'On')],
				t.map((x) =>
					row(str(x['name']), str(x['name']), {
						name: str(x['name']),
						fn: str(x['function']),
						cron: str(rec(x['scheduled_details'])['cron']),
						on: x['is_enabled'] === true ? 'on' : 'off',
					}),
				),
				'No triggers.',
			),
		];
	},
	links: (n) => [{ label: 'Open in DigitalOcean', url: `${PORTAL}/functions/${str(n['namespace'])}` }],
	create: {
		title: 'New Functions namespace',
		submit: 'Create namespace',
		fields: async (ctx) => [
			field('label', 'Name', 'text', { required: true, value: `${ctx.repo.id}-fn` }),
			field('region', 'Region', 'select', { value: 'blr1', options: await regionOptions(ctx) }),
		],
		cost: 'Functions bill by GiB-seconds used beyond DigitalOcean’s monthly free allowance; an idle namespace costs nothing.',
		async send(_ctx, w, key) {
			const n = rec(
				(
					await doSend('POST', '/functions/namespaces', key, {
						label: slug(text(w, 'label')),
						region: text(w, 'region'),
					})
				)['namespace'],
			);
			return { message: `Namespace ${str(n['label'])} created`, productId: str(n['namespace']), follow: [] };
		},
	},
	edit: {
		title: 'Triggers of',
		submit: 'Save trigger',
		fields: async (ctx, n) => {
			const t =
				(await doAll(`/functions/namespaces/${str(n?.['namespace'])}/triggers`, 'triggers', ctx.key, true)) ??
				[];
			return [
				field('trigger', 'Trigger', 'select', {
					options: t.map((x) => option(str(x['name']), `${str(x['name'])} · ${str(x['function'])}`)),
					value: str(t[0]?.['name']) || null,
				}),
				field('cron', 'Schedule (cron, UTC)', 'text', { value: str(rec(t[0]?.['scheduled_details'])['cron']) }),
				field('on', 'Enabled', 'toggle', { value: t[0]?.['is_enabled'] === true }),
			];
		},
		blocked: async (ctx, n) =>
			((await doAll(`/functions/namespaces/${str(n?.['namespace'])}/triggers`, 'triggers', ctx.key, true)) ?? [])
				.length
				? null
				: 'This namespace has no triggers to edit; functions and triggers are deployed from code with doctl serverless deploy.',
		async send(_ctx, w, key, n) {
			if (!n) throw new VendorError('Choose a namespace.', 400);
			const cron = text(w, 'cron');
			if (!/^([\d*/,-]+\s+){4}[\d*/,-]+$/.test(cron))
				throw new VendorError('Schedule: five cron fields, like 0 3 * * *.', 400);
			await doSend(
				'PUT',
				`/functions/namespaces/${str(n['namespace'])}/triggers/${encodeURIComponent(text(w, 'trigger'))}`,
				key,
				{ is_enabled: w.values['on'] === true, scheduled_details: { cron, body: {} } },
			);
			return { message: `Trigger ${text(w, 'trigger')} saved`, productId: str(n['namespace']), follow: [] };
		},
	},
	destroy: {
		submit: 'Destroy namespace',
		notes: [note('The namespace and every function in it are removed; schedules stop.', 'red')],
		remove: async (_ctx, key, n) => {
			await doSend('DELETE', `/functions/namespaces/${str(n['namespace'])}`, key);
		},
	},
	monitor: async () => ({
		series: [],
		notes: [
			note(
				'DigitalOcean shows function calls and errors on its own Functions page; its API does not publish them yet.',
				'muted',
			),
		],
	}),
	backup: { none: 'Functions are deployed from code in Git; nothing to back up.' },
	history: async (_ctx, n) => (n ? [createdRow(n, `Namespace ${str(n['label'])} created`)] : []),
});

/* ===== Network file storage ===== */

async function nfsShares(ctx: ProductCtx) {
	const regions = ((await doAll('/regions', 'regions', ctx.key)) ?? []).filter((r) => r['available'] === true);
	const per = await Promise.all(
		regions.map(async (r) =>
			((await doAll(`/nfs?region=${str(r['slug'])}`, 'shares', ctx.key, true)) ?? []).map((s) => ({
				...s,
				region: str(s['region']) || str(r['slug']),
			})),
		),
	);
	return per.flat();
}
export const nfsScreen = resource({
	vendor: 'digitalocean',
	noun: 'share',
	nouns: 'network file shares',
	items: nfsShares,
	id: (s) => str(s['id']),
	name: (s) => str(s['name']),
	status: (s) => str(s['status']),
	columns: [
		['name', 'Share', false, (s) => str(s['name'])],
		['size', 'Size', true, (s) => `${num(s['size_gib'])} GiB`],
		['region', 'Region', true, (s) => str(s['region'])],
		['mount', 'Mount', true, (s) => (str(s['host']) ? `${str(s['host'])}:${str(s['mount_path'])}` : '—')],
		['at', 'Created', true, (s) => when(str(s['created_at']))],
	],
	empty: 'No network file shares. Photos live in Spaces; a share is for files several servers write at once.',
	facts: (s) => [
		fact(
			'Mount',
			str(s['host']) ? `mount -t nfs ${str(s['host'])}:${str(s['mount_path'])} /mnt/${str(s['name'])}` : '—',
		),
		fact('Size', `${num(s['size_gib'])} GiB`),
		fact('Region', str(s['region'])),
		fact(
			'VPCs',
			arr(s['vpc_ids'])
				.map((v) => str(v))
				.join(', '),
		),
	],
	create: {
		title: 'New network file share',
		submit: 'Create share',
		fields: async (ctx) => {
			const vpcs = (await doAll('/vpcs', 'vpcs', ctx.key)) ?? [];
			return [
				field('name', 'Name', 'text', { required: true, value: `${ctx.repo.id}-shared` }),
				field('size', 'Size (GiB)', 'number', { value: 50, min: 50, max: 16_384 }),
				field('region', 'Region', 'select', { value: 'blr1', options: await regionOptions(ctx) }),
				field('vpc', 'VPC', 'select', {
					options: vpcs.map((v) => option(str(v['id']), `${str(v['name'])} · ${str(v['region'])}`)),
					required: true,
				}),
			];
		},
		cost: 'Billed per GiB a month at DigitalOcean’s network file storage rate (50 GiB minimum); its pricing page has today’s rate.',
		async send(_ctx, w, key) {
			const s = rec(
				(
					await doSend('POST', '/nfs', key, {
						name: slug(text(w, 'name')),
						size_gib: int(w, 'size', 50, 16_384),
						region: text(w, 'region'),
						vpc_ids: [text(w, 'vpc')],
					})
				)['share'],
			);
			return { message: `Share ${str(s['name'])} created`, productId: str(s['id']), follow: [] };
		},
	},
	edit: {
		title: 'Resize',
		submit: 'Grow share',
		fields: (_ctx, s) => [
			field('size', 'New size (GiB)', 'number', {
				value: num(s?.['size_gib']),
				min: num(s?.['size_gib']) + 1,
				max: 16_384,
			}),
		],
		cost: 'Billed per GiB a month from the resize.',
		async send(_ctx, w, key, s) {
			if (!s) throw new VendorError('Choose a share.', 400);
			const size = int(w, 'size', num(s['size_gib']) + 1, 16_384);
			await doSend('POST', `/nfs/${str(s['id'])}/actions`, key, {
				type: 'resize',
				region: str(s['region']),
				params: { size_gib: size },
			});
			return { message: `Growing ${str(s['name'])} to ${size} GiB`, productId: str(s['id']), follow: [] };
		},
	},
	op: {
		label: 'Snapshot',
		title: 'Snapshot',
		submit: 'Take snapshot',
		fields: (_ctx, s) => [
			field('name', 'Snapshot name', 'text', {
				value: `${str(s?.['name'])}-${new Date().toISOString().slice(0, 10)}`,
			}),
		],
		cost: 'Snapshots are billed per GiB stored.',
		async send(_ctx, w, key, s) {
			if (!s) throw new VendorError('Choose a share.', 400);
			await doSend('POST', `/nfs/${str(s['id'])}/actions`, key, {
				type: 'snapshot',
				region: str(s['region']),
				params: { name: slug(text(w, 'name')) },
			});
			return { message: `Snapshot of ${str(s['name'])} started`, productId: str(s['id']), follow: [] };
		},
	},
	destroy: {
		submit: 'Destroy share',
		notes: [note('All files on the share are deleted.', 'red')],
		remove: async (_ctx, key, s) => {
			await doSend('DELETE', `/nfs/${str(s['id'])}?region=${str(s['region'])}`, key);
		},
	},
	backup: {
		async view(ctx, s) {
			const snaps =
				(await doAll(
					`/nfs/snapshots?region=${str(s['region'])}&share_id=${str(s['id'])}`,
					'snapshots',
					ctx.key,
					true,
				)) ?? [];
			return view({
				tables: [
					table(
						'Share snapshots',
						[col('name', 'Snapshot'), col('size', 'Size', true), col('at', 'Taken', true)],
						snaps.map((x) =>
							row(str(x['id']), str(x['name']), {
								name: str(x['name']),
								size: `${num(x['size_gib'])} GiB`,
								at: when(str(x['created_at'])),
							}),
						),
						'No snapshots.',
					),
				],
			});
		},
	},
	monitor: async () => ({
		series: [],
		notes: [
			note(
				'DigitalOcean does not publish share throughput through its API; the mounting droplets’ charts show their own disk and network.',
				'muted',
			),
		],
	}),
	history: async (_ctx, s) => (s ? [createdRow(s, `Share ${str(s['name'])} created`)] : []),
});

/* ===== Managed databases ===== */

export const databasesScreen = resource({
	vendor: 'digitalocean',
	noun: 'cluster',
	nouns: 'managed databases',
	items: async (ctx) => (await doAll('/databases', 'databases', ctx.key, true)) ?? [],
	id: (d) => str(d['id']),
	name: (d) => str(d['name']),
	status: (d) => str(d['status']),
	columns: [
		['name', 'Cluster', false, (d) => str(d['name'])],
		['engine', 'Engine', true, (d) => `${str(d['engine'])} ${str(d['version'])}`],
		['size', 'Size', true, (d) => `${str(d['size'])} × ${num(d['num_nodes'])}`],
		['region', 'Region', true, (d) => str(d['region'])],
		['storage', 'Storage', true, (d) => `${Math.round(num(d['storage_size_mib']) / 1024)} GiB`],
	],
	empty: 'No managed databases. The shop’s MongoDB runs in Docker on its own server (owner decision); this screen is for a managed one later.',
	facts: (d) => [
		fact('Engine', `${str(d['engine'])} ${str(d['version'])}`),
		fact('Nodes', num(d['num_nodes'])),
		fact('Host (private)', str(rec(d['private_connection'])['host'])),
		fact('Port', num(rec(d['connection'])['port'])),
		fact('Maintenance', `${str(rec(d['maintenance_window'])['day'])} ${str(rec(d['maintenance_window'])['hour'])}`),
		fact('Password', 'kept by DigitalOcean; never read by the console'),
	],
	tables: async (ctx, d) => {
		const fw = arr((await doSoft(`/databases/${str(d['id'])}/firewall`, ctx.key))?.['rules']).map(rec);
		return [
			table(
				'Trusted sources',
				[col('type', 'Kind'), col('value', 'Value', true)],
				fw.map((r) => row(str(r['uuid']), str(r['value']), { type: str(r['type']), value: str(r['value']) })),
				'No trusted sources: anyone with the password could connect. Add the app droplet.',
			),
		];
	},
	links: (d) => [{ label: 'Open in DigitalOcean', url: `${PORTAL}/databases/${str(d['id'])}` }],
	create: {
		title: 'New managed database',
		submit: 'Create database',
		fields: async (ctx) => [
			field('name', 'Name', 'text', { required: true, value: `${ctx.repo.id}-db` }),
			field('engine', 'Engine', 'select', {
				value: 'mongodb',
				options: [
					option('mongodb', 'MongoDB'),
					option('pg', 'PostgreSQL'),
					option('mysql', 'MySQL'),
					option('valkey', 'Valkey (Redis)'),
					option('opensearch', 'OpenSearch'),
					option('kafka', 'Kafka'),
				],
			}),
			field('size', 'Size', 'select', {
				value: 'db-s-1vcpu-2gb',
				options: ['db-s-1vcpu-1gb', 'db-s-1vcpu-2gb', 'db-s-2vcpu-4gb', 'db-s-4vcpu-8gb'].map((s) =>
					option(s, s),
				),
			}),
			field('nodes', 'Nodes', 'number', {
				value: 1,
				min: 1,
				max: 3,
				help: '2 or 3 adds standby nodes that take over on failure.',
			}),
			field('region', 'Region', 'select', { value: 'blr1', options: await regionOptions(ctx) }),
		],
		cost: 'From about $15 a month for 1 vCPU · 1 GB per node (DigitalOcean list price); each standby node costs the same again.',
		async send(_ctx, w, key) {
			const d = rec(
				(
					await doSend('POST', '/databases', key, {
						name: slug(text(w, 'name')),
						engine: text(w, 'engine'),
						size: text(w, 'size'),
						num_nodes: int(w, 'nodes', 1, 3),
						region: text(w, 'region'),
					})
				)['database'],
			);
			const id = str(d['id']);
			return {
				message: `Database ${str(d['name'])} ordered`,
				productId: id,
				follow: [
					{
						label: 'Online',
						check: async (k: string) =>
							str(rec((await doGet(`/databases/${id}`, k))['database'])['status']) === 'online',
					},
				],
			};
		},
	},
	edit: {
		title: 'Resize',
		submit: 'Resize',
		fields: (_ctx, d) => [
			field('size', 'Size', 'text', { value: str(d?.['size']) }),
			field('nodes', 'Nodes', 'number', { value: num(d?.['num_nodes']), min: 1, max: 3 }),
		],
		cost: 'The new size and node count bill from the resize.',
		async send(_ctx, w, key, d) {
			if (!d) throw new VendorError('Choose a database.', 400);
			await doSend('PUT', `/databases/${str(d['id'])}/resize`, key, {
				size: text(w, 'size'),
				num_nodes: int(w, 'nodes', 1, 3),
			});
			return { message: `Resizing ${str(d['name'])}`, productId: str(d['id']), follow: [] };
		},
	},
	op: {
		label: 'Trusted sources',
		title: 'Trusted sources of',
		submit: 'Save trusted sources',
		fields: async (ctx, d) => {
			const droplets = await dropletsOf(ctx.key);
			const fw = arr((await doSoft(`/databases/${str(d?.['id'])}/firewall`, ctx.key))?.['rules']).map(rec);
			return [
				field('droplets', 'Droplets that may connect', 'multi', {
					options: droplets.map((x) => option(String(num(x['id'])), str(x['name']))),
					value: fw.filter((r) => str(r['type']) === 'droplet').map((r) => str(r['value'])),
				}),
			];
		},
		async send(_ctx, w, key, d) {
			if (!d) throw new VendorError('Choose a database.', 400);
			await doSend('PUT', `/databases/${str(d['id'])}/firewall`, key, {
				rules: list(w, 'droplets').map((v) => ({ type: 'droplet', value: v })),
			});
			return { message: `Trusted sources of ${str(d['name'])} saved`, productId: str(d['id']), follow: [] };
		},
	},
	destroy: {
		submit: 'Destroy database',
		notes: [
			note('The database and its DigitalOcean backups are deleted. Download a backup first if unsure.', 'red'),
		],
		remove: async (_ctx, key, d) => {
			await doSend('DELETE', `/databases/${str(d['id'])}`, key);
		},
	},
	backup: {
		async view(ctx, d) {
			const b = arr((await doSoft(`/databases/${str(d['id'])}/backups`, ctx.key))?.['backups']).map(rec);
			return view({
				stats: [stat('Backups', b.length, 'daily, kept 7 days by DigitalOcean')],
				tables: [
					table(
						'Backups',
						[col('at', 'Taken', true), col('size', 'Size', true)],
						b.map((x, i) =>
							row(String(i), str(x['created_at']), {
								at: when(str(x['created_at'])),
								size: `${num(x['size_gigabytes'])} GB`,
							}),
						),
						'No backups yet.',
					),
				],
			});
		},
	},
	monitor: async () => ({
		series: [],
		notes: [
			note('Database charts are on DigitalOcean’s Insights page; its public API does not publish them.', 'muted'),
		],
	}),
	history: async (ctx, d) =>
		d
			? arr((await doSoft(`/databases/${str(d['id'])}/events`, ctx.key))?.['events'])
					.map(rec)
					.map((e) => ({
						at: str(e['create_time']),
						what: str(e['event_type']).replace(/_/g, ' '),
						state: '',
					}))
			: [],
});

/* ===== Container registry ===== */

export const registryScreen = resource({
	vendor: 'digitalocean',
	noun: 'registry',
	nouns: 'container registries',
	items: async (ctx) => {
		const r = await doSoft('/registry', ctx.key);
		return r && r['registry'] ? [rec(r['registry'])] : [];
	},
	id: (r) => str(r['name']),
	name: (r) => str(r['name']),
	columns: [
		['name', 'Registry', false, (r) => str(r['name'])],
		['region', 'Region', true, (r) => str(r['region'])],
		['used', 'Stored', true, (r) => bytes(num(r['storage_usage_bytes']))],
		['at', 'Created', true, (r) => when(str(r['created_at']))],
	],
	empty: 'No container registry. Release images are kept in GitHub’s registry (private packages); this is DigitalOcean’s.',
	stats: async (items, ctx) => {
		const sub = rec(rec((await doSoft('/registry/subscription', ctx.key))?.['subscription'])['tier']);
		return items.length
			? [
					stat(
						'Plan',
						str(sub['name']) || '—',
						sub['monthly_price_in_cents'] !== undefined
							? `${usd(num(sub['monthly_price_in_cents']) / 100)} a month`
							: '',
					),
					stat(
						'Stored',
						bytes(num(items[0]?.['storage_usage_bytes'])),
						`of ${bytes(num(sub['included_storage_bytes']))}`,
					),
				]
			: [];
	},
	tables: async (ctx, r) => {
		const repos = (await doAll(`/registry/${str(r['name'])}/repositoriesV2`, 'repositories', ctx.key, true)) ?? [];
		return [
			table(
				'Repositories',
				[
					col('name', 'Repository', true),
					col('tags', 'Tags', true),
					col('latest', 'Latest', true),
					col('size', 'Size', true),
				],
				repos.map((x) =>
					row(str(x['name']), str(x['name']), {
						name: str(x['name']),
						tags: num(x['tag_count']),
						latest: arr(rec(x['latest_manifest'])['tags'])
							.map((t) => str(t))
							.join(', '),
						size: bytes(num(rec(x['latest_manifest'])['compressed_size_bytes'])),
					}),
				),
				'No repositories.',
			),
		];
	},
	create: {
		title: 'New container registry',
		submit: 'Create registry',
		fields: async (ctx) => [
			field('name', 'Name', 'text', { required: true, value: ctx.repo.id }),
			field('tier', 'Plan', 'cards', {
				value: 'starter',
				options: [
					option('starter', 'Starter', 'free · 1 repository · 500 MB'),
					option('basic', 'Basic', '$5 a month · 5 repositories · 5 GB'),
					option('professional', 'Professional', '$20 a month · unlimited · 100 GB'),
				],
			}),
			field('region', 'Region', 'select', { value: 'blr1', options: await regionOptions(ctx) }),
		],
		cost: 'Starter is free; Basic $5 and Professional $20 a month.',
		async send(_ctx, w, key) {
			await doSend('POST', '/registry', key, {
				name: slug(text(w, 'name')),
				subscription_tier_slug: text(w, 'tier'),
				region: text(w, 'region'),
			});
			return { message: `Registry ${text(w, 'name')} created`, productId: text(w, 'name'), follow: [] };
		},
	},
	op: {
		label: 'Clean up',
		title: 'Clean up',
		submit: 'Start garbage collection',
		fields: () => [
			field('type', 'Remove', 'cards', {
				value: 'untagged manifests only',
				options: [
					option('untagged manifests only', 'Untagged images', 'Safe: nothing a tag points at.'),
					option('unreferenced blobs only', 'Unreferenced layers', ''),
					option('untagged manifests and unreferenced blobs', 'Both', ''),
				],
			}),
		],
		notes: [note('Pushes are refused while it runs (a few minutes).', 'amber')],
		async send(_ctx, w, key, r) {
			if (!r) throw new VendorError('No registry.', 400);
			await doSend('POST', `/registry/${str(r['name'])}/garbage-collection`, key, { type: text(w, 'type') });
			return {
				message: `Garbage collection started on ${str(r['name'])}`,
				productId: str(r['name']),
				follow: [],
			};
		},
	},
	destroy: {
		submit: 'Destroy registry',
		notes: [note('Every image in it is deleted.', 'red')],
		remove: async (_ctx, key) => {
			await doSend('DELETE', '/registry', key);
		},
	},
	backup: { none: 'Images are rebuilt from Git by the pipeline; GitHub’s registry keeps the release images too.' },
	monitor: async () => ({
		series: [],
		notes: [note('Storage used is on the list; DigitalOcean publishes no pull or push rates.', 'muted')],
	}),
	history: async (ctx, r) =>
		r
			? arr((await doSoft(`/registry/${str(r['name'])}/garbage-collections`, ctx.key))?.['garbage_collections'])
					.map(rec)
					.map((g) => ({
						at: str(g['created_at']),
						what: `Garbage collection: ${num(g['blobs_deleted'])} layers, ${bytes(num(g['freed_bytes']))} freed`,
						state: str(g['status']),
					}))
			: [],
});

/* ===== Images and Marketplace ===== */

export const imagesScreen = resource({
	vendor: 'digitalocean',
	noun: 'image',
	nouns: 'custom images and snapshots',
	items: async (ctx) => (await doAll('/images?private=true', 'images', ctx.key)) ?? [],
	id: (i) => String(num(i['id'])),
	name: (i) => str(i['name']),
	status: (i) => str(i['status']),
	columns: [
		['name', 'Image', false, (i) => str(i['name'])],
		['kind', 'Kind', false, (i) => str(i['type'])],
		['os', 'Distribution', false, (i) => str(i['distribution'])],
		['size', 'Size', true, (i) => `${num(i['size_gigabytes'])} GB`],
		[
			'regions',
			'Regions',
			true,
			(i) =>
				arr(i['regions'])
					.map((r) => str(r))
					.join(', '),
		],
		['at', 'Created', true, (i) => when(str(i['created_at']))],
	],
	empty: 'No custom images or snapshots.',
	extraTables: async (_items, ctx) => {
		const apps = arr((await doSoft('/1-clicks?type=droplet', ctx.key))?.['1_clicks']).map(rec);
		return [
			table(
				`Marketplace 1-Click apps · ${apps.length}`,
				[col('slug', 'App', true)],
				apps.slice(0, 60).map((a) => row(str(a['slug']), str(a['slug']), { slug: str(a['slug']) })),
				'Marketplace not readable with this key.',
			),
		];
	},
	facts: (i) => [
		fact('Distribution', str(i['distribution'])),
		fact('Minimum disk', `${num(i['min_disk_size'])} GB`),
		fact('Size', `${num(i['size_gigabytes'])} GB`),
		fact(
			'Regions',
			arr(i['regions'])
				.map((r) => str(r))
				.join(', '),
		),
		fact('Description', str(i['description'])),
		fact('Error', str(i['error_message'])),
	],
	create: {
		title: 'Import a custom image',
		submit: 'Import image',
		fields: async (ctx) => [
			field('name', 'Name', 'text', { required: true }),
			field('url', 'Image URL', 'text', {
				required: true,
				help: 'A public .img, .qcow2, .vhdx or .vdi (gzip or bzip2 allowed).',
			}),
			field('region', 'Region', 'select', { value: 'blr1', options: await regionOptions(ctx) }),
			field('distribution', 'Distribution', 'select', {
				value: 'Ubuntu',
				options: ['Ubuntu', 'Debian', 'Fedora', 'CentOS', 'Rocky Linux', 'AlmaLinux', 'Unknown'].map((d) =>
					option(d, d),
				),
			}),
		],
		cost: '$0.06 per GB a month while stored.',
		async send(_ctx, w, key) {
			const url = text(w, 'url');
			if (!/^https:\/\//.test(url)) throw new VendorError('Image URL must start with https://.', 400);
			const i = rec(
				(
					await doSend('POST', '/images', key, {
						name: text(w, 'name'),
						url,
						region: text(w, 'region'),
						distribution: text(w, 'distribution'),
					})
				)['image'],
			);
			return { message: `Importing ${str(i['name'])}`, productId: String(num(i['id'])), follow: [] };
		},
	},
	edit: {
		title: 'Edit',
		submit: 'Save image',
		fields: (_ctx, i) => [
			field('name', 'Name', 'text', { value: str(i?.['name']) }),
			field('distribution', 'Distribution', 'text', { value: str(i?.['distribution']) }),
			field('description', 'Description', 'text', { value: str(i?.['description']) }),
		],
		async send(_ctx, w, key, i) {
			if (!i) throw new VendorError('Choose an image.', 400);
			await doSend('PUT', `/images/${num(i['id'])}`, key, {
				name: text(w, 'name'),
				distribution: text(w, 'distribution'),
				description: text(w, 'description', false),
			});
			return { message: `Image ${text(w, 'name')} saved`, productId: String(num(i['id'])), follow: [] };
		},
	},
	op: {
		label: 'Copy to a region',
		title: 'Copy',
		submit: 'Copy image',
		fields: async (ctx) => [
			field('region', 'To region', 'select', { value: 'sgp1', options: await regionOptions(ctx) }),
		],
		cost: 'Each region’s copy is billed as stored space.',
		async send(_ctx, w, key, i) {
			if (!i) throw new VendorError('Choose an image.', 400);
			const a = await doSend('POST', `/images/${num(i['id'])}/actions`, key, {
				type: 'transfer',
				region: text(w, 'region'),
			});
			const aid = num(rec(a['action'])['id']);
			return {
				message: `Copying ${str(i['name'])} to ${text(w, 'region')}`,
				productId: String(num(i['id'])),
				follow: [actionDone('Copied', () => aid)],
			};
		},
	},
	destroy: {
		submit: 'Delete image',
		notes: [note('Droplets already built from it keep running.', 'muted')],
		remove: async (_ctx, key, i) => {
			await doSend('DELETE', `/images/${num(i['id'])}`, key);
		},
	},
	history: async (ctx, i) =>
		i
			? ((await doAll(`/images/${num(i['id'])}/actions`, 'actions', ctx.key, true)) ?? []).map((a) => ({
					at: str(a['started_at']),
					what: str(a['type']).replace(/_/g, ' '),
					state: str(a['status']),
				}))
			: [],
});
