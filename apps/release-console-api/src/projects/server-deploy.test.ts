import { ForbiddenException } from '@nestjs/common';
import { type RotationState, emptyRotation, repositorySchema } from '@saha-textile/release-console-contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerDeployController } from './server-deploy.controller.js';
import * as deploys from '../vendors/github-deploys.js';

vi.mock('../vendors/github-deploys.js', () => ({
	serverDeployView: vi.fn(),
	startServerDeploy: vi.fn(async () => undefined),
	reviewServerDeploy: vi.fn(async () => undefined),
}));

const req = { headers: { 'x-console-session': 's1' } } as never;
const repo = repositorySchema.parse({
	id: 'saha-textile',
	name: 'saha-textile',
	sourceCode: { vendor: 'github', repository: 'Kaizer-Systems/saha-textile', keyId: 'gh' },
	environments: [
		{ name: 'local', label: 'Local' },
		{ name: 'staging', label: 'Staging', cloudId: 'digitalocean' },
		{ name: 'dev-server', label: 'Dev server', cloudId: 'digitalocean' },
	],
	cloud: [{ id: 'digitalocean', vendor: 'digitalocean' }],
});

function controller(pinOk = true) {
	let rotation: RotationState = emptyRotation();
	const projects = {
		repository: vi.fn(() => ({ project: { id: 'saha-textile', keys: [{ id: 'gh' }] }, repo })),
		valueOf: vi.fn(async () => 'github-key-not-real'),
		rotation: vi.fn(() => rotation),
		setRotation: vi.fn((_p: string, _r: string, _e: string, next: RotationState) => (rotation = next)),
	};
	const lock = {
		confirm: vi.fn(() => {
			if (!pinOk) throw new ForbiddenException('Wrong PIN or password.');
		}),
	};
	const store = { audit: vi.fn() };
	return {
		c: new ServerDeployController(projects as never, lock as never, store as never),
		lock,
		store,
		projects,
		rotation: () => rotation,
	};
}

describe('server deploys from the console', () => {
	beforeEach(() => vi.clearAllMocks());

	it('explains an environment that has no server deploy, and reads one that has', async () => {
		const { c } = controller();
		expect(await c.view('saha-textile', 'saha-textile', 'local')).toMatchObject({
			state: 'not-connected',
			message: expect.stringMatching(/runs on this computer/),
		});
		// A development server now deploys too (owner, 21 Nov): GitHub environment development.
		vi.mocked(deploys.serverDeployView).mockResolvedValueOnce({ environment: 'dev-server' } as never);
		expect(await c.view('saha-textile', 'saha-textile', 'dev-server')).toMatchObject({ state: 'ok' });
		expect(vi.mocked(deploys.serverDeployView).mock.calls.at(-1)?.[2]).toBe('development');
		vi.mocked(deploys.serverDeployView).mockResolvedValueOnce({ environment: 'staging' } as never);
		expect(await c.view('saha-textile', 'saha-textile', 'staging')).toMatchObject({ state: 'ok' });
		// No branch chosen for Staging: the target's own branch (undefined here) applies.
		expect(deploys.serverDeployView).toHaveBeenCalledWith(
			'Kaizer-Systems/saha-textile',
			'staging',
			'staging',
			'github-key-not-real',
			undefined,
			undefined,
		);
	});

	it('starts nothing on a wrong PIN, and logs a started deploy', async () => {
		const wrong = controller(false);
		await expect(wrong.c.start(req, 'saha-textile', 'saha-textile', 'staging', { pin: '135790' })).rejects.toThrow(
			/Wrong PIN/,
		);
		expect(deploys.startServerDeploy).not.toHaveBeenCalled();
		const right = controller();
		await right.c.start(req, 'saha-textile', 'saha-textile', 'staging', { pin: '135790' });
		expect(deploys.startServerDeploy).toHaveBeenCalledWith(
			'Kaizer-Systems/saha-textile',
			'staging',
			'github-key-not-real',
			undefined,
			undefined,
			[],
			{ rotate: false, restartDatabase: false, action: 'deploy', tag: undefined },
		);
		expect(right.store.audit).toHaveBeenCalledWith(
			'saha-textile',
			'server-deploy-started',
			expect.stringContaining('staging'),
		);
		await expect(right.c.start(req, 'saha-textile', 'saha-textile', 'local', { pin: '135790' })).rejects.toThrow(
			/this computer/,
		);
	});

	it('approves only the run that is waiting', async () => {
		const { c } = controller();
		vi.mocked(deploys.serverDeployView).mockResolvedValue({ run: { id: 5, waiting: [] } } as never);
		await expect(
			c.review(req, 'saha-textile', 'saha-textile', 'staging', { pin: '135790', runId: 5, approve: true }),
		).rejects.toThrow(/not waiting/);
		vi.mocked(deploys.serverDeployView).mockResolvedValue({ run: { id: 5, waiting: [77] } } as never);
		await c.review(req, 'saha-textile', 'saha-textile', 'staging', { pin: '135790', runId: 5, approve: true });
		expect(deploys.reviewServerDeploy).toHaveBeenCalledWith(
			'Kaizer-Systems/saha-textile',
			5,
			[77],
			true,
			'github-key-not-real',
		);
	});

	it('rotates only with the environment’s name typed, and clears the waiting values after a good run', async () => {
		const { c, rotation, projects } = controller();
		projects.setRotation('saha-textile', 'saha-textile', 'staging', { ...emptyRotation(), pending: ['redis'] });
		await expect(
			c.start(req, 'saha-textile', 'saha-textile', 'staging', { pin: '135790', rotate: true }),
		).rejects.toThrow(/Type staging/);
		await expect(
			c.start(req, 'saha-textile', 'saha-textile', 'staging', { pin: '135790', restartDatabase: true }),
		).rejects.toThrow(/only with rotation/);
		await c.start(req, 'saha-textile', 'saha-textile', 'staging', {
			pin: '135790',
			rotate: true,
			restartDatabase: true,
			confirm: 'staging',
		});
		expect(vi.mocked(deploys.startServerDeploy).mock.calls.at(-1)?.[6]).toMatchObject({
			rotate: true,
			restartDatabase: true,
		});
		expect(rotation().requestedAt).not.toBeNull();
		vi.mocked(deploys.serverDeployView).mockResolvedValueOnce({
			run: { status: 'completed', conclusion: 'success', createdAt: new Date().toISOString() },
		} as never);
		await c.view('saha-textile', 'saha-textile', 'staging');
		expect(rotation()).toMatchObject({ pending: [], requestedAt: null });
	});

	it('rolls back and deploys an older version of this environment only', async () => {
		const { c, store } = controller();
		await c.start(req, 'saha-textile', 'saha-textile', 'staging', { pin: '135790', action: 'rollback' });
		expect(vi.mocked(deploys.startServerDeploy).mock.calls.at(-1)?.[6]).toMatchObject({ action: 'rollback' });
		expect(store.audit).toHaveBeenLastCalledWith('saha-textile', 'server-rollback-started', expect.any(String));
		await expect(
			c.start(req, 'saha-textile', 'saha-textile', 'staging', {
				pin: '135790',
				tag: 'production-20261123-142210-08ac015c',
			}),
		).rejects.toThrow(/not a release of staging/);
		await expect(
			c.start(req, 'saha-textile', 'saha-textile', 'staging', {
				pin: '135790',
				action: 'rollback',
				rotate: true,
			}),
		).rejects.toThrow(/only swaps/);
	});
});
