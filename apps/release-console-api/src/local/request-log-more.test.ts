import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LATENCY_BUCKETS_MS } from '@saha-textile/release-console-contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestLog, apdex, bucketOf, parseEdgeLine, percentile, referrerOf, summarise } from './request-log.js';
import { ConsoleStore } from '../store/console-store.js';

import type { DockerSnapshot } from '@saha-textile/release-console-contracts';

const MINUTE = 60_000;
const edgeLine = (over: Record<string, unknown> = {}) =>
	`2026-11-20T11:00:05Z ${JSON.stringify({ time: '2026-11-20T11:00:05+00:00', kind: 'edge', status: 200, seconds: 0.1, ...over })}`;
const DOCKER = {
	containers: [{ name: 'saha-textile-stack-edge-1', state: 'running', status: 'Up', image: 'nginx', ports: '' }],
} as unknown as DockerSnapshot;

let store: ConsoleStore;
beforeEach(() => {
	process.env['CONSOLE_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'release-console-requests-more-'));
	store = new ConsoleStore();
});
afterEach(() => {
	store.onModuleDestroy();
	delete process.env['CONSOLE_DATA_DIR'];
});

describe('reading the edge’s lines', () => {
	it('skips broken or incomplete lines, and fills a request’s missing fields', () => {
		expect(parseEdgeLine('2026 {not json')).toBeNull();
		expect(parseEdgeLine(edgeLine({ status: 'soon' }))).toBeNull();
		expect(parseEdgeLine(edgeLine())).toMatchObject({ service: 'storefront', method: 'GET', route: '/' });
		expect(referrerOf('example.com', undefined)).toBe('example.com');
	});

	it('puts a very slow request in the open bucket, and reads percentiles beyond the last bound', () => {
		expect(bucketOf(10 ** 9)).toBe(LATENCY_BUCKETS_MS.length);
		const open = new Array<number>(LATENCY_BUCKETS_MS.length + 1).fill(0);
		open[LATENCY_BUCKETS_MS.length] = 4;
		const last = LATENCY_BUCKETS_MS.at(-1) as number;
		expect(percentile(open, 0.5)).toBe(Math.round(last + last * 0.5));
		expect(percentile(open, 2)).toBe(last);
		const fast = new Array<number>(LATENCY_BUCKETS_MS.length + 1).fill(0);
		fast[0] = 2;
		expect(percentile(fast, 0.5)).toBe(Math.round((LATENCY_BUCKETS_MS[0] as number) * 0.5));
		expect(apdex(new Array<number>(LATENCY_BUCKETS_MS.length + 1).fill(0))).toBeNull();
	});

	it('folds routes beyond the limit into one “other” row per service', () => {
		const minute = Date.parse('2026-11-20T11:00:00Z');
		// Two more routes than the 100 a service keeps.
		const requests = Array.from({ length: 102 }, (_, i) => ({
			at: minute + 1000,
			service: 'api',
			method: 'GET',
			route: `/r${i}`,
			status: 200,
			ms: 5,
			referrer: '',
			build: '',
		}));
		const rows = summarise(requests, minute);
		expect(rows.some((r) => r.route === 'other' && r.method === '*')).toBe(true);
	});
});

describe('the request log over time', () => {
	it('notes when there is no edge, and when the edge served nothing', async () => {
		const call = vi.fn(async () => ({ container: 'x', lines: ['plain text'] }));
		const log = new RequestLog({ call } as never, store);
		const now = Date.parse('2026-11-20T11:05:10Z');
		await log.tick({ containers: [] } as unknown as DockerSnapshot, now);
		expect(call).not.toHaveBeenCalled();
		expect(log.recent(5, now)).toBeNull();
		expect(log.view(60, now).note).toContain('Nothing to read yet');
		await log.tick(DOCKER, now + 2 * MINUTE);
		expect(call).toHaveBeenCalledTimes(1);
		expect(log.view(60, now).source).toBe('none');
	});

	it('answers from rows kept before a restart, and sorts services, routes, minutes and paths', async () => {
		const now = Date.parse('2026-11-20T12:00:30Z');
		const lines = [
			edgeLine({ host: 'api.local', uri: '/a', seconds: 0.05 }),
			edgeLine({ host: 'api.local', uri: '/b', seconds: 1.5 }),
			edgeLine({ host: 'admin.local', uri: '/x' }),
			edgeLine({ host: 'shop.local', uri: '/gone', status: 404, referer_host: 'search.example' }),
			edgeLine({ host: 'shop.local', uri: '/lost', status: 404 }),
			edgeLine({ host: 'shop.local', uri: '/lost', status: 404, time: '2026-11-20T11:59:05+00:00' }),
		].map((l) => l.replace('2026-11-20T11:00:05+00:00', '2026-11-20T11:58:05+00:00'));
		const first = new RequestLog({ call: async () => ({ container: 'edge', lines }) } as never, store);
		await first.tick(DOCKER, now);
		const later = new RequestLog({ call: async () => ({ container: 'edge', lines: [] }) } as never, store);
		const view = later.view(60, now);
		expect(view.source).toBe('edge');
		expect(view.note).toBeNull();
		expect(view.services.length).toBeGreaterThan(1);
		expect(view.routes.length).toBeGreaterThan(1);
		expect(view.series.length).toBeGreaterThan(1);
		expect(later.notFound(2, now).paths.map((p) => p.route)).toEqual(['/lost', '/gone']);
		store
			.db()
			.prepare('INSERT INTO client_builds (minute, service, build, installed, count) VALUES (?, ?, ?, ?, ?)')
			.run(now - 5 * 3_600_000, 'storefront', 'abc1234', 0, 2);
		expect(later.clientBuilds(24, now).apps[0]?.builds[0]?.lastHour).toBe(0);
	});
});
