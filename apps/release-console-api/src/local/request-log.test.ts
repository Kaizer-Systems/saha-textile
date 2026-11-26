import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	RequestLog,
	apdex,
	notFoundOf,
	parseEdgeLine,
	percentile,
	referrerOf,
	routeOf,
	serviceOf,
	summarise,
} from './request-log.js';
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
			referrer: '',
			build: '',
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
		expect(routeOf('/pay/short1')).toBe('/pay/:token');
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
			{
				at: minute + 1000,
				service: 'api',
				method: 'GET',
				route: '/a',
				status: 200,
				ms: 40,
				referrer: '',
				build: '',
			},
			{
				at: minute + 2000,
				service: 'api',
				method: 'GET',
				route: '/a',
				status: 502,
				ms: 900,
				referrer: '',
				build: '',
			},
			{
				at: minute + 3000,
				service: 'api',
				method: 'GET',
				route: '/a',
				status: 404,
				ms: 20,
				referrer: '',
				build: '',
			},
			{
				at: minute + 61_000,
				service: 'api',
				method: 'GET',
				route: '/a',
				status: 200,
				ms: 40,
				referrer: '',
				build: '',
			},
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

	it('keeps only the host a visitor came from, and counts the shop’s missing pages (Search engines)', () => {
		expect(referrerOf('WWW.Google.com', 'local.saha-textile.localhost')).toBe('google.com');
		expect(referrerOf('local.saha-textile.localhost', 'local.saha-textile.localhost:8443')).toBe('this site');
		expect(referrerOf('admin-local.saha-textile.localhost', 'local.saha-textile.localhost')).toBe('this site');
		expect(referrerOf('', 'x')).toBe('');
		expect(referrerOf('https://a.example/?t=1', 'x')).toBe('');
		const minute = Date.parse('2026-11-20T11:00:00Z');
		const r = (route: string, status: number, referrer = '', service = 'storefront') => ({
			at: minute + 1000,
			service,
			method: 'GET',
			route,
			status,
			ms: 10,
			referrer,
			build: '',
		});
		expect(
			notFoundOf(
				[
					r('/collections/silk-old', 404, 'google.com'),
					r('/collections/silk-old', 404, 'google.com'),
					r('/collections/silk-old', 404, 'this site'),
					r('static .png', 404),
					r('/ok', 200),
					r('/catalog/x', 404, '', 'api'),
				],
				minute,
			),
		).toEqual([
			{ route: '/collections/silk-old', referrer: 'google.com', count: 2 },
			{ route: '/collections/silk-old', referrer: 'this site', count: 1 },
		]);
	});

	it('answers the last hours’ missing pages by path, with where visitors came from', async () => {
		process.env['CONSOLE_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'release-console-notfound-'));
		const store = new ConsoleStore();
		const now = Date.parse('2026-11-20T11:01:10Z');
		const shop = (over: Record<string, unknown>) =>
			line({ host: 'local.saha-textile.localhost', uri: '/collections/silk-old', status: 404, ...over });
		const call = vi.fn(async () => ({
			container: 'saha-textile-stack-edge-1',
			lines: [shop({ referer_host: 'www.google.com' }), shop({ referer_host: 'WWW.Instagram.com' }), shop({})],
		}));
		const log = new RequestLog({ call } as never, store);
		const docker = {
			containers: [
				{ name: 'saha-textile-stack-edge-1', state: 'running', status: 'Up', image: 'nginx', ports: '' },
			],
		} as unknown as DockerSnapshot;
		await log.tick(docker, now);
		const view = log.notFound(24, now);
		expect(view.total).toBe(3);
		expect(view.paths).toEqual([
			{
				route: '/collections/silk-old',
				count: 3,
				from: ['google.com', 'instagram.com'],
				lastAt: '2026-11-20T11:01:00.000Z',
			},
		]);
		expect(JSON.stringify(view)).not.toContain('search?q');
		store.onModuleDestroy();
	});

	it('counts client builds per app, installed app apart, and drops anything that is not a build', async () => {
		process.env['CONSOLE_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'release-console-builds-'));
		const store = new ConsoleStore();
		const now = Date.parse('2026-11-20T11:01:10Z');
		const shop = (build: string) => line({ host: 'local.saha-textile.localhost', uri: '/', client_build: build });
		const call = vi.fn(async () => ({
			container: 'saha-textile-stack-edge-1',
			lines: [shop('ea27a021'), shop('ea27a021-app'), shop('471b5c40'), shop('dev'), shop('<script>'), shop('')],
		}));
		const log = new RequestLog({ call } as never, store);
		const docker = {
			containers: [
				{ name: 'saha-textile-stack-edge-1', state: 'running', status: 'Up', image: 'nginx', ports: '' },
			],
		} as unknown as DockerSnapshot;
		await log.tick(docker, now);
		const view = log.clientBuilds(24, now);
		expect(view.apps).toHaveLength(1);
		expect(view.apps[0]?.service).toBe('storefront');
		expect(view.apps[0]?.builds.map((b) => [b.build, b.requests, b.installed])).toEqual(
			expect.arrayContaining([
				['ea27a021', 2, 1],
				['471b5c40', 1, 0],
			]),
		);
		expect(JSON.stringify(view)).not.toContain('script');
		store.onModuleDestroy();
	});
});
