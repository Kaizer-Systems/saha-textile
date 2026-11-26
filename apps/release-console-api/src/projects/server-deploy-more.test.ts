import { NotFoundException } from '@nestjs/common';
import { type RotationState, emptyRotation, repositorySchema } from '@saha-textile/release-console-contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerDeployController } from './server-deploy.controller.js';
import * as deploys from '../vendors/github-deploys.js';
import { VendorError } from '../vendors/http.js';

vi.mock('../vendors/github-deploys.js', () => ({
	serverDeployView: vi.fn(async () => ({})),
	startServerDeploy: vi.fn(async () => undefined),
	reviewServerDeploy: vi.fn(async () => undefined),
}));

/** A made-up repository: GitHub answers locally through the mocked module. */
const req = { headers: {} } as never;
const repoOf = (over: Record<string, unknown> = {}) =>
	repositorySchema.parse({
		id: 'shop',
		name: 'shop',
		sourceCode: { vendor: 'github', repository: 'example/shop', keyId: 'gh' },
		environments: [
			{ name: 'local', label: 'Local' },
			{ name: 'staging', label: 'Staging', cloudId: 'do' },
			{ name: 'production', label: 'Production', cloudId: 'do', branch: 'release' },
			{ name: 'dev-server', label: 'Dev server', cloudId: 'do' },
			{ name: 'qa', label: 'QA', cloudId: 'do' },
		],
		cloud: [{ id: 'do', vendor: 'digitalocean' }],
		...over,
	});

function controller(options: { repo?: ReturnType<typeof repoOf>; key?: string | null; keys?: unknown[] } = {}) {
	let rotation: RotationState = emptyRotation();
	const projects = {
		repository: vi.fn((_p: string, r: string) => {
			if (r === 'missing') throw new NotFoundException('No repository missing.');
			return { project: { id: 'acme', keys: options.keys ?? [{ id: 'gh' }] }, repo: options.repo ?? repoOf() };
		}),
		valueOf: vi.fn(async () => ('key' in options ? options.key : 'example-github-key')),
		rotation: vi.fn(() => rotation),
		setRotation: vi.fn((_p: string, _r: string, _e: string, next: RotationState) => (rotation = next)),
	};
	const store = { audit: vi.fn() };
	const c = new ServerDeployController(projects as never, { confirm: vi.fn() } as never, store as never);
	return { c, store, projects, rotation: () => rotation };
}

beforeEach(() => vi.clearAllMocks());

describe('server deploys: what is not ready', () => {
	it('says why an environment cannot deploy from here', async () => {
		const message = async (c: ServerDeployController, env: string) =>
			((await c.view('acme', 'shop', env)) as { message: string }).message;
		expect(await message(controller().c, 'nowhere')).toBe('shop has no environment nowhere.');
		expect(
			await message(
				controller({ repo: repoOf({ sourceCode: { vendor: 'gitlab', repository: 'example/x', keyId: null } }) })
					.c,
				'staging',
			),
		).toContain('another vendor');
		expect(await message(controller().c, 'qa')).toContain('neither development, staging nor production');
		expect(await message(controller({ keys: [] }).c, 'staging')).toContain('GitHub is not connected');
		expect(await message(controller({ key: null }).c, 'staging')).toContain('GitHub is not connected');
	});

	it('says what GitHub refused, and lets other failures through', async () => {
		const { c } = controller();
		vi.mocked(deploys.serverDeployView).mockRejectedValueOnce(new VendorError('Not Found', 404));
		expect(await c.view('acme', 'shop', 'staging')).toEqual({ state: 'error', message: 'Not Found' });
		vi.mocked(deploys.serverDeployView).mockRejectedValueOnce(new Error('boom'));
		await expect(c.view('acme', 'shop', 'staging')).rejects.toThrow('boom');
		await expect(c.start(req, 'acme', 'missing', 'staging', { pin: '135790' })).rejects.toThrow(
			'No repository missing.',
		);
	});
});

describe('server deploys: starting, reviewing and settling', () => {
	it('asks production’s name for blanks and older versions, and keeps branches to development', async () => {
		const { c, store } = controller();
		await expect(
			c.start(req, 'acme', 'shop', 'production', { pin: '135790', allowBlank: ['MSG91_AUTH_KEY'] }),
		).rejects.toThrow('Type production to deploy production with blank values.');
		await c.start(req, 'acme', 'shop', 'production', {
			pin: '135790',
			allowBlank: ['MSG91_AUTH_KEY'],
			confirm: 'production',
		});
		expect(store.audit).toHaveBeenLastCalledWith(
			'acme',
			'server-deploy-started',
			expect.stringContaining('allowed blank: MSG91_AUTH_KEY'),
		);
		expect(vi.mocked(deploys.startServerDeploy).mock.calls.at(-1)?.[4]).toBe('release');
		await expect(
			c.start(req, 'acme', 'shop', 'production', { pin: '135790', tag: 'production-20261123-142210-08ac015c' }),
		).rejects.toThrow('Type production to confirm.');
		await c.start(req, 'acme', 'shop', 'production', {
			pin: '135790',
			tag: 'production-20261123-142210-08ac015c',
			confirm: 'production',
		});
		expect(store.audit).toHaveBeenLastCalledWith(
			'acme',
			'server-deploy-started',
			expect.stringContaining('deploy the older version production-20261123-142210-08ac015c'),
		);
		await c.start(req, 'acme', 'shop', 'staging', { pin: '135790', rotate: true, confirm: 'staging' });
		expect(store.audit).toHaveBeenLastCalledWith(
			'acme',
			'server-deploy-started',
			expect.stringContaining('deploy with rotation'),
		);
		await expect(c.start(req, 'acme', 'shop', 'staging', { pin: '135790', branch: 'feature' })).rejects.toThrow(
			'deploys its own branch',
		);
		await c.start(req, 'acme', 'shop', 'dev-server', { pin: '135790', branch: 'feature' });
		expect(vi.mocked(deploys.startServerDeploy).mock.calls.at(-1)?.[4]).toBe('feature');
	});

	it('words a refusal’s status, and lets an unexpected failure through', async () => {
		const { c } = controller();
		vi.mocked(deploys.startServerDeploy).mockRejectedValueOnce(new VendorError('Bad', 0));
		await expect(c.start(req, 'acme', 'shop', 'staging', { pin: '135790' })).rejects.toMatchObject({ status: 502 });
		vi.mocked(deploys.startServerDeploy).mockRejectedValueOnce(new VendorError('Bad', 700));
		await expect(c.start(req, 'acme', 'shop', 'staging', { pin: '135790' })).rejects.toMatchObject({ status: 502 });
		vi.mocked(deploys.startServerDeploy).mockRejectedValueOnce(new VendorError('Gone', 410));
		await expect(c.start(req, 'acme', 'shop', 'staging', { pin: '135790' })).rejects.toMatchObject({ status: 410 });
		vi.mocked(deploys.startServerDeploy).mockRejectedValueOnce(new Error('boom'));
		await expect(c.start(req, 'acme', 'shop', 'staging', { pin: '135790' })).rejects.toThrow('boom');
	});

	it('rejects a waiting run, and refuses a review when there is no run', async () => {
		const { c, store } = controller();
		vi.mocked(deploys.serverDeployView).mockResolvedValueOnce({} as never);
		await expect(
			c.review(req, 'acme', 'shop', 'staging', { pin: '135790', runId: 5, approve: true }),
		).rejects.toThrow('not waiting');
		vi.mocked(deploys.serverDeployView).mockResolvedValueOnce({ run: { id: 5, waiting: [9] } } as never);
		await c.review(req, 'acme', 'shop', 'staging', { pin: '135790', runId: 5, approve: false });
		expect(store.audit).toHaveBeenLastCalledWith('acme', 'server-deploy-rejected', 'shop · Staging · run 5');
	});

	it('keeps the waiting values after a failed run, and ignores a run older than the request', async () => {
		const { c, projects, rotation } = controller();
		const requestedAt = new Date().toISOString();
		projects.setRotation('acme', 'shop', 'staging', { ...emptyRotation(), pending: ['redis'], requestedAt });
		vi.mocked(deploys.serverDeployView).mockResolvedValueOnce({
			run: { status: 'completed', conclusion: 'success', createdAt: '2020-01-01T00:00:00Z' },
		} as never);
		await c.view('acme', 'shop', 'staging');
		expect(rotation().requestedAt).toBe(requestedAt);
		vi.mocked(deploys.serverDeployView).mockResolvedValueOnce({
			run: { status: 'completed', conclusion: 'failure', createdAt: new Date().toISOString() },
		} as never);
		await c.view('acme', 'shop', 'staging');
		expect(rotation()).toMatchObject({ pending: ['redis'], requestedAt: null });
	});
});
