import type {
	CheckCounts,
	CheckStatus,
	PullCheck,
	PullCommits,
	PullEvent,
	PullFile,
	PullPage,
	PullRow,
	ReviewState,
} from '@saha-textile/release-console-contracts';

import { fileStatus } from './diff-text.js';
import { type JsonAnswer, VendorError, arr, getJson, num, rec, sendJson, str } from '../vendors/http.js';

type Rec = Record<string, unknown>;

const API = 'https://api.github.com';
const VERSION = { 'x-github-api-version': '2022-11-28' };
/** Bodies as GitHub draws them (`body_html`) beside the Markdown (`body`). */
const FULL = { ...VERSION, accept: 'application/vnd.github.full+json' };
/** GitHub lists at most this many of a pull request's (or a commit's) changed files. */
export const GITHUB_FILE_LIMIT = 3_000;
const PAGE = 100;
/** The conversation reads this many pages of 100 at most: the first, and the newest after it. */
const TIMELINE_PAGES = 10;

/** A REST read; a refusal throws with words the screen can show (never the key). */
export async function gh(url: string, key: string, extra: Record<string, string> = VERSION): Promise<JsonAnswer> {
	const a = await getJson(url, key, extra);
	if (a.status === 401)
		throw new VendorError('GitHub refused the key (401). Check it on the Connections screen.', 401);
	if (a.status === 404) throw new VendorError('GitHub shows no such pull request or commit to this key (404).', 404);
	if (a.status >= 400) throw new VendorError(`GitHub answered ${a.status}.`, a.status);
	return a;
}

/** A GraphQL query or change; GitHub's own error message comes back when it refuses. */
export async function graphql(key: string, query: string, variables: Rec): Promise<Rec> {
	const a = await sendJson('POST', `${API}/graphql`, key, { query, variables });
	const body = rec(a.body);
	if (a.status >= 400 || body['errors']) {
		const said = str(rec(arr(body['errors'])[0])['message']);
		throw new VendorError(`GitHub refused the request: ${said || `it answered ${a.status}`}.`, a.status);
	}
	return rec(body['data']);
}

const owner = (repository: string) => {
	const [o, name] = repository.split('/');
	return { owner: o, name };
};

/** A check run's result in the console's words; GitHub's REST answers in lower case, GraphQL in upper case. */
export function checkStatus(status: string, conclusion: string): CheckStatus {
	const s = status.toLowerCase();
	if (['queued', 'requested', 'waiting', 'pending'].includes(s)) return 'queued';
	if (s !== 'completed') return 'running';
	const c = conclusion.toLowerCase();
	if (c === 'success') return 'passed';
	if (c === 'skipped' || c === 'neutral' || c === 'cancelled') return c;
	return 'failed';
}

/** An old-style commit status (StatusContext) in the console's words. */
const STATUS_CONTEXT: Record<string, CheckStatus> = { SUCCESS: 'passed', PENDING: 'running', EXPECTED: 'queued' };

/** Check results counted: skipped and neutral count as passed, cancelled as failed, as GitHub's merge box does. */
export function countChecks(statuses: readonly CheckStatus[]): CheckCounts {
	const of = (...s: CheckStatus[]) => statuses.filter((x) => s.includes(x)).length;
	return {
		total: statuses.length,
		running: of('queued', 'running'),
		passed: of('passed', 'skipped', 'neutral'),
		failed: of('failed', 'cancelled'),
	};
}

const REVIEW: Record<string, ReviewState> = {
	APPROVED: 'approved',
	CHANGES_REQUESTED: 'changes',
	REVIEW_REQUIRED: 'required',
};
const review = (decision: unknown): ReviewState => REVIEW[str(decision)] ?? 'none';

/* ===== the list ===== */

const LIST = `query($owner: String!, $name: String!, $states: [PullRequestState!]) {
	repository(owner: $owner, name: $name) {
		pullRequests(states: $states, first: 30, orderBy: { field: UPDATED_AT, direction: DESC }) {
			nodes {
				number title url isDraft state updatedAt headRefName baseRefName additions deletions reviewDecision
				author { login }
				commits(last: 1) { totalCount nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
					__typename ... on CheckRun { status conclusion } ... on StatusContext { state }
				} } } } } }
			}
		}
	}
}`;

/** Open pull requests, or the newest 30 closed and merged ones, with their checks and review in one query. */
export async function pullRows(repository: string, key: string, state: 'open' | 'closed'): Promise<PullRow[]> {
	const states = state === 'open' ? ['OPEN'] : ['CLOSED', 'MERGED'];
	const data = await graphql(key, LIST, { ...owner(repository), states });
	return arr(rec(rec(data['repository'])['pullRequests'])['nodes']).map((x) => {
		const p = rec(x);
		const commits = rec(p['commits']);
		const rollup = rec(arr(commits['nodes']).map((c) => rec(rec(c)['commit'])['statusCheckRollup'])[0]);
		const contexts = arr(rec(rollup['contexts'])['nodes']).map(rec);
		return {
			number: num(p['number']),
			title: str(p['title']),
			author: str(rec(p['author'])['login']),
			branch: str(p['headRefName']),
			base: str(p['baseRefName']),
			draft: p['isDraft'] === true,
			state: str(p['state']).toLowerCase() as PullRow['state'],
			updatedAt: str(p['updatedAt']),
			url: str(p['url']),
			commits: num(commits['totalCount']),
			additions: num(p['additions']),
			deletions: num(p['deletions']),
			// No checks reported at all (rollup missing) is not the same as zero checks.
			checks:
				'contexts' in rollup
					? countChecks(
							contexts.map((c) =>
								c['__typename'] === 'StatusContext'
									? (STATUS_CONTEXT[str(c['state'])] ?? 'failed')
									: checkStatus(str(c['status']), str(c['conclusion'])),
							),
						)
					: null,
			review: review(p['reviewDecision']),
		};
	});
}

/* ===== the page ===== */

/** The number of GitHub's last page, from its Link header (1 when there is only one). */
export const lastPage = (link: string | null): number =>
	Number(/[?&]page=(\d+)>; rel="last"/.exec(String(link))?.[1] ?? 1);

/** The conversation's items: every page up to ten, past that the first page and the newest nine. */
async function timeline(base: string, key: string, n: number): Promise<{ items: Rec[]; skipped: number }> {
	const url = (page: number) => `${base}/issues/${n}/timeline?per_page=${PAGE}&page=${page}`;
	const first = await gh(url(1), key, FULL);
	const last = lastPage(first.headers.get('link'));
	const from = last <= TIMELINE_PAGES ? 2 : last - TIMELINE_PAGES + 2;
	const rest = await Promise.all(Array.from({ length: last - from + 1 }, (_, i) => gh(url(from + i), key, FULL)));
	return { items: [first, ...rest].flatMap((a) => arr(a.body).map(rec)), skipped: (from - 2) * PAGE };
}

const login = (r: unknown) => str(rec(r)['login']);
const event = (e: Partial<PullEvent> & Pick<PullEvent, 'kind' | 'at' | 'text'>): PullEvent => ({
	who: '',
	html: '',
	tone: null,
	sha: '',
	checkId: null,
	url: '',
	...e,
});

const REVIEWED: Record<string, Pick<PullEvent, 'text' | 'tone'>> = {
	approved: { text: 'approved these changes', tone: 'ok' },
	changes_requested: { text: 'asked for changes', tone: 'red' },
	dismissed: { text: 'reviewed (dismissed)', tone: 'muted' },
};
const SIMPLE: Record<string, Pick<PullEvent, 'kind' | 'text' | 'tone'>> = {
	head_ref_force_pushed: { kind: 'force-pushed', text: 'force-pushed the branch', tone: 'amber' },
	closed: { kind: 'closed', text: 'closed it', tone: 'red' },
	reopened: { kind: 'reopened', text: 'reopened it', tone: 'ok' },
	ready_for_review: { kind: 'ready', text: 'marked it ready for review', tone: null },
};

/** One item of GitHub's time line as an event, or null for the ones the page leaves out (subscribed, mentioned…). */
export function eventOf(item: Rec): PullEvent | null {
	const kind = str(item['event']);
	// Comments name their writer as `actor`, reviews as `user`; reviews carry `submitted_at`.
	const who = login(item['actor']) || login(item['user']);
	const at = str(item['created_at']) || str(item['submitted_at']);
	const html = str(item['body_html']);
	const url = str(item['html_url']);
	if (kind === 'commented') return event({ kind: 'commented', who, at, text: 'commented', html, url });
	if (kind === 'reviewed')
		return event({
			kind: 'reviewed',
			who,
			at,
			...(REVIEWED[str(item['state'])] ?? { text: 'reviewed', tone: 'cy' }),
			html,
			url,
		});
	if (kind === 'labeled' || kind === 'unlabeled') {
		const verb = kind === 'labeled' ? 'added' : 'removed';
		return event({ kind, who, at, text: `${verb} the label ${str(rec(item['label'])['name'])}` });
	}
	if (kind === 'review_requested') {
		const asked = login(item['requested_reviewer']) || str(rec(item['requested_team'])['name']);
		return event({ kind: 'review-requested', who, at, text: `asked ${asked} for a review` });
	}
	if (kind === 'renamed')
		return event({ kind: 'renamed', who, at, text: `renamed it from “${str(rec(item['rename'])['from'])}”` });
	if (kind === 'merged')
		return event({ kind: 'merged', who, at, text: 'merged it', tone: 'ok', sha: str(item['commit_id']) });
	const simple = SIMPLE[kind];
	return simple ? event({ ...simple, who, at }) : null;
}

/** Commits in a row become one "pushed N commits" line, as GitHub groups them. */
export function withPushes(items: readonly Rec[], author: string): PullEvent[] {
	const out: PullEvent[] = [];
	let run: Rec[] = [];
	const flush = () => {
		if (!run.length) return;
		const first = run[0] as Rec;
		const last = run[run.length - 1] as Rec;
		const short = (c: Rec) => str(c['sha']).slice(0, 8);
		const text =
			run.length === 1
				? `pushed 1 commit ${short(first)}`
				: `pushed ${run.length} commits ${short(first)} … ${short(last)}`;
		out.push(
			event({
				kind: 'pushed',
				who: author,
				at: str(rec(last['committer'])['date']),
				text,
				sha: str(last['sha']),
			}),
		);
		run = [];
	};
	for (const item of items) {
		if (str(item['event']) === 'committed') run.push(item);
		else {
			flush();
			const e = eventOf(item);
			if (e) out.push(e);
		}
	}
	flush();
	return out;
}

/** The checks on the newest commit as conversation lines: when they started, each failure, and all passed. */
export function checkEvents(checks: readonly PullCheck[], sha: string): PullEvent[] {
	if (!checks.length) return [];
	const short = sha.slice(0, 8);
	const times = (pick: (c: PullCheck) => string | null) =>
		checks
			.map(pick)
			.filter((t): t is string => !!t)
			.sort();
	const out: PullEvent[] = [
		event({
			kind: 'checks-started',
			at: String(times((c) => c.startedAt)[0]),
			text: `${checks.length} checks started on ${short}`,
			tone: 'amber',
			sha,
		}),
	];
	for (const c of checks.filter((x) => x.status === 'failed'))
		out.push(
			event({
				kind: 'check-failed',
				at: String(c.completedAt),
				text: `${c.name} failed on ${short}`,
				tone: 'red',
				sha,
				checkId: c.id,
				url: c.url,
			}),
		);
	const counts = countChecks(checks.map((c) => c.status));
	if (!counts.running && !counts.failed)
		out.push(
			event({
				kind: 'checks-passed',
				at: String(times((c) => c.completedAt).pop()),
				text: `All ${checks.length} checks passed on ${short}`,
				tone: 'ok',
				sha,
			}),
		);
	return out;
}

/** A check run as the page lists it. */
export function checkOf(x: unknown): PullCheck {
	const c = rec(x);
	return {
		id: num(c['id']),
		name: str(c['name']),
		app: str(rec(c['app'])['name']),
		status: checkStatus(str(c['status']), str(c['conclusion'])),
		startedAt: str(c['started_at']) || null,
		completedAt: str(c['completed_at']) || null,
		url: str(c['html_url']),
		actionsJob: str(rec(c['app'])['slug']) === 'github-actions',
	};
}

const PAGE_EXTRA = `query($owner: String!, $name: String!, $n: Int!) {
	repository(owner: $owner, name: $name) { autoMergeAllowed pullRequest(number: $n) { reviewDecision } }
}`;
const REVIEWER: Record<string, PullPage['reviewers'][number]['state']> = {
	APPROVED: 'approved',
	CHANGES_REQUESTED: 'changes',
	DISMISSED: 'dismissed',
};

/** Everything the page shows above its tabs, the whole description and the conversation. */
export async function pullPage(repository: string, key: string, n: number): Promise<PullPage> {
	const base = `${API}/repos/${repository}`;
	const [pr, reviews, extra, line] = await Promise.all([
		gh(`${base}/pulls/${n}`, key, FULL),
		gh(`${base}/pulls/${n}/reviews?per_page=${PAGE}`, key),
		graphql(key, PAGE_EXTRA, { ...owner(repository), n }),
		timeline(base, key, n),
	]);
	const p = rec(pr.body);
	const headSha = str(rec(p['head'])['sha']);
	const runs = await gh(`${base}/commits/${headSha}/check-runs?per_page=${PAGE}`, key);
	const checkList = arr(rec(runs.body)['check_runs']).map(checkOf);
	const author = login(p['user']);
	const url = str(p['html_url']);
	const mergedAt = str(p['merged_at']) || null;
	const state: PullPage['state'] = mergedAt ? 'merged' : str(p['state']) === 'closed' ? 'closed' : 'open';
	// Each reviewer's latest word, then anyone asked who has not answered yet.
	const reviewers = new Map<string, PullPage['reviewers'][number]['state']>();
	for (const r of arr(reviews.body).map(rec))
		reviewers.set(login(r['user']), REVIEWER[str(r['state'])] ?? 'commented');
	for (const r of arr(p['requested_reviewers'])) reviewers.set(login(r), 'requested');
	const later = [...withPushes(line.items, author), ...(state === 'open' ? checkEvents(checkList, headSha) : [])];
	const repo = rec(extra['repository']);
	return {
		number: n,
		title: str(p['title']),
		state,
		draft: p['draft'] === true,
		author,
		base: str(rec(p['base'])['ref']),
		head: str(rec(p['head'])['ref']),
		baseSha: str(rec(p['base'])['sha']),
		headSha,
		url,
		createdAt: str(p['created_at']),
		updatedAt: str(p['updated_at']),
		mergedAt,
		mergedBy: login(p['merged_by']),
		closedAt: str(p['closed_at']) || null,
		bodyHtml: str(p['body_html']),
		bodyLength: str(p['body']).length,
		commits: num(p['commits']),
		additions: num(p['additions']),
		deletions: num(p['deletions']),
		changedFiles: num(p['changed_files']),
		mergeable: typeof p['mergeable'] === 'boolean' ? p['mergeable'] : null,
		mergeableState: str(p['mergeable_state']),
		autoMerge: !!p['auto_merge'],
		canAutoMerge: repo['autoMergeAllowed'] === true,
		checks: countChecks(checkList.map((c) => c.status)),
		checkList,
		review: review(rec(repo['pullRequest'])['reviewDecision']),
		reviewers: [...reviewers].map(([who, s]) => ({ login: who, state: s })),
		labels: arr(p['labels']).map((l) => str(rec(l)['name'])),
		events: [
			event({ kind: 'opened', who: author, at: str(p['created_at']), text: 'opened this pull request', url }),
			...(line.skipped
				? [
						event({
							kind: 'other',
							at: '',
							text: `about ${line.skipped.toLocaleString('en-IN')} earlier events (mostly commits) are on GitHub`,
							url,
						}),
					]
				: []),
			...later.sort((a, b) => a.at.localeCompare(b.at)),
		],
	};
}

/* ===== commits ===== */

const ROLLUP = `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Commit { oid statusCheckRollup { state } } } }`;
const ROLLED: Record<string, PullCommits['commits'][number]['checks']> = {
	SUCCESS: 'passed',
	FAILURE: 'failed',
	ERROR: 'failed',
	PENDING: 'running',
	EXPECTED: 'running',
};

/** Commits' check results by commit id, one GraphQL read for a page; a refusal leaves them unknown. */
async function rollups(key: string, nodeIds: readonly string[]): Promise<Map<string, string>> {
	const data = await graphql(key, ROLLUP, { ids: nodeIds }).catch(() => ({}) as Rec);
	return new Map(arr(data['nodes']).map((x) => [str(rec(x)['oid']), str(rec(rec(x)['statusCheckRollup'])['state'])]));
}

/**
 * One page of a pull request's commits, newest first, 100 to a page. GitHub's compare list pages past the 250 a
 * pull request's own list stops at (up to 10,000), so a pull request as big as PR #7 shows all its commits.
 */
export async function pullCommits(repository: string, key: string, n: number, page: number): Promise<PullCommits> {
	const base = `${API}/repos/${repository}`;
	const p = rec((await gh(`${base}/pulls/${n}`, key)).body);
	const range = `${str(rec(p['base'])['sha'])}...${str(rec(p['head'])['sha'])}`;
	const total = num(rec((await gh(`${base}/compare/${range}?per_page=1`, key)).body)['total_commits']);
	const pages = Math.ceil(total / PAGE);
	if (page > pages) return { total, page, pages, commits: [] };
	const at = `${base}/compare/${range}?per_page=${PAGE}&page=${pages - page + 1}`;
	const list = arr(rec((await gh(at, key)).body)['commits']).map(rec);
	const rolled = await rollups(
		key,
		list.map((c) => str(c['node_id'])),
	);
	return {
		total,
		page,
		pages,
		commits: list.reverse().map((c) => {
			const commit = rec(c['commit']);
			const sha = str(c['sha']);
			return {
				sha,
				headline: str(commit['message']).split('\n')[0] as string,
				author: login(c['author']) || str(rec(commit['author'])['name']),
				date: str(rec(commit['author'])['date']),
				checks: ROLLED[String(rolled.get(sha))] ?? 'none',
			};
		}),
	};
}

/* ===== files ===== */

/** A changed file from GitHub's list, and its patch when GitHub sends one (not for binary or very large files). */
export function githubFile(x: unknown): { file: PullFile; patch: string | null } {
	const f = rec(x);
	const patch = typeof f['patch'] === 'string' ? f['patch'] : null;
	return {
		file: {
			path: str(f['filename']),
			previous: str(f['previous_filename']) || null,
			status: fileStatus(str(f['status'])),
			additions: num(f['additions']),
			deletions: num(f['deletions']),
			// GitHub sends no patch and counts no lines for a binary file.
			binary: patch === null && num(f['changes']) === 0 && str(f['status']) !== 'renamed',
		},
		patch,
	};
}

/** The pull request's base and head and how many files it changes, as the files read needs them. */
export async function pullHead(repository: string, key: string, n: number) {
	const p = rec((await gh(`${API}/repos/${repository}/pulls/${n}`, key)).body);
	return {
		base: str(rec(p['base'])['ref']),
		baseSha: str(rec(p['base'])['sha']),
		headSha: str(rec(p['head'])['sha']),
		changedFiles: num(p['changed_files']),
	};
}

/** GitHub's list of a pull request's changed files with their patches: every page, up to its 3,000. */
export async function githubPullFiles(repository: string, key: string, n: number, count: number) {
	const pages = Math.ceil(Math.min(count, GITHUB_FILE_LIMIT) / PAGE);
	const answers = await Promise.all(
		Array.from({ length: pages }, (_, i) =>
			gh(`${API}/repos/${repository}/pulls/${n}/files?per_page=${PAGE}&page=${i + 1}`, key),
		),
	);
	return answers.flatMap((a) => arr(a.body).map(githubFile));
}

/** One commit: its whole message, author, its checks and its files with their patches (GitHub's pages of 300, up to 3,000). */
export async function githubCommit(repository: string, key: string, sha: string) {
	const base = `${API}/repos/${repository}`;
	const [first, runs] = await Promise.all([
		gh(`${base}/commits/${sha}`, key),
		gh(`${base}/commits/${sha}/check-runs?per_page=${PAGE}`, key),
	]);
	const last = Math.min(lastPage(first.headers.get('link')), GITHUB_FILE_LIMIT / 300);
	const rest = await Promise.all(
		Array.from({ length: last - 1 }, (_, i) => gh(`${base}/commits/${sha}?page=${i + 2}`, key)),
	);
	const body = rec(first.body);
	const commit = rec(body['commit']);
	const files = [first, ...rest].flatMap((a) => arr(rec(a.body)['files']).map(githubFile));
	return {
		sha: str(body['sha']),
		message: str(commit['message']),
		author: login(body['author']) || str(rec(commit['author'])['name']),
		date: str(rec(commit['author'])['date']),
		checks: countChecks(arr(rec(runs.body)['check_runs']).map((x) => checkOf(x).status)),
		files,
		/** GitHub stopped at its 3,000. */
		cut: lastPage(first.headers.get('link')) > GITHUB_FILE_LIMIT / 300,
	};
}

/* ===== a check's log ===== */

/**
 * A GitHub Actions job's log, its last lines, each marked when it reads as an error (moved here from the Ship
 * screens' failed-run view, which reads it the same way). A log GitHub refuses comes back as one line saying so.
 */
export async function jobLog(
	repository: string,
	key: string,
	jobId: string,
	lines = 120,
): Promise<Array<{ n: number; text: string; bad: boolean }>> {
	const res = await fetch(`${API}/repos/${repository}/actions/jobs/${jobId}/logs`, {
		headers: {
			authorization: `Bearer ${key}`,
			'user-agent': 'release-console',
			accept: 'application/vnd.github+json',
		},
		redirect: 'follow',
		signal: AbortSignal.timeout(20_000),
	});
	if (!res.ok)
		return [
			{
				n: 0,
				text: `GitHub answered ${res.status} for this job’s log (it may still be running, or older than 90 days).`,
				bad: false,
			},
		];
	const all = (await res.text()).split('\n');
	const start = Math.max(0, all.length - lines);
	return all.slice(start).map((l, i) => {
		const t = l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, '');
		return { n: start + i + 1, text: t, bad: /##\[error\]|\berror\b|failed|✖|ERR!/i.test(t) };
	});
}
