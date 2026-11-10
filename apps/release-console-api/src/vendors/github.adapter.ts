import type { PullRequest, WorkflowRun } from '@saha-textile/release-console-contracts';

import { VendorError, arr, getJson, num, rec, str } from './http.js';

const API = 'https://api.github.com';
const GH = { 'x-github-api-version': '2022-11-28' };

/** The source-code slot's shape. GitHub fills it today; GitLab or Bitbucket adapters fill it later. */
export interface SourceCodeAdapter {
	pulls(repository: string, key: string): Promise<PullRequest[]>;
	runs(repository: string, key: string): Promise<WorkflowRun[]>;
}

export function toPull(p: unknown): PullRequest {
	const r = rec(p);
	return {
		number: num(r['number']),
		title: str(r['title']),
		author: str(rec(r['user'])['login']),
		branch: str(rec(r['head'])['ref']),
		base: str(rec(r['base'])['ref']),
		draft: r['draft'] === true,
		updatedAt: str(r['updated_at']),
		url: str(r['html_url']),
	};
}

export function toRun(w: unknown): WorkflowRun {
	const r = rec(w);
	return {
		id: num(r['id']),
		name: str(r['name']) || str(r['display_title']),
		branch: str(r['head_branch']),
		event: str(r['event']),
		status: str(r['status']),
		conclusion: typeof r['conclusion'] === 'string' ? r['conclusion'] : null,
		createdAt: str(r['created_at']),
		updatedAt: str(r['updated_at']),
		url: str(r['html_url']),
	};
}

async function read(url: string, key: string): Promise<unknown> {
	const a = await getJson(url, key, GH);
	if (a.status === 401)
		throw new VendorError('GitHub refused the key (401). Check it on the Connections screen.', 401);
	if (a.status === 404) throw new VendorError('GitHub does not show this repository to the key (404).', 404);
	if (a.status >= 400) throw new VendorError(`GitHub answered ${a.status}.`, a.status);
	return a.body;
}

export const githubAdapter: SourceCodeAdapter = {
	async pulls(repository, key) {
		return arr(await read(`${API}/repos/${repository}/pulls?state=open&per_page=50`, key)).map(toPull);
	},
	async runs(repository, key) {
		return arr(rec(await read(`${API}/repos/${repository}/actions/runs?per_page=30`, key))['workflow_runs']).map(
			toRun,
		);
	},
};
