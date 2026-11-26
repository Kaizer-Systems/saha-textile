/**
 * Ship › Code › Coverage on GitHub (brief CRmpBdP3ce62g1JoCAhh23): the CI runs that kept their coverage
 * reports, one run's reports, the file list of the commit it measured, a file's text at that commit and
 * the lines a commit or a branch changed. Reads only; the repository's own GitHub key.
 */
import { type CoverageRuns, changedLines } from '@saha-textile/release-console-contracts';

import { type JsonAnswer, VendorError, arr, getJson, num, rec, str } from '../vendors/http.js';
import { unzip } from './zip.js';

const API = 'https://api.github.com';
const VERSION = { 'x-github-api-version': '2022-11-28' };
/** The artifact name the CI coverage job keeps its reports under. */
export const COVERAGE_ARTIFACT = 'coverage';

/** GitHub as the coverage screen uses it; tests pass a stand-in. */
export interface CoverageHttp {
	json(url: string, key: string): Promise<JsonAnswer>;
	/** Raw bytes, following GitHub's redirect to its storage (which gets no key). */
	bytes(url: string, key: string): Promise<{ status: number; body: Buffer | null }>;
	/** A file's raw text. */
	text(url: string, key: string): Promise<{ status: number; body: string | null }>;
}

async function raw(url: string, key: string, accept: string, timeout: number) {
	return fetch(url, {
		headers: { authorization: `Bearer ${key}`, accept, 'user-agent': 'release-console', ...VERSION },
		redirect: 'follow',
		signal: AbortSignal.timeout(timeout),
	});
}
export const coverageHttp: CoverageHttp = {
	json: (url, key) => getJson(url, key, VERSION),
	async bytes(url, key) {
		const res = await raw(url, key, 'application/vnd.github+json', 120_000);
		return { status: res.status, body: res.ok ? Buffer.from(await res.arrayBuffer()) : null };
	},
	async text(url, key) {
		const res = await raw(url, key, 'application/vnd.github.raw+json', 20_000);
		return { status: res.status, body: res.ok ? await res.text() : null };
	},
};

/** A GitHub refusal in words; never the key. */
function refused(status: number, what: string): VendorError {
	if (status === 401)
		return new VendorError(
			'GitHub did not accept this repository’s key. Paste a new one on the Connections screen.',
			401,
		);
	if (status === 403 || status === 404)
		return new VendorError(
			`GitHub would not show ${what}. The key needs Actions and Contents read access to this repository.`,
			status,
		);
	return new VendorError(`GitHub could not show ${what} (status ${status}).`, status);
}
async function json(http: CoverageHttp, url: string, key: string, what: string): Promise<Record<string, unknown>> {
	const a = await http.json(url, key);
	if (a.status !== 200) throw refused(a.status, what);
	return rec(a.body);
}
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/**
 * Recent runs of the workflows that keep coverage reports: each with its state, newest first. A workflow
 * counts once any of its recent runs kept a report, so a run still going, or one whose reports were not
 * kept, shows too.
 */
export async function ciRuns(
	http: CoverageHttp,
	repo: string,
	key: string,
): Promise<Pick<CoverageRuns, 'ci' | 'ciMessage'>> {
	const kept = arr(
		(
			await json(
				http,
				`${API}/repos/${repo}/actions/artifacts?name=${COVERAGE_ARTIFACT}&per_page=50`,
				key,
				'the coverage reports',
			)
		)['artifacts'],
	).map(rec);
	const live = new Set(kept.filter((a) => a['expired'] !== true).map((a) => num(rec(a['workflow_run'])['id'])));
	const runs = arr(
		(await json(http, `${API}/repos/${repo}/actions/runs?per_page=40`, key, 'the workflow runs'))['workflow_runs'],
	).map(rec);
	const workflows = new Set(runs.filter((r) => live.has(num(r['id']))).map((r) => num(r['workflow_id'])));
	const ci = runs
		.filter((r) => workflows.has(num(r['workflow_id'])))
		.map((r) => {
			const done = str(r['status']) === 'completed';
			return {
				id: String(num(r['id'])),
				sha: str(r['head_sha']),
				ref: str(r['head_branch']),
				title: str(r['display_title']) || str(r['name']),
				finishedAt: done ? str(r['updated_at']) || null : null,
				state: !done
					? ('running' as const)
					: !live.has(num(r['id']))
						? ('no-reports' as const)
						: str(r['conclusion']) === 'success'
							? ('passed' as const)
							: ('failed' as const),
				url: str(r['html_url']),
			};
		});
	return {
		ci,
		ciMessage: ci.length
			? null
			: 'No CI run has kept coverage reports yet. Runs keep them from the commit that adds the upload step to the coverage job.',
	};
}

/** One run's reports by file name (meta.json, <workspace>/coverage-final.json, <workspace>/tests.json). */
export async function ciReports(
	http: CoverageHttp,
	repo: string,
	key: string,
	runId: string,
): Promise<Map<string, Buffer>> {
	const list = arr(
		(
			await json(
				http,
				`${API}/repos/${repo}/actions/runs/${encodeURIComponent(runId)}/artifacts?name=${COVERAGE_ARTIFACT}`,
				key,
				'this run’s reports',
			)
		)['artifacts'],
	).map(rec);
	const artifact = list.find((a) => a['expired'] !== true);
	if (!artifact)
		throw new VendorError(
			list.length
				? 'This run’s coverage reports have expired (GitHub keeps them 90 days).'
				: 'This run kept no coverage reports.',
			404,
		);
	const zip = await http.bytes(`${API}/repos/${repo}/actions/artifacts/${num(artifact['id'])}/zip`, key);
	if (!zip.body) throw refused(zip.status, 'this run’s reports');
	return unzip(zip.body, (name) => /(^|\/)(meta|coverage-final|tests)\.json$/.test(name));
}

/** Every file in the commit, as GitHub lists its tree. */
export async function committedFiles(
	http: CoverageHttp,
	repo: string,
	key: string,
	sha: string,
): Promise<{ files: string[]; truncated: boolean }> {
	const tree = await json(
		http,
		`${API}/repos/${repo}/git/trees/${encodeURIComponent(sha)}?recursive=1`,
		key,
		'the commit’s files',
	);
	return {
		files: arr(tree['tree'])
			.map(rec)
			.filter((e) => e['type'] === 'blob')
			.map((e) => str(e['path'])),
		truncated: tree['truncated'] === true,
	};
}

/** A file's text at a commit; null when the commit has no such file. */
export async function fileAt(
	http: CoverageHttp,
	repo: string,
	key: string,
	sha: string,
	path: string,
): Promise<string | null> {
	const a = await http.text(`${API}/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(sha)}`, key);
	if (a.status === 404) return null;
	if (a.body === null) throw refused(a.status, 'this file');
	return a.body;
}

/**
 * The lines a change added or changed, per file: `base` 'commit' is the commit itself, any other value a
 * branch the commit is compared with (what a pull request into it would change). Files GitHub shows no
 * patch for (too large, or not text) are left out.
 */
export async function changedOnGithub(
	http: CoverageHttp,
	repo: string,
	key: string,
	sha: string,
	base: string,
): Promise<Map<string, number[]>> {
	const body =
		base === 'commit'
			? await json(http, `${API}/repos/${repo}/commits/${encodeURIComponent(sha)}`, key, 'the commit’s changes')
			: await json(
					http,
					`${API}/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(sha)}`,
					key,
					'the changes',
				);
	const out = new Map<string, number[]>();
	for (const f of arr(body['files']).map(rec)) {
		const patch = str(f['patch']);
		if (patch) out.set(str(f['filename']), changedLines(patch));
	}
	return out;
}
