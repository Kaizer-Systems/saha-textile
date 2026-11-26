import { describe, expect, it } from 'vitest';

import { type TraceView, type TracingRaw, diagnose, traceOf, tracingView } from './traces.js';

const tag = (key: string, value: unknown) => ({ key, value });
/** A span in the Jaeger search API's shape: times in microseconds. */
const span = (
	spanID: string,
	operationName: string,
	startUs: number,
	durationUs: number,
	over: Record<string, unknown> = {},
) => ({
	spanID,
	traceID: 't1',
	operationName,
	startTime: startUs,
	duration: durationUs,
	processID: 'p1',
	tags: [],
	...over,
});
const child = (parent: string, refType = 'CHILD_OF') => ({ references: [{ refType, spanID: parent }] });

describe('reading traces the store sends in unusual shapes', () => {
	it('has nothing to draw for a trace with no spans', () => {
		expect(traceOf({ traceID: 't1', spans: [] })).toBeNull();
		expect(traceOf('not a trace')).toBeNull();
	});

	it('names the request by its operation without a route, reads numbers as text, and keeps unknown names', () => {
		const trace = traceOf({
			traceID: 't1',
			processes: {
				p1: { serviceName: 'saha-textile-api', tags: [tag('service.version', '3f9a2c1b7d4e')] },
				p2: { serviceName: 'billing-gateway' },
			},
			spans: [
				span('a', 'nightly sweep', 1_000_000, 300_000, {
					tags: [tag('http.response.status_code', 200), tag('saha_textile.request_id', 'req-7')],
				}),
				span('b', 'SELECT invoices', 1_010_000, 20_000, {
					...child('a'),
					tags: [tag('db.system', 'postgresql')],
				}),
				span('c', 'charge', 1_050_000, 40_000, { ...child('a', 'FOLLOWS_FROM'), processID: 'p2' }),
			],
		});
		expect(trace).toMatchObject({ name: 'nightly sweep', status: 200, requestId: 'req-7', build: '3f9a2c1b7d4e' });
		const where = Object.fromEntries((trace?.spans ?? []).map((s) => [s.id, s.where]));
		expect(where).toEqual({ a: 'API', b: 'postgresql', c: 'billing-gateway' });
		expect(trace?.spans.find((s) => s.id === 'c')?.parentId).toBe('a');
	});

	it('starts from the earliest span when every span names a parent in the trace', () => {
		const trace = traceOf({
			traceID: 't2',
			processes: { p1: { serviceName: 'saha-textile-api' } },
			spans: [span('x', 'later', 2_000, 10, child('y')), span('y', 'first', 1_000, 10, child('x'))],
		});
		expect(trace?.name).toBe('first');
		expect(trace?.build).toBeNull();
		expect(Object.fromEntries((trace?.spans ?? []).map((s) => [s.id, s.depth]))).toEqual({ y: 0, x: 1 });
	});

	it('draws a span that names itself as its parent at the top, as before', () => {
		const trace = traceOf({
			traceID: 't3',
			processes: { p1: { serviceName: 'saha-textile-api' } },
			spans: [span('r', 'GET /', 1_000, 50), span('s', 'odd', 1_010, 10, child('s'))],
		});
		expect(trace?.spans.find((s) => s.id === 's')?.depth).toBe(0);
	});

	it('finds the earliest of a longer loop, and draws each span below the one it names', () => {
		const trace = traceOf({
			traceID: 't4',
			processes: { p1: { serviceName: 'saha-textile-api' } },
			spans: [
				span('x', 'second', 2_000, 10, child('y')),
				span('y', 'first', 1_000, 10, child('z')),
				span('z', 'third', 3_000, 10, child('x')),
			],
		});
		expect(Object.fromEntries((trace?.spans ?? []).map((s) => [s.id, s.depth]))).toEqual({ y: 0, x: 1, z: 2 });
	});

	it('takes the id from the first span when the trace has none, and names routes with or without a method', () => {
		const withRoute = traceOf({
			processes: { p1: { serviceName: 'saha-textile-api', tags: [tag('host.name', 'api-1')] } },
			spans: [
				span('r', 'handler', 1_000, 50, {
					traceID: 'from-span',
					tags: [tag('http.request.method', 'GET'), tag('http.route', '/catalog/{slug}')],
				}),
				span('o', 'orphan', 1_010, 10),
			],
		});
		expect(withRoute).toMatchObject({ id: 'from-span', name: 'GET /catalog/{slug}', build: null });
		expect(withRoute?.spans.find((s) => s.id === 'o')?.depth).toBe(0);
		const pathOnly = traceOf({
			traceID: 't5',
			processes: { p1: { serviceName: 'saha-textile-api' } },
			spans: [span('r', 'handler', 1_000, 50, { tags: [tag('url.path', '/health/live')] })],
		});
		expect(pathOnly?.name).toBe('/health/live');
	});
});

describe('diagnose', () => {
	const view = (ms: number, spans: Partial<TraceView['spans'][number]>[]): TraceView =>
		({
			id: 't',
			name: 'GET /checkout',
			service: 'saha-textile-api',
			ms,
			status: 200,
			error: false,
			at: '2026-11-23T10:00:00.000Z',
			requestId: null,
			build: null,
			diagnose: [],
			spans: spans.map((s, index) => ({
				id: `s${index}`,
				parentId: 'root',
				name: 'POST /orders',
				service: 'saha-textile-api',
				where: 'api.example-pay.com',
				startMs: 0,
				ms: 10,
				depth: 1,
				error: false,
				query: null,
				...s,
			})),
		}) as TraceView;

	it('flags an outside call far over its usual time, from the other traces read', () => {
		const usual = [view(100, [{ ms: 100 }]), view(100, [{ ms: 110 }]), view(100, [{ ms: 120 }])];
		const slow = view(1_500, [{ ms: 900 }]);
		expect(diagnose(slow, usual).map((d) => d.rule)).toEqual(['slowest', 'outside-slow']);
		expect(diagnose(view(2_000, [{ ms: 150 }]), usual).map((d) => d.rule)).toEqual([]);
		expect(diagnose(slow, usual.slice(0, 2)).map((d) => d.rule)).toEqual(['slowest']);
	});

	it('reads a request with no length without dividing by nothing', () => {
		expect(diagnose(view(0, [{ ms: 0 }]))).toEqual([]);
	});

	it('flags a slow database call, with its query shape when it has one', () => {
		const texts = diagnose(
			view(1_000, [
				{ where: 'MongoDB', name: 'variants.find', ms: 150, query: 'find variants {productId: ?}' },
				{ where: 'Redis', name: 'GET', ms: 120, query: null },
			]),
		).map((d) => d.text);
		expect(texts).toContain(
			'variants.find on MongoDB took 150 ms (find variants {productId: ?}): look for a missing index in the Database monitor.',
		);
		expect(texts).toContain('GET on Redis took 120 ms: look for a missing index in the Database monitor.');
	});
});

describe('the tracing switch’s states', () => {
	const raw = (over: Partial<TracingRaw> = {}): TracingRaw => ({
		docker: true,
		store: true,
		address: true,
		addressSince: null,
		stack: [],
		outside: { api: null, storefront: null },
		...over,
	});

	it('says when Docker is off, and when the store stopped with the address still set', () => {
		expect(tracingView(raw({ docker: false }), {}).state).toBe('no-docker');
		expect(tracingView(raw({ store: false }), {}).state).toBe('stopped');
		expect(tracingView(raw({ address: false }), {}).state).toBe('off');
	});

	it('counts one trace in the singular, and many as the cap and more', () => {
		const view = tracingView(raw(), { 'saha-textile-api': 1, 'saha-textile-storefront': 150 });
		expect(view.apps.find((a) => a.label === 'API')?.note).toBe('sending · 1 trace in the last hour');
		expect(view.apps.find((a) => a.label === 'Shop')?.note).toBe('sending · 100+ traces in the last hour');
	});
});
