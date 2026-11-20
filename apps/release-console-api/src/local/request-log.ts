import { Injectable } from '@nestjs/common';
import {
	type DockerSnapshot,
	LATENCY_BUCKETS_MS,
	type ClientBuildsView,
	type Logs,
	type NotFoundView,
	type RequestRoute,
	type RequestsView,
} from '@saha-textile/release-console-contracts';

import { RunnerClient } from '../runner/runner-client.js';
import { ConsoleStore } from '../store/console-store.js';

const MINUTE = 60_000;
const KEEP_MS = 7 * 86_400_000;
const MAX_ROUTES = 100;

/** One request from the edge's JSON log, reduced to what the summaries need. */
export interface EdgeRequest {
	at: number;
	service: string;
	method: string;
	route: string;
	status: number;
	ms: number;
	/** Where the visitor came from: the referrer's host only, `this site` for our own links, or ''. */
	referrer: string;
	/** The client build that sent it (`x-client-build`, logged as `client_build`), or ''. */
	build: string;
}

/**
 * Where a visitor came from, from the edge's `referer_host` field (the host only: the edge drops the
 * scheme, sign-in, port, path and query before it logs anything). Lowercased without `www.`;
 * `this site` when it is one of our own hosts (the same host or the same site name, e.g.
 * `local.saha-textile.localhost` and `api-local.saha-textile.localhost`); '' when there was none.
 */
export function referrerOf(refererHost: unknown, host: unknown): string {
	if (typeof refererHost !== 'string') return '';
	const from = refererHost
		.trim()
		.toLowerCase()
		.replace(/^www\./, '');
	if (!/^[a-z0-9.-]+$/.test(from)) return '';
	const own = String(host ?? '')
		.toLowerCase()
		.replace(/:\d+$/, '')
		.replace(/^www\./, '');
	const site = (h: string) => h.split('.').slice(-2).join('.');
	return from === own || (own.includes('.') && site(from) === site(own)) ? 'this site' : from;
}

/** The service a host serves: the first label of the local host names. */
export function serviceOf(host: string): string {
	const first = host.split('.')[0] ?? '';
	if (first.startsWith('api')) return 'api';
	if (first.startsWith('admin')) return 'admin';
	return 'storefront';
}

const STATIC = /\.(js|mjs|css|map|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|json|webmanifest|txt|xml)$/i;

/**
 * A route without its query string, IDs or anything personal: ObjectIds, UUIDs, numbers, long
 * tokens and anything with an @ become `:id`; static files collapse by type; deep paths keep three
 * segments. Query strings, where personal data could ride, are never kept.
 */
export function routeOf(uri: string): string {
	const path = ((uri.split('?')[0] ?? '/').split('#')[0] ?? '/').replace(/\/pay\/[^/]+/gi, '/pay/:token');
	const ext = STATIC.exec(path)?.[1];
	if (ext) return `static .${ext.toLowerCase()}`;
	const parts = path
		.split('/')
		.filter(Boolean)
		.map((s) =>
			/^[0-9a-f]{24}$/i.test(s) ||
			/^[0-9a-f-]{32,36}$/i.test(s) ||
			/^\d+$/.test(s) ||
			s.length > 40 ||
			s.includes('@') ||
			s.includes('%40')
				? ':id'
				: s,
		);
	return `/${parts.slice(0, 3).join('/')}${parts.length > 3 ? '/…' : ''}`;
}

/** One line of `docker logs --timestamps` from the edge, or null when it is not a JSON request line. */
export function parseEdgeLine(line: string): EdgeRequest | null {
	const brace = line.indexOf('{');
	if (brace < 0) return null;
	let d: Record<string, unknown>;
	try {
		d = JSON.parse(line.slice(brace)) as Record<string, unknown>;
	} catch {
		return null;
	}
	if (d['kind'] !== 'edge' || typeof d['time'] !== 'string') return null;
	const at = Date.parse(d['time']);
	const status = Number(d['status']);
	const seconds = Number(d['seconds']);
	if (!Number.isFinite(at) || !Number.isFinite(status) || !Number.isFinite(seconds)) return null;
	return {
		at,
		service: serviceOf(String(d['host'] ?? '')),
		method: String(d['method'] ?? 'GET'),
		route: routeOf(String(d['uri'] ?? '/')),
		status,
		ms: Math.round(seconds * 1000),
		referrer: referrerOf(d['referer_host'], d['host']),
		build: /^[a-z0-9]{7,40}(-app)?$/.test(String(d['client_build'] ?? '')) ? String(d['client_build']) : '',
	};
}

/** The bucket a duration falls in. */
export const bucketOf = (ms: number): number => {
	const i = LATENCY_BUCKETS_MS.findIndex((b) => ms <= b);
	return i < 0 ? LATENCY_BUCKETS_MS.length : i;
};

/** A percentile from bucket counts, interpolated inside its bucket; null without requests. */
export function percentile(buckets: number[], q: number): number | null {
	const total = buckets.reduce((a, b) => a + b, 0);
	if (!total) return null;
	const target = q * total;
	let before = 0;
	for (let i = 0; i < buckets.length; i++) {
		const n = buckets[i] ?? 0;
		if (before + n >= target && n > 0) {
			const lower = i === 0 ? 0 : (LATENCY_BUCKETS_MS[i - 1] ?? 0);
			const upper = LATENCY_BUCKETS_MS[i] ?? lower * 2;
			return Math.round(lower + (upper - lower) * ((target - before) / n));
		}
		before += n;
	}
	return LATENCY_BUCKETS_MS.at(-1) ?? null;
}

/** Apdex with a 0.5 s target: under 0.5 s counts fully, under 2 s counts half. */
export function apdex(buckets: number[]): number | null {
	const total = buckets.reduce((a, b) => a + b, 0);
	if (!total) return null;
	const fast = LATENCY_BUCKETS_MS.indexOf(500);
	const slow = LATENCY_BUCKETS_MS.indexOf(2000);
	const satisfied = buckets.slice(0, fast + 1).reduce((a, b) => a + b, 0);
	const tolerating = buckets.slice(fast + 1, slow + 1).reduce((a, b) => a + b, 0);
	return Math.round(((satisfied + tolerating / 2) / total) * 100) / 100;
}

interface Row {
	minute: number;
	service: string;
	method: string;
	route: string;
	count: number;
	e5: number;
	e4: number;
	buckets: string;
}

export interface Summary {
	minute: number;
	service: string;
	method: string;
	route: string;
	count: number;
	e5: number;
	e4: number;
	buckets: number[];
}

/** Minute summaries of one minute's requests, at most MAX_ROUTES routes per service. */
export function summarise(requests: EdgeRequest[], minute: number): Summary[] {
	const rows = new Map<string, Omit<Summary, 'minute'>>();
	const routesPer = new Map<string, number>();
	for (const r of requests) {
		if (r.at < minute || r.at >= minute + MINUTE) continue;
		let key = `${r.service} ${r.method} ${r.route}`;
		if (!rows.has(key)) {
			const n = routesPer.get(r.service) ?? 0;
			if (n >= MAX_ROUTES) key = `${r.service} * other`;
			else routesPer.set(r.service, n + 1);
		}
		const row = rows.get(key) ?? {
			service: r.service,
			method: key.endsWith(' other') ? '*' : r.method,
			route: key.endsWith(' other') ? 'other' : r.route,
			count: 0,
			e5: 0,
			e4: 0,
			buckets: new Array<number>(LATENCY_BUCKETS_MS.length + 1).fill(0),
		};
		row.count++;
		if (r.status >= 500) row.e5++;
		else if (r.status >= 400) row.e4++;
		row.buckets[bucketOf(r.ms)] = (row.buckets[bucketOf(r.ms)] ?? 0) + 1;
		rows.set(key, row);
	}
	return [...rows.values()].map((r) => ({ minute, ...r }));
}

/** One minute's requests that named their client build, per service, build and installed app. */
export function clientBuildsOf(
	requests: EdgeRequest[],
	minute: number,
): { service: string; build: string; installed: boolean; count: number }[] {
	const rows = new Map<string, { service: string; build: string; installed: boolean; count: number }>();
	for (const r of requests) {
		if (r.at < minute || r.at >= minute + MINUTE || !r.build) continue;
		const installed = r.build.endsWith('-app');
		const build = installed ? r.build.slice(0, -4) : r.build;
		const key = `${r.service} ${build} ${installed}`;
		const row = rows.get(key) ?? { service: r.service, build, installed, count: 0 };
		row.count++;
		rows.set(key, row);
	}
	return [...rows.values()];
}

/** One minute's "page not found" answers from the shop's pages (not files), by route and referrer. */
export function notFoundOf(
	requests: EdgeRequest[],
	minute: number,
): { route: string; referrer: string; count: number }[] {
	const rows = new Map<string, { route: string; referrer: string; count: number }>();
	for (const r of requests) {
		if (r.at < minute || r.at >= minute + MINUTE) continue;
		if (r.status !== 404 || r.service !== 'storefront' || r.method !== 'GET' || r.route.startsWith('static '))
			continue;
		const key = `${r.route} ${r.referrer}`;
		const row = rows.get(key) ?? { route: r.route, referrer: r.referrer, count: 0 };
		row.count++;
		rows.set(key, row);
	}
	return [...rows.values()];
}

const add = (a: number[], b: number[]) => a.map((v, i) => v + (b[i] ?? 0));
const timing = (count: number, e5: number, e4: number, buckets: number[], minutes: number) => ({
	count,
	perMinute: Math.round((count / minutes) * 10) / 10,
	p50: percentile(buckets, 0.5),
	p95: percentile(buckets, 0.95),
	p99: percentile(buckets, 0.99),
	errorRate: count ? e5 / count : 0,
	clientErrorRate: count ? e4 / count : 0,
	apdex: apdex(buckets),
});

/**
 * The requests view: the local stack edge's JSON request log, read through the Mac helper once a
 * minute and kept as minute summaries per service and route for 7 days. Raw lines are never kept.
 */
@Injectable()
export class RequestLog {
	private lastMinute = 0;
	private readAt: string | null = null;
	private source: 'edge' | 'none' = 'none';

	constructor(
		private readonly runner: RunnerClient,
		private readonly store: ConsoleStore,
	) {}

	/** Called on every reading; summarises each minute once it has ended. */
	async tick(docker: DockerSnapshot | null, now = Date.now()): Promise<void> {
		const current = Math.floor(now / MINUTE) * MINUTE;
		if (this.lastMinute >= current - MINUTE) return;
		const edge = docker?.containers.find(
			(c) => c.name.startsWith('saha-textile-stack-edge') && c.state === 'running',
		);
		if (!edge) {
			this.source = 'none';
			this.lastMinute = current - MINUTE;
			return;
		}
		const logs = await this.runner.call<Logs>(
			'GET',
			`/logs?container=${encodeURIComponent(edge.name)}&tail=5000&since=4m`,
			undefined,
			20_000,
		);
		const requests = logs.lines.map(parseEdgeLine).filter((r): r is EdgeRequest => r !== null);
		if (requests.length) this.source = 'edge';
		const first = this.lastMinute ? this.lastMinute + MINUTE : current - 3 * MINUTE;
		const db = this.store.db();
		const insert = db.prepare(
			'INSERT INTO requests (minute, service, method, route, count, e5, e4, buckets) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
		);
		const missing = db.prepare('INSERT INTO not_found (minute, route, referrer, count) VALUES (?, ?, ?, ?)');
		const builds = db.prepare(
			'INSERT INTO client_builds (minute, service, build, installed, count) VALUES (?, ?, ?, ?, ?)',
		);
		for (let m = Math.max(first, current - 3 * MINUTE); m < current; m += MINUTE) {
			for (const r of summarise(requests, m))
				insert.run(m, r.service, r.method, r.route, r.count, r.e5, r.e4, JSON.stringify(r.buckets));
			for (const r of notFoundOf(requests, m)) missing.run(m, r.route, r.referrer, r.count);
			for (const r of clientBuildsOf(requests, m))
				builds.run(m, r.service, r.build, r.installed ? 1 : 0, r.count);
		}
		db.prepare('DELETE FROM client_builds WHERE minute < ?').run(now - KEEP_MS);
		db.prepare('DELETE FROM requests WHERE minute < ?').run(now - KEEP_MS);
		db.prepare('DELETE FROM not_found WHERE minute < ?').run(now - KEEP_MS);
		this.lastMinute = current - MINUTE;
		this.readAt = new Date(now).toISOString();
	}

	private rows(since: number): Row[] {
		return this.store.db().prepare('SELECT * FROM requests WHERE minute >= ?').all(since) as unknown as Row[];
	}

	/**
	 * The shop's "page not found" answers of the last `hours` hours (Search engines, brief
	 * 26gq3NbcbBESea6abRtsa3, screen 5): the 50 most frequent paths, with where visitors came from.
	 */
	notFound(hours: number, now = Date.now()): NotFoundView {
		const since = now - hours * 3_600_000;
		const rows = this.store
			.db()
			.prepare('SELECT minute, route, referrer, count FROM not_found WHERE minute >= ?')
			.all(since) as unknown as { minute: number; route: string; referrer: string; count: number }[];
		const paths = new Map<string, { count: number; last: number; from: Map<string, number> }>();
		for (const r of rows) {
			const p = paths.get(r.route) ?? { count: 0, last: 0, from: new Map<string, number>() };
			p.count += r.count;
			p.last = Math.max(p.last, r.minute);
			if (r.referrer) p.from.set(r.referrer, (p.from.get(r.referrer) ?? 0) + r.count);
			paths.set(r.route, p);
		}
		return {
			source: this.source,
			since: new Date(since).toISOString(),
			total: rows.reduce((a, r) => a + r.count, 0),
			paths: [...paths.entries()]
				.sort((a, b) => b[1].count - a[1].count)
				.slice(0, 50)
				.map(([route, p]) => ({
					route,
					count: p.count,
					from: [...p.from.entries()]
						.sort((a, b) => b[1] - a[1])
						.map(([h]) => h)
						.slice(0, 3),
					lastAt: new Date(p.last + MINUTE).toISOString(),
				})),
		};
	}

	/** Which client builds called in the last `hours` hours, per app, newest first (Client versions). */
	clientBuilds(hours: number, now = Date.now()): ClientBuildsView {
		const since = now - hours * 3_600_000;
		const rows = this.store
			.db()
			.prepare('SELECT minute, service, build, installed, count FROM client_builds WHERE minute >= ?')
			.all(since) as unknown as {
			minute: number;
			service: string;
			build: string;
			installed: number;
			count: number;
		}[];
		const apps = new Map<
			string,
			Map<string, { requests: number; installed: number; lastHour: number; first: number; last: number }>
		>();
		for (const r of rows) {
			const builds = apps.get(r.service) ?? new Map();
			const b = builds.get(r.build) ?? {
				requests: 0,
				installed: 0,
				lastHour: 0,
				first: r.minute,
				last: r.minute,
			};
			b.requests += r.count;
			if (r.installed) b.installed += r.count;
			if (r.minute >= now - 3_600_000) b.lastHour += r.count;
			b.first = Math.min(b.first, r.minute);
			b.last = Math.max(b.last, r.minute);
			builds.set(r.build, b);
			apps.set(r.service, builds);
		}
		return {
			source: this.source,
			since: new Date(since).toISOString(),
			apps: [...apps.entries()].map(([service, builds]) => ({
				service,
				builds: [...builds.entries()]
					.sort((a, b) => b[1].last - a[1].last)
					.map(([build, b]) => ({
						build,
						requests: b.requests,
						installed: b.installed,
						lastHour: b.lastHour,
						firstAt: new Date(b.first).toISOString(),
						lastAt: new Date(b.last + MINUTE).toISOString(),
					})),
			})),
		};
	}

	/** Requests and server errors of the last `minutes` minutes, for the errors-rising alert; null without a log. */
	recent(minutes: number, now = Date.now()): { total: number; serverErrors: number } | null {
		if (this.source === 'none') return null;
		const rows = this.rows(now - minutes * MINUTE);
		return { total: rows.reduce((a, r) => a + r.count, 0), serverErrors: rows.reduce((a, r) => a + r.e5, 0) };
	}

	view(minutes: number, now = Date.now()): RequestsView {
		const since = Math.floor((now - minutes * MINUTE) / MINUTE) * MINUTE;
		const rows = this.rows(since).map((r) => ({ ...r, b: JSON.parse(r.buckets) as number[] }));
		const empty = () => new Array<number>(LATENCY_BUCKETS_MS.length + 1).fill(0);
		const group = <K extends string>(keyOf: (r: (typeof rows)[number]) => K) => {
			const out = new Map<
				K,
				{ count: number; e5: number; e4: number; b: number[]; first: (typeof rows)[number] }
			>();
			for (const r of rows) {
				const k = keyOf(r);
				const g = out.get(k) ?? { count: 0, e5: 0, e4: 0, b: empty(), first: r };
				g.count += r.count;
				g.e5 += r.e5;
				g.e4 += r.e4;
				g.b = add(g.b, r.b);
				out.set(k, g);
			}
			return out;
		};
		const services = [...group((r) => r.service).entries()]
			.map(([service, g]) => ({ service, ...timing(g.count, g.e5, g.e4, g.b, minutes) }))
			.sort((a, b) => b.count - a.count);
		const routes: RequestRoute[] = [...group((r) => `${r.service} ${r.method} ${r.route}`).values()]
			.map((g) => ({
				service: g.first.service,
				method: g.first.method,
				route: g.first.route,
				...timing(g.count, g.e5, g.e4, g.b, minutes),
				buckets: g.b,
			}))
			.sort((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0))
			.slice(0, 40);
		const series: RequestsView['series'] = [...group((r) => String(r.minute)).entries()]
			.map(([m, g]): [number, number | null, number, number] => [
				Number(m),
				percentile(g.b, 0.95),
				g.count ? g.e5 / g.count : 0,
				g.count,
			])
			.sort((a, b) => a[0] - b[0]);
		return {
			source: this.source === 'edge' || rows.length ? 'edge' : 'none',
			note:
				this.source === 'none' && !rows.length
					? 'Nothing to read yet: the local stack’s edge is not running, or has served no requests since the console started.'
					: null,
			minutes,
			readAt: this.readAt,
			services,
			routes,
			series,
		};
	}
}
