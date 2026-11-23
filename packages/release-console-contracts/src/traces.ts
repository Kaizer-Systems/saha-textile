import { z } from 'zod';

/**
 * Real tracing (Release Path brief Part 6, approved 23 Nov): traces from the local VictoriaTraces
 * (Jaeger-compatible search API on 127.0.0.1:10428, the Infisical chat's M7), read by the Mac helper.
 * Spans carry no values: addresses use the logs' {{token}} placeholders and database calls show their
 * shape with "?" (masked where they are made). Servers wait for DEC-TRACING-SERVERS.
 */

export const traceSpanSchema = z.object({
	id: z.string(),
	parentId: z.string().nullable(),
	name: z.string(),
	service: z.string(),
	/** Where the span ran, in words: shop, API, worker, MongoDB, Redis, search, or an outside host. */
	where: z.string(),
	startMs: z.number(),
	ms: z.number(),
	depth: z.number().int(),
	error: z.boolean(),
	/** The database call's shape (`db.query.text`, every value "?"), when it is one. */
	query: z.string().nullable(),
});
export type TraceSpan = z.infer<typeof traceSpanSchema>;

export const traceSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	service: z.string(),
	ms: z.number(),
	status: z.number().nullable(),
	error: z.boolean(),
	at: z.string(),
	spans: z.number().int(),
	requestId: z.string().nullable(),
	build: z.string().nullable(),
});
export type TraceSummary = z.infer<typeof traceSummarySchema>;

export const diagnosisSchema = z.object({ rule: z.string(), text: z.string(), spanId: z.string().nullable() });
export type Diagnosis = z.infer<typeof diagnosisSchema>;

export const traceViewSchema = traceSummarySchema.extend({
	spans: z.array(traceSpanSchema),
	diagnose: z.array(diagnosisSchema),
});
export type TraceView = z.infer<typeof traceViewSchema>;

export const tracesListSchema = z.object({
	state: z.enum(['ok', 'off']),
	message: z.string(),
	services: z.array(z.string()),
	traces: z.array(traceSummarySchema),
	/** Calls between services across these traces, for the service map. */
	edges: z.array(z.object({ from: z.string(), to: z.string(), calls: z.number().int(), ms: z.number() })),
});
export type TracesList = z.infer<typeof tracesListSchema>;

/* ----- reading a Jaeger-format trace ----- */

const rec = (v: unknown): Record<string, unknown> =>
	v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** A span's tags as a plain map. */
function tagsOf(span: Record<string, unknown>): Record<string, string> {
	return Object.fromEntries(arr(span['tags']).map((t) => [str(rec(t)['key']), str(rec(t)['value'])]));
}

const DB_WHERE: Record<string, string> = { mongodb: 'MongoDB', redis: 'Redis', meilisearch: 'search' };
const SERVICE_WHERE: Record<string, string> = {
	'saha-textile-storefront': 'shop',
	'saha-textile-api': 'API',
	'saha-textile-worker': 'worker',
};

/**
 * Our own containers and this machine: exact names only, so outside hosts such as api.msg91.com or
 * api-m.paypal.com stay outside calls.
 */
const INSIDE_HOST =
	/^((saha-textile-)?(api|storefront|worker|mongo|redis|meilisearch)|localhost|127\.[\d.]+|::1|\[::1\])$/;

/**
 * `callsOurs`: the span has a child in another of our own services, so it is a call between them
 * (the shop's call to the API joins the API's trace), never an outside host, whatever address it used.
 */
function whereOf(service: string, tags: Record<string, string>, callsOurs = false): string {
	const db = tags['db.system'];
	if (db) return DB_WHERE[db] ?? db;
	const host = tags['server.address'] ?? tags['net.peer.name'];
	if (host && !callsOurs && tags['span.kind'] === 'client' && !INSIDE_HOST.test(host)) return host;
	return SERVICE_WHERE[service] ?? service;
}

/** One trace from the Jaeger search API, as the console draws it (start times in ms from the request's start). */
export function traceOf(raw: unknown): TraceView | null {
	const t = rec(raw);
	const processes = rec(t['processes']);
	const spansRaw = arr(t['spans']).map(rec);
	if (!spansRaw.length) return null;
	const parentOf = (s: Record<string, unknown>) =>
		str(
			rec(arr(s['references']).find((r) => str(rec(r)['refType']) === 'CHILD_OF') ?? arr(s['references'])[0])[
				'spanID'
			],
		) || null;
	const ids = new Set(spansRaw.map((s) => str(s['spanID'])));
	const isRoot = (s: Record<string, unknown>) => {
		const p = parentOf(s);
		return !p || !ids.has(p);
	};
	// The span with no parent in this trace; if every span has one (a loop), the earliest.
	const root =
		spansRaw.find(isRoot) ??
		spansRaw.reduce((first, s) => (Number(s['startTime']) < Number(first['startTime']) ? s : first));
	const t0 = Number(root['startTime']);
	// The root is depth 0. A span is marked 0 while its depth is worked out, so parents that point back
	// round in a loop (a broken trace from the store) end the climb instead of recursing for ever.
	const depthOf = new Map<string, number>([[str(root['spanID']), 0]]);
	const depth = (s: Record<string, unknown>): number => {
		const id = str(s['spanID']);
		const known = depthOf.get(id);
		if (known !== undefined) return known;
		depthOf.set(id, 0);
		const p = parentOf(s);
		const parent = p ? spansRaw.find((x) => str(x['spanID']) === p) : undefined;
		const d = parent && parent !== s ? Math.min(depth(parent) + 1, 12) : 0;
		depthOf.set(id, d);
		return d;
	};
	const serviceOf = (s: Record<string, unknown>) => str(rec(processes[str(s['processID'])])['serviceName']);
	// Spans with a child in another of our own services: calls between our services.
	const callsOurs = new Set(
		spansRaw
			.filter((c) => SERVICE_WHERE[serviceOf(c)])
			.flatMap((c) => {
				const p = parentOf(c);
				const parent = p ? spansRaw.find((x) => str(x['spanID']) === p) : undefined;
				return parent && serviceOf(parent) !== serviceOf(c) ? [p as string] : [];
			}),
	);
	const spans: TraceSpan[] = spansRaw
		.map((s) => {
			const tags = tagsOf(s);
			const service = serviceOf(s);
			return {
				id: str(s['spanID']),
				parentId: s === root ? null : parentOf(s),
				name: str(s['operationName']),
				service,
				where: whereOf(service, tags, callsOurs.has(str(s['spanID']))),
				startMs: Math.max(0, (Number(s['startTime']) - t0) / 1000),
				ms: Number(s['duration']) / 1000,
				depth: depth(s),
				error: tags['error'] === 'true' || Number(tags['http.response.status_code']) >= 500,
				query: tags['db.query.text'] ?? null,
			};
		})
		.sort((a, b) => a.startMs - b.startMs);
	const rootTags = tagsOf(root);
	const rootService = str(rec(processes[str(root['processID'])])['serviceName']);
	const status = Number(rootTags['http.response.status_code']) || null;
	const summary: TraceSummary = {
		id: str(t['traceID']) || str(root['traceID']),
		// The route template when the server names one, else the masked path (url.path, {{token}} placeholders).
		name:
			rootTags['http.route'] || rootTags['url.path']
				? `${rootTags['http.request.method'] ?? ''} ${rootTags['http.route'] || rootTags['url.path']}`.trim()
				: str(root['operationName']),
		service: rootService,
		ms: Number(root['duration']) / 1000,
		status,
		error: spans.some((s) => s.error),
		at: new Date(t0 / 1000).toISOString(),
		spans: spans.length,
		requestId: rootTags['saha_textile.request_id'] ?? null,
		build: rec(processes[str(root['processID'])])['tags']
			? (Object.fromEntries(
					arr(rec(processes[str(root['processID'])])['tags']).map((x) => [
						str(rec(x)['key']),
						str(rec(x)['value']),
					]),
				)['service.version'] ?? null)
			: null,
	};
	return { ...summary, spans, diagnose: [] };
}

/**
 * Diagnose (brief 6.1): fixed rules, no AI. The span that took most of the request, the same call
 * made again and again, a slow database call, and an outside call far over its usual time (the
 * median of the same call across the other traces read).
 */
export function diagnose(trace: TraceView, others: readonly TraceView[] = []): Diagnosis[] {
	const out: Diagnosis[] = [];
	const total = trace.ms || 1;
	const children = trace.spans.filter((s) => s.parentId !== null);
	const slowest = [...children].sort((a, b) => b.ms - a.ms)[0];
	if (slowest && slowest.ms / total >= 0.5)
		out.push({
			rule: 'slowest',
			text: `${slowest.name} (${slowest.where}) took ${Math.round((slowest.ms / total) * 100)}% of this request: ${Math.round(slowest.ms)} ms of ${Math.round(total)}.`,
			spanId: slowest.id,
		});
	const same = new Map<string, TraceSpan[]>();
	for (const s of children) {
		const k = `${s.where}|${s.name}|${s.query ?? ''}`;
		same.set(k, [...(same.get(k) ?? []), s]);
	}
	for (const list of same.values())
		if (list.length >= 3) {
			const first = list[0] as TraceSpan;
			out.push({
				rule: 'repeated',
				text: `${first.name} (${first.where}) ran ${list.length} times in one request; one call for all of them would save about ${Math.round(list.slice(1).reduce((n, s) => n + s.ms, 0))} ms.`,
				spanId: first.id,
			});
		}
	for (const s of children)
		if (['MongoDB', 'Redis', 'search'].includes(s.where) && s.ms >= 100)
			out.push({
				rule: 'slow-database',
				text: `${s.name} on ${s.where} took ${Math.round(s.ms)} ms${s.query ? ` (${s.query})` : ''}: look for a missing index in the Database monitor.`,
				spanId: s.id,
			});
	const usual = (name: string, where: string) => {
		const times = others
			.flatMap((t) => t.spans)
			.filter((x) => x.name === name && x.where === where)
			.map((x) => x.ms)
			.sort((a, b) => a - b);
		return times.length >= 3 ? (times[Math.floor(times.length / 2)] as number) : null;
	};
	for (const s of children) {
		if (['shop', 'API', 'worker', 'MongoDB', 'Redis', 'search'].includes(s.where)) continue;
		const median = usual(s.name, s.where);
		if (median !== null && s.ms > median * 2 && s.ms - median > 200)
			out.push({
				rule: 'outside-slow',
				text: `${s.where} answered ${s.name} in ${Math.round(s.ms)} ms; it usually takes about ${Math.round(median)} ms.`,
				spanId: s.id,
			});
	}
	return out;
}

/** Calls between services, for the service map: a span whose parent ran elsewhere is one call. */
export function edgesOf(traces: readonly TraceView[]): TracesList['edges'] {
	const map = new Map<string, { from: string; to: string; calls: number; ms: number }>();
	for (const t of traces) {
		const byId = new Map(t.spans.map((s) => [s.id, s]));
		for (const s of t.spans) {
			const p = s.parentId ? byId.get(s.parentId) : undefined;
			if (!p || p.where === s.where) continue;
			const k = `${p.where}→${s.where}`;
			const e = map.get(k) ?? { from: p.where, to: s.where, calls: 0, ms: 0 };
			e.calls += 1;
			e.ms += s.ms;
			map.set(k, e);
		}
	}
	return [...map.values()].map((e) => ({ ...e, ms: Math.round(e.ms / e.calls) }));
}

/* ----- the tracing switch on this Mac (brief 8UmNaHHAuiGLez47McHkj8, approved 23 Nov) ----- */

/** What the Mac helper reads: Docker, the trace store, the address, the stack's apps, ports 4000 and 4200. */
export const tracingRawSchema = z.object({
	docker: z.boolean(),
	store: z.boolean(),
	address: z.boolean(),
	addressSince: z.string().nullable(),
	stack: z.array(z.string()),
	outside: z.object({
		api: z.object({ startedAt: z.string().nullable(), vite: z.boolean() }).nullable(),
		storefront: z.object({ startedAt: z.string().nullable(), vite: z.boolean() }).nullable(),
	}),
});
export type TracingRaw = z.infer<typeof tracingRawSchema>;

export const tracingAppSchema = z.object({
	label: z.string(),
	service: z.string(),
	sending: z.boolean(),
	note: z.string(),
	tone: z.enum(['ok', 'amber', 'muted']),
});
export const tracingViewSchema = z.object({
	/** off: no store or no address · on: both · stopped: address set, store off · no-docker: Docker is off. */
	state: z.enum(['off', 'on', 'stopped', 'no-docker']),
	store: z.boolean(),
	address: z.boolean(),
	apps: z.array(tracingAppSchema),
});
export type TracingView = z.infer<typeof tracingViewSchema>;

const APPS = [
	{ label: 'API', service: 'saha-textile-api', stack: 'api', port: 4000, outside: 'api' },
	{ label: 'Worker', service: 'saha-textile-worker', stack: 'worker', port: null, outside: null },
	{ label: 'Shop', service: 'saha-textile-storefront', stack: 'storefront', port: 4200, outside: 'storefront' },
] as const;

/**
 * The switch's state and each app's line on the Sending list, from the helper's read and each app's
 * traces in the last hour (`counts`, capped at `cap`). An app that sends nothing says why and what
 * starts it; the console never restarts what it did not start.
 */
export function tracingView(raw: TracingRaw, counts: Record<string, number>, cap = 100): TracingView {
	const state = !raw.docker ? 'no-docker' : raw.address ? (raw.store ? 'on' : 'stopped') : 'off';
	const since = raw.addressSince ? Date.parse(raw.addressSince) : null;
	const apps = APPS.map((a) => {
		const n = counts[a.service] ?? 0;
		const base = { label: a.label, service: a.service };
		if (n > 0)
			return {
				...base,
				sending: true,
				note: `sending · ${n >= cap ? `${cap}+` : n} ${n === 1 ? 'trace' : 'traces'} in the last hour`,
				tone: 'ok' as const,
			};
		if (raw.stack.includes(a.stack))
			return {
				...base,
				sending: false,
				note: 'in the local stack · no traces in the last hour: it sends once it handles a request',
				tone: 'muted' as const,
			};
		const p = a.outside ? raw.outside[a.outside] : null;
		if (p && a.port) {
			if (p.vite)
				return {
					...base,
					sending: false,
					note: `runs on :${a.port} as the quick-edit server (vite), which is never traced`,
					tone: 'amber' as const,
				};
			const before = since !== null && p.startedAt !== null && Date.parse(p.startedAt) < since;
			return {
				...base,
				sending: false,
				note: before
					? `runs on :${a.port}, started outside the console before tracing was turned on · it sends from its next start`
					: `runs on :${a.port}, started outside the console · no traces in the last hour: it sends once it handles a request`,
				tone: before ? ('amber' as const) : ('muted' as const),
			};
		}
		return {
			...base,
			sending: false,
			note: a.port ? 'not running' : 'not running in the local stack',
			tone: 'muted' as const,
		};
	});
	return { state, store: raw.store, address: raw.address, apps };
}
