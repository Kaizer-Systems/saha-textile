import { describe, expect, it, vi } from 'vitest';

import { type GithubHttp, reviewServerDeploy, serverDeployView, startServerDeploy } from './github-deploys.js';

const REPO = 'Kaizer-Systems/saha-textile';
const answer = (status: number, body: unknown = null) => ({ status, headers: new Headers(), body });

/** A stand-in for GitHub: answers each URL from `routes` by the longest matching ending. */
function github(routes: Record<string, { status: number; body?: unknown }>) {
	const get = vi.fn(async (url: string) => {
		const hit = Object.keys(routes)
			.filter((k) => url.endsWith(k) || url.includes(`${k}?`))
			.sort((a, b) => b.length - a.length)[0];
		return hit ? answer(routes[hit]!.status, routes[hit]!.body) : answer(404);
	});
	const send = vi.fn(async (..._args: unknown[]) => answer(204));
	return { http: { get, send } as unknown as GithubHttp, get, send };
}

const run = (id: number, status: string, title = 'Deploy staging · staging') => ({
	id,
	html_url: `https://github.com/${REPO}/actions/runs/${id}`,
	head_branch: 'staging',
	head_sha: 'abcdef1234567',
	status,
	conclusion: status === 'completed' ? 'success' : null,
	created_at: '2026-11-20T10:00:00Z',
	display_title: title,
});

describe('server deploys on GitHub', () => {
	it('reports what the GitHub environment still lacks, and the newest run with its jobs', async () => {
		const { http } = github({
			[`/repos/${REPO}`]: { status: 200, body: { default_branch: 'dev' } },
			'/environments/staging': { status: 200, body: {} },
			'/contents/.github/workflows/deploy.yml': { status: 200, body: {} },
			'/environments/staging/variables': {
				status: 200,
				body: { variables: [{ name: 'INFISICAL_IDENTITY_ID' }] },
			},
			'/environments/staging/secrets': { status: 403 },
			'/actions/workflows/deploy.yml/runs': {
				status: 200,
				body: {
					workflow_runs: [
						run(2, 'waiting'),
						run(9, 'completed', 'Deploy production · main'),
						run(1, 'completed'),
					],
				},
			},
			'/actions/runs/2/jobs': {
				status: 200,
				body: { jobs: [{ name: 'Deploy to staging', status: 'waiting', conclusion: null, steps: [] }] },
			},
			'/actions/runs/2/pending_deployments': {
				status: 200,
				body: [{ environment: { id: 77, name: 'staging' } }],
			},
		});
		const view = await serverDeployView(REPO, 'staging', 'staging', 'k', http);
		expect(view.branch).toBe('staging');
		expect(view.setup).toEqual({
			environmentExists: true,
			missingVariables: ['SERVER_SSH_HOST', 'SERVER_SSH_KNOWN_HOSTS', 'API_HOST'],
			missingSecrets: null,
			workflowOnBranch: true,
		});
		expect(view.run).toMatchObject({ id: 2, waiting: [77], commit: 'abcdef1' });
		expect(view.run?.jobs[0]?.name).toBe('Deploy to staging');
		expect(view.recent.map((r) => r.id)).toEqual([1]);
	});

	it('starts deploy.yml on the branch the environment allows', async () => {
		const { http, send } = github({});
		await startServerDeploy(REPO, 'production', 'k', http);
		expect(send).toHaveBeenCalledWith(
			'POST',
			`https://api.github.com/repos/${REPO}/actions/workflows/deploy.yml/dispatches`,
			'k',
			{ ref: 'main', inputs: { environment: 'production' } },
			expect.any(Object),
		);
	});

	it('says to merge deploy.yml first when GitHub does not know it on that branch', async () => {
		const { http, send } = github({});
		send.mockResolvedValueOnce(answer(404));
		await expect(startServerDeploy(REPO, 'staging', 'k', http)).rejects.toThrow(/merge it there first/);
	});

	it('approves the waiting environment', async () => {
		const { http, send } = github({});
		send.mockResolvedValueOnce(answer(200));
		await reviewServerDeploy(REPO, 2, [77], true, 'k', http);
		expect(send.mock.calls[0]?.[3]).toMatchObject({ environment_ids: [77], state: 'approved' });
	});
});
