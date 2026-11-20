import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { StatsCollector, rate, samplesOf } from './stats-collector.js';
import { servicesFromSnapshot } from '../local-stack/local-stack.service.js';
import { ConsoleStore } from '../store/console-store.js';

import type { DockerSnapshot, MacSnapshot } from '@saha-textile/release-console-contracts';

const mac = (rx: number): MacSnapshot => ({
	at: 't',
	cpu: { user: 10, sys: 5, idle: 85, used: 15 },
	memory: { total: 16e9, used: 9e9, compressed: 1e9, wired: 2e9 },
	swapUsed: 0,
	load: { one: 1, five: 1, fifteen: 1 },
	disk: { total: 1e12, free: 4e11, used: 6e11 },
	network: { rx, tx: 0 },
	cpus: 16,
});
const docker: DockerSnapshot = {
	at: 't',
	reachable: true,
	version: '29',
	cpus: 16,
	memoryTotal: 16e9,
	containers: [
		{
			name: 'saha-textile-stack-api-1',
			image: 'api',
			state: 'running',
			status: 'Up 3 minutes (healthy)',
			ports: '',
		},
		{ name: 'saha-textile-mongo', image: 'mongo', state: 'exited', status: 'Exited (0)', ports: '' },
		{ name: 'other', image: 'x', state: 'running', status: 'Up', ports: '' },
	],
	stats: [
		{
			name: 'saha-textile-stack-api-1',
			cpuPercent: 2,
			memoryBytes: 1e8,
			memoryLimitBytes: 1e9,
			netRxBytes: 100,
			netTxBytes: 50,
			blockReadBytes: 0,
			blockWriteBytes: 0,
			pids: 10,
		},
	],
};

describe('stats', () => {
	afterEach(() => {
		delete process.env['CONSOLE_DATA_DIR'];
	});

	it('turns counters into rates and never a negative one', () => {
		expect(rate(undefined, 10, 5)).toBeNull();
		expect(rate(10, 60, 5)).toBe(10);
		expect(rate(60, 10, 5)).toBeNull();
	});

	it('keeps the Mac’s and each container’s figures, with rates from the second reading', () => {
		const first = samplesOf(mac(1000), docker, {}, 0);
		expect(first.rows.find(([s, n]) => s === 'mac' && n === 'cpu')?.[2]).toBe(15);
		expect(first.rows.some(([, n]) => n === 'net_rx_rate')).toBe(false);
		const second = samplesOf(mac(6000), docker, first.counters, 5);
		expect(second.rows.find(([s, n]) => s === 'mac' && n === 'net_rx_rate')?.[2]).toBe(1000);
		expect(second.rows.find(([s, n]) => s === 'container:saha-textile-stack-api-1' && n === 'mem')?.[2]).toBe(1e8);
	});

	it('stores 5-second points, rolls up minutes and answers history', () => {
		process.env['CONSOLE_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'release-console-stats-'));
		const store = new ConsoleStore();
		const c = new StatsCollector({} as never, store, {} as never, {} as never, {} as never);
		const t0 = Date.UTC(2026, 10, 20, 10, 0, 0);
		c.save([['mac', 'cpu', 10]], t0);
		c.save([['mac', 'cpu', 30]], t0 + 30_000);
		c.save([['mac', 'cpu', 50]], t0 + 60_000);
		expect(c.history('mac', ['cpu'], 60, t0 + 61_000)[0]?.points.map(([, v]) => v)).toEqual([10, 30, 50]);
		expect(c.history('mac', ['cpu'], 600, t0 + 61_000)[0]?.points).toEqual([[t0, 20]]);
		store.onModuleDestroy();
	});

	it('shows this project’s containers on the Services screen, with health from Docker’s status', () => {
		const rows = servicesFromSnapshot(docker, 'saha-textile');
		expect(rows.map((r) => [r.name, r.state, r.health])).toEqual([
			['saha-textile-mongo', 'exited', 'none'],
			['saha-textile-stack-api-1', 'running', 'healthy'],
		]);
	});
});
