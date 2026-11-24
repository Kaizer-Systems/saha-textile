/**
 * Cloudflare › Domain screens for the edge slot's domain (brief v7, the real Cloudflare menus):
 * overview, analytics, DNS, email, SSL/TLS, security, bots, speed, caching, rules, error pages,
 * network, traffic and the smaller lists. Plan-locked settings are shown, never sent.
 */
import type { ProductCtx, ProductFormSpec, ProductScreen } from './kit.js';
import {
	action,
	ago,
	bool,
	bytes,
	col,
	confirmed,
	fact,
	field,
	form,
	formTab,
	int,
	list,
	monitorTab,
	note,
	option,
	pick,
	row,
	stat,
	table,
	text,
	toneOf,
	view,
	when,
} from './kit.js';
import {
	type SettingSpec,
	type Zone,
	addRule,
	cfAll,
	cfSend,
	cfSoft,
	entrypoint,
	expression,
	noAnalytics,
	ruleFields,
	rulesOf,
	rulesTable,
	seriesOf,
	settingsForm,
	settingsOf,
	settingsView,
	traffic,
	zoneOf,
} from './cf-kit.js';
import { VendorError, arr, num, rec, str } from '../vendors/http.js';
import { ruleKindTables, rulesTabs } from './cf-rules.js';
import { cfFeatures } from './cf-plan.js';

const moreRules = rulesTabs();

const DASH = 'https://dash.cloudflare.com';
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—');

/* ===== Overview ===== */

const overviewTab = async (ctx: ProductCtx) => {
	const z = await zoneOf(ctx);
	const rows = (await traffic({ ...ctx, range: '24h' }, z)) ?? [];
	const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
	const req = sum((r) => r.requests);
	return view({
		head: { name: z.name, status: str(z.raw['status']), tone: toneOf(str(z.raw['status'])) },
		stats: [
			stat('Requests, 24 h', req.toLocaleString('en-IN')),
			stat(
				'Served from cache',
				pct(
					sum((r) => r.cached),
					req,
				),
			),
			stat('Bandwidth, 24 h', bytes(sum((r) => r.bytes))),
			stat(
				'Threats stopped',
				sum((r) => r.threats),
			),
		],
		facts: [
			fact('Plan', z.plan),
			fact(
				'Nameservers',
				arr(z.raw['name_servers'])
					.map((n) => str(n))
					.join(', '),
			),
			fact(
				'Paused',
				z.raw['paused'] === true ? 'yes: traffic bypasses Cloudflare' : 'no',
				z.raw['paused'] === true ? 'red' : null,
			),
			fact(
				'Development mode',
				num(z.raw['development_mode']) > 0
					? `on for ${Math.round(num(z.raw['development_mode']) / 60)} more min`
					: 'off',
			),
			fact('Original registrar', str(z.raw['original_registrar'])),
			fact('Active since', when(str(z.raw['activated_on']))),
		],
		notes: rows.length ? [] : [noAnalytics],
		links: [{ label: 'Open in Cloudflare', url: `${DASH}/${z.account}/${z.name}` }],
		actions: [action('Pause or development mode', 'edit')],
	});
};

const overviewEdit: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		return formTab(
			form({
				key: 'edit',
				title: `Edit ${z.name}`,
				submit: 'Save',
				fields: [
					field('paused', 'Pause Cloudflare', 'toggle', {
						value: z.raw['paused'] === true,
						help: 'Traffic goes straight to the server, unprotected and uncached. Only for diagnosing.',
					}),
					field('dev', 'Development mode (3 hours)', 'toggle', {
						value: num(z.raw['development_mode']) > 0,
						help: 'Bypasses the cache so changes show at once.',
					}),
				],
				notes: [
					note(
						'Pausing exposes the server’s address. The console asks for the domain’s name to be typed.',
						'amber',
					),
				],
				confirmName: z.name,
			}),
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		confirmed(w, z.name);
		const changed: string[] = [];
		if ((w.values['paused'] === true) !== (z.raw['paused'] === true)) {
			await cfSend('PATCH', `/zones/${z.id}`, k, { paused: w.values['paused'] === true });
			changed.push(w.values['paused'] === true ? 'paused' : 'unpaused');
		}
		const devOn = num(z.raw['development_mode']) > 0;
		if ((w.values['dev'] === true) !== devOn) {
			await cfSend('PATCH', `/zones/${z.id}/settings/development_mode`, k, {
				value: w.values['dev'] === true ? 'on' : 'off',
			});
			changed.push(`development mode ${w.values['dev'] === true ? 'on' : 'off'}`);
		}
		if (!changed.length) throw new VendorError('Nothing changed.', 400);
		return { message: `${z.name}: ${changed.join(', ')}`, productId: z.id, follow: [] };
	},
};

const addZone: ProductFormSpec = {
	read: async () =>
		formTab(
			form({
				key: 'add',
				title: 'Add a domain',
				submit: 'Add domain',
				fields: [
					field('name', 'Domain', 'text', {
						required: true,
						help: 'Like example.com. Cloudflare scans its DNS records and answers with the two nameservers to set at the registrar.',
					}),
				],
				notes: [
					note('Added on the Free plan; nothing changes until the registrar points at Cloudflare.', 'muted'),
				],
			}),
		),
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const name = text(w, 'name').toLowerCase();
		if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name)) throw new VendorError('A domain like example.com.', 400);
		const z = await zoneOf(ctx, k);
		const r = rec(await cfSend('POST', '/zones', k, { name, account: { id: z.account }, type: 'full' }));
		return {
			message: `${name} added; set its nameservers to ${arr(r['name_servers'])
				.map((n) => str(n))
				.join(' and ')}`,
			productId: str(r['id']),
			follow: [],
		};
	},
};

const trafficMonitor = (which: 'all' | 'cache' | 'ssl') => async (ctx: ProductCtx) => {
	const z = await zoneOf(ctx);
	const rows = await traffic(ctx, z);
	if (!rows) return monitorTab([], [noAnalytics], null);
	const series =
		which === 'cache'
			? [
					seriesOf(rows, 'Served from cache', '%', (r) => (r.requests ? (r.cached / r.requests) * 100 : 0)),
					seriesOf(rows, 'Bandwidth saved', ' MB', (r) => r.cachedBytes / 1048576),
					seriesOf(rows, 'Bandwidth', ' MB', (r) => r.bytes / 1048576),
				]
			: which === 'ssl'
				? [
						seriesOf(rows, 'TLS 1.3 share', '%', (r) => (r.requests ? (r.tls13 / r.requests) * 100 : 0)),
						seriesOf(rows, 'HTTPS share', '%', (r) => (r.requests ? (r.encrypted / r.requests) * 100 : 0)),
					]
				: [
						seriesOf(rows, 'Requests', '', (r) => r.requests),
						seriesOf(rows, 'Cached', '', (r) => r.cached),
						seriesOf(rows, 'Threats', '', (r) => r.threats),
						seriesOf(rows, 'Bandwidth', ' MB', (r) => r.bytes / 1048576),
					];
	return monitorTab(series, [], null);
};

export const cfOverviewScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		overview: overviewTab,
		add: addZone.read,
		edit: overviewEdit.read,
		monitor: trafficMonitor('all'),
		destroy: async (ctx) => {
			const z = await zoneOf(ctx);
			return formTab(
				form({
					key: 'destroy',
					title: `Remove ${z.name}`,
					submit: 'Remove site',
					danger: true,
					confirmName: z.name,
					// zoneOf() reads the project's own first domain, so this is always its live domain.
					blocked: `${z.name} is this project’s live domain: removing it takes the shop offline, so the console refuses. Do it on Cloudflare’s page if you really mean it.`,
				}),
			);
		},
		history: async (ctx) => auditHistory(ctx),
	},
	forms: { add: addZone, edit: overviewEdit },
};

/** Cloudflare's account audit log, newest first (used by several History tabs). */
async function auditHistory(ctx: ProductCtx, match?: RegExp) {
	const z = await zoneOf(ctx);
	const logs = (await cfAll(`/accounts/${z.account}/audit_logs?direction=desc`, ctx.key)) ?? [];
	const mine = logs.filter(
		(l) => !match || match.test(`${str(rec(l['action'])['type'])} ${str(rec(l['resource'])['type'])}`),
	);
	return view({
		tables: [
			table(
				'Changes Cloudflare recorded',
				[col('at', 'When', true), col('who', 'Who'), col('what', 'What'), col('on', 'On'), col('ok', 'Result')],
				mine.slice(0, 100).map((l, i) =>
					row(
						String(i),
						str(rec(l['action'])['type']),
						{
							at: when(str(l['when'])),
							who: str(rec(l['actor'])['email']) || str(rec(l['actor'])['type']),
							what: str(rec(l['action'])['type']),
							on: str(rec(l['resource'])['type']),
							ok: rec(l['action'])['result'] === true ? 'ok' : 'refused',
						},
						rec(l['action'])['result'] === true ? null : 'red',
					),
				),
				logs.length
					? 'Nothing about this area.'
					: 'The audit log is not readable with this key (it needs Account audit logs read).',
			),
		],
		notes: [note('What was pressed in the console, with the PIN, is also in Governance › Audit.', 'muted')],
	});
}

/* ===== Analytics and observability ===== */

export const cfAnalyticsScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		analytics: async (ctx) => {
			const z = await zoneOf(ctx);
			const rows = await traffic({ ...ctx, range: '30d' }, z);
			if (!rows) return view({ notes: [noAnalytics] });
			const total = rows.reduce((a, r) => a + r.requests, 0);
			const countries: Record<string, number> = {};
			for (const r of rows)
				for (const [c, n] of Object.entries(r.countries)) countries[c] = (countries[c] ?? 0) + n;
			const top = Object.entries(countries)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 12);
			return view({
				head: { name: `${z.name} · last 30 days`, status: z.plan, tone: 'cy' },
				stats: [
					stat('Requests', total.toLocaleString('en-IN')),
					stat(
						'From cache',
						pct(
							rows.reduce((a, r) => a + r.cached, 0),
							total,
						),
					),
					stat('Bandwidth', bytes(rows.reduce((a, r) => a + r.bytes, 0))),
					stat(
						'Unique visitors (sum of days)',
						rows.reduce((a, r) => a + r.uniques, 0).toLocaleString('en-IN'),
					),
				],
				tables: [
					table(
						'By day',
						[
							col('day', 'Day', true),
							col('req', 'Requests', true),
							col('cache', 'Cached', true),
							col('bytes', 'Bandwidth', true),
							col('threats', 'Threats', true),
						],
						rows
							.map((r) =>
								row(String(r.t), String(r.t), {
									day: new Date(r.t * 1000).toISOString().slice(0, 10),
									req: r.requests,
									cache: pct(r.cached, r.requests),
									bytes: bytes(r.bytes),
									threats: r.threats,
								}),
							)
							.reverse(),
						'No traffic.',
					),
					table(
						'Top countries',
						[col('c', 'Country', true), col('n', 'Requests', true), col('p', 'Share', true)],
						top.map(([c, n]) => row(c, c, { c, n, p: pct(n, total) })),
						'No traffic.',
					),
				],
				notes: [
					note(
						'Logpush (raw request logs) is Enterprise only; the console’s own request log is Watch › Live logs.',
						'muted',
					),
				],
			});
		},
	},
};

export const cfObservabilityScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		logs: async () =>
			view({
				notes: [
					note(
						'Cloudflare’s observability logs cover Workers; this domain runs no Worker, so its request log is the console’s own (Watch › Live logs), read from the server.',
						'cy',
					),
				],
			}),
		traces: async () =>
			view({
				notes: [
					note(
						'Cloudflare traces cover Workers (beta). The shop’s traces are on Watch › Traces, from the server.',
						'cy',
					),
				],
			}),
		export: async (ctx) => {
			const z = await zoneOf(ctx);
			const jobs = (await cfAll(`/zones/${z.id}/logpush/jobs`, ctx.key)) ?? [];
			return view({
				tables: [
					table(
						'Logpush jobs',
						[col('name', 'Job'), col('dest', 'Sends to', true), col('on', 'On')],
						jobs.map((j) =>
							row(String(num(j['id'])), str(j['name']), {
								name: str(j['name']),
								dest: str(j['destination_conf']).replace(/\?.*/, ''),
								on: j['enabled'] === true ? 'on' : 'off',
							}),
						),
						'No Logpush jobs: Logpush is Enterprise only.',
					),
				],
			});
		},
		dashboards: async () =>
			view({ notes: [note('Custom dashboards are kept in the console: Watch › Dashboards.', 'cy')] }),
	},
};

/* ===== DNS (beyond the records list) ===== */

async function records(ctx: ProductCtx, z: Zone, key = ctx.key) {
	return (await cfAll(`/zones/${z.id}/dns_records`, key, false)) ?? [];
}

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'];
const recordLabel = (r: Record<string, unknown>) =>
	`${str(r['type'])} ${str(r['name'])} → ${str(r['content']).slice(0, 60)}`;

const dnsEdit: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const all = await records(ctx, z);
		const p = pick(
			'Record',
			all.map((r) => ({ value: str(r['id']), label: recordLabel(r) })),
			ctx.id,
		);
		const r = all.find((x) => str(x['id']) === p.value);
		return formTab(
			form({
				key: 'edit',
				title: r ? `Edit ${recordLabel(r)}` : 'Edit a record',
				submit: 'Save record',
				blocked: r ? null : 'No records.',
				fields: r
					? [
							field('type', 'Type', 'select', {
								value: str(r['type']),
								options: RECORD_TYPES.map((t) => option(t, t)),
							}),
							field('name', 'Name', 'text', { value: str(r['name']) }),
							field('content', 'Content', 'text', { value: str(r['content']) }),
							field('proxied', 'Proxied through Cloudflare', 'toggle', {
								value: r['proxied'] === true,
								help: 'Orange cloud: hides the server’s address and caches. Mail and SSH records stay grey.',
							}),
							field('ttl', 'TTL (1 = automatic)', 'number', {
								value: num(r['ttl']),
								min: 1,
								max: 86_400,
							}),
						]
					: [],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const id = w.id ?? ctx.id;
		if (!id) throw new VendorError('Choose a record.', 400);
		const type = text(w, 'type');
		if (!RECORD_TYPES.includes(type)) throw new VendorError('Choose a record type.', 400);
		const body = {
			type,
			name: text(w, 'name'),
			content: text(w, 'content'),
			proxied: ['A', 'AAAA', 'CNAME'].includes(type) && w.values['proxied'] === true,
			ttl: int(w, 'ttl', 1, 86_400),
		};
		await cfSend('PUT', `/zones/${z.id}/dns_records/${id}`, k, body);
		return {
			message: `${type} ${body.name} → ${body.content}${body.proxied ? ' (proxied)' : ''}`,
			productId: id,
			follow: [],
		};
	},
};

const dnsAdd: ProductFormSpec = {
	read: async (ctx) => {
		const z = await zoneOf(ctx);
		return formTab(
			form({
				key: 'add',
				title: `Add a record to ${z.name}`,
				submit: 'Add record',
				fields: [
					field('type', 'Type', 'select', { value: 'A', options: RECORD_TYPES.map((t) => option(t, t)) }),
					field('name', 'Name', 'text', {
						value: '',
						help: `Like staging (becomes staging.${z.name}) or @.`,
					}),
					field('content', 'Content', 'text', { required: true }),
					field('proxied', 'Proxied through Cloudflare', 'toggle', { value: true }),
					field('ttl', 'TTL (1 = automatic)', 'number', { value: 1, min: 1, max: 86_400 }),
				],
			}),
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const type = text(w, 'type');
		if (!RECORD_TYPES.includes(type)) throw new VendorError('Choose a record type.', 400);
		const body = {
			type,
			// A required box: text() refuses an empty name.
			name: text(w, 'name'),
			content: text(w, 'content'),
			proxied: ['A', 'AAAA', 'CNAME'].includes(type) && w.values['proxied'] === true,
			ttl: int(w, 'ttl', 1, 86_400),
		};
		const r = rec(await cfSend('POST', `/zones/${z.id}/dns_records`, k, body));
		return { message: `${type} ${body.name} → ${body.content} added`, productId: str(r['id']), follow: [] };
	},
};

/** The shop's go-live switch: the apex and www records move to a server, and can move back. */
const SWITCH_NAMES = (z: Zone) => [z.name, `www.${z.name}`];

/**
 * The production server and its newest deploy, for the guided switch (Release Path brief 2.9, C9):
 * read with the console's own DigitalOcean and GitHub keys; anything unread answers null.
 */
async function production(ctx: ProductCtx): Promise<{ ip: string | null; deployed: boolean | null }> {
	const env = ctx.repo.environments.find((e) => /prod/i.test(e.name) && e.cloudId !== null);
	if (!env) return { ip: null, deployed: null };
	const doKey = ctx.consoleKey('CONSOLE_DO_READ_TOKEN') ?? ctx.consoleKey('CONSOLE_DO_WRITE_TOKEN');
	const ghKey = ctx.consoleKey('CONSOLE_GITHUB_TOKEN');
	const name = `${ctx.projectId}-${env.name}`;
	const ip = doKey
		? await fetch(
				`https://api.digitalocean.com/v2/droplets?tag_name=${encodeURIComponent(ctx.projectId)}&per_page=200`,
				{
					headers: { authorization: `Bearer ${doKey}` },
					signal: AbortSignal.timeout(15_000),
				},
			)
				.then((r) => r.json() as Promise<unknown>)
				.then((b) => {
					const d = arr(rec(b)['droplets'])
						.map(rec)
						.find((x) => str(x['name']) === name);
					const v4 = arr(rec(d?.['networks'])['v4'])
						.map(rec)
						.find((n) => str(n['type']) === 'public');
					return v4 ? str(v4['ip_address']) : null;
				})
				.catch(() => null)
		: null;
	const deployed = ghKey
		? await fetch(`https://api.github.com/repos/${ctx.repository}/actions/workflows/deploy.yml/runs?per_page=30`, {
				headers: { authorization: `Bearer ${ghKey}`, 'user-agent': 'release-console' },
				signal: AbortSignal.timeout(15_000),
			})
				.then((r) => r.json() as Promise<unknown>)
				.then((b) => {
					const run = arr(rec(b)['workflow_runs'])
						.map(rec)
						.find((x) => str(x['display_title']).startsWith('Deploy production '));
					return run ? str(run['conclusion']) === 'success' : false;
				})
				.catch(() => null)
		: null;
	return { ip, deployed };
}

const dnsSwitch: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const all = await records(ctx, z);
		const now = all.filter(
			(r) => SWITCH_NAMES(z).includes(str(r['name'])) && ['A', 'AAAA', 'CNAME'].includes(str(r['type'])),
		);
		const last = ctx.recent('dns-switch')[0];
		const prod = await production(ctx);
		const state = (v: boolean | null) => (v === null ? 'not read' : v ? 'done' : 'not yet');
		return formTab(
			form({
				key: 'switch',
				title: 'DNS switch · production',
				submit: 'Switch',
				danger: true,
				confirmName: 'production',
				fields: [
					field('ip', 'Production server (IPv4)', 'text', {
						required: true,
						value: prod.ip,
						help: 'Read from DigitalOcean: the production server. Both records become proxied A records to it.',
					}),
					field('backup', 'A backup restored on a throwaway server', 'toggle', { value: false }),
					field('wordpress', 'WordPress export and the URL review', 'toggle', { value: false }),
				],
				notes: [
					note(
						`Before you switch: production deployed and healthy on its own deploy: ${state(prod.deployed)} · a backup restored on a throwaway server: your tick · WordPress export and the URL review: your tick.`,
						prod.deployed ? 'cy' : 'amber',
					),
					note(
						`${SWITCH_NAMES(z)
							.map((n) => {
								const r = now.find((x) => str(x['name']) === n);
								return `${n}: ${r ? `${str(r['type'])} ${str(r['content'])}` : 'no record'} → ${prod.ip ?? 'the production server'}`;
							})
							.join(' · ')}`,
						'cy',
					),
					note('Type production, then the PIN. Flipping back is the same edit (Flip back).', 'muted'),
					note(
						'What they point at now is kept in the audit log, so Flip back can restore it exactly.',
						'muted',
					),
					...(last
						? [note(`Last switch ${ago(last.at)}: ${last.detail.split(' · before: ')[0]}`, 'muted')]
						: []),
				],
			}),
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		confirmed(w, 'production');
		if (!bool(w, 'backup') || !bool(w, 'wordpress'))
			throw new VendorError(
				'Tick both: a backup restored on a throwaway server, and the WordPress export and URL review.',
				400,
			);
		const ip = text(w, 'ip');
		if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new VendorError('An IPv4 address like 203.0.113.9.', 400);
		const all = await records(ctx, z, k);
		const before = all
			.filter((r) => SWITCH_NAMES(z).includes(str(r['name'])) && ['A', 'AAAA', 'CNAME'].includes(str(r['type'])))
			.map((r) => ({
				id: str(r['id']),
				type: str(r['type']),
				name: str(r['name']),
				content: str(r['content']),
				proxied: r['proxied'] === true,
				ttl: num(r['ttl']),
			}));
		for (const name of SWITCH_NAMES(z)) {
			const hit = before.filter((r) => r.name === name);
			for (const extra of hit.slice(1)) await cfSend('DELETE', `/zones/${z.id}/dns_records/${extra.id}`, k);
			const body = { type: 'A', name, content: ip, proxied: true, ttl: 1 };
			if (hit[0]) await cfSend('PUT', `/zones/${z.id}/dns_records/${hit[0].id}`, k, body);
			else await cfSend('POST', `/zones/${z.id}/dns_records`, k, body);
		}
		return {
			message: `${SWITCH_NAMES(z).join(' and ')} → ${ip} (proxied) · before: ${JSON.stringify(before.map(({ id: _id, ...r }) => r))}`,
			productId: z.id,
			follow: [],
		};
	},
};

const dnsFlipBack: ProductFormSpec = {
	async read(ctx) {
		const last = ctx.recent('dns-switch')[0];
		return formTab(
			form({
				key: 'flipback',
				title: 'Flip back',
				submit: 'Restore the records from before the switch',
				danger: true,
				confirmName: ctx.zones[0] ?? null,
				blocked: last ? null : 'No switch recorded by the console, so there is nothing to flip back to.',
				notes: last ? [note(`Restores: ${last.detail.split(' · before: ')[1] ?? ''}`, 'amber')] : [],
			}),
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		confirmed(w, z.name);
		const last = ctx.recent('dns-switch')[0];
		const saved: unknown = last
			? JSON.parse(last.detail.split(' · before: ')[1]?.replace(/ \([^)]*\)$/, '') ?? '[]')
			: [];
		const want = arr(saved).map(rec);
		if (!want.length) throw new VendorError('Nothing recorded to flip back to.', 400);
		const all = await records(ctx, z, k);
		for (const name of SWITCH_NAMES(z))
			for (const r of all.filter(
				(x) => str(x['name']) === name && ['A', 'AAAA', 'CNAME'].includes(str(x['type'])),
			))
				await cfSend('DELETE', `/zones/${z.id}/dns_records/${str(r['id'])}`, k);
		for (const r of want)
			await cfSend('POST', `/zones/${z.id}/dns_records`, k, {
				type: str(r['type']),
				name: str(r['name']),
				content: str(r['content']),
				proxied: r['proxied'] === true,
				ttl: num(r['ttl']) || 1,
			});
		return {
			message: `Flipped back: ${want.map((r) => `${str(r['type'])} ${str(r['name'])} → ${str(r['content'])}`).join(', ')}`,
			productId: z.id,
			follow: [],
		};
	},
};

export const cfDnsScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		edit: dnsEdit.read,
		switch: async (ctx) => {
			const t = await dnsSwitch.read(ctx);
			return t;
		},
		settings: async (ctx) => {
			const z = await zoneOf(ctx);
			const [dnssec, ds, all] = await Promise.all([
				cfSoft(`/zones/${z.id}/dnssec`, ctx.key),
				cfSoft(`/zones/${z.id}/dns_settings`, ctx.key),
				records(ctx, z),
			]);
			const types: Record<string, number> = {};
			for (const r of all) types[str(r['type'])] = (types[str(r['type'])] ?? 0) + 1;
			return view({
				head: { name: z.name, status: `${all.length} records`, tone: 'cy' },
				facts: [
					fact(
						'DNSSEC',
						str(rec(dnssec)['status']) || 'not readable',
						str(rec(dnssec)['status']) === 'active' ? 'ok' : 'amber',
					),
					fact(
						'CNAME flattening',
						rec(ds)['flatten_all_cnames'] === true ? 'all CNAMEs' : 'at the apex only',
					),
					fact('Nameserver TTL', num(rec(ds)['ns_ttl']) || '—'),
					fact(
						'Records by type',
						Object.entries(types)
							.map(([t, n]) => `${t} ${n}`)
							.join(' · '),
					),
				],
				notes: [
					note(
						'Export: Cloudflare › DNS › Records › Export gives a BIND file; the console lists every record on the Records tab.',
						'muted',
					),
				],
				actions: [action('Add a record', 'add', 'primary'), action('Flip back the go-live switch', 'flipback')],
			});
		},
		monitor: async () =>
			monitorTab(
				[],
				[
					note(
						'DNS query analytics need a paid plan on Cloudflare; the Free plan does not publish them.',
						'muted',
					),
				],
				null,
			),
		destroy: async (ctx) => {
			const z = await zoneOf(ctx);
			const all = await records(ctx, z);
			const p = pick(
				'Record',
				all.map((r) => ({ value: str(r['id']), label: recordLabel(r) })),
				ctx.id,
			);
			const r = all.find((x) => str(x['id']) === p.value);
			return formTab(
				form({
					key: 'destroy',
					title: 'Delete a record',
					submit: 'Delete record',
					danger: true,
					confirmName: r ? str(r['name']) : null,
					blocked: r ? null : 'No records.',
					notes: r
						? [note(`${recordLabel(r)} stops answering at once (cached answers for up to its TTL).`, 'red')]
						: [],
				}),
				p,
			);
		},
		history: async (ctx) => auditHistory(ctx, /dns|record/i),
	},
	forms: {
		edit: dnsEdit,
		add: dnsAdd,
		switch: dnsSwitch,
		flipback: dnsFlipBack,
		destroy: {
			read: async (ctx) => cfDnsScreen.tabs['destroy']!(ctx),
			async send(ctx, w) {
				const k = await ctx.writeKey();
				const z = await zoneOf(ctx, k);
				const id = w.id ?? ctx.id;
				const r = (await records(ctx, z, k)).find((x) => str(x['id']) === id);
				if (!r) throw new VendorError('Choose a record.', 400);
				confirmed(w, str(r['name']));
				await cfSend('DELETE', `/zones/${z.id}/dns_records/${str(r['id'])}`, k);
				return { message: `${recordLabel(r)} deleted`, productId: null, follow: [] };
			},
		},
	},
};

/* ===== Email ===== */

const dmarcOf = (all: Record<string, unknown>[], z: Zone) =>
	all.find((r) => str(r['type']) === 'TXT' && str(r['name']) === `_dmarc.${z.name}`);

export const cfEmailScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		settings: async (ctx) => {
			const z = await zoneOf(ctx);
			const [routing, rules, all] = await Promise.all([
				cfSoft(`/zones/${z.id}/email/routing`, ctx.key),
				cfAll(`/zones/${z.id}/email/routing/rules`, ctx.key),
				records(ctx, z),
			]);
			const dmarc = dmarcOf(all, z);
			const spf = all.find(
				(r) => str(r['type']) === 'TXT' && str(r['name']) === z.name && str(r['content']).includes('v=spf1'),
			);
			const mx = all.filter((r) => str(r['type']) === 'MX' && str(r['name']) === z.name);
			return view({
				head: {
					name: z.name,
					status: rec(routing)['enabled'] === true ? 'Email Routing on' : 'Email Routing off',
					tone: 'cy',
				},
				facts: [
					fact(
						'Mail goes to',
						mx.map((r) => str(r['content'])).join(', ') || 'no MX record',
						mx.length ? null : 'amber',
					),
					fact('SPF', str(spf?.['content']) || 'none', spf ? 'ok' : 'amber'),
					fact('DMARC', str(dmarc?.['content']) || 'none', dmarc ? 'ok' : 'amber'),
				],
				tables: [
					table(
						'Email Routing rules',
						[col('name', 'Rule'), col('to', 'Forwards to', true), col('on', 'On')],
						(rules ?? []).map((r) =>
							row(str(r['id']), str(r['name']), {
								name: str(r['name']),
								to: arr(r['actions'])
									.map((a) =>
										arr(rec(a)['value'])
											.map((v) => str(v))
											.join(', '),
									)
									.join(' · '),
								on: r['enabled'] === true ? 'on' : 'off',
							}),
						),
						'No routing rules: mail is handled by Google Workspace.',
					),
				],
				actions: [action('Edit the DMARC record', 'edit')],
			});
		},
		edit: async (ctx) => cfEmailScreen.forms!['edit']!.read(ctx),
		monitor: async () =>
			monitorTab(
				[],
				[
					note(
						'DMARC reports arrive at the rua address in the DMARC record; Cloudflare’s DMARC Management reads them when switched on in its dashboard.',
						'muted',
					),
				],
				null,
			),
		history: async (ctx) => auditHistory(ctx, /email|dns/i),
	},
	forms: {
		edit: {
			async read(ctx) {
				const z = await zoneOf(ctx);
				const d = str(dmarcOf(await records(ctx, z), z)?.['content']);
				const policy = /p=(none|quarantine|reject)/.exec(d)?.[1] ?? 'none';
				const rua = /rua=mailto:([^;\s]+)/.exec(d)?.[1] ?? `dmarc@${z.name}`;
				return formTab(
					form({
						key: 'edit',
						title: 'DMARC record',
						submit: 'Save DMARC record',
						fields: [
							field('policy', 'Policy', 'cards', {
								value: policy,
								options: [
									option('none', 'Report only', 'Start here: mail is delivered, reports arrive.'),
									option('quarantine', 'Quarantine', 'Failing mail goes to spam.'),
									option('reject', 'Reject', 'Failing mail is refused.'),
								],
							}),
							field('rua', 'Reports to', 'text', { value: rua }),
						],
						notes: [
							note(
								'Move to quarantine only after reports show Google Workspace and MSG91 both pass.',
								'amber',
							),
						],
					}),
				);
			},
			async send(ctx, w) {
				const k = await ctx.writeKey();
				const z = await zoneOf(ctx, k);
				const policy = text(w, 'policy');
				if (!['none', 'quarantine', 'reject'].includes(policy)) throw new VendorError('Choose a policy.', 400);
				const rua = text(w, 'rua');
				if (!/^[^\s@;]+@[^\s@;]+$/.test(rua)) throw new VendorError('Reports to: an email address.', 400);
				const content = `v=DMARC1; p=${policy}; rua=mailto:${rua}; adkim=r; aspf=r`;
				const now = dmarcOf(await records(ctx, z, k), z);
				if (now)
					await cfSend('PUT', `/zones/${z.id}/dns_records/${str(now['id'])}`, k, {
						type: 'TXT',
						name: `_dmarc.${z.name}`,
						content,
						ttl: 1,
					});
				else
					await cfSend('POST', `/zones/${z.id}/dns_records`, k, {
						type: 'TXT',
						name: `_dmarc.${z.name}`,
						content,
						ttl: 1,
					});
				return { message: `DMARC set to ${policy}`, productId: z.id, follow: [] };
			},
		},
	},
};

/* ===== SSL/TLS ===== */

const SSL_MODE: SettingSpec[] = [
	{
		id: 'ssl',
		label: 'Encryption mode',
		options: [
			['off', 'Off'],
			['flexible', 'Flexible'],
			['full', 'Full'],
			['strict', 'Full (strict)'],
		],
		help: 'Full (strict) is the plan: the server has a Cloudflare origin certificate.',
	},
];
const SSL_EDGE: SettingSpec[] = [
	{ id: 'always_use_https', label: 'Always use HTTPS' },
	{
		id: 'min_tls_version',
		label: 'Minimum TLS version',
		options: [
			['1.0', '1.0'],
			['1.1', '1.1'],
			['1.2', '1.2'],
			['1.3', '1.3'],
		],
	},
	{
		id: 'tls_1_3',
		label: 'TLS 1.3',
		options: [
			['on', 'On'],
			['off', 'Off'],
			['zrt', 'On with 0-RTT'],
		],
	},
	{ id: 'automatic_https_rewrites', label: 'Automatic HTTPS rewrites' },
	{ id: 'opportunistic_encryption', label: 'Opportunistic encryption' },
	{
		id: 'security_header',
		label: 'HSTS',
		help: 'Edit HSTS on its own form: once browsers have it, plain HTTP is refused for its whole max-age.',
	},
	{ id: 'ech', label: 'Encrypted Client Hello (ECH)' },
	{ id: 'pq_keyex', label: 'Post-quantum key agreement' },
	{ id: 'tls_1_2_only', label: 'TLS 1.2 only (older setting; minimum TLS version replaces it)' },
	{
		id: 'tls_client_auth',
		label: 'Authenticated origin pulls (zone certificate)',
		help: 'The server then accepts only Cloudflare’s client certificate; server create turns on the per-host kind.',
	},
];

const hstsForm: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const all = await settingsOf(ctx, z);
		const h = rec(rec(rec(all.get('security_header'))['value'])['strict_transport_security']);
		return formTab(
			form({
				key: 'edit',
				title: 'HSTS',
				submit: 'Save HSTS',
				danger: true,
				confirmName: z.name,
				fields: [
					field('enabled', 'Send HSTS', 'toggle', { value: h['enabled'] === true }),
					field('max_age', 'Max age (seconds)', 'select', {
						value: String(num(h['max_age']) || 15_552_000),
						options: [
							['86400', '1 day'],
							['2592000', '1 month'],
							['15552000', '6 months'],
							['31536000', '12 months'],
						].map(([v, l]) => option(v as string, l as string)),
					}),
					field('include_subdomains', 'Include subdomains', 'toggle', {
						value: h['include_subdomains'] === true,
					}),
					field('preload', 'Preload', 'toggle', {
						value: h['preload'] === true,
						help: 'Asks browsers to ship the domain as HTTPS-only. Very hard to undo.',
					}),
				],
				notes: [
					note(
						'Safety: once a browser has seen HSTS it refuses plain HTTP for the whole max age, even if HTTPS breaks. Start with 1 day.',
						'red',
					),
				],
			}),
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		confirmed(w, z.name);
		const maxAge = int(w, 'max_age', 0, 63_072_000);
		await cfSend('PATCH', `/zones/${z.id}/settings/security_header`, k, {
			value: {
				strict_transport_security: {
					enabled: w.values['enabled'] === true,
					max_age: maxAge,
					include_subdomains: w.values['include_subdomains'] === true,
					preload: w.values['preload'] === true,
					nosniff: true,
				},
			},
		});
		return {
			message: `HSTS ${w.values['enabled'] === true ? `on, ${maxAge} s` : 'off'}`,
			productId: z.id,
			follow: [],
		};
	},
};

export const cfSslScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		mode: async (ctx) => {
			const v = await settingsView(ctx, 'Encryption mode', SSL_MODE);
			v.view.actions = [action('Change the mode', 'mode', 'primary')];
			return v;
		},
		edge: async (ctx) => {
			const z = await zoneOf(ctx);
			const packs = (await cfAll(`/zones/${z.id}/ssl/certificate_packs?status=all`, ctx.key)) ?? [];
			const v = await settingsView(ctx, 'HTTPS settings', SSL_EDGE, {
				tables: [
					table(
						'Edge certificates',
						[
							col('hosts', 'Covers', true),
							col('ca', 'Issuer'),
							col('status', 'Status'),
							col('until', 'Expires', true),
						],
						packs.map((p) =>
							row(
								str(p['id']),
								str(p['type']),
								{
									hosts: arr(p['hosts'])
										.map((h) => str(h))
										.join(', '),
									ca: str(p['certificate_authority']),
									status: str(p['status']),
									until: when(str(rec(arr(p['certificates'])[0])['expires_on'])),
								},
								toneOf(str(p['status'])),
							),
						),
						'No edge certificates readable.',
					),
				],
			});
			v.view.actions = [action('Change HTTPS settings', 'settings'), action('HSTS', 'edit')];
			return v;
		},
		origin: async (ctx) => {
			const z = await zoneOf(ctx);
			const [certs, aop] = await Promise.all([
				cfAll(`/certificates?zone_id=${z.id}`, ctx.key),
				cfSoft(`/zones/${z.id}/origin_tls_client_auth/settings`, ctx.key),
			]);
			return view({
				facts: [
					fact('Authenticated Origin Pulls (zone)', rec(aop)['enabled'] === true ? 'on' : 'off'),
					fact(
						'Per-server pulls',
						'each new server gets its own client certificate (DigitalOcean › Droplets › Create)',
					),
				],
				tables: [
					table(
						'Origin certificates',
						[col('hosts', 'Covers', true), col('type', 'Key', true), col('until', 'Expires', true)],
						(certs ?? []).map((c) =>
							row(
								str(c['id']),
								arr(c['hostnames'])
									.map((h) => str(h))
									.join(', '),
								{
									hosts: arr(c['hostnames'])
										.map((h) => str(h))
										.join(', '),
									type: str(c['request_type']),
									until: when(str(c['expires_on'])),
								},
							),
						),
						certs
							? 'No origin certificates yet: the first server create makes one (key made on this Mac, kept in Infisical).'
							: 'Not readable with this key (it needs SSL and Certificates read).',
					),
				],
				actions: [action('Revoke a certificate', 'destroy', 'danger')],
			});
		},
		client: async (ctx) => {
			const z = await zoneOf(ctx);
			const c = (await cfAll(`/zones/${z.id}/client_certificates`, ctx.key)) ?? [];
			return view({
				tables: [
					table(
						'Client certificates (mTLS)',
						[col('cn', 'For', true), col('status', 'Status'), col('until', 'Expires', true)],
						c.map((x) =>
							row(str(x['id']), str(x['common_name']), {
								cn: str(x['common_name']),
								status: str(x['status']),
								until: when(str(x['expires_on'])),
							}),
						),
						'No client certificates: machines call the API with tokens, not certificates.',
					),
				],
			});
		},
		edit: hstsForm.read,
		monitor: trafficMonitor('ssl'),
		destroy: async (ctx) => {
			const z = await zoneOf(ctx);
			const certs = (await cfAll(`/certificates?zone_id=${z.id}`, ctx.key)) ?? [];
			const p = pick(
				'Certificate',
				certs.map((c) => ({
					value: str(c['id']),
					label: `${arr(c['hostnames'])
						.map((h) => str(h))
						.join(', ')} · until ${when(str(c['expires_on']))}`,
				})),
				ctx.id,
			);
			return formTab(
				form({
					key: 'destroy',
					title: 'Revoke an origin certificate',
					submit: 'Revoke certificate',
					danger: true,
					confirmName: p.value ? z.name : null,
					blocked: p.value ? null : 'No origin certificates.',
					notes: [
						note(
							'A server still presenting it gets errors 526 at once. Deploy its replacement first.',
							'red',
						),
					],
				}),
				p,
			);
		},
		history: async (ctx) => auditHistory(ctx, /ssl|certificate|tls/i),
	},
	forms: {
		mode: settingsForm('mode', 'Encryption mode', SSL_MODE),
		settings: settingsForm(
			'settings',
			'HTTPS settings',
			SSL_EDGE.filter((s) => s.id !== 'security_header'),
		),
		edit: hstsForm,
		destroy: {
			read: (ctx) => cfSslScreen.tabs['destroy']!(ctx),
			async send(ctx, w) {
				const k = await ctx.writeKey();
				const z = await zoneOf(ctx, k);
				confirmed(w, z.name);
				const id = w.id ?? ctx.id;
				if (!id) throw new VendorError('Choose a certificate.', 400);
				await cfSend('DELETE', `/certificates/${id}`, k);
				return { message: 'Origin certificate revoked', productId: null, follow: [] };
			},
		},
	},
};

/* ===== Security (WAF) ===== */

const PHASES = {
	custom: 'http_request_firewall_custom',
	rate: 'http_ratelimit',
	managed: 'http_request_firewall_managed',
} as const;
const ACTIONS = [
	option('block', 'Block'),
	option('managed_challenge', 'Managed challenge'),
	option('js_challenge', 'JS challenge'),
	option('challenge', 'Interactive challenge'),
	option('log', 'Log only (Enterprise)'),
	option('skip', 'Skip'),
];

async function wafRules(ctx: ProductCtx, z: Zone) {
	const [custom, rate] = await Promise.all([entrypoint(ctx, z, PHASES.custom), entrypoint(ctx, z, PHASES.rate)]);
	const tagged = (rs: Record<string, unknown> | null, phase: string): Record<string, unknown>[] =>
		rulesOf(rs).map((r) => ({ ...r, _rs: str(rs?.['id']), _phase: phase }));
	return [...tagged(custom, 'custom'), ...tagged(rate, 'rate')];
}

const wafCreate: ProductFormSpec = {
	read: async () =>
		formTab(
			form({
				key: 'create',
				title: 'New custom rule',
				submit: 'Create rule',
				fields: [
					...ruleFields(),
					field('action', 'Then', 'select', { value: 'managed_challenge', options: ACTIONS }),
				],
				notes: [note('Free plan: 5 custom rules. The expression is shown on the list after saving.', 'muted')],
			}),
		),
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const act = text(w, 'action');
		if (!ACTIONS.some((a) => a.value === act)) throw new VendorError('Choose an action.', 400);
		const rule = {
			description: text(w, 'description'),
			expression: expression(w),
			action: act,
			enabled: true,
			...(act === 'skip' ? { action_parameters: { ruleset: 'current' } } : {}),
		};
		await addRule(k, z, PHASES.custom, rule);
		return { message: `Rule “${rule.description}”: ${rule.expression} → ${act}`, productId: z.id, follow: [] };
	},
};

const wafEdit: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const rules = await wafRules(ctx, z);
		const p = pick(
			'Rule',
			rules.map((r) => ({ value: str(r['id']), label: `${str(r['description'])} (${str(r['_phase'])})` })),
			ctx.id,
		);
		const r = rules.find((x) => str(x['id']) === p.value);
		return formTab(
			form({
				key: 'edit',
				title: r ? `Edit ${str(r['description'])}` : 'Edit a rule',
				submit: 'Save rule',
				blocked: r ? null : 'No custom or rate-limiting rules yet.',
				fields: r
					? [
							field('description', 'Name', 'text', { value: str(r['description']) }),
							field('expression', 'Expression', 'textarea', { value: str(r['expression']) }),
							field('action', 'Then', 'select', { value: str(r['action']), options: ACTIONS }),
							field('enabled', 'On', 'toggle', { value: r['enabled'] !== false }),
						]
					: [],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const id = w.id ?? ctx.id;
		const r = (await wafRules({ ...ctx, key: k }, z)).find((x) => str(x['id']) === id);
		if (!r) throw new VendorError('Choose a rule.', 400);
		const act = text(w, 'action');
		if (!ACTIONS.some((a) => a.value === act) && act !== str(r['action']))
			throw new VendorError('Choose an action.', 400);
		await cfSend('PATCH', `/zones/${z.id}/rulesets/${str(r['_rs'])}/rules/${str(r['id'])}`, k, {
			description: text(w, 'description'),
			expression: expression(w),
			action: act,
			enabled: w.values['enabled'] === true,
			...(r['ratelimit'] ? { ratelimit: r['ratelimit'] } : {}),
			...(r['action_parameters'] ? { action_parameters: r['action_parameters'] } : {}),
		});
		return { message: `Rule “${text(w, 'description')}” saved`, productId: str(r['id']), follow: [] };
	},
};

const ruleDestroy = (phase: string, label: string): ProductFormSpec => ({
	async read(ctx) {
		const z = await zoneOf(ctx);
		const rs = await entrypoint(ctx, z, phase);
		const rules = rulesOf(rs);
		const p = pick(
			'Rule',
			rules.map((r) => ({ value: str(r['id']), label: str(r['description']) || str(r['id']) })),
			ctx.id,
		);
		const r = rules.find((x) => str(x['id']) === p.value);
		return formTab(
			form({
				key: 'destroy',
				title: `Delete a ${label}`,
				submit: 'Delete rule',
				danger: true,
				confirmName: r ? str(r['description']) || str(r['id']) : null,
				blocked: r ? null : `No ${label}s.`,
				notes: r ? [note(`When: ${str(r['expression'])}`, 'muted')] : [],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const rs = await entrypoint({ ...ctx, key: k }, z, phase, k);
		const r = rulesOf(rs).find((x) => str(x['id']) === (w.id ?? ctx.id));
		if (!r) throw new VendorError('Choose a rule.', 400);
		confirmed(w, str(r['description']) || str(r['id']));
		await cfSend('DELETE', `/zones/${z.id}/rulesets/${str(rs?.['id'])}/rules/${str(r['id'])}`, k);
		return { message: `${label} “${str(r['description'])}” deleted`, productId: null, follow: [] };
	},
});

export const cfWafScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		custom: async (ctx) => {
			const z = await zoneOf(ctx);
			const rules = rulesOf(await entrypoint(ctx, z, PHASES.custom));
			return view({
				stats: [stat('Custom rules', `${rules.length} of ${/free/i.test(z.plan) ? 5 : 20}`, z.plan)],
				tables: [rulesTable('Custom rules', rules, 'No custom rules.')],
				actions: [action('New custom rule', 'create', 'primary'), action('Edit a rule', 'edit')],
			});
		},
		create: wafCreate.read,
		rate: async (ctx) => {
			const z = await zoneOf(ctx);
			const rules = rulesOf(await entrypoint(ctx, z, PHASES.rate));
			return view({
				stats: [stat('Rate-limiting rules', `${rules.length} of ${/free/i.test(z.plan) ? 1 : 2}`, z.plan)],
				tables: [
					table(
						'Rate limits',
						[
							col('name', 'Rule'),
							col('expr', 'When', true),
							col('limit', 'Limit', true),
							col('action', 'Then'),
						],
						rules.map((r) => {
							const l = rec(r['ratelimit']);
							return row(str(r['id']), str(r['description']), {
								name: str(r['description']),
								expr: str(r['expression']).slice(0, 100),
								limit: `${num(l['requests_per_period'])} per ${num(l['period'])} s for ${num(l['mitigation_timeout'])} s`,
								action: str(r['action']),
							});
						}),
						'No rate-limiting rules. Free allows one: on the login and OTP paths, 10 seconds.',
					),
				],
				actions: [action('Add a rate limit', 'rate', 'primary')],
			});
		},
		managed: async (ctx) => {
			const z = await zoneOf(ctx);
			const rules = rulesOf(await entrypoint(ctx, z, PHASES.managed));
			return view({
				tables: [
					table(
						'Managed rulesets deployed',
						[col('name', 'Ruleset'), col('on', 'On')],
						rules.map((r) =>
							row(str(r['id']), str(r['description']), {
								name: str(r['description']) || str(rec(r['action_parameters'])['id']),
								on: r['enabled'] === false ? 'off' : 'on',
							}),
						),
						'Only the Free Managed Ruleset (always on). Cloudflare Managed and OWASP need Pro.',
					),
				],
			});
		},
		tools: async (ctx) => {
			const z = await zoneOf(ctx);
			const [ip, ua, lock] = await Promise.all([
				cfAll(`/zones/${z.id}/firewall/access_rules/rules`, ctx.key),
				cfAll(`/zones/${z.id}/firewall/ua_rules`, ctx.key),
				cfAll(`/zones/${z.id}/firewall/lockdowns`, ctx.key),
			]);
			return view({
				tables: [
					table(
						'IP access rules',
						[col('what', 'Address or country', true), col('mode', 'Action'), col('why', 'Note')],
						(ip ?? []).map((r) =>
							row(str(r['id']), str(rec(r['configuration'])['value']), {
								what: str(rec(r['configuration'])['value']),
								mode: str(r['mode']),
								why: str(r['notes']),
							}),
						),
						'No IP access rules.',
					),
					table(
						'User-agent blocking',
						[col('ua', 'User agent', true), col('mode', 'Action')],
						(ua ?? []).map((r) =>
							row(str(r['id']), str(rec(r['configuration'])['value']), {
								ua: str(rec(r['configuration'])['value']),
								mode: str(r['mode']),
							}),
						),
						'No user-agent rules.',
					),
					table(
						'Zone lockdown',
						[col('urls', 'Paths', true), col('ips', 'Allowed', true)],
						(lock ?? []).map((r) =>
							row(str(r['id']), str(r['description']), {
								urls: arr(r['urls'])
									.map((u) => str(u))
									.join(', '),
								ips: arr(r['configurations'])
									.map((c) => str(rec(c)['value']))
									.join(', '),
							}),
						),
						'No lockdowns (Pro).',
					),
				],
				actions: [action('Block an address', 'block-ip', 'primary')],
			});
		},
		edit: wafEdit.read,
		monitor: async (ctx) => {
			const z = await zoneOf(ctx);
			const rows = await traffic(ctx, z);
			return rows
				? monitorTab(
						[
							seriesOf(rows, 'Threats stopped', '', (r) => r.threats),
							seriesOf(rows, 'Requests', '', (r) => r.requests),
						],
						[
							note(
								'Blocked versus challenged per rule needs Security Events, which keep 24 hours on Free; the totals above come from traffic analytics.',
								'muted',
							),
						],
						null,
					)
				: monitorTab([], [noAnalytics], null);
		},
		destroy: ruleDestroy(PHASES.custom, 'custom rule').read,
		history: async (ctx) => auditHistory(ctx, /ruleset|firewall|waf|rule/i),
	},
	forms: {
		create: wafCreate,
		edit: wafEdit,
		destroy: ruleDestroy(PHASES.custom, 'custom rule'),
		rate: {
			read: async () =>
				formTab(
					form({
						key: 'rate',
						title: 'Add a rate limit',
						submit: 'Add rate limit',
						fields: [
							field('description', 'Name', 'text', { value: 'Sign-in and OTP', required: true }),
							field('path', 'Path starts with', 'text', { value: '/api/auth/' }),
							field('requests', 'Requests', 'number', { value: 20, min: 1, max: 10_000 }),
							field('action', 'Then', 'select', { value: 'block', options: ACTIONS.slice(0, 4) }),
						],
						notes: [note('Free plan: counted per IP over 10 seconds, blocked for 10 seconds.', 'muted')],
					}),
				),
			async send(ctx, w) {
				const k = await ctx.writeKey();
				const z = await zoneOf(ctx, k);
				const path = text(w, 'path');
				if (!path.startsWith('/')) throw new VendorError('A path starting with /.', 400);
				const free = /free/i.test(z.plan);
				await addRule(k, z, PHASES.rate, {
					description: text(w, 'description'),
					expression: `(starts_with(http.request.uri.path, ${JSON.stringify(path)}))`,
					action: text(w, 'action'),
					enabled: true,
					ratelimit: {
						characteristics: ['ip.src', 'cf.colo.id'],
						period: 10,
						requests_per_period: int(w, 'requests', 1, 10_000),
						mitigation_timeout: free ? 10 : 60,
					},
				});
				return {
					message: `Rate limit on ${path}: ${text(w, 'requests')} per 10 s`,
					productId: z.id,
					follow: [],
				};
			},
		},
		'block-ip': {
			read: async () =>
				formTab(
					form({
						key: 'block-ip',
						title: 'Block an address or country',
						submit: 'Add rule',
						fields: [
							field('target', 'Kind', 'select', {
								value: 'ip',
								options: [
									option('ip', 'IP address'),
									option('ip_range', 'IP range'),
									option('country', 'Country (two letters)'),
									option('asn', 'Network (ASN)'),
								],
							}),
							field('value', 'Value', 'text', { required: true }),
							field('mode', 'Action', 'select', {
								value: 'block',
								options: [
									option('block', 'Block'),
									option('managed_challenge', 'Managed challenge'),
									option('whitelist', 'Allow'),
								],
							}),
							field('notes', 'Why', 'text', { value: '' }),
						],
					}),
				),
			async send(ctx, w) {
				const k = await ctx.writeKey();
				const z = await zoneOf(ctx, k);
				await cfSend('POST', `/zones/${z.id}/firewall/access_rules/rules`, k, {
					mode: text(w, 'mode'),
					configuration: { target: text(w, 'target'), value: text(w, 'value') },
					notes: text(w, 'notes', false),
				});
				return { message: `${text(w, 'mode')} ${text(w, 'value')}`, productId: z.id, follow: [] };
			},
		},
	},
};

/* ===== Security settings (bots and DDoS) ===== */

const DDOS: SettingSpec[] = [
	{
		id: 'security_level',
		label: 'Security level',
		options: [
			['essentially_off', 'Essentially off'],
			['low', 'Low'],
			['medium', 'Medium'],
			['high', 'High'],
			['under_attack', 'I’m under attack'],
		],
	},
	{
		id: 'challenge_ttl',
		label: 'Challenge passage',
		options: [
			['1800', '30 min'],
			['3600', '1 hour'],
			['14400', '4 hours'],
			['86400', '1 day'],
		],
	},
	{ id: 'browser_check', label: 'Browser integrity check' },
	{ id: 'email_obfuscation', label: 'Email address obfuscation' },
	{ id: 'hotlink_protection', label: 'Hotlink protection' },
	{ id: 'server_side_exclude', label: 'Server-side excludes' },
	{ id: 'replace_insecure_js', label: 'Replace insecure JavaScript libraries' },
	{ id: 'privacy_pass', label: 'Privacy Pass support' },
];

export const cfBotsScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		bots: async (ctx) => {
			const z = await zoneOf(ctx);
			const b = rec(await cfSoft(`/zones/${z.id}/bot_management`, ctx.key));
			return view({
				head: { name: z.name, status: z.plan, tone: 'cy' },
				facts: [
					fact(
						'Bot Fight Mode',
						b['fight_mode'] === true ? 'on' : 'off',
						b['fight_mode'] === true ? 'ok' : 'amber',
					),
					fact('Block AI crawlers', str(b['ai_bots_protection']) || '—'),
					fact('Managed robots.txt', b['is_robots_txt_managed'] === true ? 'on' : 'off'),
					fact(
						'Super Bot Fight Mode',
						/free/i.test(z.plan) ? 'needs Pro' : str(b['sbfm_likely_automated']) || 'off',
					),
					fact('JavaScript detections', b['enable_js'] === true ? 'on' : 'off'),
				],
				actions: [action('Change bot settings', 'bots', 'primary')],
			});
		},
		ddos: async (ctx) => {
			const z = await zoneOf(ctx);
			const widgets = (await cfAll(`/accounts/${z.account}/challenges/widgets`, ctx.key)) ?? [];
			const v = await settingsView(ctx, 'DDoS and challenges', DDOS, {
				tables: [
					table(
						'Turnstile widgets',
						[col('name', 'Widget'), col('domains', 'Domains', true), col('mode', 'Mode')],
						widgets.map((x) =>
							row(str(x['sitekey']), str(x['name']), {
								name: str(x['name']),
								domains: arr(x['domains'])
									.map((d) => str(d))
									.join(', '),
								mode: str(x['mode']),
							}),
						),
						'No Turnstile widgets.',
					),
				],
				notes: [note('DDoS protection is always on, on every plan; these settings tune challenges.', 'muted')],
			});
			v.view.actions = [action('Change these settings', 'ddos')];
			return v;
		},
		edit: async (ctx) => {
			const z = await zoneOf(ctx);
			return formTab(
				form({
					key: 'edit',
					title: 'Super Bot Fight Mode',
					submit: 'Save',
					blocked: /free/i.test(z.plan)
						? 'Super Bot Fight Mode classes need Pro. On Free, Bot Fight Mode is on the Bots tab.'
						: null,
				}),
			);
		},
		monitor: async () =>
			monitorTab(
				[],
				[
					note(
						'Bot analytics (likely automated, verified bots) need Pro or Bot Management; Free does not publish them.',
						'muted',
					),
				],
				null,
			),
		history: async (ctx) => auditHistory(ctx, /bot|security/i),
	},
	forms: {
		ddos: settingsForm('ddos', 'DDoS and challenges', DDOS),
		bots: {
			async read(ctx) {
				const z = await zoneOf(ctx);
				const b = rec(await cfSoft(`/zones/${z.id}/bot_management`, ctx.key));
				return formTab(
					form({
						key: 'bots',
						title: 'Bot settings',
						submit: 'Save bot settings',
						fields: [
							field('fight_mode', 'Bot Fight Mode', 'toggle', {
								value: b['fight_mode'] === true,
								help: 'Challenges known bad bots. Can upset payment webhooks: the console’s rule skips /api/webhooks.',
							}),
							field('ai', 'Block AI crawlers', 'select', {
								value: str(b['ai_bots_protection']) || 'disabled',
								options: [option('block', 'Block'), option('disabled', 'Allow')],
							}),
							field('robots', 'Managed robots.txt', 'toggle', {
								value: b['is_robots_txt_managed'] === true,
							}),
						],
					}),
				);
			},
			async send(ctx, w) {
				const k = await ctx.writeKey();
				const z = await zoneOf(ctx, k);
				const ai = text(w, 'ai');
				if (!['block', 'disabled'].includes(ai)) throw new VendorError('Choose block or allow.', 400);
				await cfSend('PUT', `/zones/${z.id}/bot_management`, k, {
					fight_mode: w.values['fight_mode'] === true,
					ai_bots_protection: ai,
					is_robots_txt_managed: w.values['robots'] === true,
				});
				return {
					message: `Bot Fight Mode ${w.values['fight_mode'] === true ? 'on' : 'off'}, AI crawlers ${ai === 'block' ? 'blocked' : 'allowed'}`,
					productId: z.id,
					follow: [],
				};
			},
		},
	},
};

/* ===== Speed, Caching, Network ===== */

const SPEED: SettingSpec[] = [
	{ id: 'early_hints', label: 'Early Hints' },
	{ id: 'http3', label: 'HTTP/3 (QUIC)' },
	{ id: '0rtt', label: '0-RTT connection resumption' },
	{
		id: 'rocket_loader',
		label: 'Rocket Loader',
		help: 'Off: it rewrites script loading and can break the Angular app.',
	},
	{ id: 'speed_brain', label: 'Speed Brain (prefetch)' },
	{ id: 'polish', label: 'Polish (image compression)', plan: 'Pro' },
	{ id: 'mirage', label: 'Mirage (retired)', plan: 'retired by Cloudflare' },
	{ id: 'brotli', label: 'Brotli compression' },
];
const CACHE: SettingSpec[] = [
	{
		id: 'cache_level',
		label: 'Caching level',
		options: [
			['basic', 'No query string'],
			['simplified', 'Ignore query string'],
			['aggressive', 'Standard'],
		],
	},
	{
		id: 'browser_cache_ttl',
		label: 'Browser cache TTL',
		options: [
			['0', 'Respect the server'],
			['1800', '30 min'],
			['14400', '4 hours'],
			['86400', '1 day'],
		],
	},
	{ id: 'always_online', label: 'Always Online' },
	{ id: 'development_mode', label: 'Development mode' },
	{
		id: 'edge_cache_ttl',
		label: 'Edge cache TTL',
		options: [
			['7200', '2 hours'],
			['10800', '3 hours'],
			['14400', '4 hours'],
			['28800', '8 hours'],
			['43200', '12 hours'],
			['86400', '1 day'],
			['172800', '2 days'],
			['604800', '1 week'],
			['1209600', '2 weeks'],
			['2678400', '1 month'],
		],
	},
];
const NETWORK: SettingSpec[] = [
	{ id: 'ipv6', label: 'IPv6 compatibility' },
	{ id: 'websockets', label: 'WebSockets' },
	{ id: 'opportunistic_onion', label: 'Onion routing' },
	{ id: 'ip_geolocation', label: 'IP geolocation header' },
	{
		id: 'pseudo_ipv4',
		label: 'Pseudo IPv4',
		options: [
			['off', 'Off'],
			['add_header', 'Add header'],
			['overwrite_header', 'Overwrite headers'],
		],
	},
	{ id: 'max_upload', label: 'Maximum upload size', plan: 'a paid plan (Free is 100 MB)' },
	{ id: 'orange_to_orange', label: 'Orange-to-orange (O2O)' },
	{ id: 'visitor_ip', label: 'Visitor IP to the server' },
];

const settingsHistory = (specs: SettingSpec[]) => async (ctx: ProductCtx) => {
	const z = await zoneOf(ctx);
	const all = await settingsOf(ctx, z);
	const rows = specs
		.map((s) => ({ s, v: all.get(s.id) }))
		.filter((x) => x.v && str(x.v['modified_on']))
		.sort((a, b) => str(b.v?.['modified_on']).localeCompare(str(a.v?.['modified_on'])));
	return view({
		tables: [
			table(
				'Last change of each setting',
				[col('at', 'When', true), col('what', 'Setting'), col('now', 'Now', true)],
				rows.map(({ s, v }) =>
					row(s.id, s.label, {
						at: when(str(v?.['modified_on'])),
						what: s.label,
						now: typeof v?.['value'] === 'object' ? 'set' : String(v?.['value']),
					}),
				),
				'No setting changed since the domain was added.',
			),
		],
	});
};

export const cfSpeedScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		settings: async (ctx) => {
			const v = await settingsView(ctx, 'Speed settings', SPEED);
			v.view.actions = [action('Change speed settings', 'settings')];
			return v;
		},
		observatory: async (ctx) => {
			const z = await zoneOf(ctx);
			const pages = (await cfAll(`/zones/${z.id}/speed_api/pages`, ctx.key)) ?? [];
			return view({
				tables: [
					table(
						'Pages tested by Observatory',
						[col('url', 'Page', true), col('score', 'Last score', true), col('region', 'From', true)],
						pages.map((p) =>
							row(str(p['url']), str(p['url']), {
								url: str(p['url']),
								score: num(rec(rec(p['tests'] ?? rec(p['latest'])))['performanceScore']) || '—',
								region: str(rec(p['region'])['value']),
							}),
						),
						'No Observatory tests. The shop’s own Lighthouse runs are on Watch › Shopper experience.',
					),
				],
			});
		},
		edit: async (ctx) => {
			const z = await zoneOf(ctx);
			return formTab(
				form({
					key: 'edit',
					title: 'Polish',
					submit: 'Save',
					blocked: /free/i.test(z.plan)
						? 'Polish needs Pro. Photos are already resized and converted to AVIF/WebP by the media pipeline.'
						: null,
				}),
			);
		},
		monitor: async () =>
			monitorTab(
				[],
				[
					note(
						'Real-visitor LCP, CLS and INP come from Cloudflare Web Analytics or the shop’s own RUM (Watch › Shopper experience).',
						'muted',
					),
				],
				null,
			),
		history: settingsHistory(SPEED),
	},
	forms: { settings: settingsForm('settings', 'Speed settings', SPEED) },
};

const purge: ProductFormSpec = {
	read: async (ctx) => {
		const z = await zoneOf(ctx);
		return formTab(
			form({
				key: 'op',
				title: 'Purge the cache',
				submit: 'Purge',
				fields: [
					field('what', 'What', 'cards', {
						value: 'files',
						options: [
							option('files', 'These addresses', 'Full URLs, one per line.'),
							option('prefixes', 'Everything under a path', `Like ${z.name}/en/sarees/`),
							option(
								'everything',
								'Everything',
								'The whole domain; the next visitors are slower while it refills.',
							),
						],
					}),
					field('list', 'Addresses or paths', 'textarea', { value: `https://${z.name}/` }),
				],
				notes: [note('Purging never deletes anything at the server; Cloudflare fetches it again.', 'muted')],
			}),
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const what = text(w, 'what');
		const items = list(w, 'list');
		const body =
			what === 'everything'
				? { purge_everything: true }
				: what === 'prefixes'
					? { prefixes: items.map((p) => p.replace(/^https?:\/\//, '')) }
					: { files: items };
		if (what !== 'everything' && !items.length) throw new VendorError('List at least one address or path.', 400);
		await cfSend('POST', `/zones/${z.id}/purge_cache`, k, body);
		return {
			message:
				what === 'everything'
					? `Purged everything on ${z.name}`
					: `Purged ${items.length} ${what === 'prefixes' ? 'paths' : 'addresses'}`,
			productId: z.id,
			follow: [],
		};
	},
};

const cacheRuleCreate: ProductFormSpec = {
	read: async () =>
		formTab(
			form({
				key: 'create',
				title: 'New cache rule',
				submit: 'Create cache rule',
				fields: [
					...ruleFields(),
					field('cache', 'Cache it', 'toggle', { value: true }),
					field('ttl', 'Edge TTL (seconds, 0 = respect the server)', 'number', {
						value: 0,
						min: 0,
						max: 31_536_000,
					}),
				],
			}),
		),
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const ttl = int(w, 'ttl', 0, 31_536_000);
		await addRule(k, z, 'http_request_cache_settings', {
			description: text(w, 'description'),
			expression: expression(w),
			action: 'set_cache_settings',
			enabled: true,
			action_parameters: {
				cache: w.values['cache'] === true,
				...(ttl ? { edge_ttl: { mode: 'override_origin', default: ttl } } : {}),
			},
		});
		return { message: `Cache rule “${text(w, 'description')}” created`, productId: z.id, follow: [] };
	},
};

export const cfCacheScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		config: async (ctx) => {
			const z = await zoneOf(ctx);
			const tiered = rec(await cfSoft(`/zones/${z.id}/argo/tiered_caching`, ctx.key));
			const v = await settingsView(ctx, 'Caching configuration', CACHE, {
				facts: [
					fact('Tiered cache', str(tiered['value']) || '—'),
					fact('Cache Reserve', /free/i.test(z.plan) ? 'needs a paid add-on' : '—'),
				],
			});
			v.view.actions = [action('Purge', 'op', 'primary'), action('Change caching settings', 'settings')];
			return v;
		},
		rules: async (ctx) => {
			const z = await zoneOf(ctx);
			return view({
				tables: [
					rulesTable(
						'Cache rules',
						rulesOf(await entrypoint(ctx, z, 'http_request_cache_settings')),
						'No cache rules: Cloudflare caches static files by extension; the shop’s pages follow the server’s Cache-Control.',
					),
				],
				actions: [action('New cache rule', 'create', 'primary')],
			});
		},
		edit: async (ctx) => cacheRuleCreate.read(ctx),
		monitor: trafficMonitor('cache'),
		op: purge.read,
		destroy: ruleDestroy('http_request_cache_settings', 'cache rule').read,
		history: async (ctx) => auditHistory(ctx, /cache|purge/i),
	},
	forms: {
		op: purge,
		create: cacheRuleCreate,
		edit: cacheRuleCreate,
		settings: settingsForm('settings', 'Caching settings', CACHE),
		destroy: ruleDestroy('http_request_cache_settings', 'cache rule'),
	},
};

export const cfNetworkScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		settings: async (ctx) => {
			const v = await settingsView(ctx, 'Network', NETWORK);
			v.view.actions = [action('Change network settings', 'settings')];
			return v;
		},
		history: settingsHistory(NETWORK),
	},
	forms: { settings: settingsForm('settings', 'Network settings', NETWORK) },
};

/* ===== Rules (redirects and every ruleset) ===== */

const redirectCreate: ProductFormSpec = {
	read: async () =>
		formTab(
			form({
				key: 'create',
				title: 'New redirect rule',
				submit: 'Create redirect',
				fields: [
					field('description', 'Name', 'text', { required: true }),
					field('from', 'When the path is', 'text', { required: true, help: 'Like /old-sarees' }),
					field('to', 'Send to', 'text', {
						required: true,
						help: 'A full URL like https://sahatextile.com/en/sarees',
					}),
					field('status', 'Status code', 'select', {
						value: '301',
						options: [
							option('301', '301 moved permanently'),
							option('302', '302 found (temporary)'),
							option('307', '307'),
							option('308', '308'),
						],
					}),
					field('query', 'Keep the query string', 'toggle', { value: true }),
				],
			}),
		),
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const from = text(w, 'from');
		const to = text(w, 'to');
		if (!from.startsWith('/')) throw new VendorError('A path starting with /.', 400);
		if (!/^https:\/\//.test(to)) throw new VendorError('Send to: a full https:// address.', 400);
		await addRule(k, z, 'http_request_dynamic_redirect', {
			description: text(w, 'description'),
			expression: `(http.request.uri.path eq ${JSON.stringify(from)})`,
			action: 'redirect',
			enabled: true,
			action_parameters: {
				from_value: {
					status_code: int(w, 'status', 301, 308),
					target_url: { value: to },
					preserve_query_string: w.values['query'] === true,
				},
			},
		});
		return { message: `Redirect ${from} → ${to}`, productId: z.id, follow: [] };
	},
};

export const cfRulesScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		overview: async (ctx) => {
			const z = await zoneOf(ctx);
			const [sets, older] = await Promise.all([
				cfAll(`/zones/${z.id}/rulesets`, ctx.key),
				// Cloudflare's Page Rules API refuses account-owned tokens (the console's kind) outright.
				cfAll(`/zones/${z.id}/pagerules`, ctx.consoleKey('CONSOLE_CF_USER_TOKEN') ?? ctx.key).catch(
					(err: unknown) => {
						if (err instanceof VendorError && /account owned tokens/i.test(err.message))
							return 'refused' as const;
						throw err;
					},
				),
			]);
			const pagerules = older === 'refused' ? null : older;
			const zoneSets = (sets ?? []).filter((s) => str(s['kind']) === 'zone');
			const counts = await Promise.all(
				zoneSets.map(async (s) => ({
					s,
					n: rulesOf(rec(await cfSoft(`/zones/${z.id}/rulesets/${str(s['id'])}`, ctx.key))).length,
				})),
			);
			return view({
				stats: [
					stat(
						'Rules in use',
						counts.reduce((a, c) => a + c.n, 0) + (pagerules ?? []).length,
						`${/free/i.test(z.plan) ? 70 : 225} allowed on ${z.plan}`,
					),
				],
				tables: [
					table(
						'Every rule type in use',
						[col('phase', 'Kind', true), col('n', 'Rules', true), col('at', 'Changed', true)],
						counts.map(({ s, n }) =>
							row(str(s['id']), str(s['phase']), {
								phase: str(s['phase'])
									.replace(/^http_/, '')
									.replace(/_/g, ' '),
								n,
								at: when(str(s['last_updated'])),
							}),
						),
						'No rules yet.',
					),
					rulesTable(
						'Redirect rules',
						rulesOf(await entrypoint(ctx, z, 'http_request_dynamic_redirect')),
						'No redirect rules.',
					),
					...(await ruleKindTables(ctx, z)),
					table(
						'Page rules (older kind)',
						[col('targets', 'URL', true), col('actions', 'Does'), col('status', 'On')],
						(pagerules ?? []).map((p) =>
							row(str(p['id']), str(p['id']), {
								targets: arr(p['targets'])
									.map((t) => str(rec(rec(t)['constraint'])['value']))
									.join(', '),
								actions: arr(p['actions'])
									.map((a) => str(rec(a)['id']))
									.join(', '),
								status: str(p['status']),
							}),
						),
						older === 'refused'
							? 'Not readable with the console’s account token (see the note).'
							: 'No page rules.',
					),
				],
				notes:
					older === 'refused'
						? [
								note(
									'Page rules (the older kind) are not shown: Cloudflare’s Page Rules API does not accept account tokens. Add the personal token CONSOLE_CF_USER_TOKEN to see and change them here, on the Page Rules tab.',
									'muted',
								),
							]
						: [],
				actions: [action('New redirect rule', 'create', 'primary'), action('Upload bulk redirects', 'op')],
			});
		},
		create: redirectCreate.read,
		edit: async (ctx) => {
			const z = await zoneOf(ctx);
			const rules = rulesOf(await entrypoint(ctx, z, 'http_request_dynamic_redirect'));
			const p = pick(
				'Redirect',
				rules.map((r) => ({ value: str(r['id']), label: str(r['description']) })),
				ctx.id,
			);
			const r = rules.find((x) => str(x['id']) === p.value);
			const target = rec(rec(rec(r?.['action_parameters'])['from_value'])['target_url']);
			return formTab(
				form({
					key: 'edit',
					title: r ? `Edit ${str(r['description'])}` : 'Edit a redirect',
					submit: 'Save redirect',
					blocked: r ? null : 'No redirect rules.',
					fields: r
						? [
								field('description', 'Name', 'text', { value: str(r['description']) }),
								field('expression', 'When', 'textarea', { value: str(r['expression']) }),
								field('to', 'Send to', 'text', { value: str(target['value']) }),
								field('enabled', 'On', 'toggle', { value: r['enabled'] !== false }),
							]
						: [],
				}),
				p,
			);
		},
		monitor: async () =>
			monitorTab(
				[],
				[
					note(
						'Redirect counts per rule need Security Events or Logpush (paid); the totals are on Analytics.',
						'muted',
					),
				],
				null,
			),
		op: async () =>
			formTab(
				form({
					key: 'op',
					title: 'Upload bulk redirects',
					submit: 'Upload',
					fields: [
						field('list', 'List name', 'text', {
							value: 'shop_redirects',
							help: 'An account-level redirect list; made when missing.',
						}),
						field('rows', 'Redirects', 'textarea', {
							help: 'One per line: from-URL, to-URL, status. Like sahatextile.com/old, https://sahatextile.com/new, 301',
						}),
					],
					notes: [note('Free: 10,000 bulk redirects across the account.', 'muted')],
				}),
			),
		history: async (ctx) =>
			auditHistory(ctx, /ruleset|rule|redirect|page_rule|snippet|managed_headers|url_normalization/i),
		...moreRules.tabs,
	},
	forms: {
		create: redirectCreate,
		...moreRules.forms,
		edit: {
			read: (ctx) => cfRulesScreen.tabs['edit']!(ctx),
			async send(ctx, w) {
				const k = await ctx.writeKey();
				const z = await zoneOf(ctx, k);
				const rs = await entrypoint({ ...ctx, key: k }, z, 'http_request_dynamic_redirect', k);
				const r = rulesOf(rs).find((x) => str(x['id']) === (w.id ?? ctx.id));
				if (!r) throw new VendorError('Choose a redirect.', 400);
				const to = text(w, 'to');
				if (!/^https:\/\//.test(to)) throw new VendorError('Send to: a full https:// address.', 400);
				const params = structuredClone(rec(r['action_parameters']));
				rec(rec(params['from_value'])['target_url'])['value'] = to;
				await cfSend('PATCH', `/zones/${z.id}/rulesets/${str(rs?.['id'])}/rules/${str(r['id'])}`, k, {
					description: text(w, 'description'),
					expression: expression(w),
					action: 'redirect',
					enabled: w.values['enabled'] === true,
					action_parameters: params,
				});
				return { message: `Redirect “${text(w, 'description')}” saved`, productId: str(r['id']), follow: [] };
			},
		},
		op: {
			read: (ctx) => cfRulesScreen.tabs['op']!(ctx),
			async send(ctx, w) {
				const k = await ctx.writeKey();
				const z = await zoneOf(ctx, k);
				const name = text(w, 'list');
				if (!/^[a-z0-9_]{1,50}$/.test(name))
					throw new VendorError('List name: lowercase letters, digits and _.', 400);
				const rows = text(w, 'rows')
					.split('\n')
					.map((l) => l.split(',').map((x) => x.trim()))
					.filter((r) => r[0]);
				const items = rows.map((r) => {
					// Empty lines were dropped above, so every row has its first part.
					const [from, to, status] = r as [string, string?, string?];
					if (!to || !/^https:\/\//.test(to))
						throw new VendorError(`Each line: from, https://to, status (${from}).`, 400);
					return {
						redirect: {
							source_url: from.replace(/^https?:\/\//, ''),
							target_url: to,
							status_code: Number(status) || 301,
							preserve_query_string: true,
						},
					};
				});
				if (!items.length) throw new VendorError('No redirects given.', 400);
				const lists = (await cfAll(`/accounts/${z.account}/rules/lists`, k, false)) ?? [];
				let id = str(lists.find((l) => str(l['name']) === name)?.['id']);
				if (!id)
					id = str(
						rec(
							await cfSend('POST', `/accounts/${z.account}/rules/lists`, k, {
								name,
								kind: 'redirect',
								description: 'Made by the Release Console',
							}),
						)['id'],
					);
				await cfSend('POST', `/accounts/${z.account}/rules/lists/${id}/items`, k, items);
				return { message: `${items.length} redirects added to ${name}`, productId: id, follow: [] };
			},
		},
	},
};

/* ===== Error pages ===== */

export const cfErrorScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		list: async (ctx) => {
			const z = await zoneOf(ctx);
			const pages = (await cfAll(`/zones/${z.id}/custom_pages`, ctx.key)) ?? [];
			return view({
				tables: [
					table(
						'Custom error pages',
						[
							col('id', 'Page', true),
							col('what', 'Shown for'),
							col('state', 'Now'),
							col('url', 'From', true),
						],
						pages.map((p) =>
							row(
								str(p['id']),
								str(p['id']),
								{
									id: str(p['id']),
									what: str(p['description']),
									state: str(p['state']),
									url: str(p['url']) || 'Cloudflare’s default',
								},
								str(p['state']) === 'customized' ? 'ok' : null,
							),
						),
						'Custom error pages are not readable with this key.',
					),
				],
				actions: [action('Set a page', 'edit', 'primary')],
			});
		},
		edit: async (ctx) => {
			const z = await zoneOf(ctx);
			const pages = (await cfAll(`/zones/${z.id}/custom_pages`, ctx.key)) ?? [];
			const p = pick(
				'Page',
				pages.map((x) => ({ value: str(x['id']), label: `${str(x['id'])} · ${str(x['description'])}` })),
				ctx.id,
			);
			return formTab(
				form({
					key: 'edit',
					title: 'Set an error page',
					submit: 'Save page',
					blocked: pages.length ? null : 'Not readable with this key.',
					fields: [
						field('url', 'Page address', 'text', {
							value: str(pages.find((x) => str(x['id']) === p.value)?.['url']),
							help: 'A public https page containing ::CLOUDFLARE_ERROR_500S_BOX:: (or the box for this page).',
						}),
					],
				}),
				p,
			);
		},
		destroy: async (ctx) => {
			const z = await zoneOf(ctx);
			const pages = ((await cfAll(`/zones/${z.id}/custom_pages`, ctx.key)) ?? []).filter(
				(x) => str(x['state']) === 'customized',
			);
			const p = pick(
				'Page',
				pages.map((x) => ({ value: str(x['id']), label: str(x['id']) })),
				ctx.id,
			);
			return formTab(
				form({
					key: 'destroy',
					title: 'Reset to Cloudflare’s default',
					submit: 'Reset page',
					danger: true,
					confirmName: p.value,
					blocked: p.value ? null : 'No customised pages.',
				}),
				p,
			);
		},
		history: async (ctx) => {
			const z = await zoneOf(ctx);
			const pages = (await cfAll(`/zones/${z.id}/custom_pages`, ctx.key)) ?? [];
			return view({
				tables: [
					table(
						'Last change of each page',
						[col('at', 'When', true), col('id', 'Page', true), col('state', 'Now')],
						pages
							.filter((p) => str(p['modified_on']))
							.map((p) =>
								row(str(p['id']), str(p['id']), {
									at: when(str(p['modified_on'])),
									id: str(p['id']),
									state: str(p['state']),
								}),
							),
						'No page changed.',
					),
				],
			});
		},
	},
	forms: {
		edit: {
			read: (ctx) => cfErrorScreen.tabs['edit']!(ctx),
			async send(ctx, w) {
				const k = await ctx.writeKey();
				const z = await zoneOf(ctx, k);
				const id = w.id ?? ctx.id;
				const url = text(w, 'url');
				if (!id) throw new VendorError('Choose a page.', 400);
				if (!/^https:\/\//.test(url)) throw new VendorError('A public https:// address.', 400);
				await cfSend('PUT', `/zones/${z.id}/custom_pages/${id}`, k, { url, state: 'customized' });
				return { message: `${id} now from ${url}`, productId: id, follow: [] };
			},
		},
		destroy: {
			read: (ctx) => cfErrorScreen.tabs['destroy']!(ctx),
			async send(ctx, w) {
				const k = await ctx.writeKey();
				const z = await zoneOf(ctx, k);
				const id = w.id ?? ctx.id;
				if (!id) throw new VendorError('Choose a page.', 400);
				confirmed(w, id);
				await cfSend('PUT', `/zones/${z.id}/custom_pages/${id}`, k, { url: '', state: 'default' });
				return { message: `${id} reset to Cloudflare’s default`, productId: id, follow: [] };
			},
		},
	},
};

/* ===== Traffic, Workers routes, Web3, Access (zone lists) ===== */

export const cfTrafficScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		settings: async (ctx) => {
			const z = await zoneOf(ctx);
			const [argo, lbs, rooms, has] = await Promise.all([
				cfSoft(`/zones/${z.id}/argo/smart_routing`, ctx.key),
				cfAll(`/zones/${z.id}/load_balancers`, ctx.key),
				cfAll(`/zones/${z.id}/waiting_rooms`, ctx.key),
				cfFeatures(ctx),
			]);
			// Plan locks read live: a note only for what the account does not have yet (owner, 23 Nov).
			const missing = [
				...(has['cf.argo'] ? [] : ['Argo Smart Routing (paid add-on)']),
				...(has['cf.lb'] ? [] : ['Load Balancing (paid add-on)']),
				...(has['cf.waiting_room'] ? [] : ['waiting rooms (Business plan)']),
			];
			return view({
				facts: [
					fact('Argo Smart Routing', has['cf.argo'] ? str(rec(argo)['value']) || 'off' : 'needs the add-on'),
					fact('Load balancers', has['cf.lb'] ? (lbs ?? []).length : 'needs the add-on'),
					fact('Waiting rooms', has['cf.waiting_room'] ? (rooms ?? []).length : 'needs Business'),
				],
				notes: missing.length
					? [
							note(
								`Not on this account yet: ${missing.join(', ')}. Buying them is on Cloudflare; this tab opens their controls once they are on.`,
								'muted',
							),
						]
					: [],
				actions: has['cf.argo'] ? [action('Argo on or off', 'argo')] : [],
			});
		},
		lb: async (ctx) => {
			const z = await zoneOf(ctx);
			const lbs = (await cfAll(`/zones/${z.id}/load_balancers`, ctx.key)) ?? [];
			return view({
				tables: [
					table(
						'Load balancers',
						[col('name', 'Hostname', true), col('pools', 'Pools'), col('on', 'On')],
						lbs.map((l) =>
							row(str(l['id']), str(l['name']), {
								name: str(l['name']),
								pools: arr(l['default_pools']).length,
								on: l['enabled'] === true ? 'on' : 'off',
							}),
						),
						'No load balancers (paid add-on).',
					),
				],
			});
		},
		monitor: async (ctx) => {
			const z = await zoneOf(ctx);
			const hc = (await cfAll(`/zones/${z.id}/healthchecks`, ctx.key)) ?? [];
			return view({
				tables: [
					table(
						'Health checks',
						[col('name', 'Check'), col('addr', 'Address', true), col('status', 'Status')],
						hc.map((h) =>
							row(
								str(h['id']),
								str(h['name']),
								{ name: str(h['name']), addr: str(h['address']), status: str(h['status']) },
								toneOf(str(h['status'])),
							),
						),
						'No Cloudflare health checks (Pro). The server’s health is Watch › Health.',
					),
				],
			});
		},
		history: async (ctx) => auditHistory(ctx, /load|argo|waiting|health/i),
	},
};

export const cfRoutesScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		list: async (ctx) => {
			const z = await zoneOf(ctx);
			const routes = (await cfAll(`/zones/${z.id}/workers/routes`, ctx.key)) ?? [];
			return view({
				tables: [
					table(
						'Workers routes',
						[col('pattern', 'Pattern', true), col('script', 'Worker', true)],
						routes.map((r) =>
							row(str(r['id']), str(r['pattern']), {
								pattern: str(r['pattern']),
								script: str(r['script']) || '(none: skipped)',
							}),
						),
						'No Workers routes: no Worker runs in front of the shop.',
					),
				],
			});
		},
	},
};

export const cfWeb3Screen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		list: async (ctx) => {
			const z = await zoneOf(ctx);
			const h = (await cfAll(`/zones/${z.id}/web3/hostnames`, ctx.key)) ?? [];
			return view({
				tables: [
					table(
						'Web3 gateways',
						[col('name', 'Hostname', true), col('target', 'Target'), col('status', 'Status')],
						h.map((x) =>
							row(str(x['id']), str(x['name']), {
								name: str(x['name']),
								target: str(x['target']),
								status: str(x['status']),
							}),
						),
						'No Web3 gateways (not used).',
					),
				],
			});
		},
	},
};

export const accessAppsFor = async (ctx: ProductCtx, z: Zone) => {
	try {
		return { apps: (await cfAll(`/accounts/${z.account}/access/apps`, ctx.key, false)) ?? [], on: true };
	} catch (err) {
		if (err instanceof VendorError && /not.?enabled|10[0-9]{3}/i.test(err.message)) return { apps: [], on: false };
		if (err instanceof VendorError && [400, 403].includes(err.status)) return { apps: [], on: false };
		throw err;
	}
};

export const ZT_OFF = note(
	'Cloudflare Zero Trust is not switched on for this account yet. Once it is (Zero Trust › team name, Free plan), these lists fill in by themselves: the code is ready.',
	'amber',
);

export const cfAccessScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		list: async (ctx) => {
			const z = await zoneOf(ctx);
			const { apps, on } = await accessAppsFor(ctx, z);
			const mine = apps.filter(
				(a) =>
					str(a['domain']).endsWith(z.name) ||
					arr(a['self_hosted_domains']).some((d) => str(d).endsWith(z.name)),
			);
			return view({
				notes: on ? [] : [ZT_OFF],
				tables: [
					table(
						`Access applications on ${z.name}`,
						[
							col('name', 'Application'),
							col('domain', 'Address', true),
							col('type', 'Kind'),
							col('policies', 'Policies', true),
						],
						mine.map((a) =>
							row(str(a['id']), str(a['name']), {
								name: str(a['name']),
								domain: str(a['domain']),
								type: str(a['type']),
								policies: arr(a['policies']).length,
							}),
						),
						on
							? 'No Access applications on this domain yet: each server create adds its SSH one.'
							: 'Zero Trust is off.',
					),
				],
			});
		},
	},
};
