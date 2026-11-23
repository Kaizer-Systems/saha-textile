import { createHash } from 'node:crypto';

import type {
	KeyRef,
	RequestsView,
	MonitorRange,
	ProductAction,
	ProductColumn,
	ProductFact,
	ProductField,
	ProductForm,
	ProductNote,
	ProductPicker,
	ProductRow,
	ProductSeries,
	ProductStat,
	ProductTab,
	ProductTable,
	ProductView,
	ProductWrite,
	Repository,
	Tone,
} from '@saha-textile/release-console-contracts';

import { VendorError, getJson, sendJson } from '../vendors/http.js';

/** What every product tab and form gets: the keys, the repository, and the product it is about. */
export interface ProductCtx {
	projectId: string;
	repo: Repository;
	/** The read key (falls back to the full-access key when no read key is linked). */
	key: string;
	/** The full-access key, asked for only by forms that change something. */
	writeKey(): Promise<string>;
	/** The edge slot's domains (Cloudflare); empty for DigitalOcean. */
	zones: string[];
	/** `?id=` of the open product, if any. */
	id: string | null;
	range: MonitorRange;
	/** The project's linked keys (names, kinds, states; never values). */
	keyRefs: KeyRef[];
	/** A value from the console's own key file by name (Spaces keys); never sent anywhere but the vendor. */
	consoleKey(name: string): string | null;
	/** Which environment each tagged resource belongs to (resource key → environment name). */
	envTags(): Record<string, string>;
	/** Tags a resource with one of the repository's environments, or clears it (null); the PIN was checked. */
	setEnvTag(key: string, env: string | null): void;
	/** Drops tags of this kind whose resource is gone; `liveIds` must be the complete live list. */
	pruneEnvTags(kind: string, liveIds: string[]): void;
	/** This project's audit entries with this action, newest first (what the console changed before). */
	recent(action: string): Array<{ at: string; detail: string }>;
	/** Every audit entry with this action, any project (local jobs are not tied to one). */
	recentAll(action: string): Array<{ at: string; detail: string }>;
	/** The repository on its source-code platform (owner/name), for GitHub screens. */
	repository: string;
	/** The local stack's request log for the last minutes: per minute [time, p95 ms, error share, requests]. */
	localRequests(minutes: number): Array<[number, number | null, number, number]>;
	/** The local request log's services and routes for the last minutes (APM's own read). */
	localView(minutes: number): RequestsView;
	/** The Mac helper (127.0.0.1:4419 or host.docker.internal): read-only looks at this Mac's stack. */
	helper<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T>;
	/** This console's audit log for the project, newest first. */
	auditLog(limit: number): Array<{ at: string; action: string; detail: string }>;
}

/** One step of a change the console follows after sending it. */
export interface Follow {
	label: string;
	/** Answers true when this step is done; throws VendorError when it failed. */
	check(key: string): Promise<boolean>;
	/** What the step found, shown under it once done (a load test stage's numbers). */
	detail?: () => string;
}

export interface Sent {
	message: string;
	productId: string | null;
	/** Steps after the vendor accepted the change, checked every few seconds. */
	follow?: Follow[];
}

export interface ProductFormSpec {
	/** The form as a tab (with its picker); the screen draws it and sends it back with the PIN. */
	read(ctx: ProductCtx): Promise<ProductTab>;
	send(ctx: ProductCtx, write: ProductWrite): Promise<Sent>;
}

/** One screen's live tabs and forms. Tabs it does not name stay drawn by the screen itself. */
export type Send = ProductFormSpec['send'];
export type Write = ProductWrite;

export interface ProductScreen {
	vendor: 'digitalocean' | 'cloudflare' | 'github' | 'local';
	tabs: Record<string, (ctx: ProductCtx) => Promise<ProductTab>>;
	forms?: Record<string, ProductFormSpec>;
}

/* ----- a short cache, so a screen's tabs and a quick revisit do not wait on the vendor again ----- */

const CACHE_MS = 20_000;
const cache = new Map<string, { at: number; body: Promise<unknown> }>();
const keyTag = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 12);

/** Forgets every cached read made with this key (after a change). */
export function forget(key: string): void {
	const tag = keyTag(key);
	for (const k of cache.keys()) if (k.startsWith(tag)) cache.delete(k);
}

/** Which Cloudflare token permission a refused path needs, in Cloudflare's own words. */
const CF_HINTS: Array<[RegExp, string]> = [
	[/dns_records|dnssec|dns_settings/, 'Zone › DNS › Edit (on the domain)'],
	[/\/certificates|ssl\/|origin_tls_client_auth|client_certificates/, 'Zone › SSL and Certificates › Edit'],
	[/rulesets|firewall|waf/, 'Zone › Zone WAF › Edit and Zone › Firewall Services › Edit'],
	[/purge_cache/, 'Zone › Cache Purge'],
	[/settings/, 'Zone › Zone Settings › Edit'],
	[/bot_management/, 'Zone › Bot Management › Edit'],
	[/email\/routing/, 'Zone › Email Routing Rules › Edit'],
	[/custom_pages/, 'Zone › Custom Pages › Edit'],
	[/pagerules/, 'Zone › Page Rules › Edit'],
	[/workers\/routes/, 'Zone › Workers Routes › Edit'],
	[/^\/client\/v4\/zones/, 'Zone › Zone › Read'],
];

function vendorMessage(vendor: string, url: string, status: number, body: unknown): string {
	const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
	const errors = Array.isArray(b['errors']) ? (b['errors'] as Array<Record<string, unknown>>) : [];
	const said =
		(typeof b['message'] === 'string' && b['message']) ||
		(errors[0] && typeof errors[0]['message'] === 'string' ? errors[0]['message'] : '') ||
		'';
	const path = url.replace(/^https:\/\/[^/]+/, '').split('?')[0] ?? '';
	if (status === 403 || status === 401) {
		const hint = vendor === 'Cloudflare' ? CF_HINTS.find(([re]) => re.test(path))?.[1] : undefined;
		return `${vendor} refused ${path} with this key (${status})${said ? `: ${said}` : ''}. ${hint ? `Add the permission ${hint} to the console’s Cloudflare token.` : 'The key needs that permission.'}`;
	}
	return `${vendor} answered ${status} to ${path}${said ? `: ${said}` : ''}.`;
}

/** GET a vendor URL, cached for a few seconds per key. Throws VendorError with plain words. */
export async function read(vendor: string, url: string, key: string, ttl = CACHE_MS): Promise<unknown> {
	const k = `${keyTag(key)} ${url}`;
	const hit = cache.get(k);
	if (hit && Date.now() - hit.at < ttl) return hit.body;
	const body = getJson(url, key).then((a) => {
		if (a.status >= 400) throw new VendorError(vendorMessage(vendor, url, a.status, a.body), a.status);
		return a.body;
	});
	cache.set(k, { at: Date.now(), body });
	body.catch(() => cache.delete(k));
	return body;
}

/** Like `read`, but a refusal or a missing product answers null (the tab says so instead of failing). */
export async function soft(vendor: string, url: string, key: string): Promise<unknown | null> {
	try {
		return await read(vendor, url, key);
	} catch (err) {
		if (err instanceof VendorError && [401, 403, 404, 405, 422].includes(err.status)) return null;
		throw err;
	}
}

/** A change sent to a vendor; forgets cached reads for this key first. */
export async function write(
	vendor: string,
	method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
	url: string,
	key: string,
	payload?: unknown,
): Promise<unknown> {
	forget(key);
	let status: number;
	let body: unknown;
	if (method === 'DELETE') {
		const res = await fetch(url, {
			method,
			headers: {
				authorization: `Bearer ${key}`,
				accept: 'application/json',
				'user-agent': 'release-console',
				...(payload === undefined ? {} : { 'content-type': 'application/json' }),
			},
			body: payload === undefined ? undefined : JSON.stringify(payload),
			signal: AbortSignal.timeout(20_000),
		});
		status = res.status;
		body = await res.json().catch(() => null);
	} else {
		const a = await sendJson(method, url, key, payload ?? {});
		status = a.status;
		body = a.body;
	}
	if (status >= 400) throw new VendorError(vendorMessage(vendor, url, status, body), status);
	return body;
}

/* ----- builders ----- */

export const col = (key: string, label: string, mono = false): ProductColumn => ({ key, label, mono });

export function table(
	title: string,
	columns: ProductColumn[],
	rows: ProductRow[],
	empty: string,
	opens = false,
): ProductTable {
	return { title, columns, rows, empty, opens };
}

export const row = (id: string | number, name: string, cells: ProductRow['cells'], tone: Tone = null): ProductRow => ({
	id: String(id),
	name,
	cells,
	tone,
});

export const stat = (label: string, value: string | number, sub = ''): ProductStat => ({
	label,
	value: String(value),
	sub,
});
export const note = (text: string, tone: Tone = 'cy'): ProductNote => ({ text, tone });
export const fact = (label: string, value: string | number | null | undefined, tone: Tone = null): ProductFact => [
	label,
	value === null || value === undefined || value === '' ? '—' : String(value),
	tone,
];
export const action = (label: string, form: string, tone: ProductAction['tone'] = 'ghost'): ProductAction => ({
	label,
	form,
	tone,
});

export function view(v: Partial<ProductView>, picker: ProductPicker | null = null): ProductTab {
	return {
		type: 'view',
		picker,
		view: {
			head: v.head ?? null,
			stats: v.stats ?? [],
			notes: v.notes ?? [],
			facts: v.facts ?? [],
			tables: v.tables ?? [],
			links: v.links ?? [],
			actions: v.actions ?? [],
		},
	};
}

export const monitorTab = (
	series: ProductSeries[],
	notes: ProductNote[],
	picker: ProductPicker | null,
): ProductTab => ({
	type: 'monitor',
	picker,
	monitor: { series, notes },
});

export const formTab = (form: ProductForm, picker: ProductPicker | null = null): ProductTab => ({
	type: 'form',
	picker,
	form,
});

export function form(f: Partial<ProductForm> & Pick<ProductForm, 'key' | 'title' | 'submit'>): ProductForm {
	return {
		fields: [],
		cost: null,
		notes: [],
		confirmName: null,
		danger: false,
		blocked: null,
		...f,
	};
}

export function field(
	key: string,
	label: string,
	type: ProductField['type'],
	more: Partial<Omit<ProductField, 'key' | 'label' | 'type'>> = {},
): ProductField {
	return {
		key,
		label,
		type,
		options: [],
		value: null,
		help: '',
		required: false,
		min: null,
		max: null,
		readOnly: false,
		...more,
	};
}

export const option = (value: string, label: string, sub = '') => ({ value, label, sub });

/** The picker for tabs about one product, defaulting to the open one or the first. */
export function pick(
	label: string,
	options: Array<{ value: string; label: string }>,
	id: string | null,
): ProductPicker {
	return { label, options, value: options.find((o) => o.value === id)?.value ?? options[0]?.value ?? null };
}

/* ----- reading what the owner sent ----- */

export function text(w: ProductWrite, key: string, required = true): string {
	const v = w.values[key];
	const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
	if (required && !s) throw new VendorError(`Fill in ${key}.`, 400);
	return s;
}
export function int(w: ProductWrite, key: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
	const v = w.values[key];
	const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
	if (!Number.isInteger(n) || n < min || n > max)
		throw new VendorError(`${key} must be a whole number from ${min} to ${max}.`, 400);
	return n;
}
export const bool = (w: ProductWrite, key: string): boolean => w.values[key] === true || w.values[key] === 'true';
export function list(w: ProductWrite, key: string): string[] {
	const v = w.values[key];
	if (Array.isArray(v)) return v.map((x) => x.trim()).filter(Boolean);
	if (typeof v === 'string')
		return v
			.split(/[\s,]+/)
			.map((x) => x.trim())
			.filter(Boolean);
	return [];
}
/** Destroying asks for the product's name to be typed exactly. */
export function confirmed(w: ProductWrite, name: string): void {
	if (w.confirm.trim() !== name) throw new VendorError(`Type ${name} to confirm.`, 400);
}
/** Names DigitalOcean and Cloudflare accept for things the console makes. */
export function slug(v: string, what = 'Name'): string {
	if (!/^[a-z0-9][a-z0-9.-]{0,62}$/i.test(v))
		throw new VendorError(`${what}: letters, digits, dots and dashes only.`, 400);
	return v;
}

/* ----- words ----- */

export function bytes(n: number | null | undefined): string {
	if (n === null || n === undefined || !Number.isFinite(n)) return '—';
	const u = ['B', 'KB', 'MB', 'GB', 'TB'];
	let i = 0;
	let v = n;
	while (v >= 1024 && i < u.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
export const usd = (n: number): string => `$${n.toFixed(2)}`;
export function ago(iso: string | null | undefined): string {
	if (!iso) return '—';
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return iso;
	const s = Math.max(0, (Date.now() - t) / 1000);
	if (s < 90) return 'just now';
	if (s < 5400) return `${Math.round(s / 60)} min ago`;
	if (s < 129_600) return `${Math.round(s / 3600)} h ago`;
	if (s < 86_400 * 60) return `${Math.round(s / 86_400)} days ago`;
	return iso.slice(0, 10);
}
export const when = (iso: string | null | undefined): string => (iso ? iso.replace('T', ' ').slice(0, 16) : '—');
export const yes = (b: unknown): string => (b === true ? 'on' : b === false ? 'off' : '—');
export const toneOf = (status: string): Tone =>
	/^(active|running|online|ok|healthy|available|ready|enabled|completed|up|live|success|succeeded|on)$/i.test(status)
		? 'ok'
		: /(error|fail|down|offline|degraded|errored|unhealthy|deleted|canceled|cancelled)/i.test(status)
			? 'red'
			: /(new|pending|progress|creat|deploy|provision|build|starting|waiting|updating|resiz|migrat)/i.test(status)
				? 'amber'
				: 'muted';
