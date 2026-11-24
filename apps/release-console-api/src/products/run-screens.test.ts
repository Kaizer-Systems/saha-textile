import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	databaseScreen,
	driftScreen,
	cronScreen,
	flagsScreen,
	mediaScreen,
	networkScreen,
	processesScreen,
	searchScreen,
	serverScreen,
	tailMoreScreen,
	terminalScreen,
} from './run.js';

import type { ProductCtx, ProductScreen } from './kit.js';

/** The outside TLS checks answer locally: good, or a certificate problem. */
const tls = vi.hoisted(() => ({ ok: true }));
vi.mock('../vendors/tls-check.js', () => ({
	checkHost: async () => (tls.ok ? { ok: true, days: 60, issuer: 'Test CA' } : { ok: false, error: 'expired' }),
}));

const SCREENS: Record<string, ProductScreen> = {
	processesScreen,
	serverScreen,
	terminalScreen,
	tailMoreScreen,
	networkScreen,
	databaseScreen,
	searchScreen,
	mediaScreen,
	cronScreen,
	flagsScreen,
	driftScreen,
};

const NOW = Date.now();
const running = (name: string, ports = '') => ({ name, image: name, state: 'running', status: 'Up', ports });

/** A busy stack: every container up, something to say in every table. */
const BUSY: Record<string, unknown> = {
	'/docker': {
		containers: [
			running('saha-textile-api', '0.0.0.0:4000->4000/tcp'),
			running('saha-textile-mongo', '127.0.0.1:27018->27017/tcp'),
			running('saha-textile-meilisearch', ':::7700->7700/tcp'),
			running('saha-textile-redis'),
			{ ...running('saha-textile-old'), state: 'exited' },
		],
		stats: [
			{
				name: 'saha-textile-meilisearch',
				cpuPercent: null,
				memoryBytes: null,
				memoryLimitBytes: null,
				netRxBytes: null,
				netTxBytes: null,
				pids: 1,
			},
			{
				name: 'saha-textile-api',
				cpuPercent: 95,
				memoryBytes: 2e8,
				memoryLimitBytes: 1e9,
				netRxBytes: 1,
				netTxBytes: 2,
				pids: 12,
			},
			{
				name: 'saha-textile-mongo',
				cpuPercent: 5,
				memoryBytes: 5e8,
				memoryLimitBytes: null,
				netRxBytes: null,
				netTxBytes: null,
				pids: 3,
			},
			{
				name: 'saha-textile-redis',
				cpuPercent: null,
				memoryBytes: null,
				memoryLimitBytes: null,
				netRxBytes: null,
				netTxBytes: null,
				pids: 2,
			},
		],
	},
	'/inspect/top': [{ pid: 1, command: 'node', args: 'main.js', cpu: 3, rssKb: 1000, elapsed: '1:00' }],
	'/inspect/facts': {
		status: 'running',
		health: 'unhealthy',
		restarts: 2,
		oomKilled: true,
		image: 'api',
		started: '2026-11-24T00:00:00Z',
		ports: ['4000'],
		networks: ['net'],
		envNames: ['A'],
	},
	'/inspect/patches': {
		outdated: [
			{ name: 'node', now: '24', next: '25' },
			{ name: 'jq', now: '1', next: '2' },
		],
		images: [{ image: 'api', created: '1 day', size: '1 GB' }],
	},
	'/health': { ok: true },
	'/inspect/restart': { ok: true },
	'/inspect/commands': [
		{ id: 'mongo-ping', label: 'Ping MongoDB' },
		{ id: 'redis-ping', label: 'Ping Redis' },
		{ id: 'api-health', label: 'API health' },
	],
	'/inspect/terminal': { command: 'x', container: 'c', ok: true, lines: ['ok', 'error: refused', ''] },
	'/logs': {
		lines: [
			'2026-11-24T10:00:00.000Z info started',
			'2026-11-24T10:00:01.000Z warn slow',
			'2026-11-24T10:00:02.000Z error boom',
			'nodate',
		],
	},
	'/inspect/networks': [{ name: 'saha-textile-net', driver: 'bridge', containers: ['saha-textile-api'] }],
	'/inspect/connections': [
		{ local: '127.0.0.1:4000', remote: '', state: 'listening' },
		{ local: '10.0.0.2:5000', remote: '203.0.113.7:443', state: 'established' },
		{ local: '10.0.0.2:5001', remote: '203.0.113.7:443', state: 'established' },
	],
	'/inspect/mongo': {
		db: 'saha_textile_local',
		stats: { dataSize: 1000, objects: 10 },
		collections: [
			{
				name: 'orders',
				count: 5000,
				size: 1,
				storage: 1,
				indexSize: 1,
				indexes: [{ name: '_id_', key: '_id', unique: true, ttl: null }],
			},
			{
				name: 'sessions',
				count: 2,
				size: 1,
				storage: 1,
				indexSize: 1,
				indexes: [
					{ name: '_id_', key: '_id', unique: true, ttl: null },
					{ name: 'exp', key: 'expiresAt', unique: false, ttl: 3600 },
				],
			},
		],
		server: { version: '9.0.4', uptime: 3600 },
		ops: [{ op: 'query', ns: 'saha_textile_local.orders', secs: 12 }],
		profile: { was: 1, slowms: 100 },
		slow: [{ op: 'query', ns: 'saha_textile_local.orders', millis: 900, ts: '2026-11-24T10:00:00Z' }],
		rs: [{ name: 'mongo:27017', state: 'PRIMARY' }],
		migrations: [
			{ description: '0001 first: new shop', result: 'ok', at: '2026-11-01T00:00:00Z' },
			{ description: '0002-second', result: 'failed', at: '2026-11-02T00:00:00Z' },
		],
		switches: [
			{ message: 'Order shipped', channel: 'sms', enabled: false },
			{ messageKey: 'order_paid', channel: 'email', on: false },
			{ key: 'welcome', channel: 'email' },
		],
		settings: [{ key: 'shop', updatedAt: '2026-11-20T10:00:00Z' }],
	},
	'/inspect/migration-files': ['0001-first.ts', '0002-second.ts', '0003-third.ts'],
	'/inspect/meili': {
		health: 'available',
		version: '1.12',
		stats: { databaseSize: 1000, indexes: { products: { numberOfDocuments: 10, isIndexing: true } } },
		indexes: [
			{ uid: 'products', primaryKey: 'id', numberOfDocuments: 10, isIndexing: true },
			{ uid: 'blog', primaryKey: 'id', numberOfDocuments: 3, isIndexing: false },
		],
		failed: [
			{ uid: 1, type: 'documentAdditionOrUpdate', error: { message: 'bad' }, finishedAt: '2026-11-24T10:00:00Z' },
		],
	},
	'/inspect/redis': {
		version: '7.4',
		memory: '1M',
		clients: 2,
		queues: [
			{ queue: 'media', waiting: 1, active: 0, delayed: 0, failed: 2, completed: 3, repeat: 0 },
			{ queue: 'search', waiting: 0, active: 0, delayed: 0, failed: 0, completed: 9, repeat: 1 },
		],
		failedJobs: [
			{ queue: 'media', id: '1', name: 'resize', reason: 'boom', at: NOW, attempts: 3 },
			{ queue: 'media', id: '2', name: 'resize', reason: 'boom', at: 0, attempts: 1 },
		],
		schedules: [
			{ queue: 'search', key: 'sweep:abc', next: NOW + 60_000 },
			{ queue: 'search', key: 'plain', next: NOW + 120_000 },
			{ queue: 'media', key: 'late:1', next: NOW - 300_000 },
		],
	},
};

/** Nothing running: only a stopped container. */
const STOPPED: Record<string, unknown> = {
	...BUSY,
	'/docker': { containers: [{ ...running('saha-textile-old'), state: 'exited' }], stats: [] },
};

/** A quiet stack: everything up, nothing waiting, nothing failed, nothing due. */
const QUIET: Record<string, unknown> = {
	...BUSY,
	'/docker': { ...(BUSY['/docker'] as object), stats: [] },
	'/inspect/facts': { status: 'running', health: 'healthy', restarts: 0 },
	'/inspect/patches': { outdated: [], images: [] },
	'/inspect/connections': [],
	'/inspect/mongo': {
		...(BUSY['/inspect/mongo'] as object),
		collections: [],
		rs: [],
		ops: [],
		slow: [],
		migrations: [{ description: '0001 first', result: 'ok' }],
		switches: [],
		settings: [],
	},
	'/inspect/migration-files': ['0001-first.ts'],
	'/inspect/meili': { health: 'down', version: '1.12', stats: {}, indexes: [], failed: [] },
	'/inspect/redis': { version: '7.4', memory: '1M', clients: 0, queues: [], failedJobs: [], schedules: [] },
};

/** The stack with only the database and search containers up, and a calm media queue. */
const PARTS: Record<string, unknown> = {
	...BUSY,
	'/docker': {
		containers: [running('saha-textile-api', '127.0.0.1:4000->4000/tcp'), running('saha-textile-redis')],
		stats: [
			{
				name: 'saha-textile-api',
				cpuPercent: 10,
				memoryBytes: 1e8,
				memoryLimitBytes: 1e9,
				netRxBytes: 1,
				netTxBytes: 1,
				pids: 4,
			},
		],
	},
	'/inspect/commands': [],
	'/inspect/terminal': { command: 'x', container: 'c', ok: false, lines: [] },
	'/inspect/redis': {
		...(BUSY['/inspect/redis'] as object),
		queues: [{ queue: 'media', waiting: 0, active: 0, delayed: 0, failed: 0, completed: 3, repeat: 0 }],
		failedJobs: [],
	},
};

let answers: Record<string, unknown> | null = BUSY;
const helper = vi.fn(async (_method: string, path: string) => {
	if (!answers) throw new Error('helper down');
	const key = path.split('?')[0] as string;
	if (!(key in answers)) throw new Error(`no answer for ${key}`);
	return answers[key];
});

let n = 0;
const ctx = (id: string | null, requests: Array<[number, number | null, number, number]> = []): ProductCtx =>
	({
		key: `run-key-${++n}`,
		id,
		range: '24h',
		repo: {
			id: 'shop',
			environments: [
				{ name: 'production', label: 'Production', domains: ['example.test'], cloudId: 'c1' },
				{ name: 'staging', label: 'Staging', domains: [], cloudId: 'c1' },
				{ name: 'local', label: 'This Mac', domains: [], cloudId: null },
			],
		},
		helper,
		localRequests: () => requests,
		recent: () => [{ at: '2026-11-24T10:00:00Z', detail: 'restart' }],
		recentAll: () => [],
		auditLog: () => [],
		envTags: () => ({}),
		writeKey: async () => 'write-key',
	}) as unknown as ProductCtx;
const write = (values: Record<string, unknown>, id: string | null = null, confirm = '') =>
	({ pin: '123456', confirm, id, values }) as never;

const REQUESTS: Array<[number, number | null, number, number]> = [
	[NOW - 180_000, null, 0.05, 5],
	[NOW - 150_000, 2000, 0.01, 5],
	[NOW - 120_000, 1800, 0.05, 40],
	[NOW - 60_000, null, 0, 0],
	[NOW, 120, 0.01, 10],
];

async function everyTab(id: string | null, requests = REQUESTS) {
	const seen: string[] = [];
	for (const [name, screen] of Object.entries(SCREENS))
		for (const [tab, read] of Object.entries(screen.tabs)) {
			try {
				seen.push(JSON.stringify(await read(ctx(id, requests))));
			} catch (err) {
				seen.push(`${name}.${tab} refused: ${(err as Error).message}`);
			}
		}
	return seen.join('\n');
}

afterEach(() => {
	answers = BUSY;
	tls.ok = true;
	helper.mockClear();
});

describe('the Run screens on this Mac', () => {
	it('reads a busy stack in every tab, for the first container and for each one by name', async () => {
		const all = await everyTab(null);
		expect(all).toContain('saha-textile-api');
		for (const id of [
			'saha-textile-mongo',
			'saha-textile-redis',
			'saha-textile-meilisearch',
			'mongo-ping',
			'redis-ping',
			'api-health',
		])
			expect(await everyTab(id)).toBeTruthy();
		tls.ok = false;
		expect(await everyTab(null, [])).toContain('expired');
	});

	it('reads a quiet stack, a partial one, and a Mac whose helper does not answer', async () => {
		answers = STOPPED;
		expect(await everyTab(null, [])).toContain('No container is running.');
		answers = QUIET;
		expect(await everyTab(null, [])).toContain('nothing due');
		answers = PARTS;
		expect(await everyTab(null)).toBeTruthy();
		expect(await everyTab('saha-textile-api')).toBeTruthy();
		answers = null;
		expect(await everyTab(null, [])).toContain('The Mac helper is not answering');
	});

	it('restarts only a running stack container whose name is typed', async () => {
		const restart = processesScreen.forms?.['restart'];
		expect(JSON.stringify(await restart?.read(ctx('saha-textile-api')))).toContain('Restart saha-textile-api');
		await expect(restart?.send(ctx(null), write({ container: 'postgres' }))).rejects.toThrow('Choose a container.');
		await expect(restart?.send(ctx(null), write({ container: 'saha-textile-gone' }))).rejects.toThrow(
			'That container is not running here.',
		);
		await expect(restart?.send(ctx('saha-textile-api'), write({}, null, 'wrong'))).rejects.toThrow(
			'Type saha-textile-api to confirm.',
		);
		expect((await restart?.send(ctx(null), write({}, 'saha-textile-api', ' saha-textile-api ')))?.message).toBe(
			'saha-textile-api restarted',
		);
		expect(helper).toHaveBeenCalledWith('POST', '/inspect/restart', { container: 'saha-textile-api' });
		answers = STOPPED;
		expect(JSON.stringify(await restart?.read(ctx(null)))).toContain('No container is running.');
	});
});
