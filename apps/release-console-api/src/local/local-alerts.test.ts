import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalAlerts, type Readings, findings } from './local-alerts.js';
import { ConsoleStore } from '../store/console-store.js';

import type { DockerSnapshot, Job, MacSnapshot, Project } from '@saha-textile/release-console-contracts';

const GB = 1024 ** 3;
const mac = (usedPct: number): MacSnapshot => ({
	at: 't',
	cpu: null,
	memory: { total: 16 * GB, used: 8 * GB, compressed: 0, wired: 0 },
	swapUsed: 0,
	load: null,
	disk: { total: 100 * GB, used: usedPct * GB, free: (100 - usedPct) * GB },
	network: { rx: 0, tx: 0 },
	cpus: 8,
});
const container = (name: string, state: string, status: string) => ({ name, image: 'x', state, status, ports: '' });
const docker = (...containers: ReturnType<typeof container>[]): DockerSnapshot => ({
	at: 't',
	reachable: true,
	version: '29',
	cpus: 8,
	memoryTotal: 16 * GB,
	containers,
	stats: [],
});
const job = (id: string, status: Job['status'], startedAt: string): Job => ({
	id,
	kind: 'pipeline',
	label: 'Local pipeline (all stages)',
	status,
	startedAt,
	finishedAt: startedAt,
	exitCode: status === 'passed' ? 0 : 1,
	lines: [],
});
const read = (over: Partial<Readings>): Readings => ({
	mac: mac(50),
	docker: docker(),
	helper: true,
	jobs: [],
	projects: [],
	...over,
});

describe('local alert rules', () => {
	it('warns about the start-up disk over 85% and goes red over 95%', () => {
		expect(findings(read({ mac: mac(84) })).found).toEqual([]);
		expect(findings(read({ mac: mac(94) })).found[0]).toMatchObject({
			rule: 'disk',
			level: 'amber',
			title: 'Start-up disk 94% full',
		});
		expect(findings(read({ mac: mac(96) })).found[0]?.level).toBe('red');
	});

	it('counts a stopped container only while the rest of the stack runs', () => {
		const stopped = container('saha-textile-stack-api-1', 'exited', 'Exited (1)');
		expect(findings(read({ docker: docker(stopped) })).found).toEqual([]);
		const running = container('saha-textile-stack-mongo-1', 'running', 'Up 2 hours (healthy)');
		const sick = container('saha-textile-stack-edge-1', 'running', 'Up 2 hours (unhealthy)');
		const other = container('saha-textile-search', 'exited', 'Exited (0)');
		const found = findings(read({ docker: docker(stopped, running, sick, other) })).found;
		expect(found.map((f) => f.title)).toEqual(['api is exited', 'edge fails its health check']);
	});

	it('fires on the latest failed local run only, and on keys that need the owner', () => {
		const jobs = [job('a', 'failed', '2026-11-20T09:00:00Z'), job('b', 'passed', '2026-11-20T10:00:00Z')];
		expect(findings(read({ jobs })).found).toEqual([]);
		jobs.push(job('c', 'failed', '2026-11-20T11:00:00Z'));
		expect(findings(read({ jobs })).found[0]).toMatchObject({ rule: 'run-failed', subject: 'c' });
		const project = {
			id: 'p',
			name: 'Shop',
			keys: [
				{ id: 'k1', label: 'DigitalOcean', state: 'expiring', expiresAt: '2026-11-30T00:00:00Z', note: '' },
				{ id: 'k2', label: 'GitHub', state: 'verified', expiresAt: null, note: '' },
			],
		} as unknown as Project;
		expect(findings(read({ projects: [project] })).found).toMatchObject([
			{ rule: 'key-expiring', subject: 'p:k1', level: 'amber', title: 'Shop · DigitalOcean expires soon' },
		]);
	});

	it('judges only the helper and keys while the helper does not answer', () => {
		const { found, judged } = findings(read({ helper: false, mac: null, docker: null, jobs: null }));
		expect(found.map((f) => f.rule)).toEqual(['helper-down']);
		expect([...judged].sort()).toEqual(['helper-down', 'key-expiring']);
	});
});

describe('local alerts over time', () => {
	let store: ConsoleStore;
	beforeEach(() => {
		process.env['CONSOLE_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'release-console-alerts-'));
		store = new ConsoleStore();
	});
	afterEach(() => {
		store.onModuleDestroy();
		delete process.env['CONSOLE_DATA_DIR'];
	});

	it('fires once a finding holds long enough, ends it when it clears, and keeps it listed', () => {
		const alerts = new LocalAlerts(store);
		const t0 = Date.UTC(2026, 10, 20, 10, 0, 0);
		const stack = (state: string) =>
			docker(
				container('saha-textile-stack-mongo-1', 'running', 'Up'),
				container('saha-textile-stack-api-1', state, state === 'running' ? 'Up' : 'Exited (1)'),
			);
		for (let i = 0; i < 5; i++) alerts.evaluate(read({ docker: stack('exited') }), t0 + i * 5000);
		expect(alerts.firing()).toEqual([]);
		alerts.evaluate(read({ docker: stack('exited') }), t0 + 25_000);
		expect(alerts.firing().map((a) => a.title)).toEqual(['api is exited']);
		alerts.evaluate(read({ helper: false, mac: null, docker: null, jobs: null }), t0 + 30_000);
		expect(alerts.firing().map((a) => a.rule)).toEqual(['container-down']);
		alerts.evaluate(read({ docker: stack('running') }), t0 + 35_000);
		const view = alerts.view();
		expect(view.firing).toEqual([]);
		expect(view.recent[0]).toMatchObject({
			title: 'api is exited',
			resolvedAt: new Date(t0 + 35_000).toISOString(),
		});
		expect(view.rules.find((r) => r.rule === 'errors-rising')?.state).toBe('waiting');
		expect(view.rules.find((r) => r.rule === 'container-down')?.state).toBe('ok');
	});

	it('fires the disk alert at once and updates it as the disk fills', () => {
		const alerts = new LocalAlerts(store);
		alerts.evaluate(read({ mac: mac(90) }), 1_000);
		alerts.evaluate(read({ mac: mac(97) }), 6_000);
		expect(alerts.firing()).toMatchObject([{ rule: 'disk', level: 'red', title: 'Start-up disk 97% full' }]);
		expect(alerts.view().rules.find((r) => r.rule === 'disk')?.state).toBe('firing');
	});
});
