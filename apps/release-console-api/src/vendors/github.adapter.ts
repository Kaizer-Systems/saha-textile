import type { PullRequest, WorkflowRun } from '@saha-textile/release-console-contracts';

import { VendorError, arr, getJson, num, rec, str } from './http.js';

const API = 'https://api.github.com';
const GH = { 'x-github-api-version': '2022-11-28' };

/** The source-code slot's shape. GitHub fills it today; GitLab or Bitbucket adapters fill it later. */
export interface SourceCodeAdapter {
	pulls(repository: string, key: string): Promise<PullRequest[]>;
	runs(repository: string, key: string): Promise<WorkflowRun[]>;
	/** A file on a branch (the default branch when `ref` is left out), or `null` when it has none. */
	file(repository: string, path: string, key: string, ref?: string): Promise<string | null>;
	/** The repository's default branch and every branch name (up to 300). */
	branches(repository: string, key: string): Promise<{ defaultBranch: string | null; names: string[] }>;
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
	async file(repository, path, key, ref) {
		const at = ref ? `?ref=${encodeURIComponent(ref)}` : '';
		const a = await getJson(`${API}/repos/${repository}/contents/${path}${at}`, key, GH);
		if (a.status === 404) return null;
		if (a.status >= 400) throw new VendorError(`GitHub answered ${a.status}.`, a.status);
		const body = rec(a.body);
		return body['encoding'] === 'base64' ? Buffer.from(str(body['content']), 'base64').toString('utf8') : null;
	},
	async branches(repository, key) {
		const info = await getJson(`${API}/repos/${repository}`, key, GH);
		if (info.status >= 400) throw new VendorError(`GitHub answered ${info.status} for ${repository}.`, info.status);
		const names: string[] = [];
		for (let page = 1; page <= 3; page += 1) {
			const a = await getJson(`${API}/repos/${repository}/branches?per_page=100&page=${page}`, key, GH);
			if (a.status >= 400) throw new VendorError(`GitHub answered ${a.status}.`, a.status);
			const batch = arr(a.body).map((b) => str(rec(b)['name']));
			names.push(...batch.filter(Boolean));
			if (batch.length < 100) break;
		}
		return { defaultBranch: str(rec(info.body)['default_branch']) || null, names };
	},
	async runs(repository, key) {
		return arr(rec(await read(`${API}/repos/${repository}/actions/runs?per_page=30`, key))['workflow_runs']).map(
			toRun,
		);
	},
};
