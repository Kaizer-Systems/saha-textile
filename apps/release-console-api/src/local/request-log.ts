import { Injectable } from '@nestjs/common';
import {
	type DockerSnapshot,
	LATENCY_BUCKETS_MS,
	type Logs,
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
	const path = (uri.split('?')[0] ?? '/').split('#')[0] ?? '/';
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
		for (let m = Math.max(first, current - 3 * MINUTE); m < current; m += MINUTE)
			for (const r of summarise(requests, m))
				insert.run(m, r.service, r.method, r.route, r.count, r.e5, r.e4, JSON.stringify(r.buckets));
		db.prepare('DELETE FROM requests WHERE minute < ?').run(now - KEEP_MS);
		this.lastMinute = current - MINUTE;
		this.readAt = new Date(now).toISOString();
	}

	private rows(since: number): Row[] {
		return this.store.db().prepare('SELECT * FROM requests WHERE minute >= ?').all(since) as unknown as Row[];
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
