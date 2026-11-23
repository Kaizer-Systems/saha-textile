import { describe, expect, it } from 'vitest';

import { type TracingRaw, diagnose, edgesOf, traceOf, tracingView } from './traces.js';

/** A made-up Jaeger-format trace: the shop's page, the API, two database calls and a Redis read. */
const sample = (variantsMs = 181, id = 't1') => ({
	traceID: id,
	processes: {
		p1: { serviceName: 'saha-textile-storefront', tags: [{ key: 'service.version', value: '3f9a2c1b7d4e' }] },
		p2: { serviceName: 'saha-textile-api', tags: [] },
	},
	spans: [
		{
			traceID: id,
			spanID: 'a',
			operationName: 'GET /en/product/{{slug}}',
			references: [],
			startTime: 1_000_000_000,
			duration: 412_000,
			processID: 'p1',
			tags: [
				{ key: 'http.request.method', value: 'GET' },
				{ key: 'http.route', value: '/en/product/{{slug}}' },
				{ key: 'http.response.status_code', value: 200 },
				{ key: 'saha_textile.request_id', value: '7f2c' },
			],
		},
		{
			traceID: id,
			spanID: 'b',
			operationName: 'GET /catalog/products/{{slug}}',
			references: [{ refType: 'CHILD_OF', spanID: 'a' }],
			startTime: 1_000_025_000,
			duration: 288_000,
			processID: 'p2',
			tags: [],
		},
		{
			traceID: id,
			spanID: 'c',
			operationName: 'variants.find',
			references: [{ refType: 'CHILD_OF', spanID: 'b' }],
			startTime: 1_000_060_000,
			duration: variantsMs * 1000,
			processID: 'p2',
			tags: [
				{ key: 'db.system', value: 'mongodb' },
				{ key: 'db.query.text', value: '{ productId: ?, status: ? }' },
			],
		},
		...[0, 1, 2].map((n) => ({
			traceID: id,
			spanID: `r${n}`,
			operationName: 'GET fx:rates',
			references: [{ refType: 'CHILD_OF', spanID: 'b' }],
			startTime: 1_000_250_000 + n * 1000,
			duration: 2000,
			processID: 'p2',
			tags: [{ key: 'db.system', value: 'redis' }],
		})),
	],
});

describe('traces (Release Path brief Part 6)', () => {
	it('reads a trace with depths, places and the request id', () => {
		const t = traceOf(sample());
		expect(t).toMatchObject({
			id: 't1',
			name: 'GET /en/product/{{slug}}',
			ms: 412,
			status: 200,
			requestId: '7f2c',
		});
		expect(t?.build).toBe('3f9a2c1b7d4e');
		expect(t?.spans.map((s) => `${s.where}:${s.depth}`)).toEqual([
			'shop:0',
			'API:1',
			'MongoDB:2',
			'Redis:2',
			'Redis:2',
			'Redis:2',
		]);
	});

	it('diagnoses a slow database call and a call repeated in one request, by fixed rules', () => {
		const t = traceOf(sample(260));
		if (!t) throw new Error('no trace');
		const rules = diagnose(t).map((d) => d.rule);
		expect(rules).toContain('slow-database');
		expect(rules).toContain('repeated');
		expect(rules).toContain('slowest');
	});

	it('draws the service map from calls between places', () => {
		const t = traceOf(sample());
		if (!t) throw new Error('no trace');
		expect(edgesOf([t])).toEqual([
			{ from: 'shop', to: 'API', calls: 1, ms: 288 },
			{ from: 'API', to: 'MongoDB', calls: 1, ms: 181 },
			{ from: 'API', to: 'Redis', calls: 3, ms: 2 },
		]);
	});

	it("counts the shop's own call to the API as the shop, whatever address it used; an outside call keeps its host", () => {
		const raw = sample();
		const client = (spanID: string, address: string, parent: string, start: number) => ({
			traceID: 't1',
			spanID,
			operationName: 'GET',
			references: [{ refType: 'CHILD_OF', spanID: parent }],
			startTime: start,
			duration: 290_000,
			processID: 'p1',
			tags: [
				{ key: 'span.kind', value: 'client' },
				{ key: 'server.address', value: address },
			],
		});
		// The shop's server page → its client span to the API at 127.0.0.1 → the API's server span.
		raw.spans.splice(1, 0, client('k', '127.0.0.1', 'a', 1_000_020_000));
		(raw.spans[2] as { references: unknown[] }).references = [{ refType: 'CHILD_OF', spanID: 'k' }];
		// A public API address is still our own API when the API's span is its child.
		const t = traceOf(raw);
		if (!t) throw new Error('no trace');
		expect(t.spans.find((s) => s.id === 'k')?.where).toBe('shop');
		expect(edgesOf([t])[0]).toEqual({ from: 'shop', to: 'API', calls: 1, ms: 288 });

		const outside = sample();
		outside.spans.push(client('m', 'api.msg91.com', 'b', 1_000_200_000));
		(outside.spans.at(-1) as { processID: string }).processID = 'p2';
		const o = traceOf(outside);
		expect(o?.spans.find((s) => s.id === 'm')?.where).toBe('api.msg91.com');
		expect(edgesOf(o ? [o] : []).map((e) => `${e.from}→${e.to}`)).toContain('API→api.msg91.com');
	});
});

describe('the tracing switch on this Mac (brief 8UmNaHHAuiGLez47McHkj8)', () => {
	const raw = (over: Partial<TracingRaw> = {}): TracingRaw => ({
		docker: true,
		store: true,
		address: true,
		addressSince: '2026-11-23T12:00:00.000Z',
		stack: [],
		outside: { api: null, storefront: null },
		...over,
	});

	it('picks off, on, stopped and no-docker', () => {
		expect(tracingView(raw({ address: false }), {}).state).toBe('off');
		expect(tracingView(raw({ store: true, address: false }), {}).state).toBe('off');
		expect(tracingView(raw(), {}).state).toBe('on');
		expect(tracingView(raw({ store: false }), {}).state).toBe('stopped');
		expect(tracingView(raw({ docker: false }), {}).state).toBe('no-docker');
	});

	it('says why each app is not sending and what starts it', () => {
		const v = tracingView(
			raw({
				stack: ['worker'],
				outside: {
					api: { startedAt: '2026-11-23T11:00:00.000Z', vite: false },
					storefront: { startedAt: '2026-11-23T12:30:00.000Z', vite: true },
				},
			}),
			{ 'saha-textile-worker': 140 },
		);
		expect(v.apps.map((a) => [a.label, a.tone])).toEqual([
			['API', 'amber'],
			['Worker', 'ok'],
			['Shop', 'amber'],
		]);
		expect(v.apps[0]?.note).toContain(
			'started outside the console before tracing was turned on · it sends from its next start',
		);
		expect(v.apps[1]?.note).toBe('sending · 100+ traces in the last hour');
		expect(v.apps[2]?.note).toContain('quick-edit server (vite), which is never traced');
	});

	it('tells an app that started after the address apart from one that has had no request', () => {
		const v = tracingView(
			raw({
				stack: ['api'],
				outside: { api: null, storefront: { startedAt: '2026-11-23T12:30:00.000Z', vite: false } },
			}),
			{},
		);
		expect(v.apps[0]?.note).toContain('in the local stack · no traces in the last hour');
		expect(v.apps[1]?.note).toBe('not running in the local stack');
		expect(v.apps[2]).toMatchObject({ tone: 'muted' });
		expect(v.apps[2]?.note).toContain('started outside the console · no traces in the last hour');
	});
});
