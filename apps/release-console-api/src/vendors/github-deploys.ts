import {
	DEPLOY_SECRETS,
	DEPLOY_VARIABLES,
	DEPLOY_WORKFLOW,
	type DeployJob,
	type DeployRun,
	SERVER_TARGETS,
	type ServerDeployView,
	type ServerTarget,
} from '@saha-textile/release-console-contracts';

import { VendorError, arr, getJson, num, rec, sendJson, str } from './http.js';

const API = 'https://api.github.com';
const GH = { 'x-github-api-version': '2022-11-28' };

/** The HTTP calls this file makes, so tests can stand in for GitHub. */
export interface GithubHttp {
	get: typeof getJson;
	send: typeof sendJson;
}
const live: GithubHttp = { get: getJson, send: sendJson };

const nul = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const step = (s: unknown) => {
	const r = rec(s);
	return {
		name: str(r['name']),
		status: str(r['status']),
		conclusion: nul(r['conclusion']),
		startedAt: nul(r['started_at']),
		completedAt: nul(r['completed_at']),
	};
};
export const toJob = (j: unknown): DeployJob => ({ ...step(j), steps: arr(rec(j)['steps']).map(step) });

const failed = (what: string, status: number) => {
	if (status === 401)
		return new VendorError('GitHub refused the key (401). Check it on the Connections screen.', 401);
	if (status === 403)
		return new VendorError(
			`The GitHub key may not ${what} (403). It needs Actions, Environments and Deployments.`,
			403,
		);
	return new VendorError(`GitHub answered ${status} when asked to ${what}.`, status);
};

/** Names in a list answer, or `null` when the key may not list them. */
async function names(http: GithubHttp, url: string, key: string, field: string): Promise<string[] | null> {
	const a = await http.get(url, key, GH);
	if (a.status === 403 || a.status === 404) return null;
	if (a.status >= 400) throw failed('list the environment', a.status);
	return arr(rec(a.body)[field]).map((v) => str(rec(v)['name']));
}

async function exists(http: GithubHttp, url: string, key: string): Promise<boolean> {
	const a = await http.get(url, key, GH);
	if (a.status === 404) return false;
	if (a.status >= 400) throw failed('read the repository', a.status);
	return true;
}

/** The newest deploy.yml runs for one target, by their run name (`Deploy <target> · <branch>`). */
async function runsOf(http: GithubHttp, repository: string, target: ServerTarget, key: string) {
	const a = await http.get(
		`${API}/repos/${repository}/actions/workflows/${DEPLOY_WORKFLOW}/runs?per_page=30`,
		key,
		GH,
	);
	if (a.status === 404) return [];
	if (a.status >= 400) throw failed('list deploy runs', a.status);
	return arr(rec(a.body)['workflow_runs'])
		.map(rec)
		.filter((r) => str(r['display_title']).startsWith(`Deploy ${target} `))
		.slice(0, 10);
}

/**
 * Everything Ship › Live deploy shows for a server environment: whether its GitHub environment is
 * set up for deploy.yml, the newest run with its jobs and steps, and the runs before it.
 */
export async function serverDeployView(
	repository: string,
	environment: string,
	target: ServerTarget,
	key: string,
	http: GithubHttp = live,
	/** The environment's own branch (owner, 20 Nov); the target's when it names none. */
	chosen?: string,
): Promise<ServerDeployView> {
	const branch = chosen || SERVER_TARGETS[target].branch;
	const base = `${API}/repos/${repository}`;
	const repo = rec((await http.get(base, key, GH)).body);
	const defaultBranch = str(repo['default_branch']) || 'main';
	const [environmentExists, onBranch, onDefault, variables, secrets, runs] = await Promise.all([
		exists(http, `${base}/environments/${target}`, key),
		exists(http, `${base}/contents/.github/workflows/${DEPLOY_WORKFLOW}?ref=${branch}`, key),
		exists(http, `${base}/contents/.github/workflows/${DEPLOY_WORKFLOW}?ref=${defaultBranch}`, key),
		names(http, `${base}/environments/${target}/variables?per_page=30`, key, 'variables'),
		names(http, `${base}/environments/${target}/secrets?per_page=30`, key, 'secrets'),
		runsOf(http, repository, target, key),
	]);
	const summary = (r: Record<string, unknown>) => ({
		id: num(r['id']),
		url: str(r['html_url']),
		branch: str(r['head_branch']),
		commit: str(r['head_sha']).slice(0, 7),
		status: str(r['status']),
		conclusion: nul(r['conclusion']),
		createdAt: str(r['created_at']),
	});
	let run: DeployRun | null = null;
	const newest = runs[0];
	if (newest) {
		const id = num(newest['id']);
		const jobs = arr(
			rec((await http.get(`${base}/actions/runs/${id}/jobs?per_page=100`, key, GH)).body)['jobs'],
		).map(toJob);
		let waiting: number[] = [];
		if (str(newest['status']) === 'waiting') {
			const pending = await http.get(`${base}/actions/runs/${id}/pending_deployments`, key, GH);
			waiting = arr(pending.body).map((p) => num(rec(rec(p)['environment'])['id']));
		}
		run = { ...summary(newest), waiting, jobs };
	}
	return {
		environment,
		target,
		branch,
		setup: {
			environmentExists,
			missingVariables: variables && DEPLOY_VARIABLES.filter((v) => !variables.includes(v)),
			missingSecrets: secrets && DEPLOY_SECRETS.filter((s) => !secrets.includes(s)),
			workflowOnBranch: onBranch && onDefault,
		},
		run,
		recent: runs.slice(1).map(summary),
	};
}

/**
 * Starts deploy.yml for one target on a branch: the one chosen for the run or the environment
 * (owner, 20 Nov), else the target's own (staging, main). The target's GitHub environment may only
 * allow some branches; GitHub then refuses and the console says so.
 */
export async function startServerDeploy(
	repository: string,
	target: ServerTarget,
	key: string,
	http: GithubHttp = live,
	chosen?: string,
	allowBlank: readonly string[] = [],
): Promise<void> {
	const branch = chosen || SERVER_TARGETS[target].branch;
	const a = await http.send(
		'POST',
		`${API}/repos/${repository}/actions/workflows/${DEPLOY_WORKFLOW}/dispatches`,
		key,
		{ ref: branch, inputs: { environment: target, allow_blank: [...new Set(allowBlank)].join(',') } },
		GH,
	);
	if (a.status === 404)
		throw new VendorError(`deploy.yml is not on ${branch} and the default branch yet; merge it there first.`, 409);
	if (a.status === 422)
		throw new VendorError(
			`GitHub would not start deploy.yml on ${branch}: the ${target} environment's rules may not allow that branch.`,
			409,
		);
	if (a.status !== 204) throw failed('start the deploy', a.status);
}

/** Approves or rejects a run that waits for the owner on its GitHub environment. */
export async function reviewServerDeploy(
	repository: string,
	runId: number,
	environmentIds: number[],
	approve: boolean,
	key: string,
	http: GithubHttp = live,
): Promise<void> {
	const a = await http.send(
		'POST',
		`${API}/repos/${repository}/actions/runs/${runId}/pending_deployments`,
		key,
		{
			environment_ids: environmentIds,
			state: approve ? 'approved' : 'rejected',
			comment: approve ? 'Approved in the Release Console with the PIN.' : 'Rejected in the Release Console.',
		},
		GH,
	);
	if (a.status >= 400) throw failed(approve ? 'approve the deploy' : 'reject the deploy', a.status);
}
