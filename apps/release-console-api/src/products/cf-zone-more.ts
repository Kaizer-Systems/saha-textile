/**
 * Cloudflare › Domain: the rest of what Cloudflare's own pages can do (owner, 22 Nov: "every page should
 * be properly functional, just the way it would be in Cloudflare dashboard"). Each screen keeps its
 * tabs; this file adds the missing forms (opened by buttons on the screen's views) and the missing
 * pages as tabs. Plan-locked parts say so instead of sending.
 */
import type { ProductAction, ProductTab, ProductWrite } from '@saha-textile/release-console-contracts';

import type { ProductCtx, ProductFormSpec, ProductScreen } from './kit.js';
import {
	action,
	bool,
	col,
	confirmed,
	fact,
	field,
	form,
	formTab,
	list,
	note,
	option,
	pick,
	row,
	stat,
	table,
	text,
	view,
	when,
} from './kit.js';
import { CF_API, type SettingSpec, type Zone, cfAll, cfSend, cfSoft, graph, settingsForm, zoneOf } from './cf-kit.js';
import { type RuleKind, ruleKindForm } from './cf-rules.js';
import { VendorError, arr, num, rec, str } from '../vendors/http.js';

type Tab = (ctx: ProductCtx) => Promise<ProductTab>;

/** What one screen gains: new tabs, new forms, and buttons appended to its existing views. */
export interface ScreenExtra {
	tabs?: Record<string, Tab>;
	forms?: Record<string, ProductFormSpec>;
	buttons?: Record<string, ProductAction[]>;
}

/** A screen with its extras: buttons are added to the named tabs' views. */
export function extend(screen: ProductScreen, extra: ScreenExtra): ProductScreen {
	const tabs: Record<string, Tab> = { ...screen.tabs, ...extra.tabs };
	for (const [key, buttons] of Object.entries(extra.buttons ?? {})) {
		const base = tabs[key];
		if (!base) continue;
		tabs[key] = async (ctx) => {
			const t = await base(ctx);
			// A copy: some tabs answer one shared view (an empty list), which must not gather buttons.
			return t.type === 'view' ? { ...t, view: { ...t.view, actions: [...t.view.actions, ...buttons] } } : t;
		};
	}
	return { ...screen, tabs, forms: { ...screen.forms, ...extra.forms } };
}

const opt = (w: ProductWrite, key: string): string => {
	const v = w.values[key];
	return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
};
const isNew = (id: string | null | undefined) => !id || id === 'new';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A Cloudflare multipart upload (DNS import), answered like any other call. */
async function cfUpload(path: string, key: string, body: FormData): Promise<unknown> {
	const res = await fetch(`${CF_API}${path}`, {
		method: 'POST',
		headers: { authorization: `Bearer ${key}`, 'user-agent': 'release-console' },
		body,
		signal: AbortSignal.timeout(30_000),
	});
	const answer = rec(await res.json().catch(() => null));
	if (res.status >= 400 || answer['success'] === false) {
		const first = rec(arr(answer['errors'])[0]);
		throw new VendorError(
			`Cloudflare answered ${res.status}${first['message'] ? `: ${str(first['message'])}` : ''}.`,
			res.status,
		);
	}
	return answer['result'];
}

/* ===== DNS: DNSSEC, CNAME flattening, nameserver TTL, BIND import ===== */

const dnsSettings: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const [dnssec, ds] = await Promise.all([
			cfSoft(`/zones/${z.id}/dnssec`, ctx.key),
			cfSoft(`/zones/${z.id}/dns_settings`, ctx.key),
		]);
		const on = ['active', 'pending'].includes(str(rec(dnssec)['status']));
		return formTab(
			form({
				key: 'dnssettings',
				title: 'DNS settings',
				submit: 'Save DNS settings',
				fields: [
					field('dnssec', 'DNSSEC', 'select', {
						value: on ? 'on' : 'off',
						options: [option('on', 'On'), option('off', 'Off')],
						help: 'On: Cloudflare signs the zone; add the DS record it shows at the registrar.',
					}),
					field('flatten', 'CNAME flattening', 'select', {
						value: rec(ds)['flatten_all_cnames'] === true ? 'all' : 'apex',
						options: [option('apex', 'At the apex only'), option('all', 'Every CNAME (paid plans)')],
					}),
					field('nsTtl', 'Nameserver TTL (seconds)', 'number', {
						value: num(rec(ds)['ns_ttl']) || 86400,
						min: 30,
						max: 86400,
					}),
				],
				notes: [
					note(
						'Turning DNSSEC off while the registrar still has the DS record makes the domain fail for visitors: remove the DS record first.',
						'amber',
					),
					...(str(rec(dnssec)['ds']) ? [note(`DS record: ${str(rec(dnssec)['ds'])}`, 'muted')] : []),
				],
			}),
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const [dnssec, ds] = await Promise.all([
			cfSoft(`/zones/${z.id}/dnssec`, k),
			cfSoft(`/zones/${z.id}/dns_settings`, k),
		]);
		const changed: string[] = [];
		const wantOn = opt(w, 'dnssec') === 'on';
		if (wantOn !== ['active', 'pending'].includes(str(rec(dnssec)['status']))) {
			await cfSend('PATCH', `/zones/${z.id}/dnssec`, k, { status: wantOn ? 'active' : 'disabled' });
			changed.push(`DNSSEC ${wantOn ? 'on' : 'off'}`);
		}
		const all = opt(w, 'flatten') === 'all';
		const ttl = Number(opt(w, 'nsTtl') || '86400');
		if (!Number.isInteger(ttl) || ttl < 30 || ttl > 86400)
			throw new VendorError('Nameserver TTL: 30 to 86400 seconds.', 400);
		const patch: Record<string, unknown> = {};
		if (all !== (rec(ds)['flatten_all_cnames'] === true)) patch['flatten_all_cnames'] = all;
		if (ttl !== num(rec(ds)['ns_ttl'])) patch['ns_ttl'] = ttl;
		if (Object.keys(patch).length) {
			await cfSend('PATCH', `/zones/${z.id}/dns_settings`, k, patch);
			changed.push(...Object.keys(patch).map((x) => x.replace(/_/g, ' ')));
		}
		if (!changed.length) throw new VendorError('Nothing changed.', 400);
		return { message: `${z.name}: ${changed.join(', ')}`, productId: z.id, follow: [] };
	},
};

const dnsImport: ProductFormSpec = {
	read: async () =>
		formTab(
			form({
				key: 'import',
				title: 'Import records (BIND file)',
				submit: 'Import records',
				fields: [
					field('zonefile', 'BIND zone file', 'textarea', {
						required: true,
						help: 'Paste the file; each record line like: shop 300 IN A 203.0.113.9',
					}),
					field('proxied', 'Proxy the imported A, AAAA and CNAME records', 'toggle', { value: true }),
				],
				notes: [
					note('Records that already exist are skipped by Cloudflare and counted in the answer.', 'muted'),
				],
			}),
		),
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const body = new FormData();
		body.set('file', new Blob([text(w, 'zonefile')], { type: 'text/plain' }), 'zone.txt');
		body.set('proxied', bool(w, 'proxied') ? 'true' : 'false');
		const r = rec(await cfUpload(`/zones/${z.id}/dns_records/import`, k, body));
		return {
			message: `Imported ${num(r['recs_added'])} of ${num(r['total_records_parsed'])} records`,
			productId: z.id,
			follow: [],
		};
	},
};

export const DNS_EXTRA: ScreenExtra = {
	forms: { dnssettings: dnsSettings, import: dnsImport },
	buttons: { settings: [action('DNS settings', 'dnssettings'), action('Import a BIND file', 'import')] },
};

/* ===== Observability: log settings ===== */

const LOGS: SettingSpec[] = [
	{
		id: 'log_to_cloudflare',
		label: 'Keep request logs at Cloudflare',
		help: 'Needed for Instant Logs and log search.',
	},
	{ id: 'filter_logs_to_cloudflare', label: 'Keep only filtered logs' },
];
export const OBS_EXTRA: ScreenExtra = {
	forms: { logsettings: settingsForm('logsettings', 'Log settings', LOGS) },
	buttons: { export: [action('Log settings', 'logsettings')] },
};

/* ===== Workers routes ===== */

async function routesOf(ctx: ProductCtx, z: Zone, key = ctx.key) {
	return (await cfAll(`/zones/${z.id}/workers/routes`, key)) ?? [];
}

const routeForm: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const [routes, scripts] = await Promise.all([
			routesOf(ctx, z),
			cfAll(`/accounts/${z.account}/workers/scripts`, ctx.key),
		]);
		const p = pick(
			'Route',
			[
				{ value: 'new', label: 'New route' },
				...routes.map((r) => ({ value: str(r['id']), label: str(r['pattern']) })),
			],
			ctx.id,
		);
		const r = routes.find((x) => str(x['id']) === p.value) ?? null;
		return formTab(
			form({
				key: 'route',
				title: r ? `Edit route ${str(r['pattern'])}` : 'Add a route',
				submit: r ? 'Save route' : 'Add route',
				fields: [
					field('pattern', 'Route', 'text', {
						value: str(r?.['pattern']),
						required: true,
						help: `Like ${z.name}/api/* or *.${z.name}/*`,
					}),
					field('script', 'Worker', 'select', {
						value: str(r?.['script']),
						options: [
							option('', 'None (requests on this route skip Workers)'),
							...(scripts ?? []).map((s) => option(str(s['id']), str(s['id']))),
						],
					}),
				],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const pattern = text(w, 'pattern');
		if (!pattern.includes(z.name)) throw new VendorError(`The route is on ${z.name}.`, 400);
		const body = { pattern, ...(opt(w, 'script') ? { script: opt(w, 'script') } : {}) };
		const id = w.id ?? ctx.id;
		if (isNew(id)) await cfSend('POST', `/zones/${z.id}/workers/routes`, k, body);
		else await cfSend('PUT', `/zones/${z.id}/workers/routes/${id}`, k, body);
		return { message: `Route ${pattern} ${isNew(id) ? 'added' : 'saved'}`, productId: z.id, follow: [] };
	},
};

const routeDestroy: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const routes = await routesOf(ctx, z);
		const p = pick(
			'Route',
			routes.map((r) => ({ value: str(r['id']), label: str(r['pattern']) })),
			ctx.id,
		);
		const r = routes.find((x) => str(x['id']) === p.value);
		return formTab(
			form({
				key: 'destroy',
				title: 'Delete a route',
				submit: 'Delete route',
				danger: true,
				confirmName: r ? str(r['pattern']) : null,
				blocked: r ? null : 'No routes.',
			}),
			p,
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const r = (await routesOf(ctx, z, k)).find((x) => str(x['id']) === (w.id ?? ctx.id));
		if (!r) throw new VendorError('Choose a route.', 400);
		confirmed(w, str(r['pattern']));
		await cfSend('DELETE', `/zones/${z.id}/workers/routes/${str(r['id'])}`, k);
		return { message: `Route ${str(r['pattern'])} deleted`, productId: null, follow: [] };
	},
};

export const ROUTES_EXTRA: ScreenExtra = {
	tabs: { route: (ctx) => routeForm.read(ctx), destroy: (ctx) => routeDestroy.read(ctx) },
	forms: { route: routeForm, destroy: routeDestroy },
	buttons: { list: [action('Add a route', 'route', 'primary'), action('Delete a route', 'destroy')] },
};

/* ===== Email Routing ===== */

type Act = Record<string, unknown>;
const ruleActionOf = (r: Record<string, unknown> | null) => rec(arr(r?.['actions'])[0]);
const actionWords = (a: Act) =>
	str(a['type']) === 'forward'
		? `forward to ${arr(a['value'])
				.map((x) => str(x))
				.join(', ')}`
		: str(a['type']) === 'worker'
			? `Worker ${arr(a['value'])
					.map((x) => str(x))
					.join(', ')}`
			: // Only actions emailAction made reach here, and each has a type ("drop" here).
				str(a['type']);

function emailAction(w: ProductWrite): Act {
	const kind = opt(w, 'action');
	if (kind === 'drop') return { type: 'drop' };
	const to = list(w, 'to');
	if (kind === 'worker') {
		if (!to.length) throw new VendorError('Name the Worker that receives the mail.', 400);
		return { type: 'worker', value: to.slice(0, 1) };
	}
	if (kind !== 'forward') throw new VendorError('Choose what happens to the mail.', 400);
	if (!to.length || !to.every((x) => EMAIL.test(x)))
		throw new VendorError('Forward to: verified destination addresses.', 400);
	return { type: 'forward', value: to };
}

const ACTIONS = [option('forward', 'Send to an address'), option('drop', 'Drop'), option('worker', 'Send to a Worker')];

const emailRuleForm: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const rules = (await cfAll(`/zones/${z.id}/email/routing/rules`, ctx.key)) ?? [];
		const p = pick(
			'Rule',
			[
				{ value: 'new', label: 'New routing rule' },
				...rules.map((r) => ({
					value: str(r['id']),
					label: str(r['name']) || str(rec(arr(r['matchers'])[0])['value']),
				})),
			],
			ctx.id,
		);
		const r = rules.find((x) => str(x['id']) === p.value) ?? null;
		const a = ruleActionOf(r);
		return formTab(
			form({
				key: 'rules',
				title: r ? `Edit ${str(r['name']) || 'routing rule'}` : 'New routing rule',
				submit: r ? 'Save rule' : 'Create rule',
				fields: [
					field('name', 'Name', 'text', { value: str(r?.['name']) }),
					field('address', 'Custom address', 'text', {
						value: str(rec(arr(r?.['matchers'])[0])['value']),
						required: true,
						help: `Like orders@${z.name}`,
					}),
					field('action', 'Then', 'select', { value: str(a['type']) || 'forward', options: ACTIONS }),
					field('to', 'Destination', 'text', {
						value: arr(a['value'])
							.map((x) => str(x))
							.join(', '),
						help: 'Verified destination addresses (comma between), or the Worker’s name',
					}),
					field('enabled', 'On', 'toggle', { value: r ? r['enabled'] !== false : true }),
				],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const address = text(w, 'address').toLowerCase();
		if (!EMAIL.test(address) || !address.endsWith(`@${z.name}`))
			throw new VendorError(`The custom address ends with @${z.name}.`, 400);
		const body = {
			name: opt(w, 'name') || address,
			enabled: bool(w, 'enabled'),
			matchers: [{ type: 'literal', field: 'to', value: address }],
			actions: [emailAction(w)],
		};
		const id = w.id ?? ctx.id;
		if (isNew(id)) await cfSend('POST', `/zones/${z.id}/email/routing/rules`, k, body);
		else await cfSend('PUT', `/zones/${z.id}/email/routing/rules/${id}`, k, body);
		// The rule has the one action emailAction made.
		return { message: `${address}: ${actionWords(body.actions[0] as Act)}`, productId: z.id, follow: [] };
	},
};

const emailRouting: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const [routing, catchAll] = await Promise.all([
			cfSoft(`/zones/${z.id}/email/routing`, ctx.key),
			cfSoft(`/zones/${z.id}/email/routing/rules/catch_all`, ctx.key),
		]);
		const a = ruleActionOf(rec(catchAll));
		return formTab(
			form({
				key: 'routing',
				title: 'Email Routing and the catch-all',
				submit: 'Save',
				fields: [
					field('on', 'Email Routing', 'select', {
						value: rec(routing)['enabled'] === true ? 'on' : 'off',
						options: [option('on', 'On'), option('off', 'Off')],
						help: 'On adds Cloudflare’s MX and SPF records to the domain.',
					}),
					field('catchAll', 'Catch-all', 'toggle', { value: rec(catchAll)['enabled'] === true }),
					field('action', 'Catch-all mail', 'select', { value: str(a['type']) || 'drop', options: ACTIONS }),
					field('to', 'Destination', 'text', {
						value: arr(a['value'])
							.map((x) => str(x))
							.join(', '),
					}),
				],
			}),
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const routing = rec(await cfSoft(`/zones/${z.id}/email/routing`, k));
		const wantOn = opt(w, 'on') === 'on';
		const said: string[] = [];
		if (wantOn !== (routing['enabled'] === true)) {
			await cfSend('POST', `/zones/${z.id}/email/routing/${wantOn ? 'enable' : 'disable'}`, k, {});
			said.push(`Email Routing ${wantOn ? 'on' : 'off'}`);
		}
		const act = emailAction(w);
		await cfSend('PUT', `/zones/${z.id}/email/routing/rules/catch_all`, k, {
			enabled: bool(w, 'catchAll'),
			matchers: [{ type: 'all' }],
			actions: [act],
		});
		said.push(`catch-all ${bool(w, 'catchAll') ? actionWords(act) : 'off'}`);
		return { message: said.join(' · '), productId: z.id, follow: [] };
	},
};

async function addressesOf(ctx: ProductCtx, z: Zone, key = ctx.key) {
	return (await cfAll(`/accounts/${z.account}/email/routing/addresses`, key)) ?? [];
}

const addressForm: ProductFormSpec = {
	read: async () =>
		formTab(
			form({
				key: 'address',
				title: 'Add a destination address',
				submit: 'Add and send the check',
				fields: [field('email', 'Email address', 'text', { required: true })],
				notes: [
					note(
						'Cloudflare emails this address a link; mail is forwarded to it only after the link is opened.',
						'muted',
					),
				],
			}),
		),
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const email = text(w, 'email').toLowerCase();
		if (!EMAIL.test(email)) throw new VendorError('An email address.', 400);
		await cfSend('POST', `/accounts/${z.account}/email/routing/addresses`, k, { email });
		return { message: `${email}: Cloudflare sent the check`, productId: null, follow: [] };
	},
};

async function emailThings(ctx: ProductCtx, z: Zone, key: string) {
	const [rules, addresses] = await Promise.all([
		cfAll(`/zones/${z.id}/email/routing/rules`, key),
		addressesOf(ctx, z, key),
	]);
	return [
		...(rules ?? []).map((r) => ({
			value: `rule:${str(r['id'])}`,
			label: `${str(r['name']) || 'rule'} (rule)`,
			name: str(r['name']) || str(r['id']),
			path: `/zones/${z.id}/email/routing/rules/${str(r['id'])}`,
		})),
		...addresses.map((a) => ({
			value: `address:${str(a['id'])}`,
			label: `${str(a['email'])} (destination)`,
			name: str(a['email']),
			path: `/accounts/${z.account}/email/routing/addresses/${str(a['id'])}`,
		})),
	];
}

const emailDestroy: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const things = await emailThings(ctx, z, ctx.key);
		const p = pick(
			'Rule or address',
			things.map((t) => ({ value: t.value, label: t.label })),
			ctx.id,
		);
		const t = things.find((x) => x.value === p.value);
		return formTab(
			form({
				key: 'destroy',
				title: 'Delete a routing rule or destination',
				submit: 'Delete',
				danger: true,
				confirmName: t ? t.name : null,
				blocked: t ? null : 'Nothing to delete.',
			}),
			p,
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const t = (await emailThings(ctx, z, k)).find((x) => x.value === (w.id ?? ctx.id));
		if (!t) throw new VendorError('Choose one.', 400);
		confirmed(w, t.name);
		await cfSend('DELETE', t.path, k);
		return { message: `${t.label} deleted`, productId: null, follow: [] };
	},
};

const addressesTab: Tab = async (ctx) => {
	const z = await zoneOf(ctx);
	const addresses = await addressesOf(ctx, z);
	return view({
		tables: [
			table(
				'Destination addresses',
				[col('email', 'Address', true), col('ok', 'Checked'), col('at', 'Added', true)],
				addresses.map((a) =>
					row(
						str(a['id']),
						str(a['email']),
						{
							email: str(a['email']),
							ok: str(a['verified']) ? `yes, ${when(str(a['verified']))}` : 'waiting for the link',
							at: when(str(a['created'])),
						},
						str(a['verified']) ? null : 'amber',
					),
				),
				'No destination addresses yet.',
			),
		],
		actions: [action('Add an address', 'address', 'primary'), action('Delete one', 'destroy')],
	});
};

export const EMAIL_EXTRA: ScreenExtra = {
	tabs: { rules: (ctx) => emailRuleForm.read(ctx), addresses: addressesTab },
	forms: { rules: emailRuleForm, routing: emailRouting, address: addressForm, destroy: emailDestroy },
	buttons: { settings: [action('Routing on or off, catch-all', 'routing'), action('New routing rule', 'rules')] },
};

/* ===== SSL/TLS: Universal SSL, custom hostnames ===== */

const universal: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const u = rec(await cfSoft(`/zones/${z.id}/ssl/universal/settings`, ctx.key));
		return formTab(
			form({
				key: 'universal',
				title: 'Universal SSL',
				submit: 'Save',
				fields: [
					field('enabled', 'Universal SSL certificate', 'select', {
						value: u['enabled'] === false ? 'off' : 'on',
						options: [option('on', 'On'), option('off', 'Off')],
					}),
				],
				notes: [
					note(
						'Off removes the free edge certificate: visitors then get certificate errors unless another certificate covers the domain.',
						'amber',
					),
				],
			}),
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const on = opt(w, 'enabled') !== 'off';
		await cfSend('PATCH', `/zones/${z.id}/ssl/universal/settings`, k, { enabled: on });
		return { message: `Universal SSL ${on ? 'on' : 'off'}`, productId: z.id, follow: [] };
	},
};

async function hostnamesOf(ctx: ProductCtx, z: Zone, key = ctx.key) {
	return (await cfAll(`/zones/${z.id}/custom_hostnames`, key)) ?? [];
}

const hostnamesTab: Tab = async (ctx) => {
	const z = await zoneOf(ctx);
	const [hosts, fallback] = await Promise.all([
		hostnamesOf(ctx, z),
		cfSoft(`/zones/${z.id}/custom_hostnames/fallback_origin`, ctx.key),
	]);
	return view({
		facts: [
			fact(
				'Fallback origin',
				str(rec(fallback)['origin']) || 'not set',
				str(rec(fallback)['status']) === 'active' ? 'ok' : null,
			),
		],
		tables: [
			table(
				'Custom hostnames',
				[
					col('host', 'Hostname', true),
					col('status', 'Status'),
					col('ssl', 'Certificate'),
					col('at', 'Added', true),
				],
				hosts.map((h) =>
					row(
						str(h['id']),
						str(h['hostname']),
						{
							host: str(h['hostname']),
							status: str(h['status']),
							ssl: str(rec(h['ssl'])['status']),
							at: when(str(h['created_at'])),
						},
						str(h['status']) === 'active' ? null : 'amber',
					),
				),
				'No custom hostnames: they are for other people’s domains served through this one (Cloudflare for SaaS).',
			),
		],
		actions: [
			action('Add or change a hostname', 'hostname', 'primary'),
			action('Fallback origin', 'fallback'),
			action('Remove a hostname', 'hostdelete'),
		],
	});
};

const hostnameForm: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const hosts = await hostnamesOf(ctx, z);
		const p = pick(
			'Hostname',
			[
				{ value: 'new', label: 'New custom hostname' },
				...hosts.map((h) => ({ value: str(h['id']), label: str(h['hostname']) })),
			],
			ctx.id,
		);
		const h = hosts.find((x) => str(x['id']) === p.value) ?? null;
		const ssl = rec(h?.['ssl']);
		return formTab(
			form({
				key: 'hostname',
				title: h ? `Edit ${str(h['hostname'])}` : 'Add a custom hostname',
				submit: h ? 'Save' : 'Add hostname',
				fields: [
					field('hostname', 'Hostname', 'text', {
						value: str(h?.['hostname']),
						required: true,
						readOnly: !!h,
					}),
					field('method', 'Prove control by', 'select', {
						value: str(ssl['method']) || 'http',
						options: [option('http', 'HTTP file'), option('txt', 'TXT record')],
					}),
					field('minTls', 'Minimum TLS', 'select', {
						value: str(rec(ssl['settings'])['min_tls_version']) || '1.2',
						options: ['1.0', '1.1', '1.2', '1.3'].map((v) => option(v, `TLS ${v}`)),
					}),
				],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const ssl = {
			method: opt(w, 'method') === 'txt' ? 'txt' : 'http',
			type: 'dv',
			settings: { min_tls_version: opt(w, 'minTls') || '1.2' },
		};
		const id = w.id ?? ctx.id;
		if (isNew(id)) {
			const hostname = text(w, 'hostname').toLowerCase();
			if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(hostname))
				throw new VendorError('A hostname like shop.example.com.', 400);
			await cfSend('POST', `/zones/${z.id}/custom_hostnames`, k, { hostname, ssl });
			return { message: `${hostname} added; Cloudflare shows what to prove`, productId: z.id, follow: [] };
		}
		await cfSend('PATCH', `/zones/${z.id}/custom_hostnames/${id}`, k, { ssl });
		return { message: 'Custom hostname saved', productId: z.id, follow: [] };
	},
};

const fallbackForm: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const f = rec(await cfSoft(`/zones/${z.id}/custom_hostnames/fallback_origin`, ctx.key));
		return formTab(
			form({
				key: 'fallback',
				title: 'Fallback origin',
				submit: 'Save',
				fields: [
					field('origin', 'Fallback origin', 'text', {
						value: str(f['origin']),
						required: true,
						help: `A proxied record on ${z.name}, like fallback.${z.name}`,
					}),
				],
			}),
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const origin = text(w, 'origin');
		if (!origin.endsWith(z.name)) throw new VendorError(`A hostname on ${z.name}.`, 400);
		await cfSend('PUT', `/zones/${z.id}/custom_hostnames/fallback_origin`, k, { origin });
		return { message: `Fallback origin ${origin}`, productId: z.id, follow: [] };
	},
};

const hostDelete: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const hosts = await hostnamesOf(ctx, z);
		const p = pick(
			'Hostname',
			hosts.map((h) => ({ value: str(h['id']), label: str(h['hostname']) })),
			ctx.id,
		);
		const h = hosts.find((x) => str(x['id']) === p.value);
		return formTab(
			form({
				key: 'hostdelete',
				title: 'Remove a custom hostname',
				submit: 'Remove',
				danger: true,
				confirmName: h ? str(h['hostname']) : null,
				blocked: h ? null : 'No custom hostnames.',
			}),
			p,
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const h = (await hostnamesOf(ctx, z, k)).find((x) => str(x['id']) === (w.id ?? ctx.id));
		if (!h) throw new VendorError('Choose a hostname.', 400);
		confirmed(w, str(h['hostname']));
		await cfSend('DELETE', `/zones/${z.id}/custom_hostnames/${str(h['id'])}`, k);
		return { message: `${str(h['hostname'])} removed`, productId: null, follow: [] };
	},
};

export const SSL_EXTRA: ScreenExtra = {
	tabs: { hostnames: hostnamesTab },
	forms: { universal, hostname: hostnameForm, fallback: fallbackForm, hostdelete: hostDelete },
	buttons: { edge: [action('Universal SSL', 'universal')] },
};

/* ===== Security tools: user-agent rules, IP access rules ===== */

const UA_MODES = [
	option('block', 'Block'),
	option('managed_challenge', 'Managed challenge'),
	option('js_challenge', 'JS challenge'),
	option('challenge', 'Interactive challenge'),
];
const IP_MODES = [...UA_MODES, option('whitelist', 'Allow')];

const uaForm: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const rules = (await cfAll(`/zones/${z.id}/firewall/ua_rules`, ctx.key)) ?? [];
		const p = pick(
			'User-agent rule',
			[
				{ value: 'new', label: 'New user-agent rule' },
				...rules.map((r) => ({
					value: str(r['id']),
					label: str(r['description']) || str(rec(r['configuration'])['value']),
				})),
			],
			ctx.id,
		);
		const r = rules.find((x) => str(x['id']) === p.value) ?? null;
		return formTab(
			form({
				key: 'ua',
				title: r ? 'Edit a user-agent rule' : 'New user-agent rule',
				submit: r ? 'Save rule' : 'Create rule',
				fields: [
					field('description', 'Name', 'text', { value: str(r?.['description']) }),
					field('ua', 'User agent (exact)', 'text', {
						value: str(rec(r?.['configuration'])['value']),
						required: true,
					}),
					field('mode', 'Then', 'select', { value: str(r?.['mode']) || 'block', options: UA_MODES }),
					field('paused', 'Paused', 'toggle', { value: r?.['paused'] === true }),
				],
				notes: [note('Free: 10 user-agent rules.', 'muted')],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const mode = opt(w, 'mode');
		if (!UA_MODES.some((m) => m.value === mode)) throw new VendorError('Choose what happens.', 400);
		const body = {
			description: opt(w, 'description'),
			mode,
			paused: bool(w, 'paused'),
			configuration: { target: 'ua', value: text(w, 'ua') },
		};
		const id = w.id ?? ctx.id;
		if (isNew(id)) await cfSend('POST', `/zones/${z.id}/firewall/ua_rules`, k, body);
		else await cfSend('PUT', `/zones/${z.id}/firewall/ua_rules/${id}`, k, body);
		return { message: `User-agent rule ${isNew(id) ? 'created' : 'saved'}`, productId: z.id, follow: [] };
	},
};

async function toolRules(ctx: ProductCtx, z: Zone, key: string) {
	const [ip, ua] = await Promise.all([
		cfAll(`/zones/${z.id}/firewall/access_rules/rules`, key),
		cfAll(`/zones/${z.id}/firewall/ua_rules`, key),
	]);
	return [
		...(ip ?? []).map((r) => ({
			value: `ip:${str(r['id'])}`,
			label: `${str(rec(r['configuration'])['value'])} (${str(r['mode'])}, IP rule)`,
			name: str(rec(r['configuration'])['value']),
			raw: r,
			path: `/zones/${z.id}/firewall/access_rules/rules/${str(r['id'])}`,
		})),
		...(ua ?? []).map((r) => ({
			value: `ua:${str(r['id'])}`,
			label: `${str(r['description']) || str(rec(r['configuration'])['value'])} (user-agent rule)`,
			name: str(rec(r['configuration'])['value']),
			raw: r,
			path: `/zones/${z.id}/firewall/ua_rules/${str(r['id'])}`,
		})),
	];
}

const ipEdit: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const all = (await toolRules(ctx, z, ctx.key)).filter((t) => t.value.startsWith('ip:'));
		const p = pick(
			'IP rule',
			all.map((t) => ({ value: t.value, label: t.label })),
			ctx.id,
		);
		const t = all.find((x) => x.value === p.value);
		return formTab(
			form({
				key: 'ipedit',
				title: 'Change an IP access rule',
				submit: 'Save rule',
				blocked: t ? null : 'No IP access rules.',
				fields: t
					? [
							field('mode', 'Then', 'select', { value: str(t.raw['mode']), options: IP_MODES }),
							field('notes', 'Note', 'text', { value: str(t.raw['notes']) }),
						]
					: [],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const t = (await toolRules(ctx, z, k)).find((x) => x.value === (w.id ?? ctx.id));
		if (!t || !t.value.startsWith('ip:')) throw new VendorError('Choose an IP rule.', 400);
		const mode = opt(w, 'mode');
		if (!IP_MODES.some((m) => m.value === mode)) throw new VendorError('Choose what happens.', 400);
		await cfSend('PATCH', t.path, k, { mode, notes: opt(w, 'notes') });
		return { message: `${t.name}: ${mode.replace(/_/g, ' ')}`, productId: z.id, follow: [] };
	},
};

const toolsDelete: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const all = await toolRules(ctx, z, ctx.key);
		const p = pick(
			'Rule',
			all.map((t) => ({ value: t.value, label: t.label })),
			ctx.id,
		);
		const t = all.find((x) => x.value === p.value);
		return formTab(
			form({
				key: 'toolsdelete',
				title: 'Delete an IP or user-agent rule',
				submit: 'Delete rule',
				danger: true,
				confirmName: t ? t.name : null,
				blocked: t ? null : 'No IP or user-agent rules.',
			}),
			p,
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const t = (await toolRules(ctx, z, k)).find((x) => x.value === (w.id ?? ctx.id));
		if (!t) throw new VendorError('Choose a rule.', 400);
		confirmed(w, t.name);
		await cfSend('DELETE', t.path, k);
		return { message: `${t.label} deleted`, productId: null, follow: [] };
	},
};

/** Security › Events: what Cloudflare blocked or challenged in the last 24 hours, and why. */
const eventsTab: Tab = async (ctx) => {
	const z = await zoneOf(ctx);
	const since = new Date(Date.now() - 24 * 3600_000).toISOString();
	const data = await graph(
		ctx,
		`query($zone: String!, $since: Time!) { viewer { zones(filter: { zoneTag: $zone }) {
			firewallEventsAdaptive(limit: 100, filter: { datetime_geq: $since }, orderBy: [datetime_DESC]) {
				action source datetime clientIP clientCountryName clientRequestHTTPHost clientRequestPath ruleId userAgent } } } }`,
		{ zone: z.id, since },
	);
	const events = arr(rec(arr(rec(rec(data)['viewer'])['zones'])[0])['firewallEventsAdaptive']).map(rec);
	const count = (key: string) => {
		const m = new Map<string, number>();
		for (const e of events) m.set(str(e[key]), (m.get(str(e[key])) ?? 0) + 1);
		return [...m.entries()].sort((a, b) => b[1] - a[1]);
	};
	return view({
		stats: [
			stat('Events (24 h, newest 100)', events.length, data ? 'from Cloudflare' : 'not readable with this key'),
			...count('action')
				.slice(0, 3)
				.map(([a, n]) => stat(a.replace(/_/g, ' '), n, 'action')),
		],
		tables: [
			table(
				'By source',
				[col('source', 'Source'), col('n', 'Events', true)],
				count('source').map(([src, n]) =>
					row(src, src, { source: src.replace(/([A-Z])/g, ' $1').toLowerCase(), n }),
				),
				'No events.',
			),
			table(
				'Latest events',
				[
					col('at', 'When', true),
					col('action', 'Action'),
					col('source', 'Source'),
					col('from', 'From'),
					col('path', 'Path', true),
				],
				events.map((e, n) =>
					row(
						String(n),
						str(e['clientRequestPath']),
						{
							at: when(str(e['datetime'])),
							action: str(e['action']).replace(/_/g, ' '),
							source: str(e['source']),
							from: `${str(e['clientCountryName'])} ${str(e['clientIP'])}`,
							path: `${str(e['clientRequestHTTPHost'])}${str(e['clientRequestPath'])}`.slice(0, 90),
						},
						str(e['action']) === 'block' ? 'red' : 'amber',
					),
				),
				'Nothing blocked or challenged in the last 24 hours.',
			),
		],
		notes: [
			note(
				'Free keeps 24 hours of events; Pro and up keep longer and can filter by every field on Cloudflare.',
				'muted',
			),
		],
	});
};

export const WAF_EXTRA: ScreenExtra = {
	tabs: { events: eventsTab },
	forms: { ua: uaForm, ipedit: ipEdit, toolsdelete: toolsDelete },
	buttons: {
		tools: [
			action('User-agent rule', 'ua'),
			action('Change an IP rule', 'ipedit'),
			action('Delete a rule', 'toolsdelete'),
		],
	},
};

/* ===== Access applications on this domain ===== */

async function appsOn(ctx: ProductCtx, z: Zone, key = ctx.key) {
	const apps = (await cfAll(`/accounts/${z.account}/access/apps`, key)) ?? [];
	return apps.filter(
		(a) => str(a['domain']).endsWith(z.name) && ['self_hosted', 'ssh', 'vnc', 'rdp'].includes(str(a['type'])),
	);
}
const peopleOf = (a: Record<string, unknown> | null) => {
	const inc = arr(rec(arr(a?.['policies'])[0])['include']).map(rec);
	return {
		emails: inc.map((i) => str(rec(i['email'])['email'])).filter(Boolean),
		domains: inc.map((i) => str(rec(i['email_domain'])['domain'])).filter(Boolean),
	};
};

const appForm: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const apps = await appsOn(ctx, z);
		const p = pick(
			'Application',
			[
				{ value: 'new', label: 'New application' },
				...apps.map((a) => ({ value: str(a['id']), label: `${str(a['name'])} · ${str(a['domain'])}` })),
			],
			ctx.id,
		);
		const a = apps.find((x) => str(x['id']) === p.value) ?? null;
		const who = peopleOf(a);
		return formTab(
			form({
				key: 'app',
				title: a ? `Edit ${str(a['name'])}` : 'Protect an address with Access',
				submit: a ? 'Save application' : 'Create application',
				blocked:
					a && str(a['type']) !== 'self_hosted'
						? 'Server SSH applications are kept by server create and the SSH list.'
						: null,
				fields: [
					field('name', 'Name', 'text', { value: str(a?.['name']), required: true }),
					field('domain', 'Address', 'text', {
						value: str(a?.['domain']),
						required: true,
						help: `Like admin.${z.name} or ${z.name}/internal`,
					}),
					field('session', 'Sign-in lasts', 'select', {
						value: str(a?.['session_duration']) || '24h',
						options: ['30m', '6h', '12h', '24h', '168h', '720h'].map((v) => option(v, v)),
					}),
					field('emails', 'People (emails)', 'textarea', {
						value: who.emails.join('\n'),
						help: 'One per line; they sign in with a code sent to that email',
					}),
					field('domains', 'Or everyone at (email domains)', 'text', { value: who.domains.join(', ') }),
				],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const domain = text(w, 'domain').toLowerCase();
		if (!domain.split('/')[0]?.endsWith(z.name)) throw new VendorError(`An address on ${z.name}.`, 400);
		const emails = list(w, 'emails');
		const domains = list(w, 'domains');
		if (!emails.every((e) => EMAIL.test(e))) throw new VendorError('People: email addresses.', 400);
		if (!emails.length && !domains.length) throw new VendorError('Name who may sign in.', 400);
		const body = {
			name: text(w, 'name'),
			domain,
			type: 'self_hosted',
			session_duration: opt(w, 'session') || '24h',
			policies: [
				{
					name: 'People allowed',
					decision: 'allow',
					precedence: 1,
					include: [
						...emails.map((email) => ({ email: { email } })),
						...domains.map((d) => ({ email_domain: { domain: d } })),
					],
				},
			],
		};
		const id = w.id ?? ctx.id;
		if (isNew(id)) await cfSend('POST', `/accounts/${z.account}/access/apps`, k, body);
		else await cfSend('PUT', `/accounts/${z.account}/access/apps/${id}`, k, body);
		return {
			message: `Access on ${domain}: ${emails.length + domains.length} allowed`,
			productId: z.id,
			follow: [],
		};
	},
};

const appDestroy: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const apps = (await appsOn(ctx, z)).filter((a) => str(a['type']) === 'self_hosted');
		const p = pick(
			'Application',
			apps.map((a) => ({ value: str(a['id']), label: `${str(a['name'])} · ${str(a['domain'])}` })),
			ctx.id,
		);
		const a = apps.find((x) => str(x['id']) === p.value);
		return formTab(
			form({
				key: 'destroy',
				title: 'Delete an Access application',
				submit: 'Delete application',
				danger: true,
				confirmName: a ? str(a['name']) : null,
				blocked: a ? null : 'No applications made here (server SSH applications go with their server).',
				notes: a ? [note(`${str(a['domain'])} becomes public again.`, 'amber')] : [],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const a = (await appsOn(ctx, z, k)).find(
			(x) => str(x['id']) === (w.id ?? ctx.id) && str(x['type']) === 'self_hosted',
		);
		if (!a) throw new VendorError('Choose an application.', 400);
		confirmed(w, str(a['name']));
		await cfSend('DELETE', `/accounts/${z.account}/access/apps/${str(a['id'])}`, k);
		return { message: `${str(a['name'])} deleted`, productId: null, follow: [] };
	},
};

export const ACCESS_EXTRA: ScreenExtra = {
	tabs: { app: (ctx) => appForm.read(ctx), destroy: (ctx) => appDestroy.read(ctx) },
	forms: { app: appForm, destroy: appDestroy },
	buttons: { list: [action('Protect an address', 'app', 'primary')] },
};

/* ===== Error pages: custom error rules ===== */

export const CUSTOM_ERROR_KIND: RuleKind = {
	tab: 'rules',
	phase: 'http_custom_errors',
	label: 'custom error rule',
	title: 'Custom error rules',
	action: 'serve_error',
	fields(r) {
		const p = rec(r?.['action_parameters']);
		return [
			field('status', 'Status code', 'number', { value: num(p['status_code']) || 503, min: 400, max: 999 }),
			field('contentType', 'Content type', 'select', {
				value: str(p['content_type']) || 'text/html',
				options: ['text/html', 'application/json', 'text/plain', 'text/xml'].map((v) => option(v, v)),
			}),
			field('content', 'Response body', 'textarea', { value: str(p['content']), help: 'Up to 10 KB' }),
		];
	},
	params(w) {
		const status = Number(opt(w, 'status'));
		if (!Number.isInteger(status) || status < 400 || status > 999)
			throw new VendorError('Status code: 400 to 999.', 400);
		const content = text(w, 'content');
		if (content.length > 10_240) throw new VendorError('The body is over 10 KB.', 400);
		return { status_code: status, content_type: opt(w, 'contentType') || 'text/html', content };
	},
	notes: [
		'Serves this body instead of the error for matching requests; the Error pages tab keeps the whole-domain pages.',
	],
};

export const ERROR_EXTRA: ScreenExtra = {
	tabs: { rules: (ctx) => ruleKindForm(CUSTOM_ERROR_KIND).read(ctx) },
	forms: { rules: ruleKindForm(CUSTOM_ERROR_KIND) },
};

/* ===== Speed: Observatory tests ===== */

const REGIONS = [
	option('asia-south1', 'Mumbai'),
	option('asia-southeast1', 'Singapore'),
	option('europe-west1', 'Belgium'),
	option('us-central1', 'Iowa'),
	option('us-east1', 'South Carolina'),
	option('australia-southeast1', 'Sydney'),
];

const observatoryTest: ProductFormSpec = {
	read: async (ctx) => {
		const z = await zoneOf(ctx);
		return formTab(
			form({
				key: 'test',
				title: 'Test a page with Observatory',
				submit: 'Run the test',
				fields: [
					field('url', 'Page', 'text', { value: `${z.name}/`, required: true, help: 'Without https://' }),
					field('region', 'From', 'select', { value: 'asia-south1', options: REGIONS }),
					field('weekly', 'Also test it every week', 'toggle', { value: false }),
				],
				notes: [
					note(
						'Free: a few tests a day; results appear on the Observatory tab when Cloudflare finishes (about a minute).',
						'muted',
					),
				],
			}),
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const url = text(w, 'url').replace(/^https?:\/\//, '');
		if (!url.startsWith(z.name)) throw new VendorError(`A page on ${z.name}.`, 400);
		const region = opt(w, 'region') || 'asia-south1';
		if (!REGIONS.some((r) => r.value === region)) throw new VendorError('Choose a region.', 400);
		await cfSend('POST', `/zones/${z.id}/speed_api/pages/${encodeURIComponent(url)}/tests`, k, { region });
		if (bool(w, 'weekly'))
			await cfSend(
				'POST',
				`/zones/${z.id}/speed_api/schedule/${encodeURIComponent(url)}?region=${region}`,
				k,
				{},
			);
		return {
			message: `Observatory is testing ${url}${bool(w, 'weekly') ? ' (and every week)' : ''}`,
			productId: z.id,
			follow: [],
		};
	},
};

export const SPEED_EXTRA: ScreenExtra = {
	forms: { test: observatoryTest },
	buttons: { observatory: [action('Test a page', 'test', 'primary')] },
};

/* ===== Caching: tiered cache ===== */

const tiered: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const t = rec(await cfSoft(`/zones/${z.id}/cache/tiered_cache_smart_topology_enable`, ctx.key));
		return formTab(
			form({
				key: 'tiered',
				title: 'Tiered cache',
				submit: 'Save',
				fields: [
					field('smart', 'Smart tiered cache', 'select', {
						value: str(t['value']) || 'off',
						options: [option('on', 'On'), option('off', 'Off')],
					}),
				],
				notes: [
					note(
						'Cloudflare’s data centres ask a nearer upper tier before the server, so the server sees fewer requests. Cache Reserve needs a paid add-on.',
						'muted',
					),
				],
			}),
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const value = opt(w, 'smart') === 'on' ? 'on' : 'off';
		await cfSend('PATCH', `/zones/${z.id}/cache/tiered_cache_smart_topology_enable`, k, { value });
		return { message: `Smart tiered cache ${value}`, productId: z.id, follow: [] };
	},
};

export const CACHE_EXTRA: ScreenExtra = {
	forms: { tiered },
	buttons: { config: [action('Tiered cache', 'tiered')] },
};

/* ===== Traffic: Argo Smart Routing (once the account has the add-on) ===== */

const argoForm: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const a = rec(await cfSoft(`/zones/${z.id}/argo/smart_routing`, ctx.key));
		return formTab(
			form({
				key: 'argo',
				title: 'Argo Smart Routing',
				submit: 'Save',
				blocked:
					a['editable'] === true
						? null
						: 'Argo is a paid add-on this account does not have yet; it is bought on Cloudflare.',
				fields: [
					field('on', 'Argo Smart Routing', 'select', {
						value: str(a['value']) || 'off',
						options: [option('on', 'On'), option('off', 'Off')],
					}),
				],
				cost: 'Argo is billed per GB of traffic it carries, on top of the monthly add-on.',
			}),
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const value = opt(w, 'on') === 'on' ? 'on' : 'off';
		await cfSend('PATCH', `/zones/${z.id}/argo/smart_routing`, k, { value });
		return { message: `Argo Smart Routing ${value}`, productId: z.id, follow: [] };
	},
};

export const TRAFFIC_EXTRA: ScreenExtra = { forms: { argo: argoForm } };
