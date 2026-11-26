/**
 * Cloudflare › Account › Zero Trust: what Cloudflare's Zero Trust pages let you add, change and delete
 * (owner, 22 Nov: every page with its whole functionality). Access applications on every domain of the
 * account, Access groups, private network routes, Gateway policies and lists, devices, the split tunnel
 * list and sign-in methods. Anything that makes a secret (service tokens, tunnels, OAuth sign-in) stays
 * on Cloudflare's page, like API tokens. The console never changes the sign-in that guards itself or a
 * server's SSH sign-in (server create keeps those), so a wrong rule cannot lock the owner out.
 */
import type { ProductField, ProductWrite } from '@saha-textile/release-console-contracts';

import type { ProductCtx, ProductFormSpec } from './kit.js';
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
	table,
	text,
	view,
	when,
} from './kit.js';
import { accountOf, cfAll, cfSend, cfSoft } from './cf-kit.js';
import { type ScreenExtra } from './cf-zone-more.js';
import { cfWrites } from '../vendors/cf-writes.js';
import { VendorError, arr, rec, str } from '../vendors/http.js';

type Rec = Record<string, unknown>;

const opt = (w: ProductWrite, key: string): string => {
	const v = w.values[key];
	return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
};
const isNew = (id: string | null | undefined) => !id || id === 'new';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CIDR = /^[0-9a-f.:]+\/\d{1,3}$/i;

/** The console's own address when it runs behind Access on a server; never changed from here. */
const consoleHost = () => {
	try {
		return new URL(process.env['CONSOLE_ORIGIN'] ?? '').host;
	} catch {
		return '';
	}
};
const guarded = (a: Rec) =>
	str(a['type']) !== 'self_hosted' || (!!consoleHost() && str(a['domain']).startsWith(consoleHost()));

/* ----- a collection: list, then one form for new or existing ----- */

interface Coll {
	key: string;
	title: string;
	label: string;
	list(ctx: ProductCtx, key: string, a: string): Promise<Rec[]>;
	nameOf(r: Rec): string;
	fields(r: Rec | null, ctx: ProductCtx, a: string): Promise<ProductField[]> | ProductField[];
	body(w: ProductWrite, r: Rec | null, a: string, ctx: ProductCtx): Promise<Rec> | Rec;
	path(a: string, id?: string): string;
	update?: 'PUT' | 'PATCH';
	blocked?(r: Rec | null): string | null;
	notes?: string[];
}

function collForm(c: Coll): ProductFormSpec {
	return {
		async read(ctx) {
			const a = await accountOf(ctx);
			const items = await c.list(ctx, ctx.key, a);
			const p = pick(
				c.title,
				[
					{ value: 'new', label: `New ${c.label}` },
					...items.map((r) => ({ value: str(r['id']), label: c.nameOf(r) })),
				],
				ctx.id,
			);
			const r = items.find((x) => str(x['id']) === p.value) ?? null;
			return formTab(
				form({
					key: c.key,
					title: r ? `Edit ${c.nameOf(r)}` : `New ${c.label}`,
					submit: r ? 'Save' : 'Create',
					blocked: c.blocked?.(r) ?? null,
					fields: await c.fields(r, ctx, a),
					notes: (c.notes ?? []).map((n) => note(n, 'muted')),
				}),
				p,
			);
		},
		async send(ctx, w) {
			const k = await ctx.writeKey();
			const a = await accountOf(ctx, k);
			const id = w.id ?? ctx.id;
			const r = isNew(id) ? null : ((await c.list(ctx, k, a)).find((x) => str(x['id']) === id) ?? null);
			if (!isNew(id) && !r) throw new VendorError(`That ${c.label} is gone; pick it again.`, 404);
			const blocked = c.blocked?.(r);
			if (blocked) throw new VendorError(blocked, 409);
			const body = await c.body(w, r, a, ctx);
			if (r) await cfSend(c.update ?? 'PUT', c.path(a, str(r['id'])), k, body);
			else await cfSend('POST', c.path(a), k, body);
			return {
				message:
					`${c.label[0]?.toUpperCase()}${c.label.slice(1)} ${str(body['name']) || ''} ${r ? 'saved' : 'created'}`.replace(
						/\s+/g,
						' ',
					),
				productId: a,
				follow: [],
			};
		},
	};
}

/* ----- people rules (Access applications and groups) ----- */

const peopleFields = (inc: Rec[]) => [
	field('emails', 'People (emails)', 'textarea', {
		value: inc
			.map((i) => str(rec(i['email'])['email']))
			.filter(Boolean)
			.join('\n'),
		help: 'One per line',
	}),
	field('domains', 'Everyone at (email domains)', 'text', {
		value: inc
			.map((i) => str(rec(i['email_domain'])['domain']))
			.filter(Boolean)
			.join(', '),
	}),
	field('ips', 'From addresses (IP ranges)', 'text', {
		value: inc
			.map((i) => str(rec(i['ip'])['ip']))
			.filter(Boolean)
			.join(', '),
	}),
	field('countries', 'From countries (two-letter codes)', 'text', {
		value: inc
			.map((i) => str(rec(i['geo'])['country_code']))
			.filter(Boolean)
			.join(', '),
	}),
];
function peopleInclude(w: ProductWrite): Rec[] {
	const emails = list(w, 'emails');
	const domains = list(w, 'domains');
	const ips = list(w, 'ips');
	const countries = list(w, 'countries').map((x) => x.toUpperCase());
	if (!emails.every((e) => EMAIL.test(e))) throw new VendorError('People: email addresses.', 400);
	if (!ips.every((ip) => CIDR.test(ip))) throw new VendorError('IP ranges like 203.0.113.0/24.', 400);
	if (!countries.every((c) => /^[A-Z]{2}$/.test(c)))
		throw new VendorError('Countries: two-letter codes like IN.', 400);
	const inc = [
		...emails.map((email) => ({ email: { email } })),
		...domains.map((domain) => ({ email_domain: { domain } })),
		...ips.map((ip) => ({ ip: { ip } })),
		...countries.map((country_code) => ({ geo: { country_code } })),
	];
	if (!inc.length) throw new VendorError('Name who is let in.', 400);
	return inc;
}

const accountZones = async (ctx: ProductCtx, key: string, a: string) =>
	((await cfAll(`/zones?account.id=${a}`, key)) ?? []).map((z) => str(z['name']));

const apps: Coll = {
	key: 'apps',
	title: 'Application',
	label: 'Access application',
	list: async (_ctx, key, a) =>
		((await cfAll(`/accounts/${a}/access/apps`, key)) ?? []).filter((x) => str(x['type']) !== 'warp'),
	nameOf: (r) => `${str(r['name'])} · ${str(r['domain']) || str(r['type'])}`,
	blocked: (r) =>
		r && guarded(r)
			? 'Server SSH sign-ins and the console’s own sign-in are kept by server create and the SSH list, so they cannot lock you out.'
			: null,
	fields: (r) => [
		field('name', 'Name', 'text', { value: str(r?.['name']), required: true }),
		field('domain', 'Address', 'text', {
			value: str(r?.['domain']),
			required: true,
			help: 'On one of the account’s domains, like admin.sahatextile.com or sahatextile.com/internal',
		}),
		field('session', 'Sign-in lasts', 'select', {
			value: str(r?.['session_duration']) || '24h',
			options: ['30m', '6h', '12h', '24h', '168h', '720h'].map((v) => option(v, v)),
		}),
		...peopleFields(arr(rec(arr(r?.['policies'])[0])['include']).map(rec)),
	],
	async body(w, _r, a, ctx) {
		const domain = text(w, 'domain').toLowerCase();
		const zones = await accountZones(ctx, await ctx.writeKey(), a);
		if (!zones.some((z) => domain.split('/')[0]?.endsWith(z)))
			throw new VendorError(`An address on ${zones.join(' or ')}.`, 400);
		return {
			name: text(w, 'name'),
			domain,
			type: 'self_hosted',
			session_duration: opt(w, 'session') || '24h',
			policies: [{ name: 'People allowed', decision: 'allow', precedence: 1, include: peopleInclude(w) }],
		};
	},
	path: (a, id) => `/accounts/${a}/access/apps${id ? `/${id}` : ''}`,
};

const groups: Coll = {
	key: 'groups',
	title: 'Group',
	label: 'Access group',
	list: async (_ctx, key, a) => (await cfAll(`/accounts/${a}/access/groups`, key)) ?? [],
	nameOf: (r) => str(r['name']),
	fields: (r) => [
		field('name', 'Name', 'text', { value: str(r?.['name']), required: true }),
		...peopleFields(arr(r?.['include']).map(rec)),
	],
	body: (w) => ({ name: text(w, 'name'), include: peopleInclude(w) }),
	path: (a, id) => `/accounts/${a}/access/groups${id ? `/${id}` : ''}`,
	notes: [
		'A group can be named in an application’s rule on Cloudflare’s page; the console’s application form uses people and addresses directly.',
	],
};

const routes: Coll = {
	key: 'routes',
	title: 'Route',
	label: 'private network route',
	list: async (_ctx, key, a) => (await cfAll(`/accounts/${a}/teamnet/routes?is_deleted=false`, key)) ?? [],
	nameOf: (r) => `${str(r['network'])} · ${str(r['comment']) || str(r['tunnel_name'])}`,
	async fields(r, ctx, a) {
		const tunnels = (await cfAll(`/accounts/${a}/cfd_tunnel?is_deleted=false`, ctx.key)) ?? [];
		return [
			field('network', 'Network (CIDR)', 'text', {
				value: str(r?.['network']),
				required: true,
				readOnly: !!r,
				help: 'Like 10.122.0.0/20 or 10.122.0.4/32',
			}),
			field('tunnel', 'Through tunnel', 'select', {
				value: str(r?.['tunnel_id']),
				options: tunnels.map((t) => option(str(t['id']), str(t['name']))),
				readOnly: !!r,
			}),
			field('comment', 'Note', 'text', { value: str(r?.['comment']) }),
		];
	},
	body(w, r) {
		if (r) return { comment: opt(w, 'comment') };
		const network = text(w, 'network');
		if (!CIDR.test(network)) throw new VendorError('Network like 10.122.0.0/20.', 400);
		return { network, tunnel_id: text(w, 'tunnel'), comment: opt(w, 'comment') };
	},
	path: (a, id) => `/accounts/${a}/teamnet/routes${id ? `/${id}` : ''}`,
	update: 'PATCH',
	notes: ['WARP devices reach this network through the tunnel; server create adds each server’s own route.'],
};

const GATEWAY_ACTIONS: Record<string, string[]> = {
	dns: ['block', 'allow', 'safesearch', 'ytrestricted'],
	http: ['block', 'allow', 'off', 'noscan'],
	l4: ['block', 'allow', 'audit_ssh'],
};
const gateway: Coll = {
	key: 'gateway',
	title: 'Policy',
	label: 'Gateway policy',
	list: async (_ctx, key, a) => (await cfAll(`/accounts/${a}/gateway/rules`, key)) ?? [],
	nameOf: (r) =>
		`${str(r['name'])} (${arr(r['filters'])
			.map((x) => str(x))
			.join(', ')})`,
	fields: (r) => [
		field('name', 'Name', 'text', { value: str(r?.['name']), required: true }),
		field('kind', 'Kind', 'select', {
			value: str(arr(r?.['filters'])[0]) || 'dns',
			options: [option('dns', 'DNS'), option('http', 'HTTP'), option('l4', 'Network')],
			readOnly: !!r,
		}),
		field('traffic', 'When (traffic expression)', 'textarea', {
			value: str(r?.['traffic']),
			required: true,
			help: 'Like any(dns.domains[*] == "example.com") or http.request.host == "example.com"',
		}),
		field('action', 'Then', 'select', {
			value: str(r?.['action']) || 'block',
			options: [...new Set(Object.values(GATEWAY_ACTIONS).flat())].map((v) => option(v, v.replace(/_/g, ' '))),
		}),
		field('precedence', 'Order (lower runs first)', 'number', {
			value: Number(r?.['precedence'] ?? 1000),
			min: 0,
			max: 99999,
		}),
		field('enabled', 'On', 'toggle', { value: r ? r['enabled'] !== false : true }),
	],
	body(w, r) {
		const kind = r ? str(arr(r['filters'])[0]) : opt(w, 'kind');
		const act = opt(w, 'action');
		if (!GATEWAY_ACTIONS[kind]?.includes(act))
			throw new VendorError(`A ${kind} policy can ${GATEWAY_ACTIONS[kind]?.join(', ')}.`, 400);
		const traffic = text(w, 'traffic');
		if (traffic.length > 4000 || /[`;]/.test(traffic))
			throw new VendorError('The expression has characters Gateway does not use.', 400);
		return {
			name: text(w, 'name'),
			filters: [kind],
			traffic,
			action: act,
			precedence: Number(opt(w, 'precedence') || '1000'),
			enabled: w.values['enabled'] === true,
			identity: '',
			device_posture: '',
		};
	},
	path: (a, id) => `/accounts/${a}/gateway/rules${id ? `/${id}` : ''}`,
	notes: [
		'Gateway policies apply to devices signed in to WARP; WARP here carries only server addresses, so DNS and HTTP policies see little until the profile sends more.',
	],
};

const LIST_TYPES = ['DOMAIN', 'URL', 'IP', 'EMAIL', 'SERIAL'];
const lists: Coll = {
	key: 'lists',
	title: 'List',
	label: 'Zero Trust list',
	list: async (_ctx, key, a) => (await cfAll(`/accounts/${a}/gateway/lists`, key)) ?? [],
	nameOf: (r) => `${str(r['name'])} (${str(r['type'])}, ${Number(r['count'] ?? 0)})`,
	async fields(r, ctx, a) {
		const items = r
			? arr(await cfSoft(`/accounts/${a}/gateway/lists/${str(r['id'])}/items`, ctx.key))
					.flat()
					.map(rec)
			: [];
		return [
			field('name', 'Name', 'text', { value: str(r?.['name']), required: true }),
			field('type', 'Kind', 'select', {
				value: str(r?.['type']) || 'DOMAIN',
				options: LIST_TYPES.map((t) => option(t, t.toLowerCase())),
				readOnly: !!r,
			}),
			field('description', 'Note', 'text', { value: str(r?.['description']) }),
			field('items', 'Entries', 'textarea', {
				value: items.map((i) => str(i['value'])).join('\n'),
				help: 'One per line',
			}),
		];
	},
	body(w, r) {
		const type = r ? str(r['type']) : opt(w, 'type');
		if (!LIST_TYPES.includes(type)) throw new VendorError('Choose a kind.', 400);
		const items = text(w, 'items', false)
			.split('\n')
			.map((x) => x.trim())
			.filter(Boolean)
			.map((value) => ({ value }));
		return { name: text(w, 'name'), description: opt(w, 'description'), ...(r ? {} : { type }), items };
	},
	path: (a, id) => `/accounts/${a}/gateway/lists${id ? `/${id}` : ''}`,
};

/* ----- split tunnel (default device profile) ----- */

const splitTunnel: ProductFormSpec = {
	async read(ctx) {
		const a = await accountOf(ctx);
		const p = rec(await cfSoft(`/accounts/${a}/devices/policy`, ctx.key));
		const mode = arr(p['include']).length ? 'include' : 'exclude';
		const entries = arr(p[mode]).map(rec);
		return formTab(
			form({
				key: 'split',
				title: 'Split tunnel (default device profile)',
				submit: 'Save the list',
				fields: [
					field('mode', 'WARP carries', 'select', {
						value: mode,
						options: [
							option('include', 'Only these addresses (include)'),
							option('exclude', 'Everything except these (exclude)'),
						],
					}),
					field('entries', 'Addresses', 'textarea', {
						value: entries
							.map(
								(e) =>
									`${str(e['address']) || str(e['host'])}${str(e['description']) ? ` # ${str(e['description'])}` : ''}`,
							)
							.join('\n'),
						help: 'One per line: an address range or a hostname, then # and a note',
					}),
				],
				notes: [
					note(
						'Changing the mode or the list changes every signed-in device at once. Server create keeps each server’s address in the include list.',
						'amber',
					),
				],
			}),
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const a = await accountOf(ctx, k);
		const mode = opt(w, 'mode') === 'exclude' ? 'exclude' : 'include';
		const entries = text(w, 'entries')
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean)
			.map((l) => {
				const [target = '', ...rest] = l.split('#');
				const t = target.trim();
				const description = rest.join('#').trim();
				if (CIDR.test(t) || /^[0-9.]+$/.test(t))
					return { address: t.includes('/') ? t : `${t}/32`, description };
				if (/^[a-z0-9*.-]+$/i.test(t)) return { host: t, description };
				throw new VendorError(`${t}: an address range or a hostname.`, 400);
			});
		await cfSend('PUT', `/accounts/${a}/devices/policy/${mode}`, k, entries);
		return { message: `Split tunnel: ${mode} ${entries.length} entries`, productId: a, follow: [] };
	},
};

/* ----- devices and sign-in methods ----- */

const devicesTab = async (ctx: ProductCtx) => {
	const a = await accountOf(ctx);
	const [devices, idps] = await Promise.all([
		cfAll(`/accounts/${a}/devices`, ctx.key),
		cfAll(`/accounts/${a}/access/identity_providers`, ctx.key),
	]);
	return view({
		tables: [
			table(
				'Signed-in devices',
				[col('name', 'Device'), col('user', 'Person'), col('os', 'System'), col('seen', 'Last seen', true)],
				(devices ?? []).map((d) =>
					row(str(d['id']), str(d['name']), {
						name: str(d['name']),
						user: str(rec(d['user'])['email']),
						os: `${str(d['os_distro_name']) || str(d['device_type'])} ${str(d['os_version'])}`,
						seen: when(str(d['last_seen'])),
					}),
				),
				'No devices signed in yet: the first server create lets the SSH list sign devices in.',
			),
			table(
				'Sign-in methods',
				[col('name', 'Method'), col('type', 'Kind')],
				(idps ?? []).map((i) =>
					row(str(i['id']), str(i['name']) || str(i['type']), {
						name: str(i['name']) || str(i['type']),
						type: str(i['type']),
					}),
				),
				'No sign-in methods.',
			),
		],
		notes: [
			note(
				'Sign-in methods that need a client secret (Google, GitHub, Okta…) are added on Cloudflare’s page.',
				'muted',
			),
		],
		actions: [
			action('Add sign-in by email code', 'emailcode'),
			action('Split tunnel', 'split'),
			action('Sign a device out', 'revoke'),
		],
	});
};

const emailCode: ProductFormSpec = {
	read: async () =>
		formTab(
			form({
				key: 'emailcode',
				title: 'Sign-in by email code',
				submit: 'Add it',
				fields: [],
				notes: [
					note(
						'People type their email and get a one-time code: the method the SSH terminal and WARP use.',
						'muted',
					),
				],
			}),
		),
	async send(ctx) {
		const k = await ctx.writeKey();
		const a = await accountOf(ctx, k);
		const added = await cfWrites.emailCodeSignIn(k, a);
		return {
			message: added ? 'Sign-in by email code added' : 'Sign-in by email code was already there',
			productId: a,
			follow: [],
		};
	},
};

const revoke: ProductFormSpec = {
	async read(ctx) {
		const a = await accountOf(ctx);
		const devices = (await cfAll(`/accounts/${a}/devices`, ctx.key)) ?? [];
		const p = pick(
			'Device',
			devices.map((d) => ({ value: str(d['id']), label: `${str(d['name'])} · ${str(rec(d['user'])['email'])}` })),
			ctx.id,
		);
		const d = devices.find((x) => str(x['id']) === p.value);
		return formTab(
			form({
				key: 'revoke',
				title: 'Sign a device out',
				submit: 'Sign it out',
				danger: true,
				confirmName: d ? str(d['name']) : null,
				blocked: d ? null : 'No devices.',
			}),
			p,
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const a = await accountOf(ctx, k);
		const d = ((await cfAll(`/accounts/${a}/devices`, k)) ?? []).find((x) => str(x['id']) === (w.id ?? ctx.id));
		if (!d) throw new VendorError('Choose a device.', 400);
		confirmed(w, str(d['name']));
		await cfSend('POST', `/accounts/${a}/devices/revoke`, k, [str(d['id'])]);
		return {
			message: `${str(d['name'])} signed out; it signs in again only with a new code`,
			productId: null,
			follow: [],
		};
	},
};

/* ----- deleting any of these ----- */

const COLLS = [apps, groups, routes, gateway, lists];

const ztDelete: ProductFormSpec = {
	async read(ctx) {
		const a = await accountOf(ctx);
		const all = (await Promise.all(COLLS.map(async (c) => (await c.list(ctx, ctx.key, a)).map((r) => ({ c, r })))))
			.flat()
			.filter(({ r, c }) => !(c === apps && guarded(r)));
		const p = pick(
			'What',
			all.map(({ c, r }) => ({ value: `${c.key}:${str(r['id'])}`, label: `${c.nameOf(r)} (${c.label})` })),
			ctx.id,
		);
		const hit = all.find(({ c, r }) => `${c.key}:${str(r['id'])}` === p.value);
		return formTab(
			form({
				key: 'ztdelete',
				title: 'Delete a Zero Trust item',
				submit: 'Delete',
				danger: true,
				confirmName: hit ? str(hit.r['name']) || str(hit.r['network']) : null,
				blocked: hit ? null : 'Nothing made here to delete.',
				notes: hit && hit.c === apps ? [note(`${str(hit.r['domain'])} becomes public again.`, 'amber')] : [],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const a = await accountOf(ctx, k);
		const [ck, id] = (w.id ?? ctx.id ?? '').split(':');
		const c = COLLS.find((x) => x.key === ck);
		const r = c ? (await c.list(ctx, k, a)).find((x) => str(x['id']) === id) : undefined;
		if (!c || !r) throw new VendorError('Choose what to delete.', 400);
		if (c === apps && guarded(r))
			throw new VendorError('Server SSH sign-ins and the console’s own sign-in go with their server.', 409);
		confirmed(w, str(r['name']) || str(r['network']));
		await cfSend('DELETE', c.path(a, str(r['id'])), k);
		return { message: `${c.label} ${c.nameOf(r)} deleted`, productId: null, follow: [] };
	},
};

export const ZT_EXTRA: ScreenExtra = {
	tabs: {
		apps: (ctx) => collForm(apps).read(ctx),
		groups: (ctx) => collForm(groups).read(ctx),
		routes: (ctx) => collForm(routes).read(ctx),
		gateway: (ctx) => collForm(gateway).read(ctx),
		lists: (ctx) => collForm(lists).read(ctx),
		devices: devicesTab,
	},
	forms: {
		apps: collForm(apps),
		groups: collForm(groups),
		routes: collForm(routes),
		gateway: collForm(gateway),
		lists: collForm(lists),
		split: splitTunnel,
		emailcode: emailCode,
		revoke,
		ztdelete: ztDelete,
	},
	buttons: { access: [action('Delete an application, group, route, policy or list', 'ztdelete')] },
};
