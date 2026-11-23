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

function whereOf(service: string, tags: Record<string, string>): string {
	const db = tags['db.system'];
	if (db) return DB_WHERE[db] ?? db;
	const host = tags['server.address'] ?? tags['net.peer.name'];
	if (host && tags['span.kind'] === 'client' && !/^(api|mongo|redis|meilisearch|localhost)/.test(host)) return host;
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
	const root =
		spansRaw.find((s) => !parentOf(s) || !ids.has(parentOf(s) ?? '')) ??
		[...spansRaw].sort((a, b) => Number(a['startTime']) - Number(b['startTime']))[0];
	if (!root) return null;
	const t0 = Number(root['startTime']);
	const depthOf = new Map<string, number>();
	const depth = (s: Record<string, unknown>): number => {
		const id = str(s['spanID']);
		const known = depthOf.get(id);
		if (known !== undefined) return known;
		const p = parentOf(s);
		const parent = p ? spansRaw.find((x) => str(x['spanID']) === p) : undefined;
		const d = parent && parent !== s ? Math.min(depth(parent) + 1, 12) : 0;
		depthOf.set(id, d);
		return d;
	};
	const spans: TraceSpan[] = spansRaw
		.map((s) => {
			const tags = tagsOf(s);
			const service = str(rec(processes[str(s['processID'])])['serviceName']);
			return {
				id: str(s['spanID']),
				parentId: s === root ? null : parentOf(s),
				name: str(s['operationName']),
				service,
				where: whereOf(service, tags),
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
