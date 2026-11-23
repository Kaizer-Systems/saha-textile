/**
 * DigitalOcean networking extras, Spaces, monitoring, AI, the account, and two screens DigitalOcean
 * has no API for (secrets, security posture), which the console works out from what it can read.
 */
import { signV4 } from '../vendors/sigv4.js';
import type { ProductCtx, ProductScreen } from './kit.js';
import {
	action,
	ago,
	bytes,
	col,
	fact,
	field,
	form,
	formTab,
	int,
	list,
	note,
	option,
	pick,
	row,
	slug,
	stat,
	table,
	text,
	toneOf,
	usd,
	view,
	when,
} from './kit.js';
import { doAll, doGet, doSend, doSoft, dropletsOf, envAttached, regionSlug } from './do-kit.js';
import { type Item, createdRow, resource } from './resource.js';
import { VendorError, arr, num, rec, str } from '../vendors/http.js';

const PORTAL = 'https://cloud.digitalocean.com';

/* ===== Load balancers ===== */

export const loadBalancersScreen = resource({
	vendor: 'digitalocean',
	noun: 'load balancer',
	nouns: 'load balancers',
	items: async (ctx) => (await doAll('/load_balancers', 'load_balancers', ctx.key, true)) ?? [],
	envFrom: (ctx, l) => envAttached(ctx, arr(l['droplet_ids'])),
	id: (l) => str(l['id']),
	name: (l) => str(l['name']),
	status: (l) => str(l['status']),
	columns: [
		['name', 'Load balancer', false, (l) => str(l['name'])],
		['ip', 'Address', true, (l) => str(l['ip'])],
		['region', 'Region', true, (l) => regionSlug(l['region'])],
		['nodes', 'Nodes', true, (l) => num(l['size_unit']) || 1],
		[
			'to',
			'Sends to',
			false,
			(l) => (str(l['tag']) ? `tag ${str(l['tag'])}` : `${arr(l['droplet_ids']).length} droplets`),
		],
	],
	empty: 'No load balancers. Cloudflare sends traffic straight to the one server per environment; a load balancer comes with a second server.',
	facts: (l) => [
		fact('Address', str(l['ip'])),
		fact(
			'Rules',
			arr(l['forwarding_rules'])
				.map(rec)
				.map(
					(r) =>
						`${str(r['entry_protocol'])}:${num(r['entry_port'])} → ${str(r['target_protocol'])}:${num(r['target_port'])}`,
				)
				.join(' · '),
		),
		fact(
			'Health check',
			`${str(rec(l['health_check'])['protocol'])}:${num(rec(l['health_check'])['port'])}${str(rec(l['health_check'])['path'])}`,
		),
		fact('Sticky sessions', str(rec(l['sticky_sessions'])['type'])),
		fact('Nodes', num(l['size_unit'])),
	],
	links: (l) => [{ label: 'Open in DigitalOcean', url: `${PORTAL}/networking/load_balancers/${str(l['id'])}` }],
	create: {
		title: 'New load balancer',
		submit: 'Create load balancer',
		fields: async (ctx) => {
			const droplets = await dropletsOf(ctx.key);
			return [
				field('name', 'Name', 'text', { required: true, value: `${ctx.repo.id}-lb` }),
				field('region', 'Region', 'text', { value: 'blr1' }),
				field('tag', 'Droplets tagged', 'text', {
					value: ctx.repo.id,
					help: 'Every droplet with this tag receives traffic.',
				}),
				field('droplets', 'Or these droplets', 'multi', {
					options: droplets.map((d) => option(String(num(d['id'])), str(d['name']))),
					value: [],
				}),
				field('nodes', 'Nodes', 'number', { value: 1, min: 1, max: 100 }),
			];
		},
		cost: '$12 a month per node, billed by the hour.',
		notes: [
			note(
				'HTTPS is passed through to the droplets (port 443), so the Cloudflare origin certificate stays on the servers.',
				'muted',
			),
		],
		async send(_ctx, w, key) {
			const ids = list(w, 'droplets').map(Number);
			const tag = text(w, 'tag', false);
			const body = {
				name: slug(text(w, 'name')),
				region: text(w, 'region'),
				size_unit: int(w, 'nodes', 1, 100),
				forwarding_rules: [
					{
						entry_protocol: 'https',
						entry_port: 443,
						target_protocol: 'https',
						target_port: 443,
						tls_passthrough: true,
					},
				],
				health_check: {
					protocol: 'tcp',
					port: 443,
					check_interval_seconds: 10,
					response_timeout_seconds: 5,
					healthy_threshold: 3,
					unhealthy_threshold: 3,
				},
				...(ids.length ? { droplet_ids: ids } : tag ? { tag } : {}),
			};
			const l = rec((await doSend('POST', '/load_balancers', key, body))['load_balancer']);
			const id = str(l['id']);
			return {
				message: `Load balancer ${body.name} ordered`,
				productId: id,
				follow: [
					{
						label: 'Active with an address',
						check: async (k: string) =>
							str(rec((await doGet(`/load_balancers/${id}`, k))['load_balancer'])['status']) === 'active',
					},
				],
			};
		},
	},
	edit: {
		title: 'Edit',
		submit: 'Save',
		fields: (_ctx, l) => [
			field('nodes', 'Nodes', 'number', { value: num(l?.['size_unit']) || 1, min: 1, max: 100 }),
		],
		cost: '$12 a month per node.',
		async send(_ctx, w, key, l) {
			if (!l) throw new VendorError('Choose a load balancer.', 400);
			const body = { ...l, region: regionSlug(l['region']), size_unit: int(w, 'nodes', 1, 100) };
			for (const k of ['id', 'ip', 'status', 'created_at', 'ipv6', 'size'])
				delete (body as Record<string, unknown>)[k];
			await doSend('PUT', `/load_balancers/${str(l['id'])}`, key, body);
			return { message: `${str(l['name'])} saved`, productId: str(l['id']), follow: [] };
		},
	},
	destroy: {
		submit: 'Destroy load balancer',
		notes: [note('Traffic to its address stops at once. Point DNS back to a droplet first.', 'red')],
		remove: async (_ctx, key, l) => {
			await doSend('DELETE', `/load_balancers/${str(l['id'])}`, key);
		},
	},
	monitor: async (ctx, l) => {
		const end = Math.floor(Date.now() / 1000);
		const start = end - ({ '1h': 3600, '24h': 86400, '7d': 604800, '30d': 2592000 } as const)[ctx.range];
		const one = async (m: string, label: string, unit: string) => {
			const b = await doSoft(
				`/monitoring/metrics/load_balancer/${m}?lb_id=${str(l['id'])}&start=${start}&end=${end}`,
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
				one('frontend_requests_per_second', 'Requests', '/s'),
				one('frontend_connections_current', 'Connections', ''),
				one('frontend_http_responses', 'Responses', ''),
			])
		).filter((x) => !!x);
		return { series: s as never };
	},
	backup: { none: 'A load balancer holds no data; its settings are on the Use tab.' },
	history: async (_ctx, l) => (l ? [createdRow(l, `Load balancer ${str(l['name'])} created`)] : []),
});

/* ===== DNS (DigitalOcean) ===== */

const domainsOf = async (ctx: ProductCtx) => (await doAll('/domains', 'domains', ctx.key, true)) ?? [];
const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'];

const recordsTab = async (ctx: ProductCtx) => {
	const domains = await domainsOf(ctx);
	const p = pick(
		'Domain',
		domains.map((d) => ({ value: str(d['name']), label: str(d['name']) })),
		ctx.id,
	);
	if (!p.value)
		return view({
			notes: [
				note(
					'No domains on DigitalOcean DNS. sahatextile.com’s DNS is on Cloudflare (Cloudflare › DNS).',
					'muted',
				),
			],
		});
	const records = (await doAll(`/domains/${p.value}/records`, 'domain_records', ctx.key)) ?? [];
	return view(
		{
			tables: [
				table(
					'Records',
					[
						col('type', 'Type', true),
						col('name', 'Name', true),
						col('data', 'Value', true),
						col('ttl', 'TTL', true),
					],
					records.map((r) =>
						row(String(num(r['id'])), str(r['name']), {
							type: str(r['type']),
							name: str(r['name']),
							data: str(r['data']),
							ttl: num(r['ttl']),
						}),
					),
					'No records.',
				),
			],
			actions: [action('Add a record', 'create', 'primary')],
		},
		p,
	);
};

export const doDnsScreen: ProductScreen = (() => {
	const base = resource({
		vendor: 'digitalocean',
		noun: 'domain',
		nouns: 'domains on DigitalOcean DNS',
		items: domainsOf,
		id: (d) => str(d['name']),
		name: (d) => str(d['name']),
		columns: [
			['name', 'Domain', false, (d) => str(d['name'])],
			['ttl', 'Default TTL', true, (d) => num(d['ttl'])],
		],
		empty: 'No domains on DigitalOcean DNS. sahatextile.com’s DNS is on Cloudflare (Cloudflare › DNS).',
		destroy: {
			submit: 'Delete domain',
			notes: [note('Every record of the domain is deleted from DigitalOcean DNS.', 'red')],
			remove: async (_ctx, key, d) => {
				await doSend('DELETE', `/domains/${str(d['name'])}`, key);
			},
		},
	});
	const recordForm = (key: 'create' | 'edit') => async (ctx: ProductCtx) => {
		const domains = await domainsOf(ctx);
		const p = pick(
			'Domain',
			domains.map((d) => ({ value: str(d['name']), label: str(d['name']) })),
			ctx.id,
		);
		const records =
			key === 'edit' && p.value
				? ((await doAll(`/domains/${p.value}/records`, 'domain_records', ctx.key)) ?? [])
				: [];
		return formTab(
			form({
				key,
				title: key === 'create' ? 'Add a record' : 'Edit a record',
				submit: key === 'create' ? 'Add record' : 'Save record',
				blocked: p.value
					? key === 'edit' && !records.length
						? 'This domain has no records.'
						: null
					: 'No domains on DigitalOcean DNS.',
				fields: [
					...(key === 'edit'
						? [
								field('record', 'Record', 'select', {
									options: records.map((r) =>
										option(
											String(num(r['id'])),
											`${str(r['type'])} ${str(r['name'])} → ${str(r['data'])}`,
										),
									),
									value: records[0] ? String(num(records[0]['id'])) : null,
								}),
							]
						: []),
					field('type', 'Type', 'select', { value: 'A', options: RECORD_TYPES.map((t) => option(t, t)) }),
					field('name', 'Hostname', 'text', { value: '@', help: '@ for the domain itself.' }),
					field('data', 'Value', 'text', { required: true }),
					field('ttl', 'TTL (seconds)', 'number', { value: 3600, min: 30, max: 86_400 }),
				],
			}),
			p,
		);
	};
	const sendRecord =
		(key: 'create' | 'edit') =>
		async (ctx: ProductCtx, w: Parameters<NonNullable<ProductScreen['forms']>[string]['send']>[1]) => {
			const domain = w.id ?? ctx.id;
			if (!domain) throw new VendorError('Choose a domain.', 400);
			const k = await ctx.writeKey();
			const type = text(w, 'type');
			if (!RECORD_TYPES.includes(type)) throw new VendorError('Choose a record type.', 400);
			const body = { type, name: text(w, 'name'), data: text(w, 'data'), ttl: int(w, 'ttl', 30, 86_400) };
			if (key === 'create') await doSend('POST', `/domains/${domain}/records`, k, body);
			else await doSend('PUT', `/domains/${domain}/records/${text(w, 'record')}`, k, body);
			return { message: `${type} ${body.name} → ${body.data} on ${domain}`, productId: domain, follow: [] };
		};
	return {
		vendor: 'digitalocean',
		tabs: { ...base.tabs, records: recordsTab, create: recordForm('create'), edit: recordForm('edit') },
		forms: {
			...base.forms,
			create: { read: recordForm('create'), send: sendRecord('create') },
			edit: { read: recordForm('edit'), send: sendRecord('edit') },
		},
	};
})();

/* ===== Certificates ===== */

export const certificatesScreen = resource({
	vendor: 'digitalocean',
	noun: 'certificate',
	nouns: 'certificates',
	items: async (ctx) => (await doAll('/certificates', 'certificates', ctx.key, true)) ?? [],
	id: (c) => str(c['id']),
	name: (c) => str(c['name']),
	status: (c) => str(c['state']),
	columns: [
		['name', 'Certificate', false, (c) => str(c['name'])],
		['kind', 'Kind', false, (c) => (str(c['type']) === 'lets_encrypt' ? 'Let’s Encrypt' : 'uploaded')],
		[
			'names',
			'Names',
			true,
			(c) =>
				arr(c['dns_names'])
					.map((n) => str(n))
					.join(', '),
		],
		[
			'until',
			'Expires',
			true,
			(c) => `${when(str(c['not_after']))} (${ago(str(c['not_after'])).replace(' ago', '')})`,
		],
	],
	empty: 'No certificates on DigitalOcean. The servers use Cloudflare origin certificates (Cloudflare › SSL/TLS).',
	notes: (items) =>
		items
			.filter((c) => Date.parse(str(c['not_after'])) - Date.now() < 21 * 86_400_000)
			.map((c) => note(`${str(c['name'])} expires ${when(str(c['not_after']))}.`, 'amber')),
	create: {
		title: 'New Let’s Encrypt certificate',
		submit: 'Request certificate',
		fields: async (ctx) => [
			field('name', 'Name', 'text', { required: true, value: `${ctx.repo.id}-cert` }),
			field('names', 'Domain names', 'text', {
				required: true,
				help: 'Comma separated. The domain must use DigitalOcean DNS.',
			}),
		],
		notes: [
			note(
				'Uploading your own certificate and private key is done on DigitalOcean’s page, so the key never passes through the console.',
				'muted',
			),
		],
		async send(_ctx, w, key) {
			const c = rec(
				(
					await doSend('POST', '/certificates', key, {
						name: slug(text(w, 'name')),
						type: 'lets_encrypt',
						dns_names: list(w, 'names'),
					})
				)['certificate'],
			);
			return { message: `Certificate ${str(c['name'])} requested`, productId: str(c['id']), follow: [] };
		},
	},
	destroy: {
		submit: 'Delete certificate',
		notes: [note('A load balancer still using it stops serving HTTPS.', 'red')],
		remove: async (_ctx, key, c) => {
			await doSend('DELETE', `/certificates/${str(c['id'])}`, key);
		},
	},
	tabs: {
		op: async (ctx) => {
			const certs = (await doAll('/certificates', 'certificates', ctx.key, true)) ?? [];
			return view({
				tables: [
					table(
						'Renewal',
						[col('name', 'Certificate'), col('until', 'Expires', true), col('how', 'Renewal')],
						certs.map((c) =>
							row(
								str(c['id']),
								str(c['name']),
								{
									name: str(c['name']),
									until: when(str(c['not_after'])),
									how:
										str(c['type']) === 'lets_encrypt'
											? 'DigitalOcean renews it before expiry'
											: 'uploaded: renew it yourself and upload again',
								},
								toneOf(str(c['state'])),
							),
						),
						'No certificates.',
					),
				],
			});
		},
	},
	history: async (_ctx, c) => (c ? [createdRow(c, `Certificate ${str(c['name'])} created`)] : []),
});

/* ===== Monitoring and uptime ===== */

const METRICS: Array<[string, string]> = [
	['v1/insights/droplet/cpu', 'CPU %'],
	['v1/insights/droplet/memory_utilization_percent', 'Memory %'],
	['v1/insights/droplet/disk_utilization_percent', 'Disk %'],
	['v1/insights/droplet/load_1', 'Load (1 min)'],
	['v1/insights/droplet/public_outbound_bandwidth', 'Bandwidth out (Mbps)'],
];

const uptimeTab = async (ctx: ProductCtx) => {
	const checks = (await doAll('/uptime/checks', 'checks', ctx.key, true)) ?? [];
	const states = await Promise.all(
		checks.map(async (c) => rec(rec(await doSoft(`/uptime/checks/${str(c['id'])}/state`, ctx.key))['state'])),
	);
	return view({
		stats: [stat('Uptime checks', checks.length)],
		tables: [
			table(
				'Uptime checks',
				[
					col('name', 'Check'),
					col('target', 'Address', true),
					col('regions', 'From', true),
					col('up', '30-day uptime', true),
					col('now', 'Now'),
				],
				checks.map((c, i) => {
					const regions = rec(states[i]?.['regions']);
					const first = rec(Object.values(regions)[0]);
					return row(
						str(c['id']),
						str(c['name']),
						{
							name: str(c['name']),
							target: str(c['target']),
							regions: arr(c['regions'])
								.map((r) => str(r))
								.join(', '),
							up:
								first['thirty_day_uptime_percentage'] !== undefined
									? `${Math.round(num(first['thirty_day_uptime_percentage']) * 100) / 100}%`
									: '—',
							now: str(first['status']) || (c['enabled'] === true ? 'checking' : 'paused'),
						},
						toneOf(str(first['status'])),
					);
				}),
				'No uptime checks. Add one for the shop and the API so an outage is noticed from outside.',
			),
		],
		actions: [action('Add an uptime check', 'uptime-add', 'primary')],
	});
};

export const monitoringScreen = resource({
	vendor: 'digitalocean',
	noun: 'alert policy',
	nouns: 'alert policies',
	items: async (ctx) => (await doAll('/monitoring/alerts', 'policies', ctx.key, true)) ?? [],
	id: (p) => str(p['uuid']),
	name: (p) => str(p['description']),
	status: (p) => (p['enabled'] === true ? 'on' : 'off'),
	columns: [
		['what', 'Alert', false, (p) => str(p['description'])],
		[
			'rule',
			'Rule',
			true,
			(p) =>
				`${METRICS.find(([m]) => m === str(p['type']))?.[1] ?? str(p['type'])} ${str(p['compare']) === 'GreaterThan' ? '>' : '<'} ${num(p['value'])} for ${str(p['window'])}`,
		],
		[
			'on',
			'Droplets',
			false,
			(p) =>
				[...arr(p['tags']).map((t) => `tag ${str(t)}`), ...arr(p['entities']).map((e) => str(e))].join(', ') ||
				'all',
		],
		[
			'tell',
			'Who is told',
			false,
			(p) =>
				arr(rec(p['alerts'])['email'])
					.map((e) => str(e))
					.join(', '),
		],
	],
	empty: 'No alert policies. Add CPU, memory and disk alerts for each server.',
	create: {
		title: 'New alert policy',
		submit: 'Create policy',
		fields: (ctx) => [
			field('metric', 'Measure', 'select', {
				value: METRICS[0]?.[0] ?? '',
				options: METRICS.map(([v, l]) => option(v, l)),
			}),
			field('value', 'Above', 'number', { value: 85, min: 0, max: 100_000 }),
			field('window', 'For', 'select', {
				value: '10m',
				options: ['5m', '10m', '30m', '1h'].map((w) => option(w, w)),
			}),
			field('tags', 'Droplets tagged', 'text', { value: ctx.repo.id }),
			field('emails', 'Email', 'text', {
				required: true,
				help: 'Comma separated; each address must be a member of the DigitalOcean team.',
			}),
		],
		notes: [
			note(
				'Free. DigitalOcean emails when the rule holds for the whole window, and again when it clears.',
				'muted',
			),
		],
		async send(_ctx, w, key) {
			const metric = text(w, 'metric');
			const label = METRICS.find(([m]) => m === metric)?.[1] ?? metric;
			const p = rec(
				(
					await doSend('POST', '/monitoring/alerts', key, {
						type: metric,
						description: `${label} above ${text(w, 'value')} for ${text(w, 'window')}`,
						compare: 'GreaterThan',
						value: int(w, 'value', 0, 100_000),
						window: text(w, 'window'),
						tags: list(w, 'tags'),
						entities: [],
						alerts: { email: list(w, 'emails'), slack: [] },
						enabled: true,
					})
				)['policy'],
			);
			return { message: `Alert policy ${str(p['description'])} created`, productId: str(p['uuid']), follow: [] };
		},
	},
	edit: {
		title: 'Edit',
		submit: 'Save policy',
		fields: (_ctx, p) => [
			field('value', 'Above', 'number', { value: num(p?.['value']) }),
			field('window', 'For', 'select', {
				value: str(p?.['window']),
				options: ['5m', '10m', '30m', '1h'].map((w) => option(w, w)),
			}),
			field('enabled', 'On', 'toggle', { value: p?.['enabled'] === true }),
		],
		async send(_ctx, w, key, p) {
			if (!p) throw new VendorError('Choose a policy.', 400);
			await doSend('PUT', `/monitoring/alerts/${str(p['uuid'])}`, key, {
				...p,
				value: int(w, 'value', 0, 100_000),
				window: text(w, 'window'),
				enabled: w.values['enabled'] === true,
			});
			return { message: `${str(p['description'])} saved`, productId: str(p['uuid']), follow: [] };
		},
	},
	destroy: {
		submit: 'Delete policy',
		notes: [note('Nobody is told any more when this rule holds.', 'amber')],
		remove: async (_ctx, key, p) => {
			await doSend('DELETE', `/monitoring/alerts/${str(p['uuid'])}`, key);
		},
	},
	tabs: { uptime: uptimeTab },
	forms: {
		'uptime-add': {
			read: async (ctx) =>
				formTab(
					form({
						key: 'uptime-add',
						title: 'Add an uptime check',
						submit: 'Add check',
						fields: [
							field('name', 'Name', 'text', { required: true, value: `${ctx.repo.id}-shop` }),
							field('target', 'Address', 'text', { required: true, value: 'https://sahatextile.com/' }),
							field('regions', 'Check from', 'multi', {
								value: ['se_asia', 'eu_west', 'us_east'],
								options: [
									option('se_asia', 'South-east Asia'),
									option('eu_west', 'Western Europe'),
									option('us_east', 'Eastern USA'),
									option('us_west', 'Western USA'),
								],
							}),
						],
						notes: [
							note(
								'DigitalOcean checks the address every minute from each region and emails the team when it fails.',
								'muted',
							),
						],
					}),
				),
			async send(ctx, w) {
				const key = await ctx.writeKey();
				const target = text(w, 'target');
				if (!/^https?:\/\//.test(target)) throw new VendorError('Address must start with https://.', 400);
				const c = rec(
					(
						await doSend('POST', '/uptime/checks', key, {
							name: slug(text(w, 'name')),
							type: 'https',
							target,
							regions: list(w, 'regions'),
							enabled: true,
						})
					)['check'],
				);
				return { message: `Uptime check ${str(c['name'])} added`, productId: str(c['id']), follow: [] };
			},
		},
	},
	history: async (_ctx) => [],
});

/* ===== AI platform ===== */

export const inferenceScreen = resource({
	vendor: 'digitalocean',
	noun: 'agent',
	nouns: 'AI agents',
	items: async (ctx) => arr((await doSoft('/gen-ai/agents?per_page=100', ctx.key))?.['agents']).map(rec),
	id: (a) => str(a['uuid']),
	name: (a) => str(a['name']),
	status: (a) => str(rec(a['deployment'])['status']),
	columns: [
		['name', 'Agent', false, (a) => str(a['name'])],
		['model', 'Model', true, (a) => str(rec(a['model'])['name'])],
		[
			'state',
			'Deployment',
			false,
			(a) =>
				str(rec(a['deployment'])['status'])
					.replace(/^STATUS_/, '')
					.toLowerCase(),
		],
		['at', 'Created', true, (a) => when(str(a['created_at']))],
	],
	empty: 'No AI agents. The shop uses no AI today.',
	extraTables: async (_items, ctx) => {
		const kbs = arr((await doSoft('/gen-ai/knowledge_bases?per_page=100', ctx.key))?.['knowledge_bases']).map(rec);
		const keys = arr((await doSoft('/gen-ai/models/api_keys?per_page=100', ctx.key))?.['api_key_infos']).map(rec);
		return [
			table(
				'Knowledge bases',
				[col('name', 'Knowledge base'), col('at', 'Created', true)],
				kbs.map((k) =>
					row(str(k['uuid']), str(k['name']), { name: str(k['name']), at: when(str(k['created_at'])) }),
				),
				'None.',
			),
			table(
				'Model access keys (names only)',
				[col('name', 'Key'), col('at', 'Created', true)],
				keys.map((k) =>
					row(str(k['uuid']), str(k['name']), { name: str(k['name']), at: when(str(k['created_at'])) }),
				),
				'None.',
			),
		];
	},
	facts: (a) => [
		fact('Model', str(rec(a['model'])['name'])),
		fact('Instructions', str(a['instruction']).slice(0, 300)),
		fact('Address', str(rec(a['deployment'])['url'])),
		fact('Region', str(a['region'])),
	],
	edit: {
		title: 'Edit',
		submit: 'Save agent',
		fields: (_ctx, a) => [field('instruction', 'Instructions', 'textarea', { value: str(a?.['instruction']) })],
		async send(_ctx, w, key, a) {
			if (!a) throw new VendorError('Choose an agent.', 400);
			await doSend('PUT', `/gen-ai/agents/${str(a['uuid'])}`, key, {
				uuid: str(a['uuid']),
				instruction: text(w, 'instruction'),
			});
			return { message: `${str(a['name'])} saved`, productId: str(a['uuid']), follow: [] };
		},
	},
	destroy: {
		submit: 'Delete agent',
		notes: [note('Its address stops answering.', 'red')],
		remove: async (_ctx, key, a) => {
			await doSend('DELETE', `/gen-ai/agents/${str(a['uuid'])}`, key);
		},
	},
	monitor: async () => ({
		series: [],
		notes: [
			note(
				'Requests, tokens and response times are on DigitalOcean’s agent page; its API does not publish them yet.',
				'muted',
			),
		],
	}),
	history: async (_ctx, a) =>
		a ? [createdRow(a, `Agent ${str(a['name'])} created`), createdRow(a, 'Last change', 'updated_at')] : [],
});

/* ===== VPC peering and NAT ===== */

export const vpcPeeringScreen = resource({
	vendor: 'digitalocean',
	noun: 'peering',
	nouns: 'VPC peerings',
	items: async (ctx) => (await doAll('/vpc_peerings', 'vpc_peerings', ctx.key, true)) ?? [],
	id: (p) => str(p['id']),
	name: (p) => str(p['name']),
	status: (p) => str(p['status']),
	columns: [
		['name', 'Peering', false, (p) => str(p['name'])],
		[
			'vpcs',
			'Joins',
			true,
			(p) =>
				arr(p['vpc_ids'])
					.map((v) => str(v))
					.join(' ↔ '),
		],
		['state', 'State', false, (p) => str(p['status'])],
		['at', 'Created', true, (p) => when(str(p['created_at']))],
	],
	empty: 'No VPC peerings: staging and production networks stay apart, as planned.',
	extraTables: async (_items, ctx) => {
		const nat = arr((await doSoft('/vpc_nat_gateways', ctx.key))?.['vpc_nat_gateways']).map(rec);
		return [
			table(
				'NAT gateways',
				[col('name', 'Gateway'), col('region', 'Region', true), col('state', 'State')],
				nat.map((n) =>
					row(str(n['id']), str(n['name']), {
						name: str(n['name']),
						region: str(n['region']),
						state: str(n['state']),
					}),
				),
				'No NAT gateways.',
			),
		];
	},
	create: {
		title: 'New VPC peering',
		submit: 'Create peering',
		fields: async (ctx) => {
			const vpcs = (await doAll('/vpcs', 'vpcs', ctx.key)) ?? [];
			const opts = vpcs.map((v) => option(str(v['id']), `${str(v['name'])} · ${str(v['ip_range'])}`));
			return [
				field('name', 'Name', 'text', { required: true }),
				field('a', 'Network', 'select', { options: opts, required: true }),
				field('b', 'With', 'select', { options: opts, required: true }),
			];
		},
		notes: [note('Peering lets two networks reach each other. Never peer staging with production.', 'amber')],
		async send(_ctx, w, key) {
			const p = rec(
				(
					await doSend('POST', '/vpc_peerings', key, {
						name: slug(text(w, 'name')),
						vpc_ids: [text(w, 'a'), text(w, 'b')],
					})
				)['vpc_peering'],
			);
			return { message: `Peering ${str(p['name'])} created`, productId: str(p['id']), follow: [] };
		},
	},
	destroy: {
		submit: 'Delete peering',
		notes: [note('The two networks stop reaching each other at once.', 'amber')],
		remove: async (_ctx, key, p) => {
			await doSend('DELETE', `/vpc_peerings/${str(p['id'])}`, key);
		},
	},
	monitor: async () => ({ series: [], notes: [note('DigitalOcean publishes no throughput for peerings.', 'muted')] }),
	history: async (_ctx, p) => (p ? [createdRow(p, `Peering ${str(p['name'])} created`)] : []),
});

/* ===== Spaces (S3 calls signed with the console's Spaces key) ===== */

const SPACES_REGION = 'sgp1';

export async function s3(
	ctx: ProductCtx,
	path: string,
	region = SPACES_REGION,
	bucket?: string,
	method: 'GET' | 'PUT' | 'DELETE' = 'GET',
): Promise<string> {
	const accessKey = ctx.consoleKey('CONSOLE_SPACES_ACCESS_KEY');
	const secret = ctx.consoleKey('CONSOLE_SPACES_SECRET_KEY');
	if (!accessKey || !secret)
		throw new VendorError(
			'Spaces needs CONSOLE_SPACES_ACCESS_KEY and CONSOLE_SPACES_SECRET_KEY in the console’s key file (pnpm console:env).',
			400,
		);
	const url = new URL(`https://${bucket ? `${bucket}.` : ''}${region}.digitaloceanspaces.com${path}`);
	const headers = signV4({ method, url, region: 'us-east-1', service: 's3', accessKey, secret });
	const res = await fetch(url, { method, headers, signal: AbortSignal.timeout(15_000) });
	const body = await res.text();
	if (res.status === 404 && /NoSuch(Lifecycle|CORS|Bucket)Configuration|NoSuchCORS/.test(body)) return '';
	if (!res.ok)
		throw new VendorError(
			`Spaces answered ${res.status} to ${path.split('?')[0] || '/'}${/<Code>([^<]+)/.exec(body)?.[1] ? `: ${/<Code>([^<]+)/.exec(body)?.[1]}` : ''}.`,
			res.status,
		);
	return body;
}
export const tags = (xml: string, tag: string) =>
	[...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1] ?? '');
const tag1 = (xml: string, tag: string) => tags(xml, tag)[0] ?? '';

/**
 * The account's buckets. A key limited to one bucket may not list them all, so the names then come
 * from the project's Spaces key target, DigitalOcean's key grants and the CDN endpoints.
 */
export async function buckets(ctx: ProductCtx): Promise<Array<{ name: string; created: string; region: string }>> {
	try {
		const xml = await s3(ctx, '/');
		return tags(xml, 'Bucket').map((b) => ({
			name: tag1(b, 'Name'),
			created: tag1(b, 'CreationDate'),
			region: SPACES_REGION,
		}));
	} catch (err) {
		if (!(err instanceof VendorError) || err.status !== 403) throw err;
	}
	const found = new Map<string, string>();
	for (const k of ctx.keyRefs)
		if (k.kind.startsWith('spaces') && k.target)
			found.set(k.target.split('/')[1] ?? '', k.target.split('/')[0] ?? SPACES_REGION);
	const [keys, cdn] = await Promise.all([
		doSoft('/spaces/keys?per_page=100', ctx.key),
		doAll('/cdn/endpoints', 'endpoints', ctx.key, true),
	]);
	for (const k of arr(keys?.['keys']).map(rec))
		for (const g of arr(k['grants']).map(rec))
			if (str(g['bucket']) && !found.has(str(g['bucket']))) found.set(str(g['bucket']), SPACES_REGION);
	for (const e of cdn ?? []) {
		const m = /^([a-z0-9.-]+)\.([a-z0-9]+)\.digitaloceanspaces\.com$/.exec(str(e['origin']));
		if (m?.[1] && m[2]) found.set(m[1], m[2]);
	}
	found.delete('');
	return [...found].map(([name, region]) => ({ name, created: '', region }));
}

export const spacesScreen: ProductScreen = {
	vendor: 'digitalocean',
	tabs: {
		buckets: async (ctx) => {
			const [list_, cdn] = await Promise.all([buckets(ctx), doAll('/cdn/endpoints', 'endpoints', ctx.key, true)]);
			return view({
				stats: [
					stat('Buckets', list_.length, 'Spaces subscription: $5 a month for 250 GiB'),
					stat('CDN endpoints', (cdn ?? []).length),
				],
				tables: [
					table(
						'Spaces buckets',
						[
							col('name', 'Bucket', true),
							col('region', 'Region', true),
							col('cdn', 'CDN'),
							col('at', 'Created', true),
							col('env', 'Environment'),
						],
						list_.map((b) =>
							row(b.name, b.name, {
								env: ctx.envTags()[`do:spaces:${b.name}`] ?? 'no environment',
								name: b.name,
								cdn: (cdn ?? []).some((e) => str(e['origin']).startsWith(`${b.name}.`)) ? 'on' : 'off',
								region: b.region,
								at: b.created ? when(b.created) : '—',
							}),
						),
						'No buckets.',
						true,
					),
				],
				actions: [action('New bucket', 'create', 'primary')],
			});
		},
		bucket: async (ctx) => {
			const list_ = await buckets(ctx);
			const p = pick(
				'Bucket',
				list_.map((b) => ({ value: b.name, label: b.name })),
				ctx.id,
			);
			if (!p.value) return view({ notes: [note('No buckets.', 'muted')] });
			const regionOf = (name: string) => list_.find((b) => b.name === name)?.region ?? SPACES_REGION;
			const [objects, versioning, lifecycle, cors] = await Promise.all([
				s3(ctx, '/?list-type=2&max-keys=50', regionOf(p.value), p.value),
				s3(ctx, '/?versioning', regionOf(p.value), p.value).catch(() => ''),
				s3(ctx, '/?lifecycle', regionOf(p.value), p.value).catch(() => ''),
				s3(ctx, '/?cors', regionOf(p.value), p.value).catch(() => ''),
			]);
			const contents = tags(objects, 'Contents');
			return view(
				{
					head: {
						name: p.value,
						status: tag1(versioning, 'Status') === 'Enabled' ? 'versioning on' : 'versioning off',
						tone: tag1(versioning, 'Status') === 'Enabled' ? 'ok' : 'amber',
					},
					facts: [
						fact('Region', regionOf(p.value)),
						fact('Lifecycle rules', tags(lifecycle, 'Rule').length || 'none'),
						fact('CORS rules', tags(cors, 'CORSRule').length || 'none'),
						fact(
							'Listing',
							objects.includes('<IsTruncated>true') ? 'first 50 files shown' : `${contents.length} files`,
						),
					],
					tables: [
						table(
							'Files (first 50)',
							[col('key', 'File', true), col('size', 'Size', true), col('at', 'Changed', true)],
							contents.map((c) =>
								row(tag1(c, 'Key'), tag1(c, 'Key'), {
									key: tag1(c, 'Key'),
									size: bytes(Number(tag1(c, 'Size'))),
									at: when(tag1(c, 'LastModified')),
								}),
							),
							'Empty bucket.',
						),
					],
				},
				p,
			);
		},
		keys: async (ctx) => {
			const keys = arr((await doSoft('/spaces/keys?per_page=100', ctx.key))?.['keys']).map(rec);
			return view({
				tables: [
					table(
						'Spaces access keys (names and rights only)',
						[col('name', 'Key'), col('grants', 'May'), col('at', 'Created', true)],
						keys.map((k) =>
							row(str(k['access_key']), str(k['name']), {
								name: str(k['name']),
								grants: arr(k['grants'])
									.map(rec)
									.map((g) => `${str(g['permission'])} on ${str(g['bucket']) || 'all buckets'}`)
									.join(', '),
								at: when(str(k['created_at'])),
							}),
						),
						'No Spaces keys readable with this token.',
					),
				],
				notes: [
					note(
						'A new key’s secret is shown once by DigitalOcean: you make it there and paste it into Infisical, so it never passes through the console.',
						'muted',
					),
				],
			});
		},
		cdn: async (ctx) => {
			const cdn = (await doAll('/cdn/endpoints', 'endpoints', ctx.key, true)) ?? [];
			return view({
				tables: [
					table(
						'CDN endpoints',
						[
							col('origin', 'Bucket', true),
							col('endpoint', 'CDN address', true),
							col('ttl', 'Cache', true),
							col('domain', 'Own domain', true),
						],
						cdn.map((e) =>
							row(str(e['id']), str(e['origin']), {
								origin: str(e['origin']),
								endpoint: str(e['endpoint']),
								ttl: `${num(e['ttl'])} s`,
								domain: str(e['custom_domain']) || '—',
							}),
						),
						'No CDN endpoints. Photos are cached by Cloudflare in front of the bucket.',
					),
				],
				actions: [action('Purge the CDN', 'purge'), action('Change cache time', 'edit')],
			});
		},
		edit: async (ctx) => cdnTtlForm(ctx),
		monitor: async () => ({
			type: 'monitor',
			picker: null,
			monitor: {
				series: [],
				notes: [
					{
						text: 'DigitalOcean does not publish Spaces storage or request counts through its API; the bucket tab lists the files, and Cloudflare › Caching shows the photos’ hit rate.',
						tone: 'muted',
					},
				],
			},
		}),
		backup: async (ctx) => {
			const list_ = await buckets(ctx);
			const rows = await Promise.all(
				list_.map(async (b) => ({ b, v: await s3(ctx, '/?versioning', b.region, b.name).catch(() => '') })),
			);
			return view({
				tables: [
					table(
						'Versioning per bucket',
						[col('name', 'Bucket', true), col('v', 'Versioning')],
						rows.map(({ b, v }) =>
							row(
								b.name,
								b.name,
								{ name: b.name, v: tag1(v, 'Status') || 'off' },
								tag1(v, 'Status') === 'Enabled' ? 'ok' : 'amber',
							),
						),
						'No buckets.',
					),
				],
				notes: [
					note(
						'With versioning on, an overwritten or deleted photo can be brought back. Photos can also be rebuilt from the originals the admin keeps.',
						'muted',
					),
				],
			});
		},
		history: async (ctx) => {
			const list_ = await buckets(ctx);
			return view({
				tables: [
					table(
						'Buckets created',
						[col('at', 'When', true), col('what', 'What')],
						list_.map((b) =>
							row(b.name, b.name, {
								at: b.created ? when(b.created) : '—',
								what: `Bucket ${b.name} (${b.region})`,
							}),
						),
						'Nothing yet.',
					),
				],
				notes: [note('Changes made in the console are in Governance › Audit.', 'muted')],
			});
		},
	},
	forms: {
		purge: {
			read: async (ctx) => {
				const cdn = (await doAll('/cdn/endpoints', 'endpoints', ctx.key, true)) ?? [];
				return formTab(
					form({
						key: 'purge',
						title: 'Purge the CDN',
						submit: 'Purge',
						blocked: cdn.length ? null : 'No CDN endpoints.',
						fields: [
							field('endpoint', 'Endpoint', 'select', {
								options: cdn.map((e) => option(str(e['id']), str(e['endpoint']))),
								value: str(cdn[0]?.['id']) || null,
							}),
							field('files', 'Files', 'text', {
								value: '*',
								help: '* for everything, or paths like photos/a.jpg, comma separated.',
							}),
						],
					}),
				);
			},
			async send(ctx, w) {
				const key = await ctx.writeKey();
				await doSend('DELETE', `/cdn/endpoints/${text(w, 'endpoint')}/cache`, key, { files: list(w, 'files') });
				return { message: 'CDN purge sent', productId: text(w, 'endpoint'), follow: [] };
			},
		},
		edit: {
			read: (ctx) => cdnTtlForm(ctx),
			async send(ctx, w) {
				const key = await ctx.writeKey();
				const ttl = int(w, 'ttl', 60, 604_800);
				await doSend('PUT', `/cdn/endpoints/${text(w, 'endpoint')}`, key, { ttl });
				return { message: `CDN cache time set to ${ttl} s`, productId: text(w, 'endpoint'), follow: [] };
			},
		},
	},
};

async function cdnTtlForm(ctx: ProductCtx) {
	const cdn = (await doAll('/cdn/endpoints', 'endpoints', ctx.key, true)) ?? [];
	return formTab(
		form({
			key: 'edit',
			title: 'Change the CDN cache time',
			submit: 'Save cache time',
			blocked: cdn.length
				? null
				: 'No CDN endpoints to change. Bucket versioning, lifecycle and CORS are set on DigitalOcean’s bucket page for now.',
			fields: [
				field('endpoint', 'Endpoint', 'select', {
					options: cdn.map((e) => option(str(e['id']), str(e['endpoint']))),
					value: str(cdn[0]?.['id']) || null,
				}),
				field('ttl', 'Cache time (seconds)', 'number', {
					value: num(cdn[0]?.['ttl']) || 3600,
					min: 60,
					max: 604_800,
				}),
			],
		}),
	);
}

/* ===== Secrets manager: DigitalOcean has none; the names its products hold ===== */

export const doSecretsScreen: ProductScreen = {
	vendor: 'digitalocean',
	tabs: {
		list: async (ctx) => {
			const apps = (await doAll('/apps', 'apps', ctx.key, true)) ?? [];
			const rows = apps.flatMap((a) => {
				const s = rec(a['spec']);
				const comps = [
					...arr(s['services']),
					...arr(s['workers']),
					...arr(s['jobs']),
					...arr(s['static_sites']),
				].map(rec);
				return [
					...arr(s['envs'])
						.map(rec)
						.map((e) => ({ app: str(s['name']), where: 'app', e })),
					...comps.flatMap((c) =>
						arr(c['envs'])
							.map(rec)
							.map((e) => ({ app: str(s['name']), where: str(c['name']), e })),
					),
				];
			});
			return view({
				notes: [
					note(
						'DigitalOcean has no separate secrets manager. This project’s secrets live in Infisical (Run › Secrets); below are the secret names DigitalOcean products hold, never their values.',
						'cy',
					),
				],
				tables: [
					table(
						'Encrypted values in App Platform',
						[col('name', 'Name', true), col('app', 'App'), col('where', 'Component'), col('kind', 'Kind')],
						rows.map((r, i) =>
							row(String(i), str(r.e['key']), {
								name: str(r.e['key']),
								app: r.app,
								where: r.where,
								kind: str(r.e['type']) === 'SECRET' ? 'secret' : 'plain',
							}),
						),
						'No App Platform values.',
					),
				],
			});
		},
	},
};

/* ===== Security posture: worked out from the account, since DigitalOcean has no findings API ===== */

interface Finding {
	id: string;
	what: string;
	where: string;
	level: 'red' | 'amber';
	fix: string;
}

async function findings(ctx: ProductCtx): Promise<Finding[]> {
	const [droplets, fws, vols, reserved, dbs, keys] = await Promise.all([
		dropletsOf(ctx.key),
		doAll('/firewalls', 'firewalls', ctx.key, true),
		doAll('/volumes', 'volumes', ctx.key, true),
		doAll('/reserved_ips', 'reserved_ips', ctx.key, true),
		doAll('/databases', 'databases', ctx.key, true),
		doAll('/account/keys', 'ssh_keys', ctx.key, true),
	]);
	const out: Finding[] = [];
	const covers = (f: Item, d: Item) =>
		arr(f['droplet_ids']).some((x) => num(x) === num(d['id'])) ||
		arr(f['tags']).some((t) => arr(d['tags']).some((u) => str(u) === str(t)));
	for (const d of droplets) {
		const name = str(d['name']);
		const mine = (fws ?? []).filter((f) => covers(f, d));
		if (!mine.length)
			out.push({
				id: `fw-${num(d['id'])}`,
				what: 'No Cloud Firewall',
				where: name,
				level: 'red',
				fix: 'Networking › New firewall (HTTPS from Cloudflare only).',
			});
		for (const f of mine)
			for (const r of arr(f['inbound_rules']).map(rec))
				if (
					['22', 'all', '0'].includes(str(r['ports']) || 'all') &&
					arr(rec(r['sources'])['addresses']).some((a) => ['0.0.0.0/0', '::/0'].includes(str(a)))
				)
					out.push({
						id: `ssh-${str(f['id'])}`,
						what: 'SSH open to the whole internet',
						where: `${name} · ${str(f['name'])}`,
						level: 'red',
						fix: 'Remove the rule; SSH goes through the Cloudflare tunnel.',
					});
		const features = arr(d['features']).map((x) => str(x));
		if (!features.includes('monitoring'))
			out.push({
				id: `mon-${num(d['id'])}`,
				what: 'Monitoring agent off',
				where: name,
				level: 'amber',
				fix: 'Install the DigitalOcean agent (new servers from the console have it).',
			});
		if (/production/.test(name) && !features.includes('backups'))
			out.push({
				id: `bak-${num(d['id'])}`,
				what: 'DigitalOcean backups off on production',
				where: name,
				level: 'amber',
				fix: 'Droplets › Back up › Turn backups on.',
			});
		if (!str(d['vpc_uuid']))
			out.push({
				id: `vpc-${num(d['id'])}`,
				what: 'Not in a VPC',
				where: name,
				level: 'amber',
				fix: 'Rebuild into the environment’s VPC.',
			});
	}
	for (const v of vols ?? [])
		if (!arr(v['droplet_ids']).length)
			out.push({
				id: `vol-${str(v['id'])}`,
				what: 'Volume not attached (billed, unused)',
				where: str(v['name']),
				level: 'amber',
				fix: 'Attach it or destroy it on Volumes.',
			});
	for (const r of reserved ?? [])
		if (!r['droplet'])
			out.push({
				id: `ip-${str(r['ip'])}`,
				what: 'Reserved IP unassigned ($5 a month)',
				where: str(r['ip']),
				level: 'amber',
				fix: 'Assign or release it on Networking › IPs.',
			});
	await Promise.all(
		(dbs ?? []).map(async (db) => {
			const fw = arr((await doSoft(`/databases/${str(db['id'])}/firewall`, ctx.key))?.['rules']);
			if (!fw.length)
				out.push({
					id: `db-${str(db['id'])}`,
					what: 'Database open to any address with the password',
					where: str(db['name']),
					level: 'red',
					fix: 'Managed databases › Trusted sources.',
				});
		}),
	);
	if ((keys ?? []).length > 5)
		out.push({
			id: 'keys',
			what: `${(keys ?? []).length} SSH keys on the account`,
			where: 'account',
			level: 'amber',
			fix: 'Remove keys nobody uses (Cloud account › SSH keys).',
		});
	return out;
}

const SNOOZE_FILE = 'security-snoozes';

export const securityScreen: ProductScreen = {
	vendor: 'digitalocean',
	tabs: {
		list: async (ctx) => {
			const list_ = await findings(ctx);
			return view({
				stats: [
					stat('Findings', list_.length),
					stat('Serious', list_.filter((f) => f.level === 'red').length),
					stat('Checked', 'now', 'firewalls, SSH, agent, backups, VPC, volumes, IPs, databases, keys'),
				],
				tables: [
					table(
						'Findings',
						[col('what', 'Finding'), col('where', 'Where'), col('fix', 'Fix')],
						list_.map((f) => row(f.id, f.what, { what: f.what, where: f.where, fix: f.fix }, f.level)),
						'Nothing found: every check passed.',
						true,
					),
				],
				notes: [
					note(
						'DigitalOcean has no security findings API, so the console checks the account itself each time this tab opens.',
						'muted',
					),
				],
				actions: [action('Scan again', 'op')],
			});
		},
		detail: async (ctx) => {
			const list_ = await findings(ctx);
			const p = pick(
				'Finding',
				list_.map((f) => ({ value: f.id, label: `${f.what} · ${f.where}` })),
				ctx.id,
			);
			const f = list_.find((x) => x.id === p.value);
			if (!f) return view({ notes: [note('Nothing found: every check passed.', 'ok')] });
			return view(
				{
					head: { name: f.what, status: f.level === 'red' ? 'serious' : 'to fix', tone: f.level },
					facts: [fact('Where', f.where), fact('Fix', f.fix)],
				},
				p,
			);
		},
		edit: async (ctx) => {
			const list_ = await findings(ctx);
			const p = pick(
				'Finding',
				list_.map((f) => ({ value: f.id, label: `${f.what} · ${f.where}` })),
				ctx.id,
			);
			return formTab(
				form({
					key: 'edit',
					title: 'Accept or snooze a finding',
					submit: 'Save',
					blocked:
						'Accepting a finding is kept in the console’s audit log only for now; fix it instead where you can.',
					fields: [field('reason', 'Reason', 'text')],
				}),
				p,
			);
		},
		op: async (ctx) => {
			const list_ = await findings(ctx);
			return view({
				head: {
					name: 'Scanned just now',
					status: `${list_.length} findings`,
					tone: list_.some((f) => f.level === 'red') ? 'red' : list_.length ? 'amber' : 'ok',
				},
				notes: [note(`Read ${new Date().toISOString().slice(11, 16)} UTC from DigitalOcean.`, 'muted')],
			});
		},
		history: async () =>
			view({
				notes: [
					note(
						`Each scan reads the account live; accepted findings will be listed here (${SNOOZE_FILE}).`,
						'muted',
					),
				],
			}),
	},
};

/* ===== Cloud account: SSH keys, the console's tokens, billing, alerts ===== */

export const doAccountScreen: ProductScreen = {
	vendor: 'digitalocean',
	tabs: {
		keys: async (ctx) => {
			const keys = (await doAll('/account/keys', 'ssh_keys', ctx.key)) ?? [];
			return view({
				tables: [
					table(
						'SSH keys on the account',
						[col('name', 'Key'), col('fp', 'Fingerprint', true)],
						keys.map((k) =>
							row(String(num(k['id'])), str(k['name']), {
								name: str(k['name']),
								fp: str(k['fingerprint']),
							}),
						),
						'No SSH keys.',
					),
				],
				notes: [
					note(
						'A key added here goes on root of new droplets; the first-boot file turns root sign-in off, so people sign in with their own key as the admin user.',
						'muted',
					),
				],
				actions: [
					action('Add a public key', 'key-add', 'primary'),
					action('Remove a key', 'key-remove', 'danger'),
				],
			});
		},
		tokens: async (ctx) =>
			view({
				tables: [
					table(
						'Keys this console holds for the project',
						[
							col('label', 'Key'),
							col('kind', 'Rights'),
							col('names', 'Infisical names', true),
							col('state', 'State'),
							col('until', 'Expires', true),
						],
						ctx.keyRefs.map((k) =>
							row(
								k.id,
								k.label,
								{
									label: k.label,
									kind: k.kind.replace('-', ' · '),
									names: k.envNames.join(', '),
									state: k.state,
									until: k.expiresAt ? when(k.expiresAt) : 'no expiry',
								},
								k.state === 'expired' ? 'red' : null,
							),
						),
						'No keys linked.',
					),
				],
				notes: [
					note('Values stay in Infisical and the console’s key file; they are never shown here.', 'muted'),
				],
			}),
		billing: async (ctx) => {
			const [bal, hist, inv] = await Promise.all([
				doSoft('/customers/my/balance', ctx.key),
				doSoft('/customers/my/billing_history?per_page=20', ctx.key),
				doSoft('/customers/my/invoices?per_page=12', ctx.key),
			]);
			if (!bal)
				return view({
					notes: [note('This key may not read billing (it needs the billing read right).', 'amber')],
				});
			const preview = rec(inv?.['invoice_preview']);
			return view({
				stats: [
					stat('This month so far', usd(Number(str(bal['month_to_date_usage']) || 0))),
					stat('Balance', usd(Number(str(bal['account_balance']) || 0))),
					stat(
						'Next invoice',
						preview['amount'] ? usd(Number(str(preview['amount']))) : '—',
						str(preview['invoice_period']),
					),
				],
				tables: [
					table(
						'Invoices',
						[col('period', 'Month', true), col('amount', 'Amount', true)],
						arr(inv?.['invoices'])
							.map(rec)
							.map((i) =>
								row(str(i['invoice_uuid']), str(i['invoice_period']), {
									period: str(i['invoice_period']),
									amount: usd(Number(str(i['amount']))),
								}),
							),
						'No invoices yet.',
					),
					table(
						'Billing history',
						[col('at', 'When', true), col('what', 'What'), col('amount', 'Amount', true)],
						arr(hist?.['billing_history'])
							.map(rec)
							.map((h, i) =>
								row(String(i), str(h['description']), {
									at: when(str(h['date'])),
									what: str(h['description']),
									amount: usd(Number(str(h['amount']))),
								}),
							),
						'Nothing yet.',
					),
				],
				notes: [
					note(
						`Read ${ago(str(bal['generated_at']))} by DigitalOcean. The payment card stays on DigitalOcean.`,
						'muted',
					),
				],
				links: [{ label: 'Billing on DigitalOcean', url: `${PORTAL}/account/billing` }],
			});
		},
		alerts: async (ctx) => monitoringScreen.tabs['list']!(ctx),
	},
	forms: {
		'key-add': {
			read: async () =>
				formTab(
					form({
						key: 'key-add',
						title: 'Add a public SSH key',
						submit: 'Add key',
						fields: [
							field('name', 'Name', 'text', { required: true }),
							field('key', 'Public key', 'textarea', {
								required: true,
								help: 'The .pub file’s one line: ssh-ed25519 AAAA… name. Never the private key.',
							}),
						],
					}),
				),
			async send(ctx, w) {
				const key = await ctx.writeKey();
				const pub = text(w, 'key');
				if (!/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+) [A-Za-z0-9+/=]+( .*)?$/.test(pub))
					throw new VendorError(
						'That is not a public key line (ssh-ed25519 AAAA…). Never paste a private key.',
						400,
					);
				const k = rec(
					(await doSend('POST', '/account/keys', key, { name: text(w, 'name'), public_key: pub }))['ssh_key'],
				);
				return { message: `SSH key ${str(k['name'])} added`, productId: String(num(k['id'])), follow: [] };
			},
		},
		'key-remove': {
			read: async (ctx) => {
				const keys = (await doAll('/account/keys', 'ssh_keys', ctx.key)) ?? [];
				return formTab(
					form({
						key: 'key-remove',
						title: 'Remove an SSH key',
						submit: 'Remove key',
						danger: true,
						blocked: keys.length ? null : 'No SSH keys.',
						fields: [
							field('id', 'Key', 'select', {
								options: keys.map((k) =>
									option(String(num(k['id'])), `${str(k['name'])} · ${str(k['fingerprint'])}`),
								),
								value: keys[0] ? String(num(keys[0]['id'])) : null,
							}),
						],
						notes: [
							note(
								'Servers that already have it keep it; it is only removed from new droplets.',
								'muted',
							),
						],
					}),
				);
			},
			async send(ctx, w) {
				const key = await ctx.writeKey();
				await doSend('DELETE', `/account/keys/${int(w, 'id', 1)}`, key);
				return { message: 'SSH key removed from the account', productId: null, follow: [] };
			},
		},
	},
};
