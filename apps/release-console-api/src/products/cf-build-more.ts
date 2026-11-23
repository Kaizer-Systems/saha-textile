/**
 * Cloudflare › Account: what Cloudflare's own product pages let you make, change and delete (owner,
 * 22 Nov: every page with its whole functionality). Workers, R2, KV, D1, Queues and Pages under Build;
 * Turnstile widgets, alert policies and Web Analytics. Anything that makes a secret (a new Turnstile
 * widget's secret key, Pages from Git) stays on Cloudflare's page, like API tokens.
 */
import type { ProductField, ProductWrite } from '@saha-textile/release-console-contracts';

import type { ProductCtx, ProductFormSpec } from './kit.js';
import {
	action,
	bool,
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
	table,
	text,
	view,
} from './kit.js';
import { CF_API, accountOf, cfAll, cfSend, cfSoft, zoneOf } from './cf-kit.js';
import { type ScreenExtra } from './cf-zone-more.js';
import { VendorError, arr, rec, str } from '../vendors/http.js';

type Rec = Record<string, unknown>;

const opt = (w: ProductWrite, key: string): string => {
	const v = w.values[key];
	return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
};
const isNew = (id: string | null | undefined) => !id || id === 'new';
const SLUG = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/** Any Cloudflare call with a body that is not JSON (code uploads, KV values). */
async function cfRaw(
	method: 'PUT' | 'POST',
	path: string,
	key: string,
	body: string | FormData,
	type?: string,
): Promise<unknown> {
	const res = await fetch(`${CF_API}${path}`, {
		method,
		headers: {
			authorization: `Bearer ${key}`,
			'user-agent': 'release-console',
			...(type ? { 'content-type': type } : {}),
		},
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

/* ----- a collection with its own id, one form for new or existing ----- */

interface Coll {
	key: string;
	label: string;
	list(key: string, a: string): Promise<Rec[]>;
	idOf(r: Rec): string;
	nameOf(r: Rec): string;
	fields(r: Rec | null, ctx: ProductCtx, a: string): Promise<ProductField[]> | ProductField[];
	save(w: ProductWrite, r: Rec | null, a: string, key: string): Promise<string>;
	remove?(r: Rec, a: string, key: string): Promise<void>;
	removeNote?(r: Rec): string;
	/** False for items the console must never delete. */
	canRemove?(r: Rec): boolean;
	notes?: string[];
	newBlocked?: string;
}

function collForm(c: Coll): ProductFormSpec {
	return {
		async read(ctx) {
			const a = await accountOf(ctx);
			const items = await c.list(ctx.key, a);
			const choices = [
				...(c.newBlocked ? [] : [{ value: 'new', label: `New ${c.label}` }]),
				...items.map((r) => ({ value: c.idOf(r), label: c.nameOf(r) })),
			];
			const p = pick(c.label, choices, ctx.id);
			const r = items.find((x) => c.idOf(x) === p.value) ?? null;
			return formTab(
				form({
					key: c.key,
					title: r ? `Change ${c.nameOf(r)}` : `New ${c.label}`,
					submit: r ? 'Save' : 'Create',
					blocked: !r && c.newBlocked ? c.newBlocked : null,
					fields: r || !c.newBlocked ? await c.fields(r, ctx, a) : [],
					notes: (c.notes ?? []).map((n) => note(n, 'muted')),
				}),
				p,
			);
		},
		async send(ctx, w) {
			const k = await ctx.writeKey();
			const a = await accountOf(ctx, k);
			const id = w.id ?? ctx.id;
			const r = isNew(id) ? null : ((await c.list(k, a)).find((x) => c.idOf(x) === id) ?? null);
			if (!isNew(id) && !r) throw new VendorError(`That ${c.label} is gone; pick it again.`, 404);
			if (!r && c.newBlocked) throw new VendorError(c.newBlocked, 400);
			return { message: await c.save(w, r, a, k), productId: a, follow: [] };
		},
	};
}

function deleteAcross(key: string, title: string, colls: Coll[]): ProductFormSpec {
	const everything = async (k: string, a: string) =>
		(
			await Promise.all(
				colls
					.filter((c) => c.remove)
					.map(async (c) =>
						(await c.list(k, a).catch(() => []))
							.filter((r) => c.canRemove?.(r) ?? true)
							.map((r) => ({ c, r })),
					),
			)
		).flat();
	return {
		async read(ctx) {
			const a = await accountOf(ctx);
			const all = await everything(ctx.key, a);
			const p = pick(
				'What',
				all.map(({ c, r }) => ({ value: `${c.key}:${c.idOf(r)}`, label: `${c.nameOf(r)} (${c.label})` })),
				ctx.id,
			);
			const hit = all.find(({ c, r }) => `${c.key}:${c.idOf(r)}` === p.value);
			return formTab(
				form({
					key,
					title,
					submit: 'Delete',
					danger: true,
					confirmName: hit ? c0(hit) : null,
					blocked: hit ? null : 'Nothing to delete.',
					notes: hit?.c.removeNote ? [note(hit.c.removeNote(hit.r), 'amber')] : [],
				}),
				p,
			);
		},
		async send(ctx, w) {
			const k = await ctx.writeKey();
			const a = await accountOf(ctx, k);
			const hit = (await everything(k, a)).find(({ c, r }) => `${c.key}:${c.idOf(r)}` === (w.id ?? ctx.id));
			if (!hit?.c.remove) throw new VendorError('Choose what to delete.', 400);
			confirmed(w, c0(hit));
			await hit.c.remove(hit.r, a, k);
			return { message: `${hit.c.label} ${hit.c.nameOf(hit.r)} deleted`, productId: null, follow: [] };
		},
	};
}
const c0 = ({ c, r }: { c: Coll; r: Rec }) => c.nameOf(r).split(' · ')[0] ?? c.idOf(r);

/* ===== Workers ===== */

const workers: Coll = {
	key: 'worker',
	label: 'Worker',
	list: async (k, a) => (await cfAll(`/accounts/${a}/workers/scripts`, k)) ?? [],
	idOf: (r) => str(r['id']),
	nameOf: (r) => str(r['id']),
	fields: (r) => [
		field('name', 'Name', 'text', { value: str(r?.['id']), required: true, readOnly: !!r }),
		field('code', 'Code (JavaScript module)', 'textarea', {
			help: r
				? 'Leave empty to keep the deployed code.'
				: 'export default { async fetch(request, env) { return new Response("Hello"); } }',
		}),
		field('date', 'Compatibility date', 'text', {
			value: str(r?.['compatibility_date']) || new Date().toISOString().slice(0, 10),
		}),
		field('workersDev', 'Answer on workers.dev', 'toggle', { value: false }),
	],
	async save(w, r, a, k) {
		const name = r ? str(r['id']) : text(w, 'name');
		if (!SLUG.test(name)) throw new VendorError('Name: lowercase letters, digits and -.', 400);
		const code = opt(w, 'code');
		if (!r && !code) throw new VendorError('Give the Worker’s code.', 400);
		if (code) {
			const body = new FormData();
			body.set(
				'metadata',
				JSON.stringify({
					main_module: 'worker.js',
					compatibility_date: opt(w, 'date') || new Date().toISOString().slice(0, 10),
				}),
			);
			body.set('worker.js', new Blob([code], { type: 'application/javascript+module' }), 'worker.js');
			await cfRaw('PUT', `/accounts/${a}/workers/scripts/${name}`, k, body);
		}
		await cfSend('POST', `/accounts/${a}/workers/scripts/${name}/subdomain`, k, {
			enabled: bool(w, 'workersDev'),
			previews_enabled: false,
		});
		return `Worker ${name} ${code ? 'deployed' : 'saved'}`;
	},
	remove: async (r, a, k) => {
		await cfSend('DELETE', `/accounts/${a}/workers/scripts/${str(r['id'])}?force=true`, k);
	},
	removeNote: () => 'Its routes and bindings go with it.',
};

/* ===== R2 ===== */

const LOCATIONS = [
	option('', 'Automatic'),
	option('apac', 'Asia-Pacific'),
	option('weur', 'Western Europe'),
	option('eeur', 'Eastern Europe'),
	option('enam', 'Eastern North America'),
	option('wnam', 'Western North America'),
	option('oc', 'Oceania'),
];

const buckets: Coll = {
	key: 'r2',
	label: 'R2 bucket',
	list: async (k, a) => (await cfAll(`/accounts/${a}/r2/buckets`, k)) ?? [],
	idOf: (r) => str(r['name']),
	nameOf: (r) => `${str(r['name'])} · ${str(r['location'])}`,
	async fields(r, ctx, a) {
		const name = str(r?.['name']);
		const [managed, cors] = r
			? await Promise.all([
					cfSoft(`/accounts/${a}/r2/buckets/${name}/domains/managed`, ctx.key),
					cfSoft(`/accounts/${a}/r2/buckets/${name}/cors`, ctx.key),
				])
			: [null, null];
		const origins = arr(rec(cors)['rules']).flatMap((x) =>
			arr(rec(rec(x)['allowed'])['origins']).map((o) => str(o)),
		);
		return [
			field('name', 'Name', 'text', { value: name, required: true, readOnly: !!r }),
			...(r ? [] : [field('location', 'Location', 'select', { value: '', options: LOCATIONS })]),
			field('public', 'Public r2.dev address', 'toggle', {
				value: rec(managed)['enabled'] === true,
				help: 'Anyone can read files by URL; for a shop, a custom domain is better.',
			}),
			field('origins', 'CORS: sites that may read it', 'text', {
				value: origins.join(', '),
				help: 'Like https://sahatextile.com; empty removes CORS',
			}),
		];
	},
	async save(w, r, a, k) {
		const name = r ? str(r['name']) : text(w, 'name');
		if (!SLUG.test(name)) throw new VendorError('Bucket name: 3–63 lowercase letters, digits and -.', 400);
		if (!r)
			await cfSend('POST', `/accounts/${a}/r2/buckets`, k, {
				name,
				...(opt(w, 'location') ? { locationHint: opt(w, 'location') } : {}),
			});
		await cfSend('PUT', `/accounts/${a}/r2/buckets/${name}/domains/managed`, k, { enabled: bool(w, 'public') });
		const origins = list(w, 'origins');
		if (!origins.every((o) => /^https?:\/\/[^\s/]+$/.test(o)))
			throw new VendorError('CORS sites like https://sahatextile.com.', 400);
		if (origins.length)
			await cfSend('PUT', `/accounts/${a}/r2/buckets/${name}/cors`, k, {
				rules: [{ allowed: { origins, methods: ['GET', 'HEAD'] }, maxAgeSeconds: 3600 }],
			});
		else if (r) await cfSend('DELETE', `/accounts/${a}/r2/buckets/${name}/cors`, k).catch(() => undefined);
		return `R2 bucket ${name} ${r ? 'saved' : 'made'}`;
	},
	remove: async (r, a, k) => {
		await cfSend('DELETE', `/accounts/${a}/r2/buckets/${str(r['name'])}`, k);
	},
	removeNote: () => 'Cloudflare deletes only an empty bucket.',
};

/* ===== KV ===== */

const kv: Coll = {
	key: 'kv',
	label: 'KV namespace',
	list: async (k, a) => (await cfAll(`/accounts/${a}/storage/kv/namespaces`, k)) ?? [],
	idOf: (r) => str(r['id']),
	nameOf: (r) => str(r['title']),
	fields: (r) => [field('title', 'Name', 'text', { value: str(r?.['title']), required: true })],
	async save(w, r, a, k) {
		const title = text(w, 'title');
		if (r) await cfSend('PUT', `/accounts/${a}/storage/kv/namespaces/${str(r['id'])}`, k, { title });
		else await cfSend('POST', `/accounts/${a}/storage/kv/namespaces`, k, { title });
		return `KV namespace ${title} ${r ? 'renamed' : 'made'}`;
	},
	remove: async (r, a, k) => {
		await cfSend('DELETE', `/accounts/${a}/storage/kv/namespaces/${str(r['id'])}`, k);
	},
	removeNote: () => 'Every key in it goes too.',
};

const kvValue: ProductFormSpec = {
	async read(ctx) {
		const a = await accountOf(ctx);
		const spaces = await kv.list(ctx.key, a);
		return formTab(
			form({
				key: 'kvvalue',
				title: 'Write or delete a KV value',
				submit: 'Save',
				blocked: spaces.length ? null : 'No KV namespaces yet.',
				fields: [
					field('ns', 'Namespace', 'select', {
						value: str(spaces[0]?.['id']),
						options: spaces.map((s) => option(str(s['id']), str(s['title']))),
					}),
					field('key', 'Key', 'text', { required: true }),
					field('value', 'Value', 'textarea', { help: 'Saved as text' }),
					field('delete', 'Delete this key instead', 'toggle', { value: false }),
				],
			}),
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const a = await accountOf(ctx, k);
		const ns = (await kv.list(k, a)).find((s) => str(s['id']) === opt(w, 'ns'));
		if (!ns) throw new VendorError('Choose a namespace.', 400);
		const key = text(w, 'key');
		const path = `/accounts/${a}/storage/kv/namespaces/${str(ns['id'])}/values/${encodeURIComponent(key)}`;
		if (bool(w, 'delete')) {
			await cfSend('DELETE', path, k);
			return { message: `${str(ns['title'])}: ${key} deleted`, productId: a, follow: [] };
		}
		await cfRaw('PUT', path, k, opt(w, 'value'), 'text/plain');
		return { message: `${str(ns['title'])}: ${key} saved`, productId: a, follow: [] };
	},
};

/* ===== D1 ===== */

const d1: Coll = {
	key: 'd1',
	label: 'D1 database',
	list: async (k, a) => (await cfAll(`/accounts/${a}/d1/database`, k)) ?? [],
	idOf: (r) => str(r['uuid']),
	nameOf: (r) => str(r['name']),
	newBlocked: undefined,
	fields: (r) =>
		r
			? [field('name', 'Name', 'text', { value: str(r['name']), readOnly: true })]
			: [
					field('name', 'Name', 'text', { required: true }),
					field('location', 'Location', 'select', { value: '', options: LOCATIONS }),
				],
	async save(w, r, a, k) {
		if (r) throw new VendorError('A D1 database keeps its name; use Run SQL to change its data.', 400);
		const name = text(w, 'name');
		if (!SLUG.test(name)) throw new VendorError('Name: lowercase letters, digits and -.', 400);
		await cfSend('POST', `/accounts/${a}/d1/database`, k, {
			name,
			...(opt(w, 'location') ? { primary_location_hint: opt(w, 'location') } : {}),
		});
		return `D1 database ${name} made`;
	},
	remove: async (r, a, k) => {
		await cfSend('DELETE', `/accounts/${a}/d1/database/${str(r['uuid'])}`, k);
	},
	removeNote: () => 'Its data goes with it.',
};

const d1Query: ProductFormSpec = {
	async read(ctx) {
		const a = await accountOf(ctx);
		const dbs = await d1.list(ctx.key, a);
		return formTab(
			form({
				key: 'd1query',
				title: 'Run SQL on a D1 database',
				submit: 'Run',
				blocked: dbs.length ? null : 'No D1 databases yet.',
				confirmName: null,
				fields: [
					field('db', 'Database', 'select', {
						value: str(dbs[0]?.['uuid']),
						options: dbs.map((d) => option(str(d['uuid']), str(d['name']))),
					}),
					field('sql', 'SQL', 'textarea', {
						required: true,
						help: 'One statement; a change to data needs the PIN like everything else here.',
					}),
				],
			}),
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const a = await accountOf(ctx, k);
		const db = (await d1.list(k, a)).find((d) => str(d['uuid']) === opt(w, 'db'));
		if (!db) throw new VendorError('Choose a database.', 400);
		const r = arr(
			await cfSend('POST', `/accounts/${a}/d1/database/${str(db['uuid'])}/query`, k, { sql: text(w, 'sql') }),
		);
		const first = rec(r[0]);
		const rows = arr(first['results']);
		const preview = JSON.stringify(rows.slice(0, 5)).slice(0, 400);
		return {
			message: `${str(db['name'])}: ${rows.length} rows${rows.length ? ` · ${preview}` : ''} · ${Number(rec(first['meta'])['changes'] ?? 0)} changed`,
			productId: a,
			follow: [],
		};
	},
};

/* ===== Queues and Pages ===== */

const queues: Coll = {
	key: 'queue',
	label: 'queue',
	list: async (k, a) => (await cfAll(`/accounts/${a}/queues`, k)) ?? [],
	idOf: (r) => str(r['queue_id']),
	nameOf: (r) => str(r['queue_name']),
	fields: (r) => [field('name', 'Name', 'text', { value: str(r?.['queue_name']), required: true })],
	async save(w, r, a, k) {
		const name = text(w, 'name');
		if (!SLUG.test(name)) throw new VendorError('Name: lowercase letters, digits and -.', 400);
		if (r) await cfSend('PATCH', `/accounts/${a}/queues/${str(r['queue_id'])}`, k, { queue_name: name });
		else await cfSend('POST', `/accounts/${a}/queues`, k, { queue_name: name });
		return `Queue ${name} ${r ? 'renamed' : 'made'}`;
	},
	remove: async (r, a, k) => {
		await cfSend('DELETE', `/accounts/${a}/queues/${str(r['queue_id'])}`, k);
	},
};

const pages: Coll = {
	key: 'pages',
	label: 'Pages project',
	list: async (k, a) => (await cfAll(`/accounts/${a}/pages/projects`, k)) ?? [],
	idOf: (r) => str(r['name']),
	nameOf: (r) => `${str(r['name'])} · ${str(r['subdomain'])}`,
	newBlocked: 'A Pages project is made on Cloudflare’s page: it connects to GitHub there, or takes a folder upload.',
	fields: (r) => [
		field('name', 'Name', 'text', { value: str(r?.['name']), readOnly: true }),
		field('branch', 'Production branch', 'text', { value: str(r?.['production_branch']), required: true }),
	],
	async save(w, r, a, k) {
		if (!r) throw new VendorError('A Pages project is made on Cloudflare’s page.', 400);
		await cfSend('PATCH', `/accounts/${a}/pages/projects/${str(r['name'])}`, k, {
			production_branch: text(w, 'branch'),
		});
		return `Pages project ${str(r['name'])} saved`;
	},
	remove: async (r, a, k) => {
		await cfSend('DELETE', `/accounts/${a}/pages/projects/${str(r['name'])}`, k);
	},
	removeNote: (r) => `${str(r['subdomain'])} stops answering.`,
};

/* ===== Turnstile ===== */

const MODES = [
	option('managed', 'Managed'),
	option('non-interactive', 'Non-interactive'),
	option('invisible', 'Invisible'),
];
const turnstile: Coll = {
	key: 'turnstile',
	label: 'Turnstile widget',
	list: async (k, a) => (await cfAll(`/accounts/${a}/challenges/widgets`, k)) ?? [],
	idOf: (r) => str(r['sitekey']),
	nameOf: (r) =>
		`${str(r['name'])} · ${arr(r['domains'])
			.map((x) => str(x))
			.join(', ')}`,
	newBlocked:
		'A new widget comes with a secret key, so it is made on Cloudflare’s page (Turnstile › Add widget); the secret then goes to Infisical.',
	fields: (r) => [
		field('name', 'Name', 'text', { value: str(r?.['name']), required: true }),
		field('domains', 'Domains', 'text', {
			value: arr(r?.['domains'])
				.map((x) => str(x))
				.join(', '),
			required: true,
		}),
		field('mode', 'Widget mode', 'select', { value: str(r?.['mode']) || 'managed', options: MODES }),
	],
	async save(w, r, a, k) {
		if (!r) throw new VendorError('A new widget is made on Cloudflare’s page.', 400);
		const mode = opt(w, 'mode');
		if (!MODES.some((m) => m.value === mode)) throw new VendorError('Choose a mode.', 400);
		await cfSend('PUT', `/accounts/${a}/challenges/widgets/${str(r['sitekey'])}`, k, {
			name: text(w, 'name'),
			domains: list(w, 'domains'),
			mode,
		});
		return `Turnstile widget ${text(w, 'name')} saved`;
	},
	remove: async (r, a, k) => {
		await cfSend('DELETE', `/accounts/${a}/challenges/widgets/${str(r['sitekey'])}`, k);
	},
	removeNote: () => 'Forms using its site key stop passing the check.',
};

/* ===== Alert policies ===== */

const alerts: Coll = {
	key: 'alert',
	label: 'alert',
	list: async (k, a) => (await cfAll(`/accounts/${a}/alerting/v3/policies`, k)) ?? [],
	idOf: (r) => str(r['id']),
	nameOf: (r) => `${str(r['name'])} · ${str(r['alert_type'])}`,
	async fields(r, ctx, a) {
		const avail = rec(await cfSoft(`/accounts/${a}/alerting/v3/available_alerts`, ctx.key));
		const types = Object.values(avail).flatMap((g) => arr(g).map(rec));
		return [
			field('name', 'Name', 'text', { value: str(r?.['name']), required: true }),
			field('type', 'Alert', 'select', {
				value: str(r?.['alert_type']) || str(types[0]?.['type']),
				options: types.map((t) =>
					option(
						str(t['type']),
						str(t['display_name']) || str(t['type']),
						str(t['description']).slice(0, 80),
					),
				),
				readOnly: !!r,
			}),
			field('emails', 'Email to', 'text', {
				value: arr(rec(r?.['mechanisms'])['email'])
					.map((m) => str(rec(m)['id']))
					.join(', '),
				required: true,
			}),
			field('enabled', 'On', 'toggle', { value: r ? r['enabled'] !== false : true }),
		];
	},
	async save(w, r, a, k) {
		const emails = list(w, 'emails');
		if (!emails.length || !emails.every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))
			throw new VendorError('Email to: addresses.', 400);
		const body = {
			name: text(w, 'name'),
			alert_type: r ? str(r['alert_type']) : text(w, 'type'),
			enabled: bool(w, 'enabled'),
			mechanisms: { email: emails.map((id) => ({ id })) },
			filters: rec(r?.['filters']),
		};
		if (r) await cfSend('PUT', `/accounts/${a}/alerting/v3/policies/${str(r['id'])}`, k, body);
		else await cfSend('POST', `/accounts/${a}/alerting/v3/policies`, k, body);
		return `Alert ${body.name} ${r ? 'saved' : 'made'}`;
	},
	remove: async (r, a, k) => {
		await cfSend('DELETE', `/accounts/${a}/alerting/v3/policies/${str(r['id'])}`, k);
	},
	notes: ['Some alerts need filters (which domain, which Worker); Cloudflare says so when one is missing.'],
};

/* ===== Web Analytics ===== */

const webAnalytics: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const sites = (await cfAll(`/accounts/${z.account}/rum/site_info/list`, ctx.key)) ?? [];
		const mine = sites.find((s) => str(rec(s['ruleset'])['zone_tag']) === z.id || str(s['host']) === z.name);
		return formTab(
			form({
				key: 'webanalytics',
				title: `Web Analytics for ${z.name}`,
				submit: 'Save',
				fields: [
					field('on', 'Count real shoppers’ page speed and visits', 'select', {
						value: mine && rec(mine['ruleset'])['enabled'] !== false ? 'on' : 'off',
						options: [option('on', 'On (Cloudflare adds its beacon to pages)'), option('off', 'Off')],
					}),
				],
				notes: [
					note(
						'Free and cookie-free. The beacon sends page speed and visit counts to Cloudflare; the shop’s cookie consent lists it under Analytics.',
						'muted',
					),
				],
			}),
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const sites = (await cfAll(`/accounts/${z.account}/rum/site_info/list`, k)) ?? [];
		const mine = sites.find((s) => str(rec(s['ruleset'])['zone_tag']) === z.id || str(s['host']) === z.name);
		const on = opt(w, 'on') === 'on';
		if (!mine && on)
			await cfSend('POST', `/accounts/${z.account}/rum/site_info`, k, { zone_tag: z.id, auto_install: true });
		else if (mine)
			await cfSend('PUT', `/accounts/${z.account}/rum/site_info/${str(mine['site_tag'])}`, k, {
				zone_tag: z.id,
				auto_install: true,
				enabled: on,
			});
		return { message: `Web Analytics ${on ? 'on' : 'off'} for ${z.name}`, productId: z.id, follow: [] };
	},
};

/* ===== where they go ===== */

const BUILD_COLLS = [workers, buckets, kv, d1, queues, pages];

export const DEV_EXTRA: ScreenExtra = {
	forms: {
		worker: collForm(workers),
		r2: collForm(buckets),
		pages: collForm(pages),
		builddelete: deleteAcross(
			'builddelete',
			'Delete a Worker, bucket, namespace, database, queue or Pages project',
			BUILD_COLLS,
		),
	},
	buttons: {
		list: [
			action('Worker', 'worker', 'primary'),
			action('R2 bucket', 'r2'),
			action('Pages project', 'pages'),
			action('Delete one', 'builddelete'),
		],
	},
};

export const BUILD_EXTRA: ScreenExtra = {
	forms: {
		worker: collForm(workers),
		r2: collForm(buckets),
		kv: collForm(kv),
		kvvalue: kvValue,
		d1: collForm(d1),
		d1query: d1Query,
		queue: collForm(queues),
		pages: collForm(pages),
		builddelete: deleteAcross(
			'builddelete',
			'Delete a Worker, bucket, namespace, database, queue or Pages project',
			BUILD_COLLS,
		),
	},
	buttons: {
		compute: [
			action('Worker', 'worker', 'primary'),
			action('Pages project', 'pages'),
			action('Queue', 'queue'),
			action('Delete one', 'builddelete'),
		],
		storage: [
			action('R2 bucket', 'r2', 'primary'),
			action('KV namespace', 'kv'),
			action('KV value', 'kvvalue'),
			action('D1 database', 'd1'),
			action('Run SQL', 'd1query'),
			action('Delete one', 'builddelete'),
		],
	},
};

export const TURNSTILE_EXTRA: ScreenExtra = {
	forms: {
		turnstile: collForm(turnstile),
		turnstiledelete: deleteAcross('turnstiledelete', 'Delete a Turnstile widget', [turnstile]),
	},
	buttons: { ddos: [action('Change a Turnstile widget', 'turnstile'), action('Delete a widget', 'turnstiledelete')] },
};

export const ALERTS_EXTRA: ScreenExtra = {
	forms: { alert: collForm(alerts), alertdelete: deleteAcross('alertdelete', 'Delete an alert', [alerts]) },
	buttons: {
		audit: [
			action('Alert by email', 'alert', 'primary'),
			action('Delete an alert', 'alertdelete'),
			action('Invite or change a member', 'member'),
			action('Remove a member', 'memberdelete'),
		],
	},
};

export const ANALYTICS_EXTRA: ScreenExtra = {
	forms: { webanalytics: webAnalytics },
	buttons: { analytics: [action('Web Analytics', 'webanalytics')] },
};

/* ===== members, bulk redirect lists, Vectorize ===== */

const members: Coll = {
	key: 'member',
	label: 'member',
	list: async (k, a) => (await cfAll(`/accounts/${a}/members`, k)) ?? [],
	idOf: (r) => str(r['id']),
	nameOf: (r) =>
		`${str(rec(r['user'])['email'])} · ${arr(r['roles'])
			.map((x) => str(rec(x)['name']))
			.join(', ')} · ${str(r['status'])}`,
	async fields(r, ctx, a) {
		const roles = (await cfAll(`/accounts/${a}/roles`, ctx.key)) ?? [];
		return [
			field('email', 'Email', 'text', { value: str(rec(r?.['user'])['email']), required: true, readOnly: !!r }),
			field('role', 'Role', 'select', {
				value: str(rec(arr(r?.['roles'])[0])['id']),
				options: roles.map((x) => option(str(x['id']), str(x['name']), str(x['description']).slice(0, 80))),
			}),
		];
	},
	async save(w, r, a, k) {
		const role = text(w, 'role');
		if (r) {
			await cfSend('PUT', `/accounts/${a}/members/${str(r['id'])}`, k, { roles: [{ id: role }] });
			return 'Member role changed';
		}
		const email = text(w, 'email').toLowerCase();
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new VendorError('An email address.', 400);
		await cfSend('POST', `/accounts/${a}/members`, k, { email, roles: [role], status: 'pending' });
		return `${email}: Cloudflare emailed the invitation`;
	},
	remove: async (r, a, k) => {
		await cfSend('DELETE', `/accounts/${a}/members/${str(r['id'])}`, k);
	},
	removeNote: () => 'They lose access to this account at once.',
	// Never the account's super administrators (the owner, and the login the console's token belongs to).
	canRemove: (r) => !arr(r['roles']).some((x) => /super administrator/i.test(str(rec(x)['name']))),
	notes: ['Inviting sends an email from Cloudflare to that address.'],
};

const redirectLists: Coll = {
	key: 'redirectlist',
	label: 'bulk redirect list',
	list: async (k, a) =>
		((await cfAll(`/accounts/${a}/rules/lists`, k)) ?? []).filter((l) => str(l['kind']) === 'redirect'),
	idOf: (r) => str(r['id']),
	nameOf: (r) => `${str(r['name'])} · ${Number(r['num_items'] ?? 0)} redirects`,
	newBlocked: 'A list is made by Rules › Upload bulk redirects on the domain.',
	fields: (r) => [field('description', 'Note', 'text', { value: str(r?.['description']) })],
	async save(w, r, a, k) {
		if (!r) throw new VendorError('A list is made by Upload bulk redirects.', 400);
		await cfSend('PUT', `/accounts/${a}/rules/lists/${str(r['id'])}`, k, { description: opt(w, 'description') });
		return 'List saved';
	},
	remove: async (r, a, k) => {
		await cfSend('DELETE', `/accounts/${a}/rules/lists/${str(r['id'])}`, k);
	},
	removeNote: () => 'Cloudflare refuses while a bulk redirect rule still uses it.',
};

const vectorize: Coll = {
	key: 'vectorize',
	label: 'Vectorize index',
	list: async (k, a) => (await cfAll(`/accounts/${a}/vectorize/v2/indexes`, k)) ?? [],
	idOf: (r) => str(r['name']),
	nameOf: (r) => `${str(r['name'])} · ${Number(rec(r['config'])['dimensions'] ?? 0)} dims`,
	fields: (r) => [
		field('name', 'Name', 'text', { value: str(r?.['name']), required: true, readOnly: !!r }),
		field('dimensions', 'Dimensions', 'number', {
			value: Number(rec(r?.['config'])['dimensions'] ?? 768),
			min: 1,
			max: 1536,
			readOnly: !!r,
		}),
		field('metric', 'Distance', 'select', {
			value: str(rec(r?.['config'])['metric']) || 'cosine',
			options: ['cosine', 'euclidean', 'dot-product'].map((m) => option(m, m)),
			readOnly: !!r,
		}),
		field('description', 'Note', 'text', { value: str(r?.['description']) }),
	],
	async save(w, r, a, k) {
		if (r) throw new VendorError('An index keeps its shape; delete and make a new one to change it.', 400);
		const name = text(w, 'name');
		if (!SLUG.test(name)) throw new VendorError('Name: lowercase letters, digits and -.', 400);
		await cfSend('POST', `/accounts/${a}/vectorize/v2/indexes`, k, {
			name,
			description: opt(w, 'description'),
			config: { dimensions: Number(opt(w, 'dimensions') || '768'), metric: opt(w, 'metric') || 'cosine' },
		});
		return `Vectorize index ${name} made`;
	},
	remove: async (r, a, k) => {
		await cfSend('DELETE', `/accounts/${a}/vectorize/v2/indexes/${str(r['name'])}`, k);
	},
};

export const MEMBERS_FORMS = {
	member: collForm(members),
	memberdelete: deleteAcross('memberdelete', 'Remove a member', [members]),
	redirectlist: collForm(redirectLists),
	redirectlistdelete: deleteAcross('redirectlistdelete', 'Delete a bulk redirect list', [redirectLists]),
	vectorize: collForm(vectorize),
	vectorizedelete: deleteAcross('vectorizedelete', 'Delete a Vectorize index', [vectorize]),
};

Object.assign(ALERTS_EXTRA.forms ?? {}, { member: MEMBERS_FORMS.member, memberdelete: MEMBERS_FORMS.memberdelete });
Object.assign(BUILD_EXTRA.forms ?? {}, {
	vectorize: MEMBERS_FORMS.vectorize,
	vectorizedelete: MEMBERS_FORMS.vectorizedelete,
});
BUILD_EXTRA.buttons?.['storage']?.push(
	action('Vectorize index', 'vectorize'),
	action('Delete an index', 'vectorizedelete'),
);

export const RULES_LISTS_EXTRA: ScreenExtra = {
	forms: { redirectlist: MEMBERS_FORMS.redirectlist, redirectlistdelete: MEMBERS_FORMS.redirectlistdelete },
	buttons: {
		overview: [action('Bulk redirect list', 'redirectlist'), action('Delete a list', 'redirectlistdelete')],
	},
};

/** Manage account › Members: who is on the account, their roles, invite and remove. */
ALERTS_EXTRA.tabs = {
	...ALERTS_EXTRA.tabs,
	members: async (ctx) => {
		const a = await accountOf(ctx);
		const list = await members.list(ctx.key, a);
		return view({
			tables: [
				table(
					'Members',
					[col('email', 'Email', true), col('roles', 'Roles'), col('status', 'Status')],
					list.map((m) =>
						row(str(m['id']), str(rec(m['user'])['email']), {
							email: str(rec(m['user'])['email']),
							roles: arr(m['roles'])
								.map((x) => str(rec(x)['name']))
								.join(', '),
							status: str(m['status']),
						}),
					),
					'No members.',
				),
			],
			actions: [
				action('Invite or change a member', 'member', 'primary'),
				action('Remove a member', 'memberdelete'),
			],
		});
	},
};
