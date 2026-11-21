/**
 * Cloudflare reads and writes for the product screens: the envelope, paging, the zone and account
 * of the edge slot, zone settings, rulesets and GraphQL analytics.
 */
import { MONITOR_RANGE_SECONDS, type ProductSeries } from '@saha-textile/release-console-contracts';

import type { ProductCtx, ProductFormSpec, Write } from './kit.js';
import { col, field, form, formTab, note, option, read, row, soft, table, view, when, write } from './kit.js';
import { VendorError, arr, num, rec, sendJson, str } from '../vendors/http.js';

export const CF_API = 'https://api.cloudflare.com/client/v4';
const CF = 'Cloudflare';

export const cfGet = async (path: string, key: string): Promise<unknown> =>
	rec(await read(CF, `${CF_API}${path}`, key))['result'];
/** A read that answers null when the key may not read it or the product is off. */
export const cfSoft = async (path: string, key: string): Promise<unknown | null> => {
	const b = await soft(CF, `${CF_API}${path}`, key);
	return b === null ? null : rec(b)['result'];
};
export const cfSend = async (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, key: string, body?: unknown) =>
	rec(await write(CF, method, `${CF_API}${path}`, key, body))['result'];

/** Every page of a list (100 a page, at most 10 pages); null when the key may not read it. */
export async function cfAll(path: string, key: string, softly = true): Promise<Record<string, unknown>[] | null> {
	const out: Record<string, unknown>[] = [];
	let paged = true;
	for (let page = 1; page <= 10; page++) {
		const size = path.includes('dns_records') || path.startsWith('/zones?') ? 100 : 50;
		const url = paged
			? `${CF_API}${path}${path.includes('?') ? '&' : '?'}per_page=${size}&page=${page}`
			: `${CF_API}${path}`;
		let body: unknown;
		try {
			body = softly ? await soft(CF, url, key) : await read(CF, url, key);
		} catch (err) {
			// An empty list answers "page bigger than the number of pages"; some lists take no paging at all.
			if (err instanceof VendorError && /Page bigger than the number of pages/i.test(err.message)) return out;
			if (err instanceof VendorError && paged && /list options|per_page|page/i.test(err.message) && page === 1) {
				paged = false;
				page = 0;
				continue;
			}
			throw err;
		}
		if (body === null) return page === 1 ? null : out;
		const b = rec(body);
		const result = b['result'];
		out.push(...(Array.isArray(result) ? result : arr(rec(result)['buckets'] ?? rec(result)['issues'])).map(rec));
		const info = rec(b['result_info']);
		if (!paged || !info['total_pages'] || page >= num(info['total_pages'])) break;
	}
	return out;
}

export interface Zone {
	id: string;
	name: string;
	account: string;
	plan: string;
	raw: Record<string, unknown>;
}

/** The edge slot's first domain, as Cloudflare knows it. */
export async function zoneOf(ctx: ProductCtx, key = ctx.key): Promise<Zone> {
	const name = ctx.zones[0];
	if (!name)
		throw new VendorError('This edge slot names no domain. Add the domain on the repository’s Connections.', 400);
	const z = rec(arr(await cfGet(`/zones?name=${encodeURIComponent(name)}`, key))[0]);
	if (!str(z['id'])) throw new VendorError(`${name} is not on this Cloudflare account.`, 404);
	return { id: str(z['id']), name, account: str(rec(z['account'])['id']), plan: str(rec(z['plan'])['name']), raw: z };
}

/** The account that holds the edge slot's domain. */
export const accountOf = async (ctx: ProductCtx, key = ctx.key) => (await zoneOf(ctx, key)).account;

/* ----- zone settings ----- */

export interface SettingSpec {
	id: string;
	label: string;
	help?: string;
	/** Choices offered on Edit; on/off when omitted. */
	options?: Array<[value: string, label: string]>;
	/** Locked on the current plan (shown, never sent). */
	plan?: string;
}

export async function settingsOf(ctx: ProductCtx, z: Zone): Promise<Map<string, Record<string, unknown>>> {
	const list = arr(await cfSoft(`/zones/${z.id}/settings`, ctx.key)).map(rec);
	return new Map(list.map((s) => [str(s['id']), s]));
}

const shown = (v: unknown): string =>
	typeof v === 'string'
		? v
		: typeof v === 'number'
			? String(v)
			: v && typeof v === 'object'
				? JSON.stringify(v).slice(0, 80)
				: '—';

/** A table of zone settings with their values, who may change them, and when they last changed. */
export async function settingsView(
	ctx: ProductCtx,
	title: string,
	specs: SettingSpec[],
	extra: Partial<Parameters<typeof view>[0]> = {},
) {
	const z = await zoneOf(ctx);
	const all = await settingsOf(ctx, z);
	return view({
		head: { name: z.name, status: `${z.plan}`, tone: 'cy' },
		...extra,
		tables: [
			table(
				title,
				[col('label', 'Setting'), col('value', 'Now', true), col('can', 'Change'), col('at', 'Changed', true)],
				specs.map((s) => {
					const v = all.get(s.id);
					const editable = v?.['editable'] === true && !s.plan;
					return row(
						s.id,
						s.label,
						{
							label: s.label,
							value: v ? shown(v['value']) : 'not on this plan',
							can: s.plan ? `needs ${s.plan}` : editable ? 'here' : v ? 'locked' : '—',
							at: when(str(v?.['modified_on'])),
						},
						v ? (s.plan ? 'muted' : null) : 'muted',
					);
				}),
				'No settings readable with this key.',
			),
			...(extra.tables ?? []),
		],
		notes: [
			...(extra.notes ?? []),
			...specs.filter((s) => s.help).map((s) => note(`${s.label}: ${s.help}`, 'muted')),
		].slice(0, 6),
	});
}

/** The Edit form for a group of zone settings: only editable ones, each with its choices. */
export function settingsForm(key: string, title: string, specs: SettingSpec[]): ProductFormSpec {
	return {
		async read(ctx) {
			const z = await zoneOf(ctx);
			const all = await settingsOf(ctx, z);
			const usable = specs.filter((s) => !s.plan && all.get(s.id)?.['editable'] === true);
			return formTab(
				form({
					key,
					title,
					submit: 'Save settings',
					blocked: usable.length
						? null
						: 'None of these settings can be changed on this plan or with this key.',
					fields: usable.map((s) => {
						const now = all.get(s.id)?.['value'];
						return field(s.id, s.label, 'select', {
							value: shown(now),
							options: (
								s.options ?? [
									['on', 'On'],
									['off', 'Off'],
								]
							).map(([v, l]) => option(v, l)),
							help: s.help ?? '',
						});
					}),
					notes: specs.filter((s) => s.plan).map((s) => note(`${s.label} needs ${s.plan}.`, 'muted')),
				}),
			);
		},
		async send(ctx, w: Write) {
			const k = await ctx.writeKey();
			const z = await zoneOf(ctx, k);
			const all = await settingsOf({ ...ctx, key: k }, z);
			const changed: string[] = [];
			for (const s of specs) {
				const v = w.values[s.id];
				if (typeof v !== 'string' || s.plan) continue;
				const allowed = (s.options ?? [['on'], ['off']]).map((o) => o[0]);
				if (!allowed.includes(v)) throw new VendorError(`${s.label}: choose one of the listed values.`, 400);
				if (shown(all.get(s.id)?.['value']) === v) continue;
				await cfSend('PATCH', `/zones/${z.id}/settings/${s.id}`, k, {
					value: /^\d+$/.test(v) && s.id !== 'min_tls_version' ? Number(v) : v,
				});
				changed.push(`${s.label} → ${v}`);
			}
			if (!changed.length) throw new VendorError('Nothing changed.', 400);
			return { message: `${z.name}: ${changed.join(', ')}`, productId: z.id, follow: [] };
		},
	};
}

/* ----- rulesets ----- */

export async function entrypoint(ctx: ProductCtx, z: Zone, phase: string, key = ctx.key) {
	const r = await cfSoft(`/zones/${z.id}/rulesets/phases/${phase}/entrypoint`, key);
	return r ? rec(r) : null;
}

export const rulesOf = (rs: Record<string, unknown> | null) => arr(rs?.['rules']).map(rec);

export function rulesTable(title: string, rules: Record<string, unknown>[], empty: string) {
	return table(
		title,
		[
			col('name', 'Rule'),
			col('expr', 'When', true),
			col('action', 'Then'),
			col('on', 'On'),
			col('at', 'Changed', true),
		],
		rules.map((r) =>
			row(
				str(r['id']),
				str(r['description']) || str(r['id']),
				{
					name: str(r['description']) || '(no name)',
					expr: str(r['expression']).slice(0, 120),
					action: str(r['action']).replace(/_/g, ' '),
					on: r['enabled'] === false ? 'off' : 'on',
					at: when(str(r['last_updated'])),
				},
				r['enabled'] === false ? 'muted' : null,
			),
		),
		empty,
		true,
	);
}

/** Adds a rule to a phase, making its entry point when the zone has none yet. */
export async function addRule(key: string, z: Zone, phase: string, rule: Record<string, unknown>) {
	const rs = await cfSoft(`/zones/${z.id}/rulesets/phases/${phase}/entrypoint`, key);
	if (rs && str(rec(rs)['id']))
		return cfSend('POST', `/zones/${z.id}/rulesets/${str(rec(rs)['id'])}/rules`, key, rule);
	return cfSend('PUT', `/zones/${z.id}/rulesets/phases/${phase}/entrypoint`, key, { rules: [rule] });
}

/** A rule expression made from simple parts, refused when it is not one Cloudflare would accept. */
export function expression(w: Write): string {
	const raw = typeof w.values['expression'] === 'string' ? w.values['expression'].trim() : '';
	if (raw) {
		if (raw.length > 4000 || /[`;]/.test(raw))
			throw new VendorError('The expression has characters Cloudflare rules do not use.', 400);
		return raw;
	}
	const fieldName = str(w.values['field']);
	const op = str(w.values['operator']);
	const value = str(w.values['value']).trim();
	if (
		!/^(http\.request\.uri\.path|http\.host|ip\.src|ip\.src\.country|http\.user_agent|http\.request\.method|cf\.client\.bot)$/.test(
			fieldName,
		)
	)
		throw new VendorError('Choose a field.', 400);
	if (!value && fieldName !== 'cf.client.bot') throw new VendorError('Give a value.', 400);
	const quoted = JSON.stringify(value);
	if (fieldName === 'cf.client.bot') return 'cf.client.bot';
	if (op === 'eq')
		return `(${fieldName} eq ${fieldName.startsWith('ip.src') && fieldName !== 'ip.src.country' ? value : quoted})`;
	if (op === 'contains') return `(${fieldName} contains ${quoted})`;
	if (op === 'starts') return `(starts_with(${fieldName}, ${quoted}))`;
	if (op === 'in')
		return `(${fieldName} in {${value
			.split(/[\s,]+/)
			.filter(Boolean)
			.map((v) => (fieldName === 'ip.src' ? v : JSON.stringify(v)))
			.join(' ')}})`;
	throw new VendorError('Choose how to compare.', 400);
}

export const RULE_FIELDS = [
	option('http.request.uri.path', 'URI path'),
	option('http.host', 'Hostname'),
	option('ip.src', 'IP address'),
	option('ip.src.country', 'Country'),
	option('http.user_agent', 'User agent'),
	option('http.request.method', 'Method'),
	option('cf.client.bot', 'Known bots'),
];
export const RULE_OPS = [
	option('eq', 'equals'),
	option('contains', 'contains'),
	option('starts', 'starts with'),
	option('in', 'is in (list)'),
];

export function ruleFields(current?: Record<string, unknown>) {
	return [
		field('description', 'Name', 'text', { value: str(current?.['description']), required: true }),
		field('field', 'Field', 'select', {
			value: 'http.request.uri.path',
			options: RULE_FIELDS,
			help: 'Or write the whole expression below.',
		}),
		field('operator', 'Operator', 'select', { value: 'starts', options: RULE_OPS }),
		field('value', 'Value', 'text', { value: '' }),
		field('expression', 'Expression (optional)', 'textarea', {
			value: str(current?.['expression']),
			help: 'Cloudflare rule language, e.g. (http.request.uri.path contains "/wp-login")',
		}),
	];
}

/* ----- analytics (GraphQL) ----- */

export async function graph(
	ctx: ProductCtx,
	query: string,
	variables: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
	const a = await sendJson('POST', `${CF_API}/graphql`, ctx.key, { query, variables });
	const b = rec(a.body);
	if (a.status >= 400 || arr(b['errors']).length) return null;
	return rec(b['data']);
}

export interface Traffic {
	t: number;
	requests: number;
	cached: number;
	bytes: number;
	cachedBytes: number;
	threats: number;
	encrypted: number;
	uniques: number;
	tls13: number;
	countries: Record<string, number>;
}

/** Zone traffic over the range: hourly up to a day, daily beyond. */
export async function traffic(ctx: ProductCtx, z: Zone): Promise<Traffic[] | null> {
	const end = new Date();
	const start = new Date(end.getTime() - MONITOR_RANGE_SECONDS[ctx.range] * 1000);
	const hourly = ctx.range === '1h' || ctx.range === '24h';
	const group = hourly ? 'httpRequests1hGroups' : 'httpRequests1dGroups';
	const filter = hourly ? '{datetime_geq: $since, datetime_lt: $until}' : '{date_geq: $since, date_leq: $until}';
	const dim = hourly ? 'datetime' : 'date';
	const q = `query($zone: String!, $since: ${hourly ? 'Time' : 'Date'}!, $until: ${hourly ? 'Time' : 'Date'}!) { viewer { zones(filter: {zoneTag: $zone}) { ${group}(limit: 1000, filter: ${filter}, orderBy: [${dim}_ASC]) { dimensions { ${dim} } sum { requests cachedRequests bytes cachedBytes threats encryptedRequests clientSSLMap { clientSSLProtocol requests } countryMap { clientCountryName requests } } uniq { uniques } } } } }`;
	const fmt = (d: Date) => (hourly ? d.toISOString().slice(0, 19) + 'Z' : d.toISOString().slice(0, 10));
	const data = await graph(ctx, q, { zone: z.id, since: fmt(start), until: fmt(end) });
	if (!data) return null;
	const groups = arr(rec(arr(rec(data['viewer'])['zones'])[0])[group]).map(rec);
	return groups.map((g) => {
		const s = rec(g['sum']);
		const countries: Record<string, number> = {};
		for (const c of arr(s['countryMap']).map(rec)) countries[str(c['clientCountryName'])] = num(c['requests']);
		return {
			t: Math.floor(Date.parse(str(rec(g['dimensions'])[dim]) + (hourly ? '' : 'T00:00:00Z')) / 1000),
			requests: num(s['requests']),
			cached: num(s['cachedRequests']),
			bytes: num(s['bytes']),
			cachedBytes: num(s['cachedBytes']),
			threats: num(s['threats']),
			encrypted: num(s['encryptedRequests']),
			uniques: num(rec(g['uniq'])['uniques']),
			tls13: arr(s['clientSSLMap'])
				.map(rec)
				.filter((m) => str(m['clientSSLProtocol']) === 'TLSv1.3')
				.reduce((a, m) => a + num(m['requests']), 0),
			countries,
		};
	});
}

export const seriesOf = (
	rows: Traffic[],
	name: string,
	unit: string,
	pickValue: (r: Traffic) => number,
): ProductSeries => ({
	name,
	unit,
	points: rows.map((r) => [r.t, Math.round(pickValue(r) * 100) / 100] as [number, number]),
});

export const noAnalytics = note(
	'Cloudflare did not return analytics for this range with this key (it needs Analytics read), or the plan keeps less history.',
	'amber',
);

/** One line per account product: how many there are, or why the key cannot tell. */
export async function counts(rows: Array<[label: string, read: Promise<unknown[] | null>, what: string]>) {
	const got = await Promise.all(
		rows.map(async ([label, p, what]) => ({ label, what, n: await p.catch(() => null) })),
	);
	return table(
		'Products on the account',
		[col('label', 'Product'), col('n', 'In use', true), col('what', 'What it is')],
		got.map((g) =>
			row(
				g.label,
				g.label,
				{ label: g.label, n: g.n === null ? 'not readable with this key' : g.n.length, what: g.what },
				g.n === null ? 'muted' : g.n.length ? 'ok' : null,
			),
		),
		'Nothing.',
	);
}
