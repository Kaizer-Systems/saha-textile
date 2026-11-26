/**
 * DigitalOcean: the rest of what its own pages can change without a new bill (owner, 23 Nov: the same
 * full parity as Cloudflare). Firewall rules out and attachments, reserved IPs, DNS domains and
 * records, uptime checks, projects, registry tags, databases' logical databases, pools and
 * maintenance window. Each change needs the PIN; deletes need the typed name.
 */
import type { ProductField, ProductWrite } from '@saha-textile/release-console-contracts';

import type { ProductCtx, ProductFormSpec } from './kit.js';
import { action, bool, confirmed, field, form, formTab, list, note, option, pick, text } from './kit.js';
import { type ScreenExtra } from './cf-zone-more.js';
import { doAll, doGet, doSend, dropletsOf } from './do-kit.js';
import { VendorError, arr, num, rec, str } from '../vendors/http.js';

type Rec = Record<string, unknown>;
const opt = (w: ProductWrite, key: string) => {
	const v = w.values[key];
	return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
};
const isNew = (id: string | null | undefined) => !id || id === 'new';

type Item = { value: string; label: string; raw?: Rec };
type Items<T> = (ctx: ProductCtx, k: string) => Promise<T[]>;
type Fields<T> = (it: T | null, ctx: ProductCtx) => Promise<ProductField[]> | ProductField[];
type More = { submit?: string; danger?: boolean; confirm?: boolean; notes?: string[] };
/** The name a delete asks to be typed: the label up to its first " · ". */
const nameOf = (it: Item) => it.label.split(' · ')[0] as string;

/**
 * A one-form tab with a "new" choice first: pick one or new, then the fields; `go` does the change
 * (null for new) and says what happened.
 */
function pickerOrNew<T extends Item>(
	key: string,
	title: string,
	items: Items<T>,
	fields: Fields<T>,
	go: (ctx: ProductCtx, k: string, it: T | null, w: ProductWrite) => Promise<string>,
	more: More & { allowNew?: string },
): ProductFormSpec {
	return {
		async read(ctx) {
			const all = await items(ctx, ctx.key);
			const choices = [...(more.allowNew ? [{ value: 'new', label: more.allowNew }] : []), ...all];
			const p = pick(title, choices, ctx.id);
			const it = all.find((x) => x.value === p.value) ?? null;
			return formTab(
				form({
					key,
					title,
					submit: more.submit ?? 'Save',
					danger: !!more.danger,
					confirmName: more.confirm && it ? nameOf(it) : null,
					blocked: !it && !more.allowNew ? 'Nothing here yet.' : null,
					fields: await fields(it, ctx),
					notes: (more.notes ?? []).map((n) => note(n, 'muted')),
				}),
				p,
			);
		},
		async send(ctx, w) {
			const k = await ctx.writeKey();
			const id = w.id ?? ctx.id;
			const it = isNew(id) ? null : ((await items(ctx, k)).find((x) => x.value === id) ?? null);
			if (!isNew(id) && !it) throw new VendorError('That one is gone; pick it again.', 404);
			if (!it && !more.allowNew) throw new VendorError('Choose one.', 400);
			if (more.confirm && it) confirmed(w, nameOf(it));
			return { message: await go(ctx, k, it, w), productId: it?.value ?? null, follow: [] };
		},
	};
}

/** A one-form tab: pick one, then the fields; `go` does the change to the picked one. */
function picker<T extends Item>(
	key: string,
	title: string,
	items: Items<T>,
	fields: Fields<T>,
	go: (ctx: ProductCtx, k: string, it: T, w: ProductWrite) => Promise<string>,
	more: More = {},
): ProductFormSpec {
	// With no "new" choice, send() refuses before `go` when nothing is picked, so `it` is always there.
	return pickerOrNew(key, title, items, fields, (ctx, k, it, w) => go(ctx, k, it as T, w), more);
}

/* ===== networking: firewall rules out, attachments, reserved IPs ===== */

const firewalls = async (_ctx: ProductCtx, k: string) =>
	(await doAll('/firewalls', 'firewalls', k)).map((f) => ({
		value: str(f['id']),
		label: str(f['name']),
		raw: f,
	}));

const ruleText = (dir: string, r: Rec) => {
	const ends = rec(r[dir === 'in' ? 'sources' : 'destinations']);
	return `${dir} ${str(r['protocol'])} ${str(r['ports']) || 'all'} ${[...arr(ends['addresses']), ...arr(ends['tags'])].map((x) => str(x)).join(',')}`;
};

const ruleRemove = picker(
	'ruleremove',
	'Remove a firewall rule',
	async (ctx, k) =>
		(await firewalls(ctx, k)).flatMap((f) => [
			...arr(f.raw?.['inbound_rules']).map((r, n) => ({
				value: `${f.value}:in:${n}`,
				label: `${f.label} · ${ruleText('in', rec(r))}`,
				raw: rec(r),
			})),
			...arr(f.raw?.['outbound_rules']).map((r, n) => ({
				value: `${f.value}:out:${n}`,
				label: `${f.label} · ${ruleText('out', rec(r))}`,
				raw: rec(r),
			})),
		]),
	() => [],
	async (_ctx, k, it) => {
		const [fw, dir] = it.value.split(':');
		const r = it.raw;
		const ends = dir === 'in' ? { sources: r['sources'] } : { destinations: r['destinations'] };
		await doSend('DELETE', `/firewalls/${fw}/rules`, k, {
			[dir === 'in' ? 'inbound_rules' : 'outbound_rules']: [
				{ protocol: r['protocol'], ports: r['ports'], ...ends },
			],
		});
		return `Rule removed: ${it.label}`;
	},
	{
		submit: 'Remove rule',
		danger: true,
		notes: ['Removing the last inbound HTTPS rule takes the site off line for visitors.'],
	},
);

const fwAttach = picker(
	'fwattach',
	'Servers and tags of a firewall',
	firewalls,
	async (it, ctx) => {
		const droplets = await dropletsOf(ctx.key);
		return [
			field('droplets', 'Servers it protects', 'multi', {
				value: arr(it?.raw?.['droplet_ids'])
					.map((x) => String(x))
					.join(','),
				options: droplets.map((d) => option(String(num(d['id'])), str(d['name']))),
			}),
			field('tags', 'And every server with these tags', 'text', {
				value: arr(it?.raw?.['tags'])
					.map((x) => str(x))
					.join(', '),
			}),
		];
	},
	async (_ctx, k, it, w) => {
		const want = list(w, 'droplets').map(Number).filter(Number.isInteger);
		const have = arr(it.raw['droplet_ids']).map((x) => Number(x));
		const add = want.filter((d) => !have.includes(d));
		const drop = have.filter((d) => !want.includes(d));
		if (add.length) await doSend('POST', `/firewalls/${it.value}/droplets`, k, { droplet_ids: add });
		if (drop.length) await doSend('DELETE', `/firewalls/${it.value}/droplets`, k, { droplet_ids: drop });
		const wantTags = list(w, 'tags');
		const haveTags = arr(it.raw['tags']).map((x) => str(x));
		const addT = wantTags.filter((t) => !haveTags.includes(t));
		const dropT = haveTags.filter((t) => !wantTags.includes(t));
		if (addT.length) await doSend('POST', `/firewalls/${it.value}/tags`, k, { tags: addT });
		if (dropT.length) await doSend('DELETE', `/firewalls/${it.value}/tags`, k, { tags: dropT });
		return `${it.label}: +${add.length + addT.length} −${drop.length + dropT.length}`;
	},
);

const reservedIps = async (_ctx: ProductCtx, k: string) =>
	(await doAll('/reserved_ips', 'reserved_ips', k)).map((ip) => ({
		value: str(ip['ip']),
		label: `${str(ip['ip'])} · ${str(rec(ip['droplet'])['name']) || 'not assigned'}`,
		raw: ip,
	}));

const ipOp = picker(
	'ipop',
	'Assign, unassign or release a reserved IP',
	reservedIps,
	async (it, ctx) => {
		const droplets = await dropletsOf(ctx.key);
		return [
			field('what', 'What', 'select', {
				value: it?.raw?.['droplet'] ? 'unassign' : 'assign',
				options: [
					option('assign', 'Assign to a server'),
					option('unassign', 'Unassign'),
					option('release', 'Release it (it is free while assigned; billed while unassigned)'),
				],
			}),
			field('droplet', 'Server', 'select', {
				value: '',
				options: droplets.map((d) => option(String(num(d['id'])), str(d['name']))),
			}),
		];
	},
	async (_ctx, k, it, w) => {
		const what = opt(w, 'what');
		if (what === 'assign')
			await doSend('POST', `/reserved_ips/${it.value}/actions`, k, {
				type: 'assign',
				droplet_id: Number(text(w, 'droplet')),
			});
		else if (what === 'unassign')
			await doSend('POST', `/reserved_ips/${it.value}/actions`, k, { type: 'unassign' });
		else if (what === 'release') await doSend('DELETE', `/reserved_ips/${it.value}`, k);
		else throw new VendorError('Choose what to do.', 400);
		return `${it.value}: ${what}`;
	},
	{ notes: ['DigitalOcean bills a reserved IP only while it is not assigned to a server.'] },
);

export const NET_EXTRA: ScreenExtra = {
	forms: { ruleremove: ruleRemove, fwattach: fwAttach, ipop: ipOp },
	buttons: {
		firewalls: [action('Remove a rule', 'ruleremove'), action('Servers and tags', 'fwattach')],
		ips: [action('Assign, unassign or release', 'ipop')],
	},
};

/* ===== DNS: domains and records ===== */

const domains = async (_ctx: ProductCtx, k: string) =>
	(await doAll('/domains', 'domains', k)).map((d) => ({
		value: str(d['name']),
		label: str(d['name']),
		raw: d,
	}));

const domainAdd = pickerOrNew(
	'domain',
	'Add a domain to DigitalOcean DNS',
	async () => [],
	() => [
		field('name', 'Domain', 'text', {
			required: true,
			help: 'Only for domains whose nameservers point at DigitalOcean; sahatextile.com stays on Cloudflare',
		}),
		field('ip', 'Point the apex at (optional)', 'text'),
	],
	async (_ctx, k, _it, w) => {
		const name = text(w, 'name').toLowerCase();
		if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name)) throw new VendorError('A domain like example.com.', 400);
		await doSend('POST', '/domains', k, { name, ...(opt(w, 'ip') ? { ip_address: opt(w, 'ip') } : {}) });
		return `${name} added to DigitalOcean DNS`;
	},
	{ allowNew: 'New domain', submit: 'Add domain' },
);

const recordDelete = picker(
	'recorddelete',
	'Delete a DNS record',
	async (ctx, k) =>
		(
			await Promise.all(
				(await domains(ctx, k)).map(async (d) =>
					(await doAll(`/domains/${d.value}/records`, 'domain_records', k)).map((r) => ({
						value: `${d.value}:${num(r['id'])}`,
						label: `${str(r['name'])}.${d.value} · ${str(r['type'])} ${str(r['data'])}`,
						raw: r,
					})),
				),
			)
		).flat(),
	() => [],
	async (_ctx, k, it) => {
		const [domain, id] = it.value.split(':');
		await doSend('DELETE', `/domains/${domain}/records/${id}`, k);
		return `Deleted ${it.label}`;
	},
	{ submit: 'Delete record', danger: true, confirm: true },
);

export const DODNS_EXTRA: ScreenExtra = {
	forms: { domain: domainAdd, recorddelete: recordDelete },
	buttons: { list: [action('Add a domain', 'domain', 'primary'), action('Delete a record', 'recorddelete')] },
};

/* ===== uptime checks ===== */

const checks = async (_ctx: ProductCtx, k: string) =>
	(await doAll('/uptime/checks', 'checks', k)).map((c) => ({
		value: str(c['id']),
		label: `${str(c['name'])} · ${str(c['target'])}`,
		raw: c,
	}));

const uptimeEdit = picker(
	'uptimeedit',
	'Change or delete an uptime check',
	checks,
	(it) => [
		field('name', 'Name', 'text', { value: str(it?.raw?.['name']) }),
		field('target', 'Address', 'text', { value: str(it?.raw?.['target']) }),
		field('regions', 'From', 'multi', {
			value: arr(it?.raw?.['regions'])
				.map((x) => str(x))
				.join(','),
			options: ['us_east', 'us_west', 'eu_west', 'se_asia'].map((r) => option(r, r.replace('_', ' '))),
		}),
		field('enabled', 'On', 'toggle', { value: it?.raw?.['enabled'] !== false }),
		field('delete', 'Delete this check instead', 'toggle', { value: false }),
	],
	async (_ctx, k, it, w) => {
		if (bool(w, 'delete')) {
			await doSend('DELETE', `/uptime/checks/${it.value}`, k);
			return `${it.label} deleted`;
		}
		const target = text(w, 'target');
		if (!/^https?:\/\//.test(target)) throw new VendorError('An address starting with https://.', 400);
		await doSend('PUT', `/uptime/checks/${it.value}`, k, {
			name: text(w, 'name'),
			target,
			type: target.startsWith('https') ? 'https' : 'http',
			regions: list(w, 'regions'),
			enabled: bool(w, 'enabled'),
		});
		return `${text(w, 'name')} saved`;
	},
);

export const MONITORING_EXTRA: ScreenExtra = {
	forms: { uptimeedit: uptimeEdit },
	buttons: { uptime: [action('Change or delete a check', 'uptimeedit')] },
};

/* ===== projects ===== */

const projects = async (_ctx: ProductCtx, k: string) =>
	(await doAll('/projects', 'projects', k)).map((p) => ({
		value: str(p['id']),
		label: `${str(p['name'])}${p['is_default'] ? ' (default)' : ''}`,
		raw: p,
	}));

const projectForm = pickerOrNew(
	'project',
	'Project',
	projects,
	(it) => [
		field('name', 'Name', 'text', { value: str(it?.raw?.['name']), required: true }),
		field('purpose', 'Purpose', 'text', { value: str(it?.raw?.['purpose']) || 'Web Application' }),
		field('environment', 'Environment', 'select', {
			value: str(it?.raw?.['environment']) || 'Production',
			options: ['Development', 'Staging', 'Production'].map((e) => option(e, e)),
		}),
		field('description', 'Description', 'text', { value: str(it?.raw?.['description']) }),
		field('isDefault', 'Default project for new resources', 'toggle', { value: it?.raw?.['is_default'] === true }),
	],
	async (_ctx, k, it, w) => {
		const body = {
			name: text(w, 'name'),
			purpose: opt(w, 'purpose') || 'Web Application',
			environment: opt(w, 'environment') || 'Production',
			description: opt(w, 'description'),
		};
		if (it) await doSend('PATCH', `/projects/${it.value}`, k, { ...body, is_default: bool(w, 'isDefault') });
		else await doSend('POST', '/projects', k, body);
		return `Project ${body.name} ${it ? 'saved' : 'made'}`;
	},
	{ allowNew: 'New project' },
);

const projectDelete = picker(
	'projectdelete',
	'Delete an empty project',
	async (ctx, k) => (await projects(ctx, k)).filter((p) => p.raw?.['is_default'] !== true),
	() => [],
	async (_ctx, k, it) => {
		await doSend('DELETE', `/projects/${it.value}`, k);
		return `Project ${it.label} deleted`;
	},
	{
		submit: 'Delete project',
		danger: true,
		confirm: true,
		notes: ['DigitalOcean deletes only a project with nothing in it; the default project stays.'],
	},
);

export const ACCOUNT_EXTRA: ScreenExtra = {
	forms: { project: projectForm, projectdelete: projectDelete },
	buttons: { keys: [action('Projects', 'project'), action('Delete a project', 'projectdelete')] },
};

/* ===== container registry tags ===== */

const tags = async (_ctx: ProductCtx, k: string) => {
	const reg = rec(rec(await doGet('/registry', k).catch(() => null))['registry']);
	const name = str(reg['name']);
	if (!name) return [];
	const repos = (await doAll(`/registry/${name}/repositoriesV2`, 'repositories', k, true)) ?? [];
	return (
		await Promise.all(
			repos.map(async (r) =>
				(
					(await doAll(
						`/registry/${name}/repositories/${encodeURIComponent(str(r['name']))}/tags`,
						'tags',
						k,
						true,
					)) ?? []
				).map((t) => ({
					value: `${name}|${str(r['name'])}|${str(t['tag'])}`,
					label: `${str(r['name'])}:${str(t['tag'])} · ${Math.round(num(t['compressed_size_bytes']) / 1_048_576)} MB`,
				})),
			),
		)
	).flat();
};

const tagDelete = picker(
	'tagdelete',
	'Delete an image tag',
	tags,
	() => [],
	async (_ctx, k, it) => {
		// Every tag's value is "registry|repository|tag".
		const [reg, repo, tag] = it.value.split('|') as [string, string, string];
		await doSend(
			'DELETE',
			`/registry/${reg}/repositories/${encodeURIComponent(repo)}/tags/${encodeURIComponent(tag)}`,
			k,
		);
		return `${repo}:${tag} deleted; run Clean up to free the space`;
	},
	{
		submit: 'Delete tag',
		danger: true,
		confirm: true,
		notes: ['A release can roll back only to a tag that still exists.'],
	},
);

export const REGISTRY_EXTRA: ScreenExtra = {
	forms: { tagdelete: tagDelete },
	buttons: { list: [action('Delete an image tag', 'tagdelete')] },
};

/* ===== managed databases: logical databases, pools, maintenance ===== */

const clusters = async (_ctx: ProductCtx, k: string) =>
	(await doAll('/databases', 'databases', k)).map((d) => ({
		value: str(d['id']),
		label: `${str(d['name'])} · ${str(d['engine'])}`,
		raw: d,
	}));

const dbInside = picker(
	'dbinside',
	'Databases, pools and maintenance',
	clusters,
	(it) => [
		field('what', 'What', 'select', {
			value: 'db',
			options: [
				option('db', 'Add a database'),
				option('dbdrop', 'Delete a database'),
				option('pool', 'Add a connection pool (PostgreSQL)'),
				option('pooldrop', 'Delete a pool'),
				option('maint', 'Maintenance window'),
			],
		}),
		field('name', 'Name', 'text', { help: 'Database or pool name' }),
		field('poolDb', 'Pool: database and user', 'text', { help: 'Like shop doadmin; pool size below' }),
		field('size', 'Pool size', 'number', { value: 10, min: 1, max: 100 }),
		field('day', 'Maintenance day', 'select', {
			value: str(rec(it?.raw?.['maintenance_window'])['day']) || 'sunday',
			options: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) =>
				option(d, d),
			),
		}),
		field('hour', 'Maintenance hour (UTC, HH:MM)', 'text', {
			value: str(rec(it?.raw?.['maintenance_window'])['hour']).slice(0, 5) || '20:30',
		}),
	],
	async (_ctx, k, it, w) => {
		const what = opt(w, 'what');
		const name = opt(w, 'name');
		if (['db', 'dbdrop', 'pool', 'pooldrop'].includes(what) && !/^[a-z0-9_]{1,63}$/.test(name))
			throw new VendorError('Name: lowercase letters, digits and _.', 400);
		if (what === 'db') await doSend('POST', `/databases/${it.value}/dbs`, k, { name });
		else if (what === 'dbdrop') await doSend('DELETE', `/databases/${it.value}/dbs/${name}`, k);
		else if (what === 'pool') {
			// A split always has a first part (empty when nothing was typed).
			const [db, user = ''] = opt(w, 'poolDb').split(/\s+/) as [string, ...string[]];
			await doSend('POST', `/databases/${it.value}/pools`, k, {
				name,
				mode: 'transaction',
				size: Number(opt(w, 'size') || '10'),
				db,
				user,
			});
		} else if (what === 'pooldrop') await doSend('DELETE', `/databases/${it.value}/pools/${name}`, k);
		else if (what === 'maint') {
			const hour = opt(w, 'hour');
			if (!/^\d{2}:\d{2}$/.test(hour)) throw new VendorError('Hour like 20:30.', 400);
			await doSend('PUT', `/databases/${it.value}/maintenance`, k, { day: opt(w, 'day'), hour });
		} else throw new VendorError('Choose what to do.', 400);
		return `${it.label}: ${what} ${name}`.trim();
	},
	{ notes: ['Users are made on DigitalOcean: a new user comes with a password, a secret.'] },
);

export const DATABASES_EXTRA: ScreenExtra = {
	forms: { dbinside: dbInside },
	buttons: { list: [action('Databases, pools, maintenance', 'dbinside')] },
};
