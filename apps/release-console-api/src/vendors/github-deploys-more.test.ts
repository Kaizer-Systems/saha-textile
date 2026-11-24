import { afterEach, describe, expect, it, vi } from 'vitest';

import { type GithubHttp, reviewServerDeploy, serverDeployView, startServerDeploy } from './github-deploys.js';

const REPO = 'example/shop';
type Route = [RegExp, number, unknown];
/** GitHub answers locally by address; the first route whose pattern matches wins. */
function http(routes: Route[], log: (url: string) => Promise<string | null> = async () => null) {
	const get = vi.fn(async (url: string) => {
		const hit = routes.find(([re]) => re.test(url));
		return { status: hit?.[1] ?? 404, headers: new Headers(), body: hit?.[2] ?? null };
	});
	const send = vi.fn(async () => ({ status: 204, headers: new Headers(), body: null }));
	return { get, send, log: vi.fn(log) } as unknown as GithubHttp & {
		send: ReturnType<typeof vi.fn>;
		log: ReturnType<typeof vi.fn>;
	};
}
const run = (id: number, status: string, conclusion: string | null) => ({
	id,
	status,
	conclusion,
	display_title: 'Deploy staging · dev',
	head_sha: 'abcdef1234',
	created_at: '2026-11-24T00:00:00Z',
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('a server deploy as GitHub sees it', () => {
	it('words each refusal, and reads what is missing', async () => {
		const refused = (status: number) =>
			http([
				[/environments\/staging\/variables/, status, {}],
				[/./, 200, {}],
			]);
		await expect(serverDeployView(REPO, 'staging', 'staging', 'k', refused(500))).rejects.toThrow(
			'GitHub answered 500 when asked to list the environment.',
		);
		await expect(
			serverDeployView(
				REPO,
				'staging',
				'staging',
				'k',
				http([
					[/environments\/staging$/, 401, {}],
					[/./, 200, {}],
				]),
			),
		).rejects.toThrow('GitHub refused the key (401)');
		await expect(
			serverDeployView(
				REPO,
				'staging',
				'staging',
				'k',
				http([
					[/environments\/staging$/, 403, {}],
					[/./, 200, {}],
				]),
			),
		).rejects.toThrow('may not read the repository (403)');
		await expect(
			serverDeployView(
				REPO,
				'staging',
				'staging',
				'k',
				http([
					[/workflows\/deploy\.yml\/runs/, 500, {}],
					[/./, 200, {}],
				]),
			),
		).rejects.toThrow('list deploy runs');
		const view = await serverDeployView(
			REPO,
			'staging',
			'staging',
			'k',
			http([
				[/environments\/staging\/secrets/, 200, { secrets: [{ name: 'CF_ACCESS_CLIENT_ID' }] }],
				[/workflows\/deploy\.yml\/runs/, 404, {}],
				[/tags/, 500, {}],
				[/contents/, 404, {}],
				[/./, 200, {}],
			]),
		);
		expect(view.setup.missingSecrets).toContain('CF_ACCESS_CLIENT_SECRET');
		expect(view.setup.workflowOnBranch).toBe(false);
		expect(view.tags).toEqual([]);
		expect(view.run).toBeNull();
	});

	it('follows the newest run, its waiting approval and why it failed', async () => {
		const failing = http(
			[
				[/runs\/7\/jobs/, 200, { jobs: [{ id: 70, conclusion: 'failure', steps: [] }] }],
				[/runs\/7\/pending_deployments/, 200, [{ environment: { id: 3 } }]],
				[
					/workflows\/deploy\.yml\/runs/,
					200,
					{ workflow_runs: [run(7, 'completed', 'failure'), run(6, 'completed', 'success')] },
				],
				[
					/tags/,
					200,
					[
						{ name: 'staging-20261123-142210-08ac015c', commit: { sha: 'abc' } },
						{ name: 'production-20261123-142210-08ac015c' },
						{ name: 'v1' },
						{ name: 'staging-20261124-142210-08ac015c' },
					],
				],
				[/./, 200, {}],
			],
			async () => 'Run deploy\nError: something broke',
		);
		const view = await serverDeployView(REPO, 'staging', 'staging', 'k', failing);
		expect(view.run?.id).toBe(7);
		expect(view.failure).not.toBeUndefined();
		expect(view.tags.map((t) => t.name)).toEqual([
			'staging-20261124-142210-08ac015c',
			'staging-20261123-142210-08ac015c',
		]);
		expect(view.recent).toHaveLength(1);
		const waiting = http([
			[/runs\/8\/pending_deployments/, 200, [{ environment: { id: 3 } }]],
			[/runs\/8\/jobs/, 200, { jobs: [] }],
			[/workflows\/deploy\.yml\/runs/, 200, { workflow_runs: [run(8, 'waiting', null)] }],
			[/./, 200, {}],
		]);
		expect((await serverDeployView(REPO, 'staging', 'staging', 'k', waiting)).run?.waiting).toEqual([3]);
		const quiet = http([
			[/runs\/9\/jobs/, 200, { jobs: [{ id: 90, conclusion: 'success' }] }],
			[/workflows\/deploy\.yml\/runs/, 200, { workflow_runs: [run(9, 'completed', 'failure')] }],
			[/./, 200, {}],
		]);
		expect((await serverDeployView(REPO, 'staging', 'staging', 'k', quiet)).failure).toBeNull();
	});

	it('reads a failed job’s log over https, and nothing when GitHub will not give it', async () => {
		const fetchStub = vi.fn(async (url: string) => {
			if (url.endsWith('/logs')) return new Response('Error: broke', { status: 200 });
			if (url.includes('/actions/runs/5/jobs'))
				return Response.json({ jobs: [{ id: 50, conclusion: 'failure' }] });
			if (url.includes('workflows/deploy.yml/runs'))
				return Response.json({ workflow_runs: [run(5, 'completed', 'failure')] });
			return Response.json({});
		});
		vi.stubGlobal('fetch', fetchStub);
		expect((await serverDeployView(REPO, 'staging', 'staging', 'k')).run?.id).toBe(5);
		fetchStub.mockImplementation(async (url: string) => {
			if (url.endsWith('/logs')) throw new Error('offline');
			if (url.includes('/actions/runs/5/jobs'))
				return Response.json({ jobs: [{ id: 50, conclusion: 'failure' }] });
			if (url.includes('workflows/deploy.yml/runs'))
				return Response.json({ workflow_runs: [run(5, 'completed', 'failure')] });
			return Response.json({});
		});
		expect((await serverDeployView(REPO, 'staging', 'staging', 'k')).failure).toBeNull();
	});
});

describe('starting a server deploy', () => {
	const sending = (status: number, message = '') => {
		const h = http([]);
		h.send.mockResolvedValue({ status, headers: new Headers(), body: { message } });
		return h;
	};

	it('sends only the inputs this start needs', async () => {
		const h = sending(204);
		await startServerDeploy(REPO, 'staging', 'k', h, undefined, [], { rotate: true, restartDatabase: true });
		await startServerDeploy(REPO, 'staging', 'k', h, undefined, [], { action: 'rollback' });
		const inputs = h.send.mock.calls.map((call) => (call[3] as { inputs: Record<string, string> }).inputs);
		expect(inputs[0]).toMatchObject({ rotate: 'true', restart_database: 'true' });
		expect(inputs[1]).toMatchObject({ action: 'rollback' });
	});

	it('says why GitHub would not start it', async () => {
		await expect(
			startServerDeploy(REPO, 'staging', 'k', sending(422, 'Unexpected inputs provided'), undefined, [], {
				rotate: true,
			}),
		).rejects.toThrow('does not take rotation yet');
		await expect(
			startServerDeploy(REPO, 'staging', 'k', sending(422, 'Unexpected inputs provided'), undefined, [], {
				action: 'rollback',
			}),
		).rejects.toThrow('does not take a rollback yet');
		await expect(
			startServerDeploy(REPO, 'staging', 'k', sending(422, 'No ref'), undefined, [], {
				tag: 'staging-20261123-142210-08ac015c',
			}),
		).rejects.toThrow('may not allow its tags yet');
		await expect(startServerDeploy(REPO, 'staging', 'k', sending(422, 'No ref'))).rejects.toThrow(
			'may not allow that branch',
		);
		await expect(startServerDeploy(REPO, 'staging', 'k', sending(500))).rejects.toThrow(
			'when asked to start the deploy',
		);
	});

	it('rejects a waiting deploy, and words a refused review', async () => {
		const ok = sending(200);
		await reviewServerDeploy(REPO, 8, [3], false, 'k', ok);
		expect(ok.send.mock.calls[0]?.[3]).toMatchObject({ state: 'rejected' });
		await expect(reviewServerDeploy(REPO, 8, [3], false, 'k', sending(500))).rejects.toThrow('reject the deploy');
		await expect(reviewServerDeploy(REPO, 8, [3], true, 'k', sending(500))).rejects.toThrow('approve the deploy');
	});
});
