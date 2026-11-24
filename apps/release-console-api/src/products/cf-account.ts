/**
 * Cloudflare › Account screens: accounts and domains, registered domains, the Build and Protect
 * product overviews, Zero Trust (tunnels, Access, every area — ready before Zero Trust is switched
 * on), Workers, the account's tokens and audit log, AI Crawl Control and Agent Readiness.
 */
import type { ProductCtx, ProductScreen } from './kit.js';
import {
	action,
	ago,
	bytes,
	col,
	confirmed,
	fact,
	field,
	form,
	formTab,
	monitorTab,
	note,
	pick,
	row,
	stat,
	table,
	text,
	toneOf,
	view,
	when,
} from './kit.js';
import { cfAll, cfGet, cfSend, cfSoft, counts, zoneOf } from './cf-kit.js';
import { ZT_OFF, accessAppsFor, cfBotsScreen, cfOverviewScreen } from './cf-zone.js';
import { VendorError, arr, num, rec, str } from '../vendors/http.js';

const DASH = 'https://dash.cloudflare.com';
const acct = (ctx: ProductCtx) => zoneOf(ctx).then((z) => z.account);

/* ===== Accounts and domains ===== */

export const cfHomeScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		domains: async (ctx) => {
			const zones = (await cfAll('/zones?', ctx.key, false)) ?? [];
			return view({
				stats: [
					stat('Domains', zones.length),
					stat('Active', zones.filter((z) => str(z['status']) === 'active').length),
				],
				tables: [
					table(
						'Every domain on these accounts',
						[
							col('name', 'Domain', true),
							col('account', 'Account'),
							col('plan', 'Plan'),
							col('status', 'Status'),
						],
						zones.map((z) =>
							row(
								str(z['id']),
								str(z['name']),
								{
									name: str(z['name']),
									account: str(rec(z['account'])['name']),
									plan: str(rec(z['plan'])['name']),
									status: str(z['status']),
								},
								toneOf(str(z['status'])),
							),
						),
						'No domains readable with this key.',
					),
				],
				actions: [action('Add a domain', 'add', 'primary')],
			});
		},
		accounts: async (ctx) => {
			const accounts = (await cfAll('/accounts?', ctx.key)) ?? [];
			const zones = (await cfAll('/zones?', ctx.key)) ?? [];
			return view({
				tables: [
					table(
						'Accounts this key reaches',
						[
							col('name', 'Account'),
							col('type', 'Kind'),
							col('n', 'Domains', true),
							col('id', 'Account ID', true),
						],
						accounts.map((a) =>
							row(str(a['id']), str(a['name']), {
								name: str(a['name']),
								type: str(a['type']),
								n: zones.filter((z) => str(rec(z['account'])['id']) === str(a['id'])).length,
								id: str(a['id']),
							}),
						),
						'No accounts readable.',
					),
				],
			});
		},
		add: async (ctx) => cfOverviewScreen.forms!['add']!.read(ctx),
	},
	forms: {
		add: {
			read: async (ctx) => cfOverviewScreen.forms!['add']!.read(ctx),
			send: async (ctx, w) => cfOverviewScreen.forms!['add']!.send(ctx, w),
		},
	},
};

/* ===== Domains (sites and registrar) ===== */

export const cfDomainsScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		list: async (ctx) => {
			const a = await acct(ctx);
			const [zones, reg] = await Promise.all([
				cfAll(`/zones?account.id=${a}`, ctx.key),
				cfAll(`/accounts/${a}/registrar/domains`, ctx.key),
			]);
			return view({
				tables: [
					table(
						'Sites',
						[
							col('name', 'Domain', true),
							col('plan', 'Plan'),
							col('status', 'Status'),
							col('ns', 'Nameservers', true),
						],
						(zones ?? []).map((z) =>
							row(
								str(z['id']),
								str(z['name']),
								{
									name: str(z['name']),
									plan: str(rec(z['plan'])['name']),
									status: str(z['status']),
									ns: arr(z['name_servers'])
										.map((n) => str(n))
										.join(', '),
								},
								toneOf(str(z['status'])),
							),
						),
						'No sites.',
						true,
					),
					table(
						'Registered at Cloudflare',
						[
							col('name', 'Domain', true),
							col('until', 'Renews', true),
							col('auto', 'Auto-renew'),
							col('lock', 'Transfer lock'),
						],
						(reg ?? []).map((d) =>
							row(
								str(d['name']),
								str(d['name']),
								{
									name: str(d['name']),
									until: when(str(d['expires_at'])),
									auto: d['auto_renew'] === true ? 'on' : 'off',
									lock: d['locked'] === true ? 'on' : 'off',
								},
								d['auto_renew'] === true ? null : 'amber',
							),
						),
						reg
							? 'No domains registered at Cloudflare: sahatextile.com is registered elsewhere.'
							: 'Registrar not readable with this key.',
					),
				],
			});
		},
		detail: async (ctx) => {
			const a = await acct(ctx);
			const zones = (await cfAll(`/zones?account.id=${a}`, ctx.key)) ?? [];
			const p = pick(
				'Domain',
				zones.map((z) => ({ value: str(z['id']), label: str(z['name']) })),
				ctx.id,
			);
			const z = zones.find((x) => str(x['id']) === p.value);
			if (!z) return view({ notes: [note('No sites.', 'muted')] });
			return view(
				{
					head: { name: str(z['name']), status: str(z['status']), tone: toneOf(str(z['status'])) },
					facts: [
						fact('Plan', str(rec(z['plan'])['name'])),
						fact(
							'Nameservers',
							arr(z['name_servers'])
								.map((n) => str(n))
								.join(', '),
						),
						fact('Original registrar', str(z['original_registrar'])),
						fact('Active since', when(str(z['activated_on']))),
					],
					links: [{ label: 'Open in Cloudflare', url: `${DASH}/${a}/${str(z['name'])}` }],
				},
				p,
			);
		},
		edit: async (ctx) => {
			const a = await acct(ctx);
			const reg = (await cfAll(`/accounts/${a}/registrar/domains`, ctx.key)) ?? [];
			const p = pick(
				'Registered domain',
				reg.map((d) => ({ value: str(d['name']), label: str(d['name']) })),
				ctx.id,
			);
			const d = reg.find((x) => str(x['name']) === p.value);
			return formTab(
				form({
					key: 'edit',
					title: 'Auto-renew and transfer lock',
					submit: 'Save',
					blocked: d ? null : 'No domains registered at Cloudflare.',
					fields: d
						? [
								field('auto', 'Auto-renew', 'toggle', { value: d['auto_renew'] === true }),
								field('locked', 'Transfer lock', 'toggle', { value: d['locked'] === true }),
							]
						: [],
				}),
				p,
			);
		},
		op: async () =>
			view({
				notes: [
					note(
						'Transferring a domain in is paid for on Cloudflare’s page (a year’s renewal), so it starts there; the console then shows it on the list.',
						'cy',
					),
				],
				links: [{ label: 'Transfer on Cloudflare', url: `${DASH}/?to=/:account/domains/transfer` }],
			}),
		destroy: async (ctx) =>
			formTab(
				form({
					key: 'destroy',
					title: 'Remove a site',
					submit: 'Remove site',
					danger: true,
					blocked: `Refused for ${ctx.zones.join(', ') || 'the project’s domains'}: removing the live site takes the shop offline. Other sites are removed on Cloudflare’s page.`,
				}),
			),
		history: async (ctx) => cfOverviewScreen.tabs['history']!(ctx),
	},
	forms: {
		edit: {
			read: (ctx) => cfDomainsScreen.tabs['edit']!(ctx),
			async send(ctx, w) {
				const k = await ctx.writeKey();
				const a = (await zoneOf(ctx, k)).account;
				const name = w.id ?? ctx.id;
				if (!name) throw new VendorError('Choose a domain.', 400);
				await cfSend('PUT', `/accounts/${a}/registrar/domains/${name}`, k, {
					auto_renew: w.values['auto'] === true,
					locked: w.values['locked'] === true,
				});
				return {
					message: `${name}: auto-renew ${w.values['auto'] === true ? 'on' : 'off'}, lock ${w.values['locked'] === true ? 'on' : 'off'}`,
					productId: name,
					follow: [],
				};
			},
		},
	},
};

/* ===== Build and Protect: what the account uses ===== */

const list = (p: Promise<unknown | null>) =>
	p.then((r) =>
		r === null
			? null
			: Array.isArray(r)
				? r
				: arr(rec(r)['buckets'] ?? rec(r)['issues'] ?? rec(r)['widgets'] ?? []),
	);

export const cfBuildScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		compute: async (ctx) => {
			const a = await acct(ctx);
			return view({
				tables: [
					await counts([
						['Workers', list(cfSoft(`/accounts/${a}/workers/scripts`, ctx.key)), 'code at the edge'],
						['Pages projects', list(cfSoft(`/accounts/${a}/pages/projects`, ctx.key)), 'static sites'],
						['Queues', list(cfSoft(`/accounts/${a}/queues`, ctx.key)), 'message queues'],
						[
							'Durable Objects',
							list(cfSoft(`/accounts/${a}/workers/durable_objects/namespaces`, ctx.key)),
							'stateful objects',
						],
						['Workflows', list(cfSoft(`/accounts/${a}/workflows`, ctx.key)), 'durable steps'],
					]),
				],
				notes: [note('The shop runs on its own servers; none of these are used today.', 'muted')],
			});
		},
		ai: async (ctx) => {
			const a = await acct(ctx);
			return view({
				tables: [
					await counts([
						[
							'AI Gateway',
							list(cfSoft(`/accounts/${a}/ai-gateway/gateways`, ctx.key)),
							'caching and limits for AI calls',
						],
						[
							'Vectorize indexes',
							list(cfSoft(`/accounts/${a}/vectorize/v2/indexes`, ctx.key)),
							'vector search',
						],
						['AI Search', list(cfSoft(`/accounts/${a}/autorag/rags`, ctx.key)), 'search over your content'],
					]),
				],
			});
		},
		storage: async (ctx) => {
			const a = await acct(ctx);
			return view({
				tables: [
					await counts([
						[
							'R2 buckets',
							list(cfSoft(`/accounts/${a}/r2/buckets`, ctx.key)),
							'object storage (photos stay in Spaces)',
						],
						['KV namespaces', list(cfSoft(`/accounts/${a}/storage/kv/namespaces`, ctx.key)), 'key-value'],
						['D1 databases', list(cfSoft(`/accounts/${a}/d1/database`, ctx.key)), 'SQLite at the edge'],
						[
							'Hyperdrive',
							list(cfSoft(`/accounts/${a}/hyperdrive/configs`, ctx.key)),
							'database connection pooling',
						],
						[
							'Secrets Store',
							list(cfSoft(`/accounts/${a}/secrets_store/stores`, ctx.key)),
							'secrets for Workers (ours are in Infisical)',
						],
					]),
				],
			});
		},
		media: async (ctx) => {
			const a = await acct(ctx);
			const stats = rec(rec(await cfSoft(`/accounts/${a}/images/v1/stats`, ctx.key))['count']);
			return view({
				facts: [
					fact(
						'Cloudflare Images',
						stats['current'] !== undefined
							? `${num(stats['current'])} of ${num(stats['allowed'])}`
							: 'not used',
					),
				],
				tables: [
					await counts([
						[
							'Stream videos',
							list(cfSoft(`/accounts/${a}/stream`, ctx.key)),
							'hosted video (the shop embeds YouTube)',
						],
					]),
				],
			});
		},
		realtime: async (ctx) => {
			const a = await acct(ctx);
			return view({
				tables: [
					await counts([
						['Realtime apps', list(cfSoft(`/accounts/${a}/calls/apps`, ctx.key)), 'SFU / RealtimeKit'],
						['TURN keys', list(cfSoft(`/accounts/${a}/calls/turn_keys`, ctx.key)), 'TURN relays'],
					]),
				],
			});
		},
	},
};

export const cfProtectScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		appsec: async (ctx) => {
			const a = await acct(ctx);
			return view({
				tables: [
					await counts([
						[
							'Turnstile widgets',
							list(cfSoft(`/accounts/${a}/challenges/widgets`, ctx.key)),
							'bot checks on forms',
						],
						[
							'Security insights',
							list(cfSoft(`/accounts/${a}/security-center/insights`, ctx.key)),
							'Security Center findings',
						],
					]),
				],
				notes: [
					note(
						'Per-domain WAF, bots and rules are under the domain: Security, Security settings, Rules.',
						'muted',
					),
				],
			});
		},
		networking: async (ctx) => {
			const a = await acct(ctx);
			return view({
				tables: [
					await counts([
						[
							'Tunnels',
							list(cfSoft(`/accounts/${a}/cfd_tunnel?is_deleted=false`, ctx.key)),
							'server links (one per server)',
						],
						[
							'Private routes',
							list(cfSoft(`/accounts/${a}/teamnet/routes`, ctx.key)),
							'server addresses over WARP',
						],
						[
							'Address maps',
							list(cfSoft(`/accounts/${a}/addressing/address_maps`, ctx.key)),
							'own IP ranges (Enterprise)',
						],
					]),
				],
			});
		},
		threat: async (ctx) => {
			const a = await acct(ctx);
			const insights = (await cfAll(`/accounts/${a}/security-center/insights`, ctx.key)) ?? [];
			return view({
				tables: [
					table(
						'Security Center insights',
						[col('what', 'Finding'), col('sev', 'Severity'), col('on', 'On', true)],
						insights.map((i) =>
							row(
								str(i['id']),
								str(i['issue_type']),
								{
									what: str(i['issue_type']).replace(/_/g, ' '),
									sev: str(i['severity']),
									on: str(i['subject']),
								},
								/high|critical/i.test(str(i['severity'])) ? 'red' : 'amber',
							),
						),
						'No findings, or Security Center is not readable with this key.',
					),
				],
			});
		},
		delivery: async (ctx) => {
			const a = await acct(ctx);
			return view({
				tables: [
					await counts([
						[
							'Bulk redirect lists',
							list(cfSoft(`/accounts/${a}/rules/lists`, ctx.key)),
							'account-wide redirects',
						],
						[
							'Load balancer pools',
							list(cfSoft(`/accounts/${a}/load_balancers/pools`, ctx.key)),
							'paid add-on',
						],
					]),
				],
			});
		},
	},
};

/* ===== Zero Trust ===== */

async function tunnels(ctx: ProductCtx, a: string) {
	return (await cfAll(`/accounts/${a}/cfd_tunnel?is_deleted=false`, ctx.key)) ?? [];
}

async function hostnames(ctx: ProductCtx, a: string, id: string) {
	const c = rec(rec(await cfSoft(`/accounts/${a}/cfd_tunnel/${id}/configurations`, ctx.key))['config']);
	return { ingress: arr(c['ingress']).map(rec), warp: rec(c['warp-routing'])['enabled'] === true };
}

const ZT_AREAS: Array<[string, string, string]> = [
	['Tunnels', 'cfd_tunnel?is_deleted=false', 'server links'],
	['Access applications', 'access/apps', 'who may enter what'],
	['Service tokens', 'access/service_tokens', 'machine sign-in (deploy job)'],
	['Access groups', 'access/groups', 'reusable people lists'],
	['Devices (WARP)', 'devices', 'enrolled laptops and phones'],
	['Private routes', 'teamnet/routes', 'server addresses over WARP'],
	['Gateway rules', 'gateway/rules', 'DNS and web filtering'],
	['Device posture', 'devices/posture', 'checks before entry'],
	['Identity providers', 'access/identity_providers', 'sign-in methods (email code by default)'],
];

export const cfZeroTrustScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		tunnels: async (ctx) => {
			const a = await acct(ctx);
			const list_ = await tunnels(ctx, a);
			const hosts = await Promise.all(list_.map((t) => hostnames(ctx, a, str(t['id']))));
			return view({
				stats: [
					stat('Tunnels', list_.length),
					stat('Connected', list_.filter((t) => str(t['status']) === 'healthy').length),
				],
				tables: [
					table(
						'Tunnels',
						[
							col('name', 'Tunnel'),
							col('status', 'Status'),
							col('links', 'Connector links', true),
							col('hosts', 'Public hostnames', true),
							col('warp', 'Private network'),
						],
						list_.map((t, i) => {
							// One hostnames read per tunnel, in the same order.
							const h = hosts[i] as Awaited<ReturnType<typeof hostnames>>;
							return row(
								str(t['id']),
								str(t['name']),
								{
									name: str(t['name']),
									status: str(t['status']),
									links:
										arr(t['connections'])
											.map((c) => str(rec(c)['colo_name']))
											.join(', ') || 'none',
									hosts: h.ingress
										.filter((x) => str(x['hostname']))
										.map((x) => `${str(x['hostname'])} → ${str(x['service'])}`)
										.join(' · '),
									warp: h.warp ? 'on' : 'off',
								},
								toneOf(str(t['status'])),
							);
						}),
						'No tunnels yet: each server create makes one (tunnels work without Zero Trust being switched on).',
						true,
					),
				],
			});
		},
		access: async (ctx) => {
			const z = await zoneOf(ctx);
			const { apps, on } = await accessAppsFor(ctx, z);
			const tokens = on ? ((await cfAll(`/accounts/${z.account}/access/service_tokens`, ctx.key)) ?? []) : [];
			return view({
				notes: on
					? []
					: [
							ZT_OFF,
							note(
								'When it is on: every server create adds an SSH application (browser terminal) and its deploy token; Who may sign in over SSH (Droplets) sets the people; WARP enrolment follows the same list.',
								'muted',
							),
						],
				tables: [
					table(
						'Access applications',
						[
							col('name', 'Application'),
							col('domain', 'Address', true),
							col('type', 'Kind'),
							col('policies', 'Policies', true),
						],
						apps.map((x) =>
							row(str(x['id']), str(x['name']), {
								name: str(x['name']),
								domain: str(x['domain']),
								type: str(x['type']),
								policies: arr(x['policies'])
									.map((p) => str(rec(p)['name']))
									.join(', '),
							}),
						),
						on ? 'No Access applications yet.' : 'Zero Trust is off.',
					),
					table(
						'Service tokens',
						[col('name', 'Token'), col('until', 'Expires', true), col('used', 'Last used', true)],
						tokens.map((x) =>
							row(str(x['id']), str(x['name']), {
								name: str(x['name']),
								until: when(str(x['expires_at'])),
								used: ago(str(x['last_seen_at'])),
							}),
						),
						on ? 'No service tokens yet.' : 'Zero Trust is off.',
					),
				],
			});
		},
		edit: async (ctx) => {
			const a = await acct(ctx);
			const list_ = await tunnels(ctx, a);
			const p = pick(
				'Tunnel',
				list_.map((t) => ({ value: str(t['id']), label: str(t['name']) })),
				ctx.id,
			);
			const h = p.value ? await hostnames(ctx, a, p.value) : null;
			return formTab(
				form({
					key: 'edit',
					title: 'Add a public hostname',
					submit: 'Add hostname',
					blocked: p.value ? null : 'No tunnels yet: each server create makes one.',
					fields: [
						field('hostname', 'Hostname', 'text', {
							required: true,
							// acct() above has already refused a slot with no domain.
							help: `Like grafana-staging.${ctx.zones[0] as string}`,
						}),
						field('service', 'Service on the server', 'text', {
							value: 'http://localhost:3000',
							help: 'What the tunnel forwards to, on the server itself.',
						}),
					],
					notes: h
						? [
								note(
									`Now: ${
										h.ingress
											.filter((x) => str(x['hostname']))
											.map((x) => `${str(x['hostname'])} → ${str(x['service'])}`)
											.join(' · ') || 'no public hostnames'
									}.`,
									'cy',
								),
								note('A new hostname is public unless an Access application covers it.', 'amber'),
							]
						: [],
				}),
				p,
			);
		},
		monitor: async (ctx) => {
			const a = await acct(ctx);
			const list_ = await tunnels(ctx, a);
			const rows = list_.flatMap((t) =>
				arr(t['connections'])
					.map(rec)
					.map((c, i) =>
						row(
							`${str(t['id'])}-${i}`,
							str(t['name']),
							{
								tunnel: str(t['name']),
								colo: str(c['colo_name']),
								since: when(str(c['opened_at'])),
								origin: str(c['origin_ip']),
								state: c['is_pending_reconnect'] === true ? 'reconnecting' : 'up',
							},
							c['is_pending_reconnect'] === true ? 'amber' : 'ok',
						),
					),
			);
			return {
				...view({
					tables: [
						table(
							'Connector links now',
							[
								col('tunnel', 'Tunnel'),
								col('colo', 'Cloudflare site', true),
								col('since', 'Up since', true),
								col('origin', 'From', true),
								col('state', 'State'),
							],
							rows,
							'No connector links: no server is up yet.',
						),
					],
					notes: [
						note(
							'Each healthy server keeps four links to nearby Cloudflare sites. Request counts per tunnel need Zero Trust analytics.',
							'muted',
						),
					],
				}),
			};
		},
		destroy: async (ctx) => {
			const a = await acct(ctx);
			const list_ = await tunnels(ctx, a);
			const p = pick(
				'Tunnel',
				list_.map((t) => ({ value: str(t['id']), label: str(t['name']) })),
				ctx.id,
			);
			const t = list_.find((x) => str(x['id']) === p.value);
			return formTab(
				form({
					key: 'destroy',
					title: 'Delete a tunnel',
					submit: 'Delete tunnel',
					danger: true,
					confirmName: t ? str(t['name']) : null,
					blocked: t
						? arr(t['connections']).length
							? `${str(t['name'])} has a server connected: destroy the server from Droplets instead, which removes its tunnel last.`
							: null
						: 'No tunnels.',
					notes: [note('Its public hostnames stop answering and SSH through it ends.', 'red')],
				}),
				p,
			);
		},
		history: async (ctx) => cfOverviewScreen.tabs['history']!(ctx),
		menu: async (ctx) => {
			const z = await zoneOf(ctx);
			const { on } = await accessAppsFor(ctx, z);
			const got = await Promise.all(
				ZT_AREAS.map(async ([label, path, what]) => ({
					label,
					what,
					n: await cfAll(`/accounts/${z.account}/${path}`, ctx.key).catch(() => null),
				})),
			);
			return view({
				head: { name: 'Zero Trust', status: on ? 'switched on' : 'not switched on', tone: on ? 'ok' : 'amber' },
				notes: on ? [] : [ZT_OFF],
				tables: [
					table(
						'Every area of the Zero Trust menu',
						[col('label', 'Area'), col('n', 'In use', true), col('what', 'For')],
						got.map((g) =>
							row(
								g.label,
								g.label,
								{
									label: g.label,
									n: g.n === null ? (on ? 'not readable with this key' : 'off') : g.n.length,
									what: g.what,
								},
								g.n === null ? 'muted' : g.n.length ? 'ok' : null,
							),
						),
						'Nothing.',
					),
				],
				links: [{ label: 'Open Zero Trust', url: `https://one.dash.cloudflare.com/${z.account}` }],
			});
		},
	},
	forms: {
		edit: {
			read: (ctx) => cfZeroTrustScreen.tabs['edit']!(ctx),
			async send(ctx, w) {
				const k = await ctx.writeKey();
				const a = (await zoneOf(ctx, k)).account;
				const id = w.id ?? ctx.id;
				if (!id) throw new VendorError('Choose a tunnel.', 400);
				const hostname = text(w, 'hostname').toLowerCase();
				const service = text(w, 'service');
				if (!ctx.zones.some((zn) => hostname.endsWith(`.${zn}`)))
					throw new VendorError(`The hostname must be under ${ctx.zones.join(' or ')}.`, 400);
				if (!/^(https?|ssh|tcp):\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/.test(service))
					throw new VendorError('Service: an address on the server itself, like http://localhost:3000.', 400);
				const c = rec(rec(await cfGet(`/accounts/${a}/cfd_tunnel/${id}/configurations`, k))['config']);
				const ingress = arr(c['ingress']).map(rec);
				const catchAll = ingress.filter((r) => !str(r['hostname']));
				const named = ingress.filter((r) => str(r['hostname']) && str(r['hostname']) !== hostname);
				await cfSend('PUT', `/accounts/${a}/cfd_tunnel/${id}/configurations`, k, {
					config: {
						...c,
						ingress: [
							...named,
							{ hostname, service },
							...(catchAll.length ? catchAll : [{ service: 'http_status:404' }]),
						],
					},
				});
				const z = await zoneOf(ctx, k);
				const recs = arr(await cfGet(`/zones/${z.id}/dns_records?name=${hostname}`, k)).map(rec);
				if (!recs.length)
					await cfSend('POST', `/zones/${z.id}/dns_records`, k, {
						type: 'CNAME',
						name: hostname,
						content: `${id}.cfargotunnel.com`,
						proxied: true,
						ttl: 1,
					});
				return { message: `${hostname} → ${service} through the tunnel`, productId: id, follow: [] };
			},
		},
		destroy: {
			read: (ctx) => cfZeroTrustScreen.tabs['destroy']!(ctx),
			async send(ctx, w) {
				const k = await ctx.writeKey();
				const a = (await zoneOf(ctx, k)).account;
				const id = w.id ?? ctx.id;
				const t = (await tunnels({ ...ctx, key: k }, a)).find((x) => str(x['id']) === id);
				if (!t) throw new VendorError('Choose a tunnel.', 400);
				confirmed(w, str(t['name']));
				if (arr(t['connections']).length)
					throw new VendorError('A server is connected; destroy the server from Droplets instead.', 400);
				await cfSend('DELETE', `/accounts/${a}/cfd_tunnel/${str(t['id'])}`, k);
				return { message: `Tunnel ${str(t['name'])} deleted`, productId: null, follow: [] };
			},
		},
	},
};

/* ===== Workers (account) ===== */

export const cfDevScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		list: async (ctx) => {
			const z = await zoneOf(ctx);
			const [scripts, routes, pages, r2] = await Promise.all([
				cfAll(`/accounts/${z.account}/workers/scripts`, ctx.key),
				cfAll(`/zones/${z.id}/workers/routes`, ctx.key),
				cfAll(`/accounts/${z.account}/pages/projects`, ctx.key),
				cfSoft(`/accounts/${z.account}/r2/buckets`, ctx.key),
			]);
			return view({
				tables: [
					table(
						'Workers',
						[col('name', 'Worker', true), col('at', 'Changed', true)],
						(scripts ?? []).map((s) =>
							row(str(s['id']), str(s['id']), { name: str(s['id']), at: when(str(s['modified_on'])) }),
						),
						'No Workers.',
					),
					table(
						'Routes on the domain',
						[col('pattern', 'Pattern', true), col('script', 'Worker', true)],
						(routes ?? []).map((r) =>
							row(str(r['id']), str(r['pattern']), {
								pattern: str(r['pattern']),
								script: str(r['script']),
							}),
						),
						'No routes.',
					),
					table(
						'Pages projects',
						[col('name', 'Project', true), col('domains', 'Domains', true)],
						(pages ?? []).map((p) =>
							row(str(p['name']), str(p['name']), {
								name: str(p['name']),
								domains: arr(p['domains'])
									.map((d) => str(d))
									.join(', '),
							}),
						),
						'No Pages projects.',
					),
					table(
						'R2 buckets',
						[col('name', 'Bucket', true), col('at', 'Created', true)],
						arr(rec(r2)['buckets'])
							.map(rec)
							.map((b) =>
								row(str(b['name']), str(b['name']), {
									name: str(b['name']),
									at: when(str(b['creation_date'])),
								}),
							),
						'No R2 buckets.',
					),
				],
			});
		},
		monitor: async () =>
			monitorTab(
				[],
				[note('No Worker runs for the shop, so there are no Worker requests to chart.', 'muted')],
				null,
			),
		history: async (ctx) => cfOverviewScreen.tabs['history']!(ctx),
	},
};

/* ===== Manage account ===== */

async function tokens(ctx: ProductCtx, a: string) {
	// The console's key may be the account's own token or a person's token (page rules need one).
	const [list_, me, meUser] = await Promise.all([
		cfAll(`/accounts/${a}/tokens`, ctx.key),
		cfSoft(`/accounts/${a}/tokens/verify`, ctx.key).catch(() => null),
		cfSoft('/user/tokens/verify', ctx.key).catch(() => null),
	]);
	const mine = str(rec(me)['id']) || str(rec(meUser)['id']);
	const listed = (list_ ?? []).some((x) => str(x['id']) === mine);
	const user = !list_ || (mine && !listed) ? await cfAll('/user/tokens', ctx.key) : null;
	return { list: [...(list_ ?? []), ...(user ?? [])], mine, readable: !!(list_ ?? user) };
}

export const cfAccountScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		tokens: async (ctx) => {
			const a = await acct(ctx);
			const t = await tokens(ctx, a);
			return view({
				tables: [
					table(
						'API tokens',
						[
							col('name', 'Token'),
							col('rights', 'Rights'),
							col('status', 'Status'),
							col('until', 'Expires', true),
							col('used', 'Last used', true),
						],
						t.list.map((x) =>
							row(
								str(x['id']),
								str(x['name']),
								{
									name: `${str(x['name'])}${str(x['id']) === t.mine ? ' (this console)' : ''}`,
									rights: arr(x['policies'])
										.flatMap((p) =>
											arr(rec(p)['permission_groups']).map((g) => str(rec(g)['name'])),
										)
										.slice(0, 6)
										.join(', '),
									status: str(x['status']),
									until: str(x['expires_on']) ? when(str(x['expires_on'])) : 'no expiry',
									used: ago(str(x['last_used_on'])),
								},
								toneOf(str(x['status'])),
							),
						),
						t.readable
							? 'No tokens.'
							: 'Tokens are not readable with this key (it needs Account API Tokens read).',
					),
				],
				notes: [
					note(
						'A new token’s value is shown once: you make it on Cloudflare’s page and paste it into Infisical, so it never passes through the console.',
						'muted',
					),
				],
				actions: [action('Revoke a token', 'destroy', 'danger')],
			});
		},
		audit: async (ctx) => {
			const a = await acct(ctx);
			const [members, logs] = await Promise.all([
				cfAll(`/accounts/${a}/members`, ctx.key),
				cfAll(`/accounts/${a}/audit_logs?direction=desc`, ctx.key),
			]);
			return view({
				tables: [
					table(
						'Members',
						[col('email', 'Member', true), col('roles', 'Roles'), col('status', 'Status')],
						(members ?? []).map((m) =>
							row(str(m['id']), str(rec(m['user'])['email']), {
								email: str(rec(m['user'])['email']),
								roles: arr(m['roles'])
									.map((r) => str(rec(r)['name']))
									.join(', '),
								status: str(m['status']),
							}),
						),
						'Members not readable with this key.',
					),
					table(
						'Audit log (newest 50)',
						[col('at', 'When', true), col('who', 'Who'), col('what', 'What'), col('on', 'On')],
						(logs ?? []).slice(0, 50).map((l, i) =>
							row(String(i), str(rec(l['action'])['type']), {
								at: when(str(l['when'])),
								who: str(rec(l['actor'])['email']) || str(rec(l['actor'])['type']),
								what: str(rec(l['action'])['type']),
								on: str(rec(l['resource'])['type']),
							}),
						),
						'Audit log not readable with this key.',
					),
				],
				links: [{ label: 'Billing on Cloudflare', url: `${DASH}/${a}/billing` }],
			});
		},
		edit: async () =>
			formTab(
				form({
					key: 'edit',
					title: 'New API token',
					submit: 'Make token',
					blocked:
						'Making a token creates a secret, so it stays your step on Cloudflare’s page (My Profile › API Tokens); paste it into Infisical and run pnpm console:env.',
				}),
			),
		destroy: async (ctx) => {
			const a = await acct(ctx);
			const t = await tokens(ctx, a);
			const usable = t.list.filter((x) => str(x['id']) !== t.mine);
			const p = pick(
				'Token',
				usable.map((x) => ({ value: str(x['id']), label: str(x['name']) })),
				ctx.id,
			);
			const x = usable.find((y) => str(y['id']) === p.value);
			return formTab(
				form({
					key: 'destroy',
					title: 'Revoke a token',
					submit: 'Revoke token',
					danger: true,
					confirmName: x ? str(x['name']) : null,
					blocked: x ? null : 'No tokens the console may revoke (it never revokes the one it is using).',
					notes: [note('Anything using it stops working at once.', 'red')],
				}),
				p,
			);
		},
		history: async (ctx) => cfAccountScreen.tabs['audit']!(ctx),
	},
	forms: {
		destroy: {
			read: (ctx) => cfAccountScreen.tabs['destroy']!(ctx),
			async send(ctx, w) {
				const k = await ctx.writeKey();
				const a = (await zoneOf(ctx, k)).account;
				const t = await tokens({ ...ctx, key: k }, a);
				const x = t.list.find((y) => str(y['id']) === (w.id ?? ctx.id));
				if (!x) throw new VendorError('Choose a token.', 400);
				if (str(x['id']) === t.mine)
					throw new VendorError('Refused: that is the token the console is using.', 400);
				confirmed(w, str(x['name']));
				await cfSend('DELETE', `/accounts/${a}/tokens/${str(x['id'])}`, k);
				return { message: `Token ${str(x['name'])} revoked`, productId: null, follow: [] };
			},
		},
	},
};

/* ===== AI Crawl Control ===== */

async function fetchText(url: string): Promise<{ status: number; body: string; type: string }> {
	try {
		const r = await fetch(url, {
			headers: { 'user-agent': 'release-console' },
			signal: AbortSignal.timeout(10_000),
			redirect: 'follow',
		});
		return {
			status: r.status,
			body: (await r.text()).slice(0, 400_000),
			type: r.headers.get('content-type') ?? '',
		};
	} catch {
		return { status: 0, body: '', type: '' };
	}
}

export const cfAiCrawlScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		overview: async (ctx) => {
			const z = await zoneOf(ctx);
			const b = rec(await cfSoft(`/zones/${z.id}/bot_management`, ctx.key));
			return view({
				head: {
					name: z.name,
					status: str(b['ai_bots_protection']) === 'block' ? 'AI crawlers blocked' : 'AI crawlers allowed',
					tone: 'cy',
				},
				facts: [
					fact('Block AI crawlers', str(b['ai_bots_protection']) || '—'),
					fact('Managed robots.txt', b['is_robots_txt_managed'] === true ? 'on' : 'off'),
					fact('Crawler hints', '—'),
				],
				notes: [
					note(
						'Per-crawler request counts are on Cloudflare’s AI Crawl Control page; its API does not publish them on the Free plan yet.',
						'muted',
					),
				],
				actions: [action('Change', 'edit')],
			});
		},
		metrics: async () =>
			view({
				notes: [
					note(
						'Pages taken and referrals back per AI crawler are shown on Cloudflare’s AI Crawl Control page; its API does not publish them yet.',
						'muted',
					),
				],
				links: [{ label: 'AI Crawl Control', url: `${DASH}/?to=/:account/:zone/ai` }],
			}),
		security: async (ctx) => {
			const z = await zoneOf(ctx);
			const rules = arr(
				rec(await cfSoft(`/zones/${z.id}/rulesets/phases/http_request_firewall_custom/entrypoint`, ctx.key))[
					'rules'
				],
			)
				.map(rec)
				.filter((r) => /bot|crawler|ai/i.test(str(r['expression']) + str(r['description'])));
			return view({
				tables: [
					table(
						'Rules that name bots or AI crawlers',
						[col('name', 'Rule'), col('expr', 'When', true), col('action', 'Then')],
						rules.map((r) =>
							row(str(r['id']), str(r['description']), {
								name: str(r['description']),
								expr: str(r['expression']).slice(0, 120),
								action: str(r['action']),
							}),
						),
						'No custom rules aimed at crawlers.',
					),
				],
			});
		},
		optimization: async (ctx) => {
			const r = await fetchText(`https://${ctx.zones[0] ?? ''}/robots.txt`);
			const lines = r.body.split('\n').slice(0, 80);
			return view({
				facts: [
					fact(
						'robots.txt',
						r.status === 200 ? `${lines.length} lines` : `answered ${r.status || 'nothing'}`,
						r.status === 200 ? 'ok' : 'amber',
					),
					fact(
						'Content signals',
						/content-signal/i.test(r.body)
							? (lines.find((l) => /content-signal/i.test(l)) ?? 'present')
							: 'none',
					),
				],
				tables: [
					table(
						'robots.txt (first 80 lines)',
						[col('line', 'Line', true)],
						lines.map((l, i) => row(String(i), l, { line: l || ' ' })),
						'Empty.',
					),
				],
			});
		},
		signals: async (ctx) => {
			const r = await fetchText(`https://${ctx.zones[0] ?? ''}/robots.txt`);
			const signal = r.body.split('\n').find((l) => /content-signal/i.test(l));
			return view({
				facts: [
					fact(
						'Signal to AI operators',
						signal ?? 'none set: Cloudflare’s managed robots.txt adds “search=yes, ai-train=no”',
					),
				],
			});
		},
		edit: async (ctx) => cfBotsScreen.forms!['bots']!.read(ctx),
		monitor: async () =>
			monitorTab(
				[],
				[note('AI crawler request charts are on Cloudflare’s AI Crawl Control page.', 'muted')],
				null,
			),
		history: async (ctx) => cfOverviewScreen.tabs['history']!(ctx),
	},
	forms: {
		edit: {
			read: async (ctx) => cfBotsScreen.forms!['bots']!.read(ctx),
			send: async (ctx, w) => cfBotsScreen.forms!['bots']!.send(ctx, w),
		},
	},
};

/* ===== Agent Readiness: the console checks the shop the way an agent would ===== */

async function agentChecks(host: string) {
	const [home, robots, sitemap, llms] = await Promise.all([
		fetchText(`https://${host}/`),
		fetchText(`https://${host}/robots.txt`),
		fetchText(`https://${host}/sitemap.xml`),
		fetchText(`https://${host}/llms.txt`),
	]);
	const jsonld = [...home.body.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
	return [
		['Home page answers', home.status === 200, `${home.status || 'no answer'} · ${bytes(home.body.length)}`],
		[
			'Content is in the first answer (server-rendered)',
			/<h1|<main/i.test(home.body) && home.body.length > 5000,
			'agents read the HTML, not the JavaScript',
		],
		['Structured data (JSON-LD)', jsonld.length > 0, jsonld.slice(0, 6).join(', ') || 'none'],
		['robots.txt', robots.status === 200, robots.status ? `${robots.status}` : 'no answer'],
		[
			'Sitemap',
			sitemap.status === 200 && /<urlset|<sitemapindex/.test(sitemap.body),
			`${sitemap.status || 'no answer'}`,
		],
		['llms.txt', llms.status === 200, llms.status === 200 ? 'present' : 'none (optional)'],
	] as Array<[string, boolean, string]>;
}

export const cfAgentScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		overview: async (ctx) => {
			const host = ctx.zones[0] ?? '';
			const checks = await agentChecks(host);
			return view({
				head: {
					name: host,
					status: `${checks.filter((c) => c[1]).length} of ${checks.length} ready`,
					tone: checks.every((c) => c[1]) ? 'ok' : 'amber',
				},
				tables: [
					table(
						'What an AI agent finds on the shop',
						[col('what', 'Check'), col('ok', 'Result'), col('detail', 'Detail')],
						checks.map(([what, ok, detail]) =>
							row(what, what, { what, ok: ok ? 'yes' : 'no', detail }, ok ? 'ok' : 'amber'),
						),
						'No checks.',
					),
				],
				notes: [note('Read live from the shop now, the way a crawler or agent would.', 'muted')],
			});
		},
		diagnostics: async (ctx) => {
			const host = ctx.zones[0] ?? '';
			const pages = ['/', '/en/sarees', '/en/contact', '/en/blog', '/bn'];
			const p = pick(
				'Page',
				pages.map((x) => ({ value: x, label: `https://${host}${x}` })),
				ctx.id,
			);
			// The page list is never empty, so a page is always picked.
			const path = p.value as string;
			const r = await fetchText(`https://${host}${path}`);
			const title = /<title>([^<]*)<\/title>/i.exec(r.body)?.[1] ?? '—';
			const canonical = /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i.exec(r.body)?.[1] ?? '—';
			const robots =
				/<meta[^>]+name="robots"[^>]+content="([^"]+)"/i.exec(r.body)?.[1] ?? 'index, follow (default)';
			const types =
				[...r.body.matchAll(/"@type"\s*:\s*"([^"]+)"/g)]
					.map((m) => m[1])
					.slice(0, 8)
					.join(', ') || 'none';
			return view(
				{
					head: {
						name: `https://${host}${path}`,
						status: String(r.status || 'no answer'),
						tone: r.status === 200 ? 'ok' : 'red',
					},
					facts: [
						fact('Title', title),
						fact('Canonical', canonical),
						fact('Robots', robots),
						fact('Structured data', types),
						fact('Size', bytes(r.body.length)),
						fact(
							'Server-rendered content',
							/<h1|<main/i.test(r.body) ? 'yes' : 'no',
							/<h1|<main/i.test(r.body) ? 'ok' : 'amber',
						),
					],
					notes: [note('Read now, the way an agent would. Nothing is changed.', 'muted')],
				},
				p,
			);
		},
		playground: async () =>
			view({
				notes: [
					note(
						'Asking an agent about the shop needs an AI model; the shop uses none. The Overview tab shows what an agent reads.',
						'muted',
					),
				],
			}),
		markdown: async (ctx) => {
			const z = await zoneOf(ctx);
			return view({ notes: [note(`Markdown for Agents needs Pro (this domain is on ${z.plan}).`, 'muted')] });
		},
		webmcp: async () =>
			view({ notes: [note('WebMCP actions are not set up: no agent may take actions on the shop.', 'muted')] }),
	},
};
