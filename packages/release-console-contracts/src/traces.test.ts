import { describe, expect, it } from 'vitest';

import { diagnose, edgesOf, traceOf } from './traces.js';

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
});
