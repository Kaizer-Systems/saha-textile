import type { PullRequest, WorkflowRun } from '@saha-textile/release-console-contracts';

type SecurityAlert = {
	kind: 'dependency' | 'code';
	name: string;
	where: string;
	severity: string;
	fixedIn: string;
	url: string;
};

import { VendorError, arr, getJson, num, rec, str } from './http.js';

const API = 'https://api.github.com';
const GH = { 'x-github-api-version': '2022-11-28' };

/** The source-code slot's shape. GitHub fills it today; GitLab or Bitbucket adapters fill it later. */
export interface SourceCodeAdapter {
	pulls(repository: string, key: string): Promise<PullRequest[]>;
	runs(repository: string, key: string): Promise<WorkflowRun[]>;
	/** A file on a branch (the default branch when `ref` is left out), or `null` when it has none. */
	file(repository: string, path: string, key: string, ref?: string): Promise<string | null>;
	/** Commits and changed files in `head` that `base` lacks; null when GitHub has no such branch. */
	compare(
		repository: string,
		key: string,
		base: string,
		head: string,
	): Promise<{
		aheadBy: number;
		commits: { sha: string; message: string; author: string; date: string }[];
		files: string[];
		url: string;
	} | null>;
	/** Open Dependabot and code-scanning alerts; a list GitHub refuses comes back as a note. */
	security(repository: string, key: string): Promise<{ alerts: SecurityAlert[]; notes: string[] }>;
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
	async compare(repository, key, base, head) {
		const a = await getJson(
			`${API}/repos/${repository}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=100`,
			key,
			GH,
		);
		if (a.status === 404) return null;
		if (a.status >= 400) throw new VendorError(`GitHub answered ${a.status}.`, a.status);
		const r = rec(a.body);
		return {
			aheadBy: num(r['ahead_by']),
			commits: arr(r['commits'])
				.map(rec)
				.reverse()
				.slice(0, 30)
				.map((c) => ({
					sha: str(c['sha']).slice(0, 8),
					message: str(rec(c['commit'])['message']).split('\n')[0] ?? '',
					author: str(rec(rec(c['commit'])['author'])['name']),
					date: str(rec(rec(c['commit'])['author'])['date']),
				})),
			files: arr(r['files']).map((f) => str(rec(f)['filename'])),
			url: str(r['html_url']),
		};
	},
	async security(repository, key) {
		const notes: string[] = [];
		const list = async (path: string, what: string): Promise<unknown[]> => {
			const a = await getJson(`${API}/repos/${repository}/${path}`, key, GH);
			if (a.status === 403 || a.status === 404) {
				notes.push(
					`${what}: GitHub answered ${a.status}. Turn it on in the repository's settings and give the token “${what}: read”.`,
				);
				return [];
			}
			if (a.status >= 400) throw new VendorError(`GitHub answered ${a.status}.`, a.status);
			return arr(a.body);
		};
		const deps = (await list('dependabot/alerts?state=open&per_page=100', 'Dependabot alerts')).map((x) => {
			const r = rec(x);
			const adv = rec(r['security_advisory']);
			const vuln = rec(r['security_vulnerability']);
			return {
				kind: 'dependency' as const,
				name: str(rec(rec(r['dependency'])['package'])['name']),
				where: str(rec(r['dependency'])['manifest_path']),
				severity: str(adv['severity']),
				fixedIn: str(rec(vuln['first_patched_version'])['identifier']),
				url: str(r['html_url']),
			};
		});
		const code = (await list('code-scanning/alerts?state=open&per_page=100', 'Code scanning alerts')).map((x) => {
			const r = rec(x);
			const rule = rec(r['rule']);
			return {
				kind: 'code' as const,
				name: str(rule['description']) || str(rule['id']),
				where: str(rec(rec(r['most_recent_instance'])['location'])['path']),
				severity: str(rule['security_severity_level']) || str(rule['severity']),
				fixedIn: '',
				url: str(r['html_url']),
			};
		});
		return { alerts: [...deps, ...code], notes };
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
