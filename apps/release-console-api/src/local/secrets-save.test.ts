import { ForbiddenException } from '@nestjs/common';
import { repositorySchema } from '@saha-textile/release-console-contracts';
import { describe, expect, it, vi } from 'vitest';

import { LocalController } from './local.controller.js';

const req = { headers: { 'x-console-session': 's1' } } as never;

/** A repository whose environments each name their own place, or none. */
const repo = repositorySchema.parse({
	id: 'saha-textile',
	name: 'saha-textile',
	sourceCode: { vendor: 'github', repository: 'Kaizer-Systems/saha-textile' },
	environments: [
		{ name: 'local', label: 'Local', secretsId: 'infisical', secretsPath: 'saha-textile-local · dev' },
		{
			name: 'staging',
			label: 'Staging',
			cloudId: 'digitalocean',
			secretsId: 'infisical',
			secretsPath: 'saha-textile-staging · staging',
		},
		{ name: 'qa', label: 'QA', cloudId: 'digitalocean', secretsId: 'doppler', secretsPath: 'shop · qa' },
		{ name: 'demo', label: 'Demo' },
	],
	cloud: [{ id: 'digitalocean', vendor: 'digitalocean' }],
	secrets: [
		{ id: 'infisical', vendor: 'infisical' },
		{ id: 'doppler', vendor: 'doppler' },
	],
});

const body = (over: Record<string, unknown> = {}) => ({
	projectId: 'saha-textile',
	repositoryId: 'saha-textile',
	environment: 'staging',
	pin: '135790',
	confirmName: 'staging',
	changes: [{ folder: 'api', name: 'COOKIE_DOMAIN', value: 'test-value-not-real' }],
	...over,
});

function controller(pinOk = true) {
	const runner = {
		call: vi.fn(async () => ({
			tier: 'staging',
			project: 'saha-textile-staging',
			environment: 'staging',
			results: [{ folder: 'api', names: ['COOKIE_DOMAIN'], saved: true, error: null }],
		})),
	};
	const lock = {
		confirm: vi.fn(() => {
			if (!pinOk) throw new ForbiddenException('Wrong PIN or password.');
		}),
	};
	const store = { audit: vi.fn() };
	const projects = { repository: vi.fn(() => ({ project: {}, repo })) };
	const c = new LocalController(
		runner as never,
		{} as never,
		lock as never,
		store as never,
		{} as never,
		{} as never,
		projects as never,
	);
	return { c, runner, lock, store };
}

describe('reading an environment’s Secrets', () => {
	it('reads the place that environment names, not one the browser sends', async () => {
		const { c, runner } = controller();
		await c.secrets({ projectId: 'saha-textile', repositoryId: 'saha-textile', environment: 'local', fresh: '1' });
		expect(runner.call).toHaveBeenCalledWith(
			'GET',
			'/secrets?project=saha-textile-local&environment=dev&folder=%2F&fresh=1',
			undefined,
			190_000,
		);
	});

	it('refuses an environment that names no Infisical place', () => {
		const { c, runner } = controller();
		for (const environment of ['qa', 'demo'])
			expect(() => c.secrets({ projectId: 'saha-textile', repositoryId: 'saha-textile', environment })).toThrow(
				/does not name a place in Infisical Cloud/,
			);
		expect(() =>
			c.secrets({ projectId: 'saha-textile', repositoryId: 'saha-textile', environment: 'nope' }),
		).toThrow(/has no environment nope/);
		expect(runner.call).not.toHaveBeenCalled();
	});
});

describe('saving Secrets drafts', () => {
	it('needs the name typed for an environment on a server, before anything else', async () => {
		const { c, runner, lock } = controller();
		await expect(c.saveSecrets(req, body({ confirmName: 'prod' }))).rejects.toThrow(
			/Type staging to confirm saving into saha-textile-staging\/staging/,
		);
		expect(lock.confirm).not.toHaveBeenCalled();
		expect(runner.call).not.toHaveBeenCalled();
	});

	it('sends nothing on a wrong PIN', async () => {
		const { c, runner } = controller(false);
		await expect(c.saveSecrets(req, body())).rejects.toThrow(/Wrong PIN/);
		expect(runner.call).not.toHaveBeenCalled();
	});

	it('saves the environment’s own place through the helper and logs names only', async () => {
		const { c, runner, store } = controller();
		const answer = await c.saveSecrets(req, body());
		expect(runner.call).toHaveBeenCalledWith(
			'POST',
			'/secrets/save',
			{
				place: { project: 'saha-textile-staging', environment: 'staging', folder: '/' },
				changes: [{ folder: 'api', name: 'COOKIE_DOMAIN', value: 'test-value-not-real' }],
			},
			190_000,
		);
		expect(store.audit).toHaveBeenCalledWith(
			'saha-textile',
			'secrets-saved',
			'saha-textile-staging · staging · /api: COOKIE_DOMAIN',
		);
		expect(JSON.stringify(store.audit.mock.calls)).not.toContain('test-value-not-real');
		expect(JSON.stringify(answer)).not.toContain('test-value-not-real');
	});

	it('needs no typed name for an environment on this computer', async () => {
		const { c, runner } = controller();
		await c.saveSecrets(req, body({ environment: 'local', confirmName: '' }));
		expect(runner.call).toHaveBeenCalledTimes(1);
	});
});
