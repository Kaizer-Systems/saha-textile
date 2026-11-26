import { describe, expect, it, vi } from 'vitest';

import { LocalController } from './local.controller.js';

/** The Mac helper, figures, alerts and request log are stand-ins; nothing runs on this machine. */
function make(
	over: {
		latest?: Record<string, unknown>;
		call?: (method: string, path: string) => Promise<unknown>;
		projects?: unknown;
	} = {},
) {
	const runner = {
		call: vi.fn(over.call ?? (async (_m: string, path: string) => ({ path, label: 'job', kind: 'github' }))),
	};
	const stats = { latest: over.latest ?? { mac: null, docker: null, at: 0 }, history: vi.fn(() => []) };
	const store = { audit: vi.fn() };
	const alerts = { view: vi.fn(() => ({ rules: [] })) };
	const requests = { view: vi.fn(() => ({})), clientBuilds: vi.fn(() => ({})), notFound: vi.fn(() => ({})) };
	const lock = { confirm: vi.fn() };
	const c = new LocalController(
		runner as never,
		stats as never,
		lock as never,
		store as never,
		alerts as never,
		requests as never,
		(over.projects ?? {}) as never,
	);
	return { c, runner, stats, store, requests };
}
const req = { headers: {} } as never;

describe('this Mac’s routes', () => {
	it('reads the request log, builds, page-not-found answers, alerts and history', () => {
		const { c, requests, stats } = make();
		c.requestsView({});
		c.clientBuilds({ hours: '6' });
		c.notFound({});
		c.alertsView();
		c.history({ source: 'mac', names: 'cpu,memory' });
		expect(requests.view).toHaveBeenCalledWith(60);
		expect(requests.clientBuilds).toHaveBeenCalledWith(6);
		expect(requests.notFound).toHaveBeenCalledWith(24);
		expect(stats.history).toHaveBeenCalledWith('mac', ['cpu', 'memory'], 60);
	});

	it('asks the helper for its places, GitHub, health, logs and jobs', async () => {
		const { c, runner } = make();
		await c.secretsPlaces();
		await c.githubStatus();
		await c.githubCheck({ repository: 'example/shop' });
		await c.shopHealth();
		await c.logs({ container: 'saha-textile-api-1' });
		await c.jobs();
		await c.job('job-1');
		await c.job('job-1', '12');
		await c.job('job-1', 'nonsense');
		expect(runner.call.mock.calls.map((call) => call[1])).toEqual([
			'/secrets/places',
			'/github/status',
			'/github/check?repository=example%2Fshop',
			'/shop-health',
			expect.stringContaining('/logs'),
			'/jobs',
			'/jobs/job-1?after=0',
			'/jobs/job-1?after=12',
			'/jobs/job-1?after=0',
		]);
		expect(() => c.job('../etc')).toThrow('No such job.');
	});

	it('uses the last figures while fresh, and asks the helper otherwise', async () => {
		const fresh = make({ latest: { mac: { cpu: 1 }, docker: { at: 'x' }, at: Date.now() } });
		expect(await fresh.c.mac()).toEqual({ cpu: 1 });
		expect(await fresh.c.docker()).toEqual({ at: 'x' });
		expect(fresh.runner.call).not.toHaveBeenCalled();
		const stale = make({ latest: { mac: { cpu: 1 }, docker: { at: 'x' }, at: 0 } });
		await stale.c.mac();
		await stale.c.docker();
		expect(stale.runner.call.mock.calls.map((call) => call[1])).toEqual(['/mac', '/docker']);
	});

	it('says whether the helper answers, with its dev servers', async () => {
		const up = make({ call: async (_m, path) => (path === '/health' ? { root: '/repo' } : { shop: true }) });
		expect(await up.c.helper()).toMatchObject({ reachable: true, root: '/repo', devServers: { shop: true } });
		const down = make({ call: async () => Promise.reject(new Error('not answering')) });
		expect(await down.c.helper()).toMatchObject({ reachable: false, message: 'not answering' });
	});

	it('signs in to GitHub with no body, words a refused token, and checks job ids', async () => {
		const { c, runner, store } = make();
		await expect(c.githubLogin(undefined)).rejects.toThrow();
		runner.call.mockResolvedValueOnce({ ok: false } as never);
		await c.githubTokenLogin({ token: 'ghp_' + 'x'.repeat(36) });
		expect(store.audit).toHaveBeenLastCalledWith(null, 'github-token-refused', 'no account');
		await expect(c.answerGithubLogin('../x', { answer: 'yes' })).rejects.toThrow('No such job.');
		await expect(c.stopGithubLogin('../x')).rejects.toThrow('No such job.');
	});

	it('runs a local action with what it needs, and stops a job after the PIN', async () => {
		const { c, runner, store } = make();
		await c.run(req, 'stack-up', { pin: '123456' });
		expect(runner.call).toHaveBeenLastCalledWith('POST', '/run/stack-up', {});
		await c.run(req, 'pipeline', { pin: '123456', branch: 'dev' });
		expect(runner.call).toHaveBeenLastCalledWith('POST', '/run/pipeline', {
			from: undefined,
			only: undefined,
			branch: 'dev',
		});
		await c.stop(req, 'job-1', { pin: '123456' });
		expect(store.audit).toHaveBeenLastCalledWith(null, 'local-job-stopped', 'job');
		await expect(c.stop(req, '../x', { pin: '123456' })).rejects.toThrow('No such job.');
	});

	it('logs a save Infisical refused as not saved', async () => {
		const repo = {
			name: 'shop',
			environments: [
				{ name: 'local', label: 'Local', cloudId: null, secretsId: 'inf', secretsPath: 'acme-local/dev' },
			],
			secrets: [{ id: 'inf', vendor: 'infisical' }],
		};
		const { c, store } = make({
			projects: { repository: () => ({ project: {}, repo }) },
			call: async () => ({
				tier: 'local',
				project: 'acme-local',
				environment: 'dev',
				results: [{ folder: 'api', names: ['COOKIE_DOMAIN'], saved: false, error: 'refused' }],
			}),
		});
		await c.saveSecrets(req, {
			projectId: 'acme',
			repositoryId: 'shop',
			environment: 'local',
			pin: '123456',
			changes: [{ folder: 'api', name: 'COOKIE_DOMAIN', value: 'example-value' }],
		});
		expect(store.audit).toHaveBeenLastCalledWith(
			'acme',
			'secrets-not-saved',
			'acme-local · dev · /api: COOKIE_DOMAIN',
		);
	});
});
