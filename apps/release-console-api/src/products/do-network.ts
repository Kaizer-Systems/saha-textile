/**
 * DigitalOcean › Networking: Cloud Firewalls (checked against Cloudflare's ranges and the plan's
 * "no SSH from the internet"), VPCs, reserved IPs, and the rule, create and delete forms.
 */
import type { ProductCtx, ProductScreen, Write } from './kit.js';
import {
	action,
	col,
	confirmed,
	field,
	form,
	formTab,
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
	view,
	when,
} from './kit.js';
import { doAll, doGet, doSend, dropletName, dropletsOf, envAttached, regionSlug } from './do-kit.js';
import { cloudflareRanges } from '../vendors/do-writes.js';
import { VendorError, arr, num, rec, str } from '../vendors/http.js';

type Rule = Record<string, unknown>;
const EVERYONE = ['0.0.0.0/0', '::/0'];
/** Ports never opened to the whole internet from the console (owner, 21 Nov: port 22 stays closed). */
const NEVER_PUBLIC: Record<string, string> = {
	'22': 'SSH',
	'27017': 'MongoDB',
	'6379': 'Redis',
	'7700': 'Meilisearch',
	'9000': 'the API',
};

const sourcesOf = (r: Rule, side: 'sources' | 'destinations') => {
	const s = rec(r[side]);
	return [
		...arr(s['addresses']).map((a) => str(a)),
		...arr(s['tags']).map((t) => `tag:${str(t)}`),
		...arr(s['droplet_ids']).map((d) => `droplet:${num(d)}`),
		...arr(s['load_balancer_uids']).map((l) => `lb:${str(l)}`),
	];
};

function summarise(rules: Rule[], side: 'sources' | 'destinations', ranges: string[]): string {
	if (!rules.length) return 'nothing';
	return rules
		.map((r) => {
			const from = sourcesOf(r, side);
			const cf = ranges.length && from.length >= ranges.length - 2 && ranges.every((x) => from.includes(x));
			const who = cf
				? 'Cloudflare'
				: from.some((f) => EVERYONE.includes(f))
					? 'everyone'
					: from.length > 3
						? `${from.length} sources`
						: from.join(', ');
			return `${str(r['protocol']).toUpperCase()} ${str(r['ports']) || 'all'} ${side === 'sources' ? 'from' : 'to'} ${who}`;
		})
		.join(' · ');
}

/** Problems a firewall has against the plan, in words. */
function problems(f: Rule, ranges: string[]): string[] {
	const out: string[] = [];
	for (const r of arr(f['inbound_rules']).map(rec)) {
		const from = sourcesOf(r, 'sources');
		const ports = str(r['ports']) || 'all';
		if (from.some((x) => EVERYONE.includes(x))) {
			for (const [port, what] of Object.entries(NEVER_PUBLIC))
				if (
					ports === port ||
					ports === 'all' ||
					ports === '0' ||
					(ports.includes('-') &&
						Number(ports.split('-')[0]) <= Number(port) &&
						Number(port) <= Number(ports.split('-')[1]))
				)
					out.push(`${what} (port ${port}) is open to the whole internet`);
		}
		if (
			ports === '443' &&
			ranges.length &&
			from.length &&
			!from.some((x) => EVERYONE.includes(x)) &&
			ranges.some((x) => !from.includes(x))
		)
			out.push(`HTTPS misses ${ranges.filter((x) => !from.includes(x)).length} of Cloudflare's current ranges`);
	}
	return out;
}

const firewalls = async (ctx: ProductCtx) => {
	const [fws, droplets, ranges] = await Promise.all([
		doAll('/firewalls', 'firewalls', ctx.key),
		dropletsOf(ctx.key),
		cloudflareRanges().catch(() => [] as string[]),
	]);
	const all = fws;
	const covered = new Set<number>();
	for (const f of all)
		for (const d of droplets)
			if (
				arr(f['droplet_ids']).some((x) => num(x) === num(d['id'])) ||
				arr(f['tags']).some((t) => arr(d['tags']).some((u) => str(u) === str(t)))
			)
				covered.add(num(d['id']));
	const open = droplets.filter((d) => !covered.has(num(d['id'])));
	const issues = all.flatMap((f) => problems(f, ranges).map((p) => `${str(f['name'])}: ${p}`));
	return view({
		stats: [
			stat('Firewalls', all.length),
			stat(
				'Droplets protected',
				`${covered.size} of ${droplets.length}`,
				open.length ? `open: ${open.map((d) => str(d['name'])).join(', ')}` : 'all',
			),
			stat("Cloudflare's ranges", ranges.length || '—', 'read now from Cloudflare'),
			stat('Problems', issues.length, issues.length ? 'see below' : 'none'),
		],
		notes: [
			...issues.map((i) => note(i, 'red')),
			...open.map((d) =>
				note(
					`${str(d['name'])} has no Cloud Firewall: every port its software opens is reachable from the internet.`,
					'amber',
				),
			),
		],
		tables: [
			table(
				'Cloud Firewalls',
				[
					col('name', 'Firewall'),
					col('status', 'Status'),
					col('in', 'Inbound'),
					col('out', 'Outbound'),
					col('on', 'Applies to'),
					col('at', 'Created', true),
					col('env', 'Environment'),
				],
				all.map((f) =>
					row(
						str(f['id']),
						str(f['name']),
						{
							name: str(f['name']),
							status: str(f['status']),
							in: summarise(arr(f['inbound_rules']).map(rec), 'sources', ranges),
							out: summarise(arr(f['outbound_rules']).map(rec), 'destinations', ranges),
							on:
								[
									...arr(f['droplet_ids']).map((x) => dropletName(droplets, x)),
									...arr(f['tags']).map((t) => `tag ${str(t)}`),
								].join(', ') || 'nothing',
							at: when(str(f['created_at'])),
							env: envAttached(ctx, arr(f['droplet_ids'])),
						},
						problems(f, ranges).length ? 'red' : toneOf(str(f['status'])),
					),
				),
				'No Cloud Firewalls on this account.',
			),
		],
		actions: [action('New firewall', 'create', 'primary'), action('Add a rule', 'rule')],
	});
};

const PRESETS: Array<[string, string, string]> = [
	[
		'cloudflare-https',
		'HTTPS 443 from Cloudflare only',
		'The plan: the site is reached through Cloudflare; nothing else comes in.',
	],
	[
		'cloudflare-web',
		'HTTP 80 and HTTPS 443 from Cloudflare only',
		'For a server still answering plain HTTP behind Cloudflare.',
	],
	[
		'none',
		'No inbound at all',
		'For workers and databases reached only on the private network or through the tunnel.',
	],
];

async function inboundFor(preset: string): Promise<Rule[]> {
	if (preset === 'none') return [];
	const ranges = await cloudflareRanges();
	if (!ranges.length) throw new VendorError("Cloudflare's address list could not be read; try again.", 502);
	const rule = (port: string) => ({ protocol: 'tcp', ports: port, sources: { addresses: ranges } });
	return preset === 'cloudflare-web' ? [rule('80'), rule('443')] : [rule('443')];
}
const OUTBOUND = [
	{ protocol: 'tcp', ports: 'all', destinations: { addresses: EVERYONE } },
	{ protocol: 'udp', ports: 'all', destinations: { addresses: EVERYONE } },
	{ protocol: 'icmp', destinations: { addresses: EVERYONE } },
];

const createForm = async (ctx: ProductCtx) => {
	const droplets = await dropletsOf(ctx.key);
	const tags = [...new Set(droplets.flatMap((d) => arr(d['tags']).map((t) => str(t))))];
	return formTab(
		form({
			key: 'create',
			title: 'New Cloud Firewall',
			submit: 'Create firewall',
			fields: [
				field('name', 'Name', 'text', { required: true, value: `${ctx.repo.id}-edge` }),
				field('inbound', 'Inbound', 'cards', {
					value: 'cloudflare-https',
					options: PRESETS.map(([v, l, s]) => option(v, l, s)),
				}),
				field('tags', 'Apply to droplets tagged', 'multi', {
					options: tags.map((t) => option(t, t)),
					value: [],
					help: 'Every droplet with one of these tags, now and later.',
				}),
				field('droplets', 'And these droplets', 'multi', {
					options: droplets.map((d) => option(String(num(d['id'])), str(d['name']))),
					value: [],
				}),
			],
			notes: [
				note(
					'Outbound: everything allowed. SSH is never opened to the internet; it goes through the Cloudflare tunnel.',
					'muted',
				),
			],
		}),
	);
};

const ruleForm = async (ctx: ProductCtx) => {
	const fws = await doAll('/firewalls', 'firewalls', ctx.key);
	const p = pick(
		'Firewall',
		fws.map((f) => ({ value: str(f['id']), label: str(f['name']) })),
		ctx.id,
	);
	return formTab(
		form({
			key: 'rule',
			title: 'Add a rule',
			submit: 'Add rule',
			blocked: fws.length ? null : 'No Cloud Firewalls yet: create one first.',
			fields: [
				field('direction', 'Direction', 'select', {
					value: 'inbound',
					options: [option('inbound', 'Inbound'), option('outbound', 'Outbound')],
				}),
				field('protocol', 'Protocol', 'select', {
					value: 'tcp',
					options: [option('tcp', 'TCP'), option('udp', 'UDP'), option('icmp', 'ICMP')],
				}),
				field('ports', 'Ports', 'text', { value: '443', help: 'One port, a range like 8000-8100, or all.' }),
				field('addresses', 'Addresses', 'textarea', {
					value: '',
					help: 'IPv4/IPv6 addresses or ranges, one per line. Write cloudflare for Cloudflare’s current list.',
				}),
				field('tags', 'Droplet tags', 'text', { value: '', help: 'Optional, comma separated.' }),
			],
			notes: [
				note(
					'Checked before sending: SSH (22), MongoDB, Redis, Meilisearch and the API port are never opened to the whole internet.',
					'amber',
				),
			],
		}),
		p,
	);
};

async function sendRule(ctx: ProductCtx, w: Write) {
	const id = w.id ?? ctx.id;
	if (!id) throw new VendorError('Choose a firewall.', 400);
	const key = await ctx.writeKey();
	const direction = text(w, 'direction') === 'outbound' ? 'outbound' : 'inbound';
	const protocol = text(w, 'protocol');
	if (!['tcp', 'udp', 'icmp'].includes(protocol)) throw new VendorError('Protocol must be TCP, UDP or ICMP.', 400);
	const ports = protocol === 'icmp' ? '' : text(w, 'ports');
	if (ports && !/^(all|\d{1,5}(-\d{1,5})?)$/.test(ports))
		throw new VendorError('Ports: one port, a range like 8000-8100, or all.', 400);
	let addresses = list(w, 'addresses');
	if (addresses.includes('cloudflare'))
		addresses = [...addresses.filter((a) => a !== 'cloudflare'), ...(await cloudflareRanges())];
	for (const a of addresses)
		if (!/^[0-9a-f:.]+(\/\d{1,3})?$/i.test(a)) throw new VendorError(`${a} is not an address or range.`, 400);
	const tags = list(w, 'tags');
	if (!addresses.length && !tags.length) throw new VendorError('Give at least one address or tag.', 400);
	const rule: Rule = {
		protocol,
		...(ports ? { ports } : {}),
		[direction === 'inbound' ? 'sources' : 'destinations']: { addresses, tags },
	};
	if (direction === 'inbound') {
		const bad = problems({ inbound_rules: [rule] }, []);
		if (bad.length)
			throw new VendorError(`Refused: ${bad.join('; ')}. Use the tunnel or the private network instead.`, 400);
	}
	await doSend('POST', `/firewalls/${id}/rules`, key, { [`${direction}_rules`]: [rule] });
	return { message: `Rule added: ${protocol.toUpperCase()} ${ports || ''} ${direction}`, productId: id, follow: [] };
}

const vpcs = async (ctx: ProductCtx) => {
	const list_ = await doAll('/vpcs', 'vpcs', ctx.key);
	const members = await Promise.all(
		list_.map(async (v) => (await doAll(`/vpcs/${str(v['id'])}/members`, 'members', ctx.key, true)) ?? []),
	);
	return view({
		stats: [
			stat('Private networks', list_.length),
			stat(
				'Members',
				members.reduce((a, m) => a + m.length, 0),
			),
		],
		tables: [
			table(
				'VPC networks',
				[
					col('name', 'Network'),
					col('region', 'Region', true),
					col('range', 'Range', true),
					col('members', 'Members'),
					col('def', 'Default'),
					col('at', 'Created', true),
				],
				list_.map((v, i) =>
					row(str(v['id']), str(v['name']), {
						name: str(v['name']),
						region: str(v['region']),
						range: str(v['ip_range']),
						// One member list was read per network, in the same order.
						members:
							(members[i] as Record<string, unknown>[]).map((m) => str(m['name'])).join(', ') || 'none',
						def: v['default'] === true ? 'yes' : '',
						at: when(str(v['created_at'])),
					}),
				),
				'No VPC networks yet; DigitalOcean makes a default one per region with the first droplet.',
			),
		],
		notes: [
			note(
				'Staging and production get their own VPC so a staging server can never reach the production database.',
				'muted',
			),
		],
		actions: [action('New VPC', 'vpc', 'primary')],
	});
};

const ips = async (ctx: ProductCtx) => {
	const [v4, v6, droplets] = await Promise.all([
		doAll('/reserved_ips', 'reserved_ips', ctx.key, true),
		doAll('/reserved_ipv6', 'reserved_ipv6s', ctx.key, true),
		dropletsOf(ctx.key),
	]);
	const rows = [
		...(v4 ?? []).map((r) =>
			row(
				str(r['ip']),
				str(r['ip']),
				{
					ip: str(r['ip']),
					kind: 'IPv4',
					region: regionSlug(r['region']),
					on: str(rec(r['droplet'])['name']) || 'unassigned',
					env: r['droplet'] ? envAttached(ctx, [rec(r['droplet'])['id']]) : '—',
				},
				r['droplet'] ? null : 'amber',
			),
		),
		...(v6 ?? []).map((r) =>
			row(
				str(r['ip']),
				str(r['ip']),
				{
					ip: str(r['ip']),
					kind: 'IPv6',
					region: regionSlug(r['region_slug'] ?? r['region']),
					on: str(rec(r['droplet'])['name']) || 'unassigned',
					env: r['droplet'] ? envAttached(ctx, [rec(r['droplet'])['id']]) : '—',
				},
				r['droplet'] ? null : 'amber',
			),
		),
	];
	const v6On = droplets.filter((d) => arr(rec(d['networks'])['v6']).length > 0);
	return view({
		stats: [
			stat(
				'Reserved addresses',
				rows.length,
				`${rows.filter((r) => r.tone === 'amber').length} unassigned (billed)`,
			),
			stat('Droplets with IPv6', `${v6On.length} of ${droplets.length}`),
		],
		tables: [
			table(
				'Reserved IPs',
				[
					col('ip', 'Address', true),
					col('kind', 'Kind'),
					col('region', 'Region', true),
					col('on', 'Assigned to'),
					col('env', 'Environment'),
				],
				rows,
				'No reserved IPs. A droplet keeps its own address until destroyed.',
			),
		],
		notes: [
			note(
				'A reserved IP moves to a new droplet in seconds, so Cloudflare’s DNS never changes during a rebuild. Unassigned reserved IPv4 addresses cost $5 a month.',
				'muted',
			),
		],
		actions: [action('Reserve an address', 'reserve', 'primary')],
	});
};

const destroyForm = async (ctx: ProductCtx) => {
	const [fws, droplets] = await Promise.all([doAll('/firewalls', 'firewalls', ctx.key), dropletsOf(ctx.key)]);
	const list_ = fws;
	const p = pick(
		'Firewall',
		list_.map((f) => ({ value: str(f['id']), label: str(f['name']) })),
		ctx.id,
	);
	const f = list_.find((x) => str(x['id']) === p.value);
	const hit = f
		? droplets.filter(
				(d) =>
					arr(f['droplet_ids']).some((x) => num(x) === num(d['id'])) ||
					arr(f['tags']).some((t) => arr(d['tags']).some((u) => str(u) === str(t))),
			)
		: [];
	return formTab(
		form({
			key: 'destroy',
			title: `Delete ${str(f?.['name'])}`,
			submit: 'Delete firewall',
			danger: true,
			confirmName: f ? str(f['name']) : null,
			blocked: f ? null : 'No Cloud Firewalls on this account.',
			notes: f
				? [
						note(
							`It stops protecting ${hit.length ? hit.map((d) => str(d['name'])).join(', ') : 'nothing'}.`,
							hit.length ? 'red' : 'muted',
						),
						note('Refused while a production droplet would be left with no firewall.', 'amber'),
					]
				: [],
		}),
		p,
	);
};

export const networkScreen: ProductScreen = {
	vendor: 'digitalocean',
	tabs: {
		firewalls,
		rule: ruleForm,
		vpc: vpcs,
		ips,
		create: createForm,
		destroy: destroyForm,
		history: async (ctx) => {
			const [fws, nets] = await Promise.all([
				doAll('/firewalls', 'firewalls', ctx.key),
				doAll('/vpcs', 'vpcs', ctx.key),
			]);
			const rows = [
				...fws.map((f) =>
					row(str(f['id']), str(f['name']), {
						at: when(str(f['created_at'])),
						what: `Firewall ${str(f['name'])} created`,
						state: str(f['status']),
					}),
				),
				...nets.map((v) =>
					row(str(v['id']), str(v['name']), {
						at: when(str(v['created_at'])),
						what: `VPC ${str(v['name'])} created (${str(v['ip_range'])})`,
						state: '',
					}),
				),
			].sort((a, b) => String(b.cells['at']).localeCompare(String(a.cells['at'])));
			return view({
				tables: [
					table(
						'Networking changes DigitalOcean dates',
						[col('at', 'When', true), col('what', 'What'), col('state', 'Now')],
						rows,
						'Nothing yet.',
					),
				],
				notes: [
					note(
						'DigitalOcean keeps no change log for firewall rules; every rule the console adds or removes is in Governance › Audit with who and when.',
						'muted',
					),
				],
			});
		},
	},
	forms: {
		create: {
			read: createForm,
			async send(ctx, w) {
				const key = await ctx.writeKey();
				const name = slug(text(w, 'name'));
				const tags = list(w, 'tags');
				const ids = list(w, 'droplets').map(Number).filter(Number.isInteger);
				const f = rec(
					(
						await doSend('POST', '/firewalls', key, {
							name,
							inbound_rules: await inboundFor(text(w, 'inbound')),
							outbound_rules: OUTBOUND,
							tags,
							droplet_ids: ids,
						})
					)['firewall'],
				);
				return { message: `Firewall ${name} created`, productId: str(f['id']), follow: [] };
			},
		},
		rule: { read: ruleForm, send: sendRule },
		vpc: {
			async read(ctx) {
				const regions = await doAll('/regions', 'regions', ctx.key);
				return formTab(
					form({
						key: 'vpc',
						title: 'New VPC network',
						submit: 'Create VPC',
						fields: [
							field('name', 'Name', 'text', { required: true, value: `${ctx.repo.id}-staging` }),
							field('region', 'Region', 'select', {
								value: 'blr1',
								options: regions
									.filter((r) => r['available'] === true)
									.map((r) => option(str(r['slug']), `${str(r['name'])} · ${str(r['slug'])}`)),
							}),
							field('range', 'Address range', 'text', {
								value: '',
								help: 'Optional, like 10.20.0.0/20. Left empty, DigitalOcean picks one that does not overlap.',
							}),
						],
						notes: [note('Free. Droplets join a VPC only when created in it.', 'muted')],
					}),
				);
			},
			async send(ctx, w) {
				const key = await ctx.writeKey();
				const range = text(w, 'range', false);
				if (range && !/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(range))
					throw new VendorError('Range: like 10.20.0.0/20.', 400);
				const v = rec(
					(
						await doSend('POST', '/vpcs', key, {
							name: slug(text(w, 'name')),
							region: text(w, 'region'),
							...(range ? { ip_range: range } : {}),
						})
					)['vpc'],
				);
				return { message: `VPC ${str(v['name'])} created`, productId: str(v['id']), follow: [] };
			},
		},
		reserve: {
			async read(ctx) {
				const droplets = await dropletsOf(ctx.key);
				return formTab(
					form({
						key: 'reserve',
						title: 'Reserve an IPv4 address',
						submit: 'Reserve',
						fields: [
							field('droplet', 'Assign to', 'select', {
								required: true,
								options: droplets.map((d) =>
									option(String(num(d['id'])), `${str(d['name'])} · ${regionSlug(d['region'])}`),
								),
							}),
						],
						cost: 'Free while assigned to a droplet; $5 a month while unassigned.',
					}),
				);
			},
			async send(ctx, w) {
				const key = await ctx.writeKey();
				const r = rec(
					(await doSend('POST', '/reserved_ips', key, { droplet_id: Number(text(w, 'droplet')) }))[
						'reserved_ip'
					],
				);
				return { message: `Reserved ${str(r['ip'])}`, productId: str(r['ip']), follow: [] };
			},
		},
		destroy: {
			read: destroyForm,
			async send(ctx, w) {
				const id = w.id ?? ctx.id;
				if (!id) throw new VendorError('Choose a firewall.', 400);
				const key = await ctx.writeKey();
				const [f, droplets, fws] = await Promise.all([
					doGet(`/firewalls/${id}`, key).then((b) => rec(b['firewall'])),
					dropletsOf(key),
					doAll('/firewalls', 'firewalls', key),
				]);
				confirmed(w, str(f['name']));
				const covers = (fw: Rule, d: Rule) =>
					arr(fw['droplet_ids']).some((x) => num(x) === num(d['id'])) ||
					arr(fw['tags']).some((t) => arr(d['tags']).some((u) => str(u) === str(t)));
				const others = fws.filter((x) => str(x['id']) !== id);
				const left = droplets.filter(
					(d) => covers(f, d) && /production/.test(str(d['name'])) && !others.some((o) => covers(o, d)),
				);
				if (left.length)
					throw new VendorError(
						`Refused: ${left.map((d) => str(d['name'])).join(', ')} would be left with no firewall.`,
						400,
					);
				await doSend('DELETE', `/firewalls/${id}`, key);
				return { message: `Firewall ${str(f['name'])} deleted`, productId: null, follow: [] };
			},
		},
	},
};
