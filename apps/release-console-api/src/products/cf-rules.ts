/**
 * Cloudflare › Domain › Rules, every kind Cloudflare's own Rules pages offer (owner, 22 Nov: "every
 * page should be properly functional, just the way it would be in Cloudflare dashboard"): URL
 * rewrites, request and response header changes, origin, configuration and compression rules, managed
 * transforms, snippets, Cloud Connector, page rules and URL normalisation. Each kind is one tab: pick
 * "New rule" or an existing one, change it, save with the PIN. Deleting any rule is one shared tab.
 */
import type { ProductField, ProductTab, ProductWrite } from '@saha-textile/release-console-contracts';

import type { ProductCtx, ProductFormSpec } from './kit.js';
import { bool, confirmed, field, form, formTab, note, option, pick, text } from './kit.js';
import {
	CF_API,
	type Zone,
	addRule,
	cfSend,
	cfSoft,
	entrypoint,
	expression,
	ruleFields,
	rulesOf,
	rulesTable,
	zoneOf,
} from './cf-kit.js';
import { VendorError, arr, rec, str } from '../vendors/http.js';

type Rule = Record<string, unknown>;

/* ----- reading what was sent ----- */

const opt = (w: ProductWrite, key: string): string => {
	const v = w.values[key];
	return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
};
const choice = (w: ProductWrite, key: string, allowed: string[], fallback: string): string => {
	const v = opt(w, key) || fallback;
	if (!allowed.includes(v)) throw new VendorError(`Choose a value for ${key}.`, 400);
	return v;
};
const checkExpr = (v: string, label: string): string => {
	if (v.length > 4000 || /[`;]/.test(v))
		throw new VendorError(`${label}: characters Cloudflare rules do not use.`, 400);
	return v;
};

/* ----- the rule kinds that live in a ruleset phase ----- */

export interface RuleKind {
	/** Tab and form key. */
	tab: string;
	phase: string;
	/** "URL rewrite rule" */
	label: string;
	/** "URL rewrite rules" */
	title: string;
	action: string;
	fields(r: Rule | null): ProductField[];
	params(w: ProductWrite, r: Rule | null): Record<string, unknown>;
	notes?: string[];
}

const MODE = [
	option('keep', 'Keep as it is'),
	option('static', 'Rewrite to'),
	option('dynamic', 'Rewrite with an expression'),
];

/** One URL part (path or query) of a rewrite: keep, a fixed value or an expression. */
function uriPart(w: ProductWrite, part: 'path' | 'query'): Record<string, string> | null {
	const mode = choice(w, `${part}Mode`, ['keep', 'static', 'dynamic'], 'keep');
	if (mode === 'keep') return null;
	const v = opt(w, part);
	if (mode === 'static') {
		if (part === 'path' && !v.startsWith('/')) throw new VendorError('The new path starts with /.', 400);
		return { value: v };
	}
	if (!v) throw new VendorError(`Give the ${part} expression.`, 400);
	return { expression: checkExpr(v, part) };
}
const partMode = (p: Record<string, unknown>) =>
	str(p['expression']) ? 'dynamic' : p['value'] !== undefined ? 'static' : 'keep';
const partValue = (p: Record<string, unknown>) => str(p['expression']) || str(p['value']);

/** Header changes as lines: `set Name: value`, `set Name = expression`, `add Name: value`, `remove Name`. */
export function headerLines(raw: string): Record<string, Record<string, string>> {
	const out: Record<string, Record<string, string>> = {};
	for (const line of raw
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)) {
		const m = /^(set|add|remove)\s+([A-Za-z0-9!#$%&'*+.^_`|~-]+)\s*(?:([:=])\s*(.*))?$/.exec(line);
		if (!m) throw new VendorError(`Each line: set Name: value, add Name: value or remove Name (${line}).`, 400);
		const [, op = '', name = '', sep, value = ''] = m;
		if (op === 'remove') out[name] = { operation: 'remove' };
		else if (!sep || !value) throw new VendorError(`${name}: give a value after : or an expression after =.`, 400);
		else out[name] = sep === '=' ? { operation: op, expression: checkExpr(value, name) } : { operation: op, value };
	}
	if (!Object.keys(out).length) throw new VendorError('Give at least one header line.', 400);
	return out;
}
const headerText = (r: Rule | null): string =>
	Object.entries(rec(rec(r?.['action_parameters'])['headers']))
		.map(([name, h]) => {
			const x = rec(h);
			const op = str(x['operation']);
			return op === 'remove'
				? `remove ${name}`
				: str(x['expression'])
					? `${op} ${name} = ${str(x['expression'])}`
					: `${op} ${name}: ${str(x['value'])}`;
		})
		.join('\n');

const ON_OFF = [option('', 'Leave as the zone has it'), option('on', 'On'), option('off', 'Off')];
/** Configuration rule settings (Cloudflare › Rules › Configuration rules), with their choices. */
const CONFIG: Array<{
	id: string;
	label: string;
	options?: Array<{ value: string; label: string; sub: string }>;
	flag?: boolean;
}> = [
	{ id: 'automatic_https_rewrites', label: 'Automatic HTTPS rewrites' },
	{ id: 'bic', label: 'Browser integrity check' },
	{ id: 'email_obfuscation', label: 'Email obfuscation' },
	{ id: 'fonts', label: 'Cloudflare Fonts' },
	{ id: 'hotlink_protection', label: 'Hotlink protection' },
	{ id: 'opportunistic_encryption', label: 'Opportunistic encryption' },
	{ id: 'rocket_loader', label: 'Rocket Loader' },
	{ id: 'server_side_excludes', label: 'Server-side excludes' },
	{ id: 'sxg', label: 'Signed exchanges (SXG)' },
	{
		id: 'security_level',
		label: 'Security level',
		options: [
			option('', 'Leave as the zone has it'),
			...['off', 'essentially_off', 'low', 'medium', 'high', 'under_attack'].map((v) =>
				option(v, v.replace(/_/g, ' ')),
			),
		],
	},
	{
		id: 'ssl',
		label: 'SSL',
		options: [
			option('', 'Leave as the zone has it'),
			...['off', 'flexible', 'full', 'strict', 'origin_pull'].map((v) => option(v, v.replace(/_/g, ' '))),
		],
	},
	{
		id: 'polish',
		label: 'Polish (Pro)',
		options: [
			option('', 'Leave as the zone has it'),
			option('off', 'Off'),
			option('lossless', 'Lossless'),
			option('lossy', 'Lossy'),
		],
	},
	{ id: 'disable_apps', label: 'Turn off Cloudflare apps', flag: true },
	{ id: 'disable_rum', label: 'Turn off real-user monitoring', flag: true },
	{ id: 'disable_zaraz', label: 'Turn off Zaraz', flag: true },
];

const COMPRESSION = [
	option('default', 'Cloudflare’s default'),
	option('auto', 'Best the browser accepts'),
	option('zstd,brotli,gzip', 'Zstandard, then Brotli, then Gzip'),
	option('brotli,gzip', 'Brotli, then Gzip'),
	option('gzip', 'Gzip only'),
	option('none', 'No compression'),
];

export const RULE_KINDS: RuleKind[] = [
	{
		tab: 'rewrite',
		phase: 'http_request_transform',
		label: 'URL rewrite rule',
		title: 'URL rewrite rules',
		action: 'rewrite',
		fields(r) {
			const uri = rec(rec(r?.['action_parameters'])['uri']);
			const path = rec(uri['path']);
			const query = rec(uri['query']);
			return [
				field('pathMode', 'Path', 'select', { value: partMode(path), options: MODE }),
				field('path', 'New path or expression', 'text', {
					value: partValue(path),
					help: 'Like /en/sarees, or concat("/en", http.request.uri.path)',
				}),
				field('queryMode', 'Query string', 'select', { value: partMode(query), options: MODE }),
				field('query', 'New query or expression', 'text', {
					value: partValue(query),
					help: 'Like lang=en; empty with "Rewrite to" clears it',
				}),
			];
		},
		params(w) {
			const path = uriPart(w, 'path');
			const query = uriPart(w, 'query');
			if (!path && !query) throw new VendorError('Rewrite the path, the query string or both.', 400);
			return { uri: { ...(path ? { path } : {}), ...(query ? { query } : {}) } };
		},
		notes: ['The visitor’s address bar keeps the old URL; for a visible move use a redirect rule.'],
	},
	{
		tab: 'reqheaders',
		phase: 'http_request_late_transform',
		label: 'request header rule',
		title: 'Request header rules',
		action: 'rewrite',
		fields: (r) => [
			field('headers', 'Headers sent to the server', 'textarea', {
				value: headerText(r),
				help: 'One per line: set X-Name: value · set X-Country = ip.src.country · add X-Name: value · remove X-Name',
			}),
		],
		params: (w) => ({ headers: headerLines(text(w, 'headers')) }),
	},
	{
		tab: 'respheaders',
		phase: 'http_response_headers_transform',
		label: 'response header rule',
		title: 'Response header rules',
		action: 'rewrite',
		fields: (r) => [
			field('headers', 'Headers sent to the visitor', 'textarea', {
				value: headerText(r),
				help: 'One per line: set X-Name: value · set X-Name = expression · add Set-Cookie: a=b · remove X-Powered-By',
			}),
		],
		params: (w) => ({ headers: headerLines(text(w, 'headers')) }),
	},
	{
		tab: 'origin',
		phase: 'http_request_origin',
		label: 'origin rule',
		title: 'Origin rules',
		action: 'route',
		fields(r) {
			const p = rec(r?.['action_parameters']);
			const origin = rec(p['origin']);
			return [
				field('hostHeader', 'Host header', 'text', {
					value: str(p['host_header']),
					help: 'Sent to the server instead of the visitor’s host (Enterprise on some plans)',
				}),
				field('host', 'Resolve to DNS record', 'text', {
					value: str(origin['host']),
					help: 'A hostname on this domain, like origin.sahatextile.com',
				}),
				field('port', 'Destination port', 'number', {
					value: origin['port'] ? Number(origin['port']) : null,
					min: 1,
					max: 65535,
				}),
				field('sni', 'Server name (SNI)', 'text', { value: str(rec(p['sni'])['value']) }),
			];
		},
		params(w) {
			const host = opt(w, 'host');
			const portRaw = opt(w, 'port');
			const port = portRaw ? Number(portRaw) : null;
			if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535))
				throw new VendorError('Port: a whole number from 1 to 65535.', 400);
			const out: Record<string, unknown> = {};
			if (opt(w, 'hostHeader')) out['host_header'] = opt(w, 'hostHeader');
			if (host || port) out['origin'] = { ...(host ? { host } : {}), ...(port ? { port } : {}) };
			if (opt(w, 'sni')) out['sni'] = { value: opt(w, 'sni') };
			if (!Object.keys(out).length)
				throw new VendorError('Change the host header, the DNS record, the port or the SNI.', 400);
			return out;
		},
	},
	{
		tab: 'config',
		phase: 'http_config_settings',
		label: 'configuration rule',
		title: 'Configuration rules',
		action: 'set_config',
		fields(r) {
			const p = rec(r?.['action_parameters']);
			return CONFIG.map((c) =>
				c.flag
					? field(c.id, c.label, 'toggle', { value: p[c.id] === true })
					: field(c.id, c.label, 'select', {
							value: c.options ? str(p[c.id]) : p[c.id] === true ? 'on' : p[c.id] === false ? 'off' : '',
							options: c.options ?? ON_OFF,
						}),
			);
		},
		params(w) {
			const out: Record<string, unknown> = {};
			for (const c of CONFIG) {
				if (c.flag) {
					if (bool(w, c.id)) out[c.id] = true;
					continue;
				}
				const v = opt(w, c.id);
				if (!v) continue;
				if (c.options) {
					if (!c.options.some((o) => o.value === v))
						throw new VendorError(`Choose a value for ${c.label}.`, 400);
					out[c.id] = v;
				} else out[c.id] = v === 'on';
			}
			if (!Object.keys(out).length) throw new VendorError('Change at least one setting.', 400);
			return out;
		},
	},
	{
		tab: 'compress',
		phase: 'http_response_compression',
		label: 'compression rule',
		title: 'Compression rules',
		action: 'compress_response',
		fields(r) {
			const names = arr(rec(r?.['action_parameters'])['algorithms'])
				.map((a) => str(rec(a)['name']))
				.join(',');
			return [
				field('algorithms', 'Compress with', 'select', { value: names || 'default', options: COMPRESSION }),
			];
		},
		params(w) {
			const v = choice(
				w,
				'algorithms',
				COMPRESSION.map((o) => o.value),
				'default',
			);
			return { algorithms: v.split(',').map((name) => ({ name })) };
		},
	},
];

/* ----- one tab per kind: new or existing, saved with the PIN ----- */

const POSITION = [option('keep', 'Keep its place'), option('first', 'First'), option('last', 'Last')];
const placed = (where: string) =>
	where === 'first' ? { position: { before: '' } } : where === 'last' ? { position: { after: '' } } : {};

export function ruleKindForm(kind: RuleKind): ProductFormSpec {
	return {
		async read(ctx) {
			const z = await zoneOf(ctx);
			const rules = rulesOf(await entrypoint(ctx, z, kind.phase));
			const p = pick(
				kind.title,
				[
					{ value: 'new', label: `New ${kind.label}` },
					...rules.map((r) => ({ value: str(r['id']), label: str(r['description']) || str(r['id']) })),
				],
				ctx.id,
			);
			const r = rules.find((x) => str(x['id']) === p.value) ?? null;
			return formTab(
				form({
					key: kind.tab,
					title: r ? `Edit ${str(r['description']) || kind.label}` : `New ${kind.label}`,
					submit: r ? 'Save rule' : 'Create rule',
					fields: [
						...ruleFields(r ?? undefined),
						...kind.fields(r),
						...(r ? [field('enabled', 'On', 'toggle', { value: r['enabled'] !== false })] : []),
						field('position', 'Place in the list', 'select', {
							value: r ? 'keep' : 'last',
							options: POSITION,
						}),
					],
					notes: [
						...(kind.notes ?? []).map((n) => note(n, 'muted')),
						note(
							`${rules.length} ${kind.title.toLowerCase()} on this domain; rules run top to bottom.`,
							'muted',
						),
					],
				}),
				p,
			);
		},
		async send(ctx, w) {
			const k = await ctx.writeKey();
			const z = await zoneOf(ctx, k);
			const rs = await entrypoint({ ...ctx, key: k }, z, kind.phase, k);
			const id = w.id ?? ctx.id;
			const r = id && id !== 'new' ? (rulesOf(rs).find((x) => str(x['id']) === id) ?? null) : null;
			if (id && id !== 'new' && !r) throw new VendorError('That rule is gone; pick it again.', 404);
			const body = {
				description: text(w, 'description'),
				expression: expression(w),
				action: kind.action,
				action_parameters: kind.params(w, r),
				enabled: r ? bool(w, 'enabled') : true,
				...placed(choice(w, 'position', ['keep', 'first', 'last'], 'keep')),
			};
			if (r) await cfSend('PATCH', `/zones/${z.id}/rulesets/${str(rs?.['id'])}/rules/${str(r['id'])}`, k, body);
			else await addRule(k, z, kind.phase, body);
			return {
				message: `${kind.label[0]?.toUpperCase()}${kind.label.slice(1)} “${body.description}” ${r ? 'saved' : 'created'}`,
				productId: z.id,
				follow: [],
			};
		},
	};
}

/** Every kind's rules as tables, for the Rules overview. */
export async function ruleKindTables(ctx: ProductCtx, z: Zone) {
	const sets = await Promise.all(RULE_KINDS.map((k) => entrypoint(ctx, z, k.phase)));
	return RULE_KINDS.map((k, n) => rulesTable(k.title, rulesOf(sets[n] ?? null), `No ${k.title.toLowerCase()}.`));
}

/* ----- managed transforms ----- */

const MANAGED_NAMES: Record<string, string> = {
	add_client_certificate_headers: 'Add client certificate headers',
	add_visitor_location_headers: 'Add visitor location headers',
	remove_visitor_ip_headers: 'Remove visitor IP headers',
	add_true_client_ip_headers: 'Add True-Client-IP header',
	add_waf_credential_check_status_header: 'Add leaked credentials checks header',
	add_bot_protection_headers: 'Add bot protection headers',
	remove_x_powered_by_header: 'Remove X-Powered-By header',
	add_security_headers: 'Add security headers',
};
const managedLabel = (id: string) => MANAGED_NAMES[id] ?? id.replace(/_/g, ' ');

export const managedTransforms: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const m = rec(await cfSoft(`/zones/${z.id}/managed_headers`, ctx.key));
		const fields: ProductField[] = [];
		for (const [group, title] of [
			['managed_request_headers', 'Request'],
			['managed_response_headers', 'Response'],
		] as const)
			for (const h of arr(m[group]).map(rec))
				fields.push(
					field(`${group}:${str(h['id'])}`, `${title} · ${managedLabel(str(h['id']))}`, 'toggle', {
						value: h['enabled'] === true,
						help:
							h['has_conflict'] === true
								? `Clashes with ${arr(h['conflicts_with'])
										.map((x) => str(x))
										.join(', ')}`
								: '',
					}),
				);
		return formTab(
			form({
				key: 'managed',
				title: 'Managed transforms',
				submit: 'Save transforms',
				fields,
				blocked: fields.length ? null : 'Cloudflare listed no managed transforms for this domain.',
			}),
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const m = rec(await cfSoft(`/zones/${z.id}/managed_headers`, k));
		const body: Record<string, Array<{ id: string; enabled: boolean }>> = {};
		const changed: string[] = [];
		for (const group of ['managed_request_headers', 'managed_response_headers'])
			body[group] = arr(m[group]).map((h) => {
				const id = str(rec(h)['id']);
				const enabled = bool(w, `${group}:${id}`);
				if (enabled !== (rec(h)['enabled'] === true))
					changed.push(`${managedLabel(id)} ${enabled ? 'on' : 'off'}`);
				return { id, enabled };
			});
		if (!changed.length) throw new VendorError('Nothing changed.', 400);
		await cfSend('PATCH', `/zones/${z.id}/managed_headers`, k, body);
		return { message: `Managed transforms: ${changed.join(', ')}`, productId: z.id, follow: [] };
	},
};

/* ----- URL normalisation (Rules › Settings) ----- */

export const urlNormalization: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const n = rec(await cfSoft(`/zones/${z.id}/url_normalization`, ctx.key));
		return formTab(
			form({
				key: 'settings',
				title: 'URL normalisation',
				submit: 'Save settings',
				fields: [
					field('type', 'Normalise URLs the', 'select', {
						value: str(n['type']) || 'cloudflare',
						options: [option('cloudflare', 'Cloudflare way'), option('rfc3986', 'RFC 3986 way')],
					}),
					field('scope', 'Normalise', 'select', {
						value: str(n['scope']) || 'incoming',
						options: [
							option('incoming', 'Incoming URLs only'),
							option('both', 'Incoming URLs and those sent to the server'),
							option('none', 'Not at all'),
						],
					}),
				],
				notes: [
					note('Rules match against the normalised URL, so /a/../b and /b are the same to them.', 'muted'),
				],
			}),
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const body = {
			type: choice(w, 'type', ['cloudflare', 'rfc3986'], 'cloudflare'),
			scope: choice(w, 'scope', ['incoming', 'both', 'none'], 'incoming'),
		};
		await cfSend('PUT', `/zones/${z.id}/url_normalization`, k, body);
		return { message: `URL normalisation: ${body.type}, ${body.scope}`, productId: z.id, follow: [] };
	},
};

/* ----- snippets ----- */

/** Snippet rules live on their own list, not in a ruleset phase. */
const snippetRules = async (key: string, z: Zone) =>
	arr(await cfSoft(`/zones/${z.id}/snippets/snippet_rules`, key)).map(rec);
const saveSnippetRules = (key: string, z: Zone, rules: Rule[]) =>
	cfSend('PUT', `/zones/${z.id}/snippets/snippet_rules`, key, {
		rules: rules.map((r) => ({
			description: str(r['description']),
			enabled: r['enabled'] !== false,
			expression: str(r['expression']),
			snippet_name: str(r['snippet_name']),
		})),
	});

async function snippetUpload(key: string, z: Zone, name: string, code: string): Promise<void> {
	const body = new FormData();
	body.set('metadata', JSON.stringify({ main_module: 'snippet.js' }));
	body.set('files', new Blob([code], { type: 'application/javascript+module' }), 'snippet.js');
	const res = await fetch(`${CF_API}/zones/${z.id}/snippets/${encodeURIComponent(name)}`, {
		method: 'PUT',
		headers: { authorization: `Bearer ${key}`, 'user-agent': 'release-console' },
		body,
		signal: AbortSignal.timeout(20_000),
	});
	const answer = rec(await res.json().catch(() => null));
	if (res.status >= 400 || answer['success'] === false) {
		const first = rec(arr(answer['errors'])[0]);
		throw new VendorError(
			`Cloudflare answered ${res.status}${first['message'] ? `: ${str(first['message'])}` : ''}.`,
			res.status,
		);
	}
}

export const snippetsForm: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const [list, rules] = await Promise.all([cfSoft(`/zones/${z.id}/snippets`, ctx.key), snippetRules(ctx.key, z)]);
		const snippets = arr(list).map(rec);
		const p = pick(
			'Snippet',
			[
				{ value: 'new', label: 'New snippet' },
				...snippets.map((s) => ({ value: str(s['snippet_name']), label: str(s['snippet_name']) })),
			],
			ctx.id,
		);
		const s = snippets.find((x) => str(x['snippet_name']) === p.value) ?? null;
		const rule = s ? (rules.find((r) => str(r['snippet_name']) === str(s['snippet_name'])) ?? null) : null;
		return formTab(
			form({
				key: 'snippets',
				title: s ? `Edit snippet ${str(s['snippet_name'])}` : 'New snippet',
				submit: s ? 'Save snippet' : 'Create snippet',
				fields: [
					field('name', 'Snippet name', 'text', {
						value: str(s?.['snippet_name']),
						required: true,
						readOnly: !!s,
						help: 'Lowercase letters, digits and _',
					}),
					field('code', 'Code (JavaScript module)', 'textarea', {
						value: '',
						help: s
							? 'Leave empty to keep the current code; Cloudflare does not send code back.'
							: 'export default { async fetch(request) { return fetch(request); } }',
					}),
					field('expression', 'Run when (expression)', 'textarea', {
						value: str(rule?.['expression']) || 'true',
						help: 'Cloudflare rule language; true runs it on every request',
					}),
					field('enabled', 'On', 'toggle', { value: rule ? rule['enabled'] !== false : true }),
				],
				notes: [
					note(
						'Snippets run small JavaScript on requests at Cloudflare; Cloudflare refuses them on plans that do not include them, and says so here.',
						'muted',
					),
				],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const name = text(w, 'name');
		if (!/^[a-z0-9_]{1,50}$/.test(name))
			throw new VendorError('Snippet name: lowercase letters, digits and _.', 400);
		const code = opt(w, 'code');
		const id = w.id ?? ctx.id;
		const isNew = !id || id === 'new';
		if (isNew && !code) throw new VendorError('Give the snippet’s code.', 400);
		if (code) await snippetUpload(k, z, name, code);
		const rules = await snippetRules(k, z);
		const next = {
			description: name,
			expression: checkExpr(opt(w, 'expression') || 'true', 'expression'),
			snippet_name: name,
			enabled: bool(w, 'enabled'),
		};
		const had = rules.some((r) => str(r['snippet_name']) === name);
		await saveSnippetRules(
			k,
			z,
			had ? rules.map((r) => (str(r['snippet_name']) === name ? next : r)) : [...rules, next],
		);
		return { message: `Snippet ${name} ${isNew ? 'created' : 'saved'}`, productId: z.id, follow: [] };
	},
};

/* ----- Cloud Connector ----- */

const PROVIDERS = [
	option('cloudflare_r2', 'Cloudflare R2'),
	option('aws_s3', 'Amazon S3'),
	option('gcp_storage', 'Google Cloud Storage'),
	option('azure_storage', 'Azure Blob Storage'),
];

export const cloudConnector: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const rules = arr(await cfSoft(`/zones/${z.id}/cloud_connector/rules`, ctx.key)).map(rec);
		const p = pick(
			'Connector rule',
			[
				{ value: 'new', label: 'New connector rule' },
				...rules.map((r) => ({ value: str(r['id']), label: str(r['description']) || str(r['expression']) })),
			],
			ctx.id,
		);
		const r = rules.find((x) => str(x['id']) === p.value) ?? null;
		return formTab(
			form({
				key: 'connector',
				title: r ? `Edit ${str(r['description']) || 'connector rule'}` : 'New connector rule',
				submit: r ? 'Save rule' : 'Create rule',
				fields: [
					field('description', 'Name', 'text', { value: str(r?.['description']), required: true }),
					field('provider', 'Storage', 'select', {
						value: str(r?.['provider']) || 'cloudflare_r2',
						options: PROVIDERS,
					}),
					field('host', 'Bucket address', 'text', {
						value: str(rec(r?.['parameters'])['host']),
						required: true,
						help: 'Like media.example.r2.cloudflarestorage.com or a bucket hostname',
					}),
					field('expression', 'Send when (expression)', 'textarea', {
						value: str(r?.['expression']),
						required: true,
						help: '(starts_with(http.request.uri.path, "/media/"))',
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
		const rules = arr(await cfSoft(`/zones/${z.id}/cloud_connector/rules`, k)).map(rec);
		const id = w.id ?? ctx.id;
		const next = {
			description: text(w, 'description'),
			provider: choice(
				w,
				'provider',
				PROVIDERS.map((o) => o.value),
				'cloudflare_r2',
			),
			expression: checkExpr(text(w, 'expression'), 'expression'),
			enabled: bool(w, 'enabled'),
			parameters: { host: text(w, 'host') },
		};
		const kept = rules.map((r) => ({
			...(str(r['id']) === id
				? next
				: {
						description: r['description'],
						provider: r['provider'],
						expression: r['expression'],
						enabled: r['enabled'],
						parameters: r['parameters'],
					}),
		}));
		const all = id && id !== 'new' ? kept : [...kept, next];
		await cfSend('PUT', `/zones/${z.id}/cloud_connector/rules`, k, all);
		return {
			message: `Connector rule “${next.description}” ${id && id !== 'new' ? 'saved' : 'created'}`,
			productId: z.id,
			follow: [],
		};
	},
};

/* ----- page rules (Cloudflare's Page Rules API takes only a personal token) ----- */

export const USER_TOKEN = 'CONSOLE_CF_USER_TOKEN';
const NO_USER_TOKEN =
	'Page rules need a personal Cloudflare token: Cloudflare’s Page Rules API refuses account tokens. Use a personal token (My Profile › API Tokens) as the console’s Cloudflare key, or add one as CONSOLE_CF_USER_TOKEN.';
/** Cloudflare's answer to an account token on the Page Rules API. */
const refusedKind = (err: unknown) => err instanceof VendorError && /account owned tokens|1011/i.test(err.message);
/** The key for page rules: the separate personal token when there is one, else the console's own key. */
const pageKey = (ctx: ProductCtx, fallback: string) => ctx.consoleKey(USER_TOKEN) ?? fallback;

/** A page rule setting and how its value is written. */
const PAGE_SETTINGS: Array<{
	id: string;
	label: string;
	kind: 'none' | 'onoff' | 'number' | 'choice' | 'forward';
	choices?: string[];
}> = [
	{ id: 'forwarding_url', label: 'Forwarding URL (301 https://…)', kind: 'forward' },
	{ id: 'always_use_https', label: 'Always use HTTPS', kind: 'none' },
	{
		id: 'cache_level',
		label: 'Cache level',
		kind: 'choice',
		choices: ['bypass', 'basic', 'simplified', 'aggressive', 'cache_everything'],
	},
	{ id: 'edge_cache_ttl', label: 'Edge cache TTL (seconds)', kind: 'number' },
	{ id: 'browser_cache_ttl', label: 'Browser cache TTL (seconds)', kind: 'number' },
	{
		id: 'security_level',
		label: 'Security level',
		kind: 'choice',
		choices: ['off', 'essentially_off', 'low', 'medium', 'high', 'under_attack'],
	},
	{ id: 'ssl', label: 'SSL', kind: 'choice', choices: ['off', 'flexible', 'full', 'strict'] },
	{ id: 'automatic_https_rewrites', label: 'Automatic HTTPS rewrites', kind: 'onoff' },
	{ id: 'browser_check', label: 'Browser integrity check', kind: 'onoff' },
	{ id: 'cache_deception_armor', label: 'Cache deception armor', kind: 'onoff' },
	{ id: 'email_obfuscation', label: 'Email obfuscation', kind: 'onoff' },
	{ id: 'explicit_cache_control', label: 'Origin cache control', kind: 'onoff' },
	{ id: 'ip_geolocation', label: 'IP geolocation header', kind: 'onoff' },
	{ id: 'opportunistic_encryption', label: 'Opportunistic encryption', kind: 'onoff' },
	{ id: 'origin_error_page_pass_thru', label: 'Origin error page pass-through', kind: 'onoff' },
	{ id: 'rocket_loader', label: 'Rocket Loader', kind: 'onoff' },
	{ id: 'server_side_exclude', label: 'Server-side excludes', kind: 'onoff' },
	{ id: 'sort_query_string_for_cache', label: 'Query string sort', kind: 'onoff' },
	{ id: 'respect_strong_etag', label: 'Respect strong ETags', kind: 'onoff' },
	{ id: 'disable_apps', label: 'Disable apps', kind: 'none' },
	{ id: 'disable_performance', label: 'Disable performance', kind: 'none' },
	{ id: 'disable_zaraz', label: 'Disable Zaraz', kind: 'none' },
];
const SLOTS = 5;

/** Turns a page rule action into the slot's text value. */
function actionValue(a: Record<string, unknown>): string {
	const v = a['value'];
	if (a['id'] === 'forwarding_url') return `${str(rec(v)['status_code'])} ${str(rec(v)['url'])}`;
	return v === undefined || v === null ? '' : String(v);
}

/** Reads the setting slots of a page rule form into Cloudflare actions. */
export function pageActions(w: ProductWrite): Array<Record<string, unknown>> {
	const out: Array<Record<string, unknown>> = [];
	for (let n = 1; n <= SLOTS; n++) {
		const id = opt(w, `setting${n}`);
		if (!id) continue;
		const spec = PAGE_SETTINGS.find((s) => s.id === id);
		if (!spec) throw new VendorError(`Setting ${n}: choose a setting.`, 400);
		const v = opt(w, `value${n}`);
		if (spec.kind === 'none') out.push({ id });
		else if (spec.kind === 'onoff') {
			if (!['on', 'off'].includes(v)) throw new VendorError(`${spec.label}: on or off.`, 400);
			out.push({ id, value: v });
		} else if (spec.kind === 'number') {
			const s = Number(v);
			if (!Number.isInteger(s) || s < 0) throw new VendorError(`${spec.label}: seconds as a whole number.`, 400);
			out.push({ id, value: s });
		} else if (spec.kind === 'choice') {
			if (!spec.choices?.includes(v))
				throw new VendorError(`${spec.label}: one of ${spec.choices?.join(', ')}.`, 400);
			out.push({ id, value: v });
		} else {
			const m = /^(301|302)\s+(https?:\/\/\S+)$/.exec(v);
			if (!m)
				throw new VendorError(
					'Forwarding URL: 301 or 302, then the address, like 301 https://sahatextile.com/$1',
					400,
				);
			out.push({ id, value: { status_code: Number(m[1]), url: m[2] } });
		}
	}
	if (!out.length) throw new VendorError('Choose at least one setting.', 400);
	if (out.some((a) => a['id'] === 'forwarding_url') && out.length > 1)
		throw new VendorError('A forwarding URL is the page rule’s only setting.', 400);
	return out;
}

const settingOptions = [
	option('', '—'),
	...PAGE_SETTINGS.map((s) =>
		option(s.id, s.label, s.choices?.join(' · ') ?? (s.kind === 'onoff' ? 'on · off' : '')),
	),
];

async function pageRulesOf(key: string, z: Zone): Promise<Rule[]> {
	const res = await fetch(`${CF_API}/zones/${z.id}/pagerules?order=priority&direction=asc`, {
		headers: { authorization: `Bearer ${key}`, 'user-agent': 'release-console' },
		signal: AbortSignal.timeout(15_000),
	});
	const answer = rec(await res.json().catch(() => null));
	if (res.status >= 400 || answer['success'] === false) {
		const first = rec(arr(answer['errors'])[0]);
		throw new VendorError(
			`Cloudflare answered ${res.status}${first['message'] ? `: ${str(first['message'])}` : ''}.`,
			res.status,
		);
	}
	return arr(answer['result']).map(rec);
}
const patternOf = (r: Rule) => str(rec(rec(arr(r['targets'])[0])['constraint'])['value']);

export const pageRules: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		let refused = false;
		const rules = await pageRulesOf(pageKey(ctx, ctx.key), z).catch((err: unknown) => {
			if (!refusedKind(err)) throw err;
			refused = true;
			return [] as Rule[];
		});
		const p = pick(
			'Page rule',
			[
				{ value: 'new', label: 'New page rule' },
				...rules.map((r) => ({ value: str(r['id']), label: patternOf(r) })),
			],
			ctx.id,
		);
		const r = rules.find((x) => str(x['id']) === p.value) ?? null;
		const actions = arr(r?.['actions']).map(rec);
		const slots: ProductField[] = [];
		for (let n = 1; n <= SLOTS; n++) {
			const a = actions[n - 1];
			slots.push(
				field(`setting${n}`, `Setting ${n}`, 'select', { value: str(a?.['id']), options: settingOptions }),
				field(`value${n}`, `Value ${n}`, 'text', {
					value: a ? actionValue(a) : '',
					help:
						n === 1
							? 'on/off, a choice, seconds, or 301 https://… for a forwarding URL; none for Always use HTTPS and the Disable settings'
							: '',
				}),
			);
		}
		return formTab(
			form({
				key: 'pagerules',
				title: r ? `Edit page rule ${patternOf(r)}` : 'New page rule',
				submit: r ? 'Save page rule' : 'Create page rule',
				blocked: refused ? NO_USER_TOKEN : null,
				fields: [
					field('pattern', 'If the URL matches', 'text', {
						value: r ? patternOf(r) : '',
						required: true,
						help: 'Like *sahatextile.com/old/* (* matches anything)',
					}),
					...slots,
					field('active', 'On', 'toggle', { value: r ? str(r['status']) === 'active' : true }),
					field('position', 'Place in the list', 'select', { value: r ? 'keep' : 'last', options: POSITION }),
				],
				notes: [
					note(
						`${rules.length} of the plan’s page rules in use (Free: 3). Cloudflare is moving page rules to the newer rule kinds on this screen.`,
						'muted',
					),
				],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const userKey = pageKey(ctx, await ctx.writeKey());
		const z = await zoneOf(ctx);
		const pattern = text(w, 'pattern');
		if (!/^[\w*.:/?&=%#~+-]+$/.test(pattern))
			throw new VendorError('The URL pattern has characters page rules do not use.', 400);
		const rules = await pageRulesOf(userKey, z);
		const id = w.id ?? ctx.id;
		const r = id && id !== 'new' ? rules.find((x) => str(x['id']) === id) : undefined;
		const where = choice(w, 'position', ['keep', 'first', 'last'], 'keep');
		const body = {
			targets: [{ target: 'url', constraint: { operator: 'matches', value: pattern } }],
			actions: pageActions(w),
			status: bool(w, 'active') ? 'active' : 'disabled',
			...(where === 'first'
				? { priority: rules.length + (r ? 0 : 1) }
				: where === 'last'
					? { priority: 1 }
					: r
						? { priority: r['priority'] }
						: {}),
		};
		await cfSend(r ? 'PUT' : 'POST', `/zones/${z.id}/pagerules${r ? `/${str(r['id'])}` : ''}`, userKey, body);
		return { message: `Page rule ${pattern} ${r ? 'saved' : 'created'}`, productId: z.id, follow: [] };
	},
};

/* ----- deleting any rule on the domain ----- */

interface AnyRule {
	value: string;
	label: string;
	name: string;
	when: string;
	remove(key: string, userKey: string | null): Promise<void>;
}

async function everyRule(ctx: ProductCtx, z: Zone, key: string): Promise<AnyRule[]> {
	const kinds = [
		{ phase: 'http_request_dynamic_redirect', label: 'redirect rule' },
		...RULE_KINDS,
		{ phase: 'http_custom_errors', label: 'custom error rule' },
	];
	const sets = await Promise.all(kinds.map((k) => entrypoint({ ...ctx, key }, z, k.phase, key)));
	const out: AnyRule[] = [];
	kinds.forEach((k, n) => {
		const rs = sets[n] ?? null;
		for (const r of rulesOf(rs)) {
			const name = str(r['description']) || str(r['id']);
			out.push({
				value: `${k.phase}:${str(r['id'])}`,
				label: `${name} (${k.label})`,
				name,
				when: str(r['expression']),
				remove: async (kk) => {
					await cfSend('DELETE', `/zones/${z.id}/rulesets/${str(rs?.['id'])}/rules/${str(r['id'])}`, kk);
				},
			});
		}
	});
	// A snippet goes with its rule: deleting it removes both.
	const snippets = arr(await cfSoft(`/zones/${z.id}/snippets`, key)).map(rec);
	const sRules = snippets.length ? await snippetRules(key, z) : [];
	for (const sn of snippets) {
		const name = str(sn['snippet_name']);
		const rule = sRules.find((r) => str(r['snippet_name']) === name);
		out.push({
			value: `snippet:${name}`,
			label: `${name} (snippet)`,
			name,
			when: str(rule?.['expression']) || 'not run by any rule',
			remove: async (kk) => {
				if (rule)
					await saveSnippetRules(
						kk,
						z,
						(await snippetRules(kk, z)).filter((r) => str(r['snippet_name']) !== name),
					);
				await cfSend('DELETE', `/zones/${z.id}/snippets/${encodeURIComponent(name)}`, kk);
			},
		});
	}
	for (const r of await pageRulesOf(pageKey(ctx, key), z).catch(() => [])) {
		const name = patternOf(r);
		out.push({
			value: `page:${str(r['id'])}`,
			label: `${name} (page rule)`,
			name,
			when: name,
			remove: async (kk, uk) => {
				await cfSend('DELETE', `/zones/${z.id}/pagerules/${str(r['id'])}`, uk ?? kk);
			},
		});
	}
	return out;
}

export const anyRuleDestroy: ProductFormSpec = {
	async read(ctx) {
		const z = await zoneOf(ctx);
		const rules = await everyRule(ctx, z, ctx.key);
		const p = pick(
			'Rule',
			rules.map((r) => ({ value: r.value, label: r.label })),
			ctx.id,
		);
		const r = rules.find((x) => x.value === p.value);
		return formTab(
			form({
				key: 'destroy',
				title: 'Delete a rule',
				submit: 'Delete rule',
				danger: true,
				confirmName: r ? r.name : null,
				blocked: r ? null : 'No rules on this domain.',
				notes: r ? [note(`When: ${r.when}`, 'muted')] : [],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const k = await ctx.writeKey();
		const z = await zoneOf(ctx, k);
		const r = (await everyRule(ctx, z, k)).find((x) => x.value === (w.id ?? ctx.id));
		if (!r) throw new VendorError('Choose a rule.', 400);
		confirmed(w, r.name);
		await r.remove(k, ctx.consoleKey(USER_TOKEN) ?? null);
		return { message: `${r.label} deleted`, productId: null, follow: [] };
	},
};

/** The tabs and forms this file adds to the Rules screen. */
export function rulesTabs(): {
	tabs: Record<string, (ctx: ProductCtx) => Promise<ProductTab>>;
	forms: Record<string, ProductFormSpec>;
} {
	const forms: Record<string, ProductFormSpec> = {
		managed: managedTransforms,
		settings: urlNormalization,
		snippets: snippetsForm,
		connector: cloudConnector,
		pagerules: pageRules,
		destroy: anyRuleDestroy,
	};
	for (const k of RULE_KINDS) forms[k.tab] = ruleKindForm(k);
	const tabs: Record<string, (ctx: ProductCtx) => Promise<ProductTab>> = {};
	for (const [key, spec] of Object.entries(forms)) tabs[key] = (ctx) => spec.read(ctx);
	return { tabs, forms };
}
