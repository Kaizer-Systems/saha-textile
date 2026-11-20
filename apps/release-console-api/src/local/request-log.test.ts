import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { RequestLog, apdex, parseEdgeLine, percentile, routeOf, serviceOf, summarise } from './request-log.js';
import { ConsoleStore } from '../store/console-store.js';

import type { DockerSnapshot } from '@saha-textile/release-console-contracts';

const line = (over: Record<string, unknown> = {}) =>
	`2026-11-20T11:00:05.123456789Z ${JSON.stringify({
		time: '2026-11-20T11:00:05+00:00',
		kind: 'edge',
		request_id: 'r1',
		ip: '192.168.0.2',
		method: 'GET',
		uri: '/catalog/products/6650f0c2a1b2c3d4e5f60718?ref=mail@example.com',
		status: 200,
		bytes: 10,
		seconds: 0.12,
		host: 'api-local.saha-textile.localhost',
		...over,
	})}`;

describe('request log', () => {
	afterEach(() => {
		delete process.env['CONSOLE_DATA_DIR'];
		vi.restoreAllMocks();
	});

	it('reads the edge’s JSON lines and skips everything else', () => {
		expect(parseEdgeLine(line())).toEqual({
			at: Date.parse('2026-11-20T11:00:05+00:00'),
			service: 'api',
			method: 'GET',
			route: '/catalog/products/:id',
			status: 200,
			ms: 120,
		});
		expect(parseEdgeLine('192.168.32.8 - - [20/Nov/2026:10:56:07 +0000] "GET / HTTP/1.1" 200')).toBeNull();
		expect(parseEdgeLine('{"kind":"app","time":"x"}')).toBeNull();
	});

	it('keeps routes free of queries, IDs and anything personal', () => {
		expect(routeOf('/en/orders/1234?email=a@b.c')).toBe('/en/orders/:id');
		expect(routeOf('/unsubscribe/someone@example.com')).toBe('/unsubscribe/:id');
		expect(routeOf('/a/b/c/d/e')).toBe('/a/b/c/…');
		expect(routeOf('/assets/i18n/en.json')).toBe('static .json');
		expect(routeOf('/')).toBe('/');
		expect(serviceOf('local.saha-textile.localhost')).toBe('storefront');
		expect(serviceOf('admin-local.saha-textile.localhost')).toBe('admin');
	});

	it('works out percentiles and Apdex from latency buckets', () => {
		// buckets: ≤25, ≤50, ≤100, ≤250, ≤500, ≤1000, ≤2000, ≤4000, ≤8000, more
		const b = [0, 0, 90, 0, 0, 0, 10, 0, 0, 0];
		expect(percentile(b, 0.5)).toBe(78);
		expect(percentile(b, 0.95)).toBe(1500);
		expect(apdex(b)).toBe(0.95);
		expect(percentile(new Array(10).fill(0), 0.5)).toBeNull();
	});

	it('summarises one minute per service and route', () => {
		const minute = Date.parse('2026-11-20T11:00:00Z');
		const reqs = [
			{ at: minute + 1000, service: 'api', method: 'GET', route: '/a', status: 200, ms: 40 },
			{ at: minute + 2000, service: 'api', method: 'GET', route: '/a', status: 502, ms: 900 },
			{ at: minute + 3000, service: 'api', method: 'GET', route: '/a', status: 404, ms: 20 },
			{ at: minute + 61_000, service: 'api', method: 'GET', route: '/a', status: 200, ms: 40 },
		];
		expect(summarise(reqs, minute)).toEqual([
			{
				minute,
				service: 'api',
				method: 'GET',
				route: '/a',
				count: 3,
				e5: 1,
				e4: 1,
				buckets: [1, 1, 0, 0, 0, 1, 0, 0, 0, 0],
			},
		]);
	});

	it('reads the edge once a minute through the helper and answers per service and route', async () => {
		process.env['CONSOLE_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'release-console-requests-'));
		const store = new ConsoleStore();
		const now = Date.parse('2026-11-20T11:01:10Z');
		const call = vi.fn(async () => ({
			container: 'saha-textile-stack-edge-1',
			lines: [line(), line({ status: 503, seconds: 2.5 }), 'plain text line'],
		}));
		const log = new RequestLog({ call } as never, store);
		const docker = {
			containers: [
				{ name: 'saha-textile-stack-edge-1', state: 'running', status: 'Up', image: 'nginx', ports: '' },
			],
		} as unknown as DockerSnapshot;
		await log.tick(docker, now);
		await log.tick(docker, now + 5000);
		expect(call).toHaveBeenCalledTimes(1);
		const view = log.view(60, now);
		expect(view.source).toBe('edge');
		expect(view.services).toMatchObject([{ service: 'api', count: 2, errorRate: 0.5 }]);
		expect(view.routes[0]).toMatchObject({ route: '/catalog/products/:id', method: 'GET', count: 2 });
		expect(log.recent(5, now)).toEqual({ total: 2, serverErrors: 1 });
		expect(JSON.stringify(view)).not.toContain('example.com');
		store.onModuleDestroy();
	});
});
