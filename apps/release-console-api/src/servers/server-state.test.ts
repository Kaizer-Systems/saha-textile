import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalDbReportController, ServerStateController } from './server-state.controller.js';
import { dropletSeries } from '../products/do-kit.js';
import { doWrites } from '../vendors/do-writes.js';

import type { KeySourceService } from '../keys/key-source.js';
import type { ProjectsService } from '../projects/projects.service.js';

vi.mock('../products/do-kit.js', async (load) => ({ ...(await load<object>()), dropletSeries: vi.fn(async () => []) }));

/** A made-up project: no real account or key is used, and fetch answers locally. */
const env = (name: string, domains: string[], cloudId: string | null = 'do1') => ({
	name,
	label: name,
	cloudId,
	domains,
});
function make(
	options: {
		cloud?: unknown[];
		edge?: unknown[];
		key?: string | null;
		token?: string | null;
		envs?: ReturnType<typeof env>[];
	} = {},
) {
	const repo = {
		cloud: options.cloud ?? [{ id: 'do1', vendor: 'digitalocean', keyIds: ['do'] }],
		edge: options.edge ?? [{ id: 'cf1', vendor: 'cloudflare', zones: ['example.com'], keyIds: [] }],
		environments: options.envs ?? [
			env('staging', ['staging.example.com', 'api-staging.example.com']),
			env('qa', ['api-qa.example.com']),
			env('development', []),
			env('local', [], null),
		],
	};
	const project = { keys: [{ id: 'do', kind: 'do-read' }] };
	const projects = {
		repository: () => ({ project, repo }),
		valueOf: async () => ('key' in options ? options.key : 'example-do-key'),
	} as unknown as ProjectsService;
	const keyFile = {
		get: () => ('token' in options ? options.token : 'example-ops-token'),
	} as unknown as KeySourceService;
	const c = new ServerStateController(projects, keyFile);
	const call = vi.fn(async (): Promise<unknown> => ({ containers: [] }));
	Object.assign(c, { helper: { call } });
	return { c, call };
}
const answer = (status: number, body: unknown) => ({ status, json: async () => body });
const QUEUE = { queue: 'mail', waiting: 0, active: 0, delayed: 0, failed: 0, completed: 3 };

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('a server environment’s live state', () => {
	it('refuses an environment that runs on no server', async () => {
		await expect(make().c.read('acme', 'shop', 'local')).rejects.toThrow('does not run on a server');
		await expect(make().c.read('acme', 'shop', 'nowhere')).rejects.toThrow('does not run on a server');
	});

	it('reads the machine from DigitalOcean monitoring, and says why when it cannot', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => answer(200, { at: '', queues: [QUEUE] })),
		);
		const tagged = vi.spyOn(doWrites, 'dropletsTagged');
		expect((await make({ cloud: [] }).c.read('acme', 'shop', 'staging')).machine.message).toContain(
			'not connected',
		);
		expect((await make({ key: null }).c.read('acme', 'shop', 'staging')).machine.message).toContain(
			'not connected',
		);
		tagged.mockRejectedValueOnce(new Error('down'));
		expect((await make().c.read('acme', 'shop', 'staging')).machine.message).toBe(
			'No server named acme-staging yet.',
		);
		tagged.mockResolvedValue([{ id: 7, name: 'acme-staging' } as never]);
		vi.mocked(dropletSeries).mockRejectedValueOnce(new Error('down'));
		expect((await make().c.read('acme', 'shop', 'staging')).machine.message).toContain('no figures yet');
		vi.mocked(dropletSeries).mockResolvedValueOnce([
			{ name: 'CPU', unit: '%', points: [[1, 12]] },
			{ name: 'Memory used', unit: '%', points: [] },
		]);
		const state = await make().c.read('acme', 'shop', 'staging');
		expect(state.machine).toMatchObject({ state: 'ok', cpuPercent: 12, memoryPercent: null, diskPercent: null });
	});

	it('reads the shop’s queues with the ops key, and says what each answer means', async () => {
		vi.spyOn(doWrites, 'dropletsTagged').mockResolvedValue([]);
		const shop = async (o: Parameters<typeof make>[0], envName = 'staging') =>
			(await make(o).c.read('acme', 'shop', envName)).shop;
		expect((await shop({}, 'development')).message).toBe('development names no API host.');
		expect((await shop({}, 'qa')).message).toContain('(none)');
		expect((await shop({ token: null })).message).toContain('(CONSOLE_OPS_TOKEN_STAGING)');
		const fetchStub = vi.fn();
		vi.stubGlobal('fetch', fetchStub);
		fetchStub.mockRejectedValueOnce(new Error('offline'));
		expect((await shop({})).message).toBe('api-staging.example.com did not answer.');
		fetchStub.mockResolvedValueOnce(answer(404, null));
		expect(await shop({})).toMatchObject({
			state: 'none',
			message: expect.stringContaining('OPS_TOKEN is not set'),
		});
		fetchStub.mockResolvedValueOnce(answer(500, null));
		expect(await shop({})).toMatchObject({ state: 'error', message: 'api-staging.example.com/ops answered 500.' });
		fetchStub.mockResolvedValueOnce({ status: 200, json: async () => Promise.reject(new Error('not json')) });
		expect((await shop({})).message).toContain('unknown shape');
		fetchStub.mockResolvedValueOnce(answer(200, { at: '', queues: [{ ...QUEUE, failed: 2 }] }));
		expect((await shop({})).message).toBe('2 failed jobs');
		fetchStub.mockResolvedValueOnce(answer(200, { at: '', queues: [{ ...QUEUE, waiting: 4 }] }));
		expect((await shop({})).message).toBe('4 jobs waiting');
		fetchStub.mockResolvedValueOnce(answer(200, { at: '', queues: [QUEUE] }));
		expect((await shop({})).message).toBe('queues empty');
	});

	it('reads the containers through the observer login, and says why when it cannot', async () => {
		vi.spyOn(doWrites, 'dropletsTagged').mockResolvedValue([]);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => answer(200, { at: '', queues: [] })),
		);
		const zoneless = make({ edge: [] });
		expect((await zoneless.c.read('acme', 'shop', 'staging')).containers.message).toContain(
			'names no Cloudflare zone',
		);
		const { c, call } = make();
		call.mockRejectedValueOnce(new Error('timed out'));
		expect((await c.read('acme', 'shop', 'staging')).containers.message).toBe(
			'The observer login did not answer: timed out',
		);
		call.mockResolvedValueOnce({ containers: 'nonsense' });
		expect((await c.read('acme', 'shop', 'staging')).containers.state).toBe('error');
		// No list at all reads as no containers.
		call.mockResolvedValueOnce(null);
		expect((await c.read('acme', 'shop', 'staging')).containers.message).toContain('0 running · 0 restarting');
		call.mockResolvedValueOnce({
			containers: [
				{ service: 'api', name: 'api-1', state: 'running' },
				{ service: 'worker', name: 'worker-1', state: 'restarting' },
			],
		});
		const read = await c.read('acme', 'shop', 'development');
		expect(read.containers.message).toBe('1 running · 1 restarting · through ssh-development.example.com');
	});
});

describe('logs and the database report through the observer login', () => {
	it('reads one service’s logs, with errors only when asked, and refuses an unknown answer', async () => {
		const { c, call } = make();
		call.mockResolvedValueOnce({ service: 'api', sinceMinutes: 15, lines: ['ok'] });
		expect(await c.logs('acme', 'shop', 'staging', { service: 'api' })).toEqual({
			service: 'api',
			sinceMinutes: 15,
			lines: ['ok'],
		});
		call.mockResolvedValueOnce({ nope: true });
		await expect(c.logs('acme', 'shop', 'staging', { service: 'api', since: '5', errors: '1' })).rejects.toThrow(
			'shape the console does not know',
		);
		expect(call).toHaveBeenLastCalledWith(
			'POST',
			'/server/observe',
			expect.objectContaining({ request: 'logs api --since 5 --errors' }),
			45_000,
		);
		await expect(make({ edge: [] }).c.logs('acme', 'shop', 'staging', { service: 'api' })).rejects.toThrow(
			'names no Cloudflare zone',
		);
		await expect(c.logs('acme', 'shop', 'local', { service: 'api' })).rejects.toThrow('does not run on a server');
	});

	it('reads the server’s database report, says why there is none, and refuses an unknown answer', async () => {
		const { c, call } = make();
		call.mockResolvedValueOnce({ error: 'No monitor login yet.' });
		expect(await c.dbReport('acme', 'shop', 'staging')).toEqual({ error: 'No monitor login yet.' });
		call.mockResolvedValueOnce({ connections: null, memoryMB: null });
		expect(await c.dbReport('acme', 'shop', 'staging')).toMatchObject({ uptimeSeconds: 0 });
		call.mockResolvedValueOnce({ uptimeSeconds: 'soon' });
		await expect(c.dbReport('acme', 'shop', 'staging')).rejects.toThrow('shape the console does not know');
		call.mockResolvedValueOnce(null);
		await expect(c.dbReport('acme', 'shop', 'staging')).rejects.toThrow('shape the console does not know');
		await expect(make({ edge: [] }).c.dbReport('acme', 'shop', 'staging')).rejects.toThrow(
			'names no Cloudflare zone',
		);
	});

	it('reads this Mac’s database report the same way', async () => {
		const local = new LocalDbReportController();
		const call = vi.fn();
		Object.assign(local, { helper: { call } });
		call.mockResolvedValueOnce({ error: 'Start the stack first.' });
		expect(await local.read()).toEqual({ error: 'Start the stack first.' });
		call.mockResolvedValueOnce({ connections: null, memoryMB: null });
		expect(await local.read()).toMatchObject({ collections: 0 });
		call.mockResolvedValueOnce(null);
		await expect(local.read()).rejects.toThrow('The local report answered in a shape');
	});
});
