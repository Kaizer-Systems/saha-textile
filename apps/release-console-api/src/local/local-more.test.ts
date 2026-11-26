import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalAlerts, type Readings, findings } from './local-alerts.js';
import { StatsCollector, samplesOf } from './stats-collector.js';
import { ConsoleStore } from '../store/console-store.js';

import type { DockerSnapshot, Job, MacSnapshot, Project } from '@saha-textile/release-console-contracts';

const read = (over: Partial<Readings>): Readings => ({
	mac: null,
	docker: null,
	helper: true,
	jobs: null,
	projects: [],
	...over,
});

describe('local alert rules', () => {
	it('words a failed run without an end time, and server errors by how many', () => {
		const job = {
			id: 'j',
			kind: 'pipeline',
			label: 'Local pipeline',
			status: 'failed',
			startedAt: 't',
			finishedAt: null,
		} as unknown as Job;
		expect(findings(read({ jobs: [job] })).found[0]?.detail).toBe('Local pipeline.');
		expect(findings(read({ requests: { total: 10, serverErrors: 10 } })).found).toEqual([]);
		expect(findings(read({ requests: { total: 100, serverErrors: 2 } })).found).toEqual([]);
		expect(findings(read({ requests: { total: 100, serverErrors: 10 } })).found[0]?.level).toBe('amber');
		expect(findings(read({ requests: { total: 100, serverErrors: 30 } })).found[0]?.level).toBe('red');
	});

	it('names each key in trouble with its expiry, its note or a pointer', () => {
		const key = (id: string, state: string, expiresAt: string | null, note: string) => ({
			id,
			label: id,
			state,
			expiresAt,
			note,
		});
		const project = {
			id: 'p',
			name: 'Shop',
			keys: [
				key('a', 'failed', null, 'Refused.'),
				key('b', 'expired', null, ''),
				key('c', 'expiring', '2026-12-01T00:00:00Z', ''),
			],
		} as unknown as Project;
		expect(findings(read({ projects: [project] })).found.map((f) => [f.level, f.title, f.detail])).toEqual([
			['red', 'Shop · a fails its check', 'Refused.'],
			['red', 'Shop · b has expired', 'See Connections.'],
			['amber', 'Shop · c expires soon', 'Expiry 2026-12-01.'],
		]);
	});
});

describe('this Mac’s readings', () => {
	let store: ConsoleStore;
	beforeEach(() => {
		process.env['CONSOLE_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'release-console-stats-more-'));
		store = new ConsoleStore();
	});
	afterEach(() => {
		store.onModuleDestroy();
		delete process.env['CONSOLE_DATA_DIR'];
		delete process.env['CONSOLE_COLLECT'];
		vi.useRealTimers();
	});

	it('keeps no rate for a counter it has no value for, and reads a reading without a Mac or Docker', () => {
		const mac = { memory: { used: 1 }, network: { rx: null, tx: 5 } } as unknown as MacSnapshot;
		const names = samplesOf(mac, null, {}, 1).rows.map((r) => r[1]);
		expect(names).toContain('mem_used');
		expect(names).not.toContain('net_rx_rate');
		expect(samplesOf(null, { stats: undefined } as unknown as DockerSnapshot, {}, 1).rows).toEqual([]);
	});

	it('reads on a timer unless told not to, one reading at a time, and keeps going when the alerts fail', async () => {
		const call = vi.fn(async (_m: string, path: string) =>
			path === '/jobs'
				? []
				: path === '/docker'
					? { containers: [], stats: [] }
					: { memory: { used: 1 }, network: { rx: 1, tx: 1 } },
		);
		const requests = { tick: vi.fn(async () => Promise.reject(new Error('no edge'))), recent: () => null };
		const alerts = new LocalAlerts(store);
		vi.spyOn(alerts, 'evaluate').mockImplementation(() => {
			throw new Error('broken rule');
		});
		const projects = { view: () => ({ projects: [] }) };
		const stats = new StatsCollector({ call } as never, store, alerts, projects as never, requests as never);
		process.env['CONSOLE_COLLECT'] = 'off';
		stats.onModuleInit();
		stats.onModuleDestroy();
		delete process.env['CONSOLE_COLLECT'];
		// The timer's own reading: its callback is taken from setInterval and run once here.
		const every = vi.spyOn(globalThis, 'setInterval').mockImplementation(((run: () => void) => {
			run();
			return { unref: () => undefined } as unknown as NodeJS.Timeout;
		}) as unknown as typeof setInterval);
		const stop = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);
		stats.onModuleInit();
		await vi.waitFor(() => expect((stats as unknown as { busy: boolean }).busy).toBe(false));
		expect(call).toHaveBeenCalledTimes(3);
		stats.onModuleDestroy();
		expect(stop).toHaveBeenCalled();
		every.mockRestore();
		stop.mockRestore();
		call.mockClear();
		const first = stats.tick();
		const second = stats.tick();
		await Promise.all([first, second]);
		expect(call).toHaveBeenCalledTimes(3);
		expect(stats.latest.helper).toBe(true);
		stats.onModuleDestroy();
		call.mockRejectedValueOnce(new Error('helper down'));
		await stats.tick();
		expect(stats.latest.helper).toBe(false);
	});

	it('lists an amber alert as amber, and notes that the request log answers', () => {
		const alerts = new LocalAlerts(store);
		store
			.db()
			.prepare(
				'INSERT INTO alerts (rule, subject, level, title, detail, fired_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
			)
			.run('disk', 'mac', 'amber', 'Disk', 'Full.', '2026-11-24T00:00:00.000Z', null);
		expect(alerts.firing()[0]?.level).toBe('amber');
		alerts.evaluate(read({ requests: { total: 0, serverErrors: 0 } }), Date.now());
		expect(alerts.view().rules.find((r) => r.rule === 'errors-rising')).toBeTruthy();
	});
});
