import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalStackService, servicesFromSnapshot } from './local-stack.service.js';

import type { StatsCollector } from '../local/stats-collector.js';
import type { RunnerClient } from '../runner/runner-client.js';

/** `docker` answers locally: no real Docker CLI runs in these tests. */
vi.mock('node:child_process', () => ({
	execFile: (_cmd: string, args: string[], _opts: unknown, done: (err: Error | null, out?: unknown) => void) =>
		args[0] === 'ps'
			? done(null, {
					stdout: '{"Names":"saha-textile-api-1","State":"running","Status":"Up 1 hour","Image":"api"}\n',
					stderr: '',
				})
			: done(new Error('stats failed')),
}));

const container = (name: string, state: string, status: string) => ({ name, image: 'img', state, status });
const SNAPSHOT = {
	at: '2026-11-24T00:00:00.000Z',
	containers: [
		container('saha-textile-api-1', 'running', 'Up 1 hour (healthy)'),
		container('saha-textile-db-1', 'running', 'Up 1 hour (unhealthy)'),
		container('saha-textile-web-1', 'running', 'Up 1 minute (health: starting)'),
		container('saha-textile-odd-1', 'sleeping', 'Up'),
		container('other-1', 'running', 'Up'),
	],
	stats: [{ name: 'saha-textile-api-1', cpuPercent: 1, memoryBytes: 2, memoryLimitBytes: 3 }],
};

function make(latest: { docker: unknown; at: number }, call: (path: string) => Promise<unknown>) {
	const stats = { latest } as unknown as StatsCollector;
	const runner = { call: vi.fn(call) } as unknown as RunnerClient;
	return new LocalStackService(stats, runner);
}
const offline = async () => Promise.reject(new Error('helper down'));

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('this computer’s stack', () => {
	it('names each container’s health and state', () => {
		const rows = servicesFromSnapshot(SNAPSHOT as never, 'saha-textile');
		expect(rows.map((r) => [r.name, r.state, r.health])).toEqual([
			['saha-textile-api-1', 'running', 'healthy'],
			['saha-textile-db-1', 'running', 'unhealthy'],
			['saha-textile-odd-1', 'dead', 'none'],
			['saha-textile-web-1', 'running', 'starting'],
		]);
	});

	it('reads fresh figures first, then the helper, then the Docker CLI', async () => {
		const fresh = await make({ docker: SNAPSHOT, at: Date.now() }, offline).services();
		expect(fresh.services).toHaveLength(4);
		const helper = await make({ docker: SNAPSHOT, at: 0 }, async () => SNAPSHOT).services('other');
		expect(helper.services.map((s) => s.name)).toEqual(['other-1']);
		const cli = await make({ docker: null, at: 0 }, offline).services();
		expect(cli.services.map((s) => s.name)).toEqual(['saha-textile-api-1']);
		expect((await make({ docker: null, at: 0 }, offline).services('saha-textile')).services).toHaveLength(1);
	});

	it('reads the shop’s readiness through the helper, and says what each answer means', async () => {
		const ready = (answer: unknown) => make({ docker: null, at: 0 }, async () => answer).readiness();
		expect(await make({ docker: null, at: 0 }, offline).readiness('other')).toMatchObject({ status: 'unknown' });
		expect(await ready({ dev: null })).toMatchObject({ reachable: false, status: 'down' });
		expect(await ready({ dev: { status: 200, body: 'text' } })).toMatchObject({ status: 'ok', detail: {} });
		expect(await ready({ dev: { body: {} } })).toMatchObject({ status: 'down' });
		expect(await ready({ dev: { status: 200, body: { status: 'degraded' } } })).toMatchObject({
			status: 'degraded',
		});
	});

	it('asks the shop directly when the helper does not answer', async () => {
		const service = make({ docker: null, at: 0 }, offline);
		const fetchStub = vi.fn();
		vi.stubGlobal('fetch', fetchStub);
		fetchStub.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'degraded' }) });
		expect(await service.readiness('saha-textile')).toMatchObject({ status: 'degraded' });
		fetchStub.mockResolvedValueOnce({ ok: true, json: async () => 5 });
		expect(await service.readiness()).toMatchObject({ status: 'ok', detail: {} });
		fetchStub.mockResolvedValueOnce({ ok: false, json: async () => Promise.reject(new Error('not json')) });
		expect(await service.readiness()).toMatchObject({ status: 'down', reachable: true });
		fetchStub.mockRejectedValueOnce(new Error('refused'));
		expect(await service.readiness()).toMatchObject({ status: 'down', reachable: false });
	});
});
