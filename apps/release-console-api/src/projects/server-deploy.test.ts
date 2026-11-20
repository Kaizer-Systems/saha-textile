import { ForbiddenException } from '@nestjs/common';
import { repositorySchema } from '@saha-textile/release-console-contracts';
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
	const projects = {
		repository: vi.fn(() => ({ project: { id: 'saha-textile', keys: [{ id: 'gh' }] }, repo })),
		valueOf: vi.fn(async () => 'github-key-not-real'),
	};
	const lock = {
		confirm: vi.fn(() => {
			if (!pinOk) throw new ForbiddenException('Wrong PIN or password.');
		}),
	};
	const store = { audit: vi.fn() };
	return { c: new ServerDeployController(projects as never, lock as never, store as never), lock, store };
}

describe('server deploys from the console', () => {
	beforeEach(() => vi.clearAllMocks());

	it('explains an environment that has no server deploy, and reads one that has', async () => {
		const { c } = controller();
		expect(await c.view('saha-textile', 'saha-textile', 'local')).toMatchObject({
			state: 'not-connected',
			message: expect.stringMatching(/runs on this computer/),
		});
		expect(await c.view('saha-textile', 'saha-textile', 'dev-server')).toMatchObject({
			state: 'not-connected',
			message: expect.stringMatching(/development server needs its own Infisical deploy identity/),
		});
		vi.mocked(deploys.serverDeployView).mockResolvedValueOnce({ environment: 'staging' } as never);
		expect(await c.view('saha-textile', 'saha-textile', 'staging')).toMatchObject({ state: 'ok' });
		expect(deploys.serverDeployView).toHaveBeenCalledWith(
			'Kaizer-Systems/saha-textile',
			'staging',
			'staging',
			'github-key-not-real',
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
});
