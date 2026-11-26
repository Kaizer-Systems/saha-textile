import type {
	BranchRow,
	BranchRules,
	CodeActivity,
	CodeBranches,
	CodeChecks,
	CodeCommit,
	CodeHistory,
	CodeRefs,
	CodeRelease,
	CodeReleases,
	CodeTags,
	ReleaseNotes,
	RepoInfo,
} from '@saha-textile/release-console-contracts';

import { gh, graphql } from '../pulls/github-pulls.js';
import { VendorError, arr, getJson, num, rec, str } from '../vendors/http.js';

type Rec = Record<string, unknown>;

const API = 'https://api.github.com';
const VERSION = { 'x-github-api-version': '2022-11-28' };
/** Bodies as GitHub draws them (`body_html`) beside the Markdown (`body`). */
const FULL = { ...VERSION, accept: 'application/vnd.github.full+json' };
/** How many branches the Branches page reads at most (10 pages of 100). */
export const BRANCH_LIMIT = 1_000;

const ownerName = (repository: string) => {
	const [o, n] = repository.split('/');
	return { o, n };
};
/** "dev" or "v1.0" as a path in a REST address (each part escaped, the slashes kept). */
export const refPath = (ref: string) => ref.split('/').map(encodeURIComponent).join('/');

const ROLLED: Record<string, CodeChecks> = {
	SUCCESS: 'passed',
	FAILURE: 'failed',
	ERROR: 'failed',
	PENDING: 'running',
	EXPECTED: 'running',
};
/** A commit's checks, in one word, from GitHub's rollup state. */
export const checksOf = (rollup: unknown): CodeChecks => ROLLED[str(rec(rollup)['state'])] ?? 'none';

/** A GraphQL commit as a line. */
export function commitOf(c: unknown): CodeCommit {
	const x = rec(c);
	const author = rec(x['author']);
	const login = str(rec(author['user'])['login']);
	return {
		sha: str(x['oid']),
		headline: str(x['messageHeadline']),
		author: login || str(author['name']),
		login: login || null,
		date: str(x['committedDate']),
		checks: checksOf(x['statusCheckRollup']),
	};
}

/** The `after=` cursor of GitHub's Link header's next page, or null on the last page. */
export function nextCursor(link: string | null): string | null {
	const next = (link ?? '').split(',').find((part) => part.includes('rel="next"'));
	const after = next ? /[?&]after=([^&>]+)/.exec(next) : null;
	return after ? decodeURIComponent(after[1] as string) : null;
}

/** How many there are in all, from a `per_page=1` answer's Link header (its last page), or the one or none sent. */
export function lastPage(link: string | null, sent: number): number {
	const last = (link ?? '').split(',').find((part) => part.includes('rel="last"'));
	const page = last ? /[?&]page=(\d+)/.exec(last) : null;
	return page ? Number(page[1]) : sent;
}

/** An HTML read (GitHub's own drawing of a Markdown file); null when GitHub has no such file. */
export async function ghHtml(url: string, key: string): Promise<string | null> {
	const res = await fetch(url, {
		headers: {
			authorization: `Bearer ${key}`,
			accept: 'application/vnd.github.html+json',
			'user-agent': 'release-console',
			...VERSION,
		},
		signal: AbortSignal.timeout(30_000),
	});
	if (res.status === 404) return null;
	if (res.status >= 400) throw new VendorError(`GitHub answered ${res.status}.`, res.status);
	return res.text();
}

/* ===== the repository ===== */

const REPO = `query($o: String!, $n: String!) { viewer { login } repository(owner: $o, name: $n) {
	name owner { login } url visibility description homepageUrl stargazerCount forkCount watchers { totalCount }
	viewerSubscription viewerHasStarred defaultBranchRef { name } licenseInfo { name }
	repositoryTopics(first: 20) { nodes { topic { name } } }
	languages(first: 12, orderBy: { field: SIZE, direction: DESC }) { totalSize edges { size node { name color } } }
	latestRelease { name tagName publishedAt }
	releases(first: 0) { totalCount }
	heads: refs(refPrefix: "refs/heads/", first: 0) { totalCount }
	tags: refs(refPrefix: "refs/tags/", first: 0) { totalCount }
	environments(first: 20) { nodes { name } }
	deployments(first: 50, orderBy: { field: CREATED_AT, direction: DESC }) {
		nodes { environment createdAt latestStatus { state } }
	}
} }`;
const WATCHING: Record<string, RepoInfo['watching']> = { SUBSCRIBED: 'subscribed', IGNORED: 'ignored' };

/** The repository's facts for its home page's right column and header (community files come from the copy). */
export async function repoInfo(repository: string, key: string): Promise<Omit<RepoInfo, 'community'>> {
	const data = await graphql(key, REPO, ownerName(repository));
	const r = rec(data['repository']);
	const deployments = arr(rec(r['deployments'])['nodes']).map(rec);
	const languages = rec(r['languages']);
	const total = num(languages['totalSize']);
	const contributors = await gh(`${API}/repos/${repository}/contributors?per_page=12`, key);
	const counted = await gh(`${API}/repos/${repository}/contributors?per_page=1`, key);
	const latest = r['latestRelease'] ? rec(r['latestRelease']) : null;
	return {
		owner: str(rec(r['owner'])['login']),
		name: str(r['name']),
		url: str(r['url']),
		visibility: str(r['visibility']).toLowerCase() as RepoInfo['visibility'],
		description: str(r['description']) || null,
		homepage: str(r['homepageUrl']) || null,
		topics: arr(rec(r['repositoryTopics'])['nodes']).map((t) => str(rec(rec(t)['topic'])['name'])),
		stars: num(r['stargazerCount']),
		watchers: num(rec(r['watchers'])['totalCount']),
		forks: num(r['forkCount']),
		defaultBranch: str(rec(r['defaultBranchRef'])['name']),
		viewer: str(rec(data['viewer'])['login']),
		license: str(rec(r['licenseInfo'])['name']) || null,
		watching: WATCHING[str(r['viewerSubscription'])] ?? 'none',
		starred: r['viewerHasStarred'] === true,
		branches: num(rec(r['heads'])['totalCount']),
		tags: num(rec(r['tags'])['totalCount']),
		releases: {
			total: num(rec(r['releases'])['totalCount']),
			latest: latest
				? {
						name: str(latest['name']),
						tag: str(latest['tagName']),
						publishedAt: str(latest['publishedAt']) || null,
					}
				: null,
		},
		environments: arr(rec(r['environments'])['nodes']).map((e) => {
			const name = str(rec(e)['name']);
			const last = deployments.find((d) => str(d['environment']) === name);
			return {
				name,
				deployedAt: last ? str(last['createdAt']) : null,
				state: last ? str(rec(last['latestStatus'])['state']).toLowerCase() || null : null,
			};
		}),
		contributors: {
			total: lastPage(counted.headers.get('link'), arr(counted.body).length),
			people: arr(contributors.body).map((c) => ({
				login: str(rec(c)['login']),
				contributions: num(rec(c)['contributions']),
			})),
		},
		languages: arr(languages['edges']).map((e) => {
			const node = rec(rec(e)['node']);
			return {
				name: str(node['name']),
				color: str(node['color']) || null,
				share: total ? Math.round((num(rec(e)['size']) / total) * 1000) / 10 : 0,
			};
		}),
	};
}

const HEAD = `query($o: String!, $n: String!, $r: String!, $p: String) { repository(owner: $o, name: $n) {
	object(expression: $r) { ... on Commit {
		oid history(first: 1, path: $p) { totalCount nodes {
			oid messageHeadline committedDate author { name user { login } } statusCheckRollup { state }
		} }
	} }
} }`;

/**
 * Where a branch, tag or commit points, with the newest commit that reaches `path` and how many do: the bar over
 * a folder's list and a file. A tag is read through to its commit.
 */
export async function refHead(
	repository: string,
	key: string,
	ref: string,
	path: string,
): Promise<{ sha: string; head: CodeCommit; commits: number }> {
	const data = await graphql(key, HEAD, { ...ownerName(repository), r: `${ref}^{commit}`, p: path || null });
	const commit = rec(rec(data['repository'])['object']);
	if (!str(commit['oid'])) throw new VendorError(`GitHub has no branch, tag or commit called ${ref}.`, 404);
	const history = rec(commit['history']);
	const newest = arr(history['nodes'])[0];
	if (!newest) throw new VendorError(`${path} is not on ${ref}.`, 404);
	return { sha: str(commit['oid']), head: commitOf(newest), commits: num(history['totalCount']) };
}

/** A folder's README as GitHub draws it, or null when the folder has none. */
export async function readmeOf(repository: string, key: string, ref: string, path: string) {
	const at = `${API}/repos/${repository}/readme${path ? `/${refPath(path)}` : ''}?ref=${encodeURIComponent(ref)}`;
	const found = await gh(at, key).catch((error: VendorError) =>
		error.status === 404 ? null : Promise.reject(error),
	);
	if (!found) return null;
	return { path: str(rec(found.body)['path']), html: (await ghHtml(at, key)) ?? '' };
}

/** A Markdown file as GitHub draws it (Preview, and the community tabs). */
export async function markdownOf(repository: string, key: string, ref: string, path: string): Promise<string> {
	const html = await ghHtml(
		`${API}/repos/${repository}/contents/${refPath(path)}?ref=${encodeURIComponent(ref)}`,
		key,
	);
	if (html === null) throw new VendorError(`${path} is not on ${ref}.`, 404);
	return html;
}

/** Markdown drawn as GitHub draws it, with the repository's own links (Preview while editing). */
export async function renderMarkdown(repository: string, key: string, text: string): Promise<string> {
	const res = await fetch(`${API}/markdown`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${key}`,
			accept: 'text/html',
			'content-type': 'application/json',
			'user-agent': 'release-console',
			...VERSION,
		},
		body: JSON.stringify({ text, mode: 'gfm', context: repository }),
		signal: AbortSignal.timeout(30_000),
	});
	if (res.status >= 400) throw new VendorError(`GitHub answered ${res.status}.`, res.status);
	return res.text();
}

/** Said when the sign-in lacks GitHub's packages right (Q7 A: the owner signs in again approving it). */
export const PACKAGES_RIGHT =
	"Packages needs GitHub's read:packages right, which this sign-in hasn't. Add it with Add the Packages right; you approve it on GitHub's own page.";

/** The owner's container packages that belong to this repository, newest first. */
export async function packagesOf(repository: string, key: string) {
	const { o } = ownerName(repository);
	const list = async (kind: 'orgs' | 'users') =>
		getJson(`${API}/${kind}/${o}/packages?package_type=container&per_page=100`, key, VERSION);
	let a = await list('orgs');
	if (a.status === 404) a = await list('users');
	if (a.status === 403 || a.status === 401) throw new VendorError(PACKAGES_RIGHT, 403);
	if (a.status >= 400) throw new VendorError(`GitHub answered ${a.status}.`, a.status);
	return {
		packages: arr(a.body)
			.map(rec)
			.filter((x) => str(rec(x['repository'])['full_name']) === repository)
			.map((x) => ({
				name: str(x['name']),
				visibility: str(x['visibility']),
				updatedAt: str(x['updated_at']),
				url: str(x['html_url']),
				versions: num(x['version_count']),
			}))
			.sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)),
	};
}

/** A ref's files as GitHub's .zip (Code ▾ › Download ZIP). */
export async function zipOf(repository: string, key: string, ref: string): Promise<Buffer> {
	const res = await fetch(`${API}/repos/${repository}/zipball/${refPath(ref)}`, {
		headers: { authorization: `Bearer ${key}`, 'user-agent': 'release-console', ...VERSION },
		signal: AbortSignal.timeout(300_000),
	});
	if (res.status >= 400) throw new VendorError(`GitHub answered ${res.status}.`, res.status);
	return Buffer.from(await res.arrayBuffer());
}

/* ===== branches, tags and their rules ===== */

/** A ruleset's branch pattern ("refs/heads/main", "refs/heads/release/*", "~DEFAULT_BRANCH", "~ALL"). */
export function ruleCovers(pattern: string, branch: string, defaultBranch: string): boolean {
	if (pattern === '~ALL') return true;
	if (pattern === '~DEFAULT_BRANCH') return branch === defaultBranch;
	const glob = pattern
		.replace(/^refs\/heads\//, '')
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		// `**` waits as a private-use character while the single `*` is turned into its pattern.
		.replaceAll('**', '\uE000')
		.replace(/\*/g, '[^/]*')
		.replace(/\?/g, '[^/]')
		.replaceAll('\uE000', '.*');
	return new RegExp(`^${glob}$`).test(branch);
}

interface Ruleset {
	name: string;
	include: string[];
	exclude: string[];
}

/** The repository's active branch rulesets with their patterns. */
export async function branchRulesets(repository: string, key: string): Promise<Ruleset[]> {
	const list = arr((await gh(`${API}/repos/${repository}/rulesets?per_page=100`, key)).body).map(rec);
	const active = list.filter((r) => str(r['target']) === 'branch' && str(r['enforcement']) === 'active');
	return Promise.all(
		active.map(async (r) => {
			const full = rec((await gh(`${API}/repos/${repository}/rulesets/${num(r['id'])}`, key)).body);
			const names = rec(rec(full['conditions'])['ref_name']);
			return {
				name: str(full['name']),
				include: arr(names['include']).map((x) => str(x)),
				exclude: arr(names['exclude']).map((x) => str(x)),
			};
		}),
	);
}

/** Whether a rule (a ruleset or GitHub's older branch protection) guards the branch. */
export const ruled = (sets: Ruleset[], branch: string, defaultBranch: string, protectedOld = false) =>
	protectedOld ||
	sets.some(
		(s) =>
			s.include.some((p) => ruleCovers(p, branch, defaultBranch)) &&
			!s.exclude.some((p) => ruleCovers(p, branch, defaultBranch)),
	);

/** Every page of a REST list (an address without a query), 100 at a time, up to `limit`. */
async function every(url: string, key: string, limit = BRANCH_LIMIT): Promise<Rec[]> {
	const all: Rec[] = [];
	for (let page = 1; all.length < limit; page += 1) {
		const got = arr((await gh(`${url}?per_page=100&page=${page}`, key)).body).map(rec);
		all.push(...got);
		if (got.length < 100) break;
	}
	return all.slice(0, limit);
}

/** Every branch and tag's name for the switcher, with the default branch and which branches a rule guards. */
export async function refsOf(repository: string, key: string, defaultBranch: string): Promise<CodeRefs> {
	const [branches, tags, sets] = await Promise.all([
		every(`${API}/repos/${repository}/branches`, key),
		every(`${API}/repos/${repository}/tags`, key),
		branchRulesets(repository, key),
	]);
	return {
		defaultBranch,
		branches: branches.map((b) => ({
			name: str(b['name']),
			rule: ruled(sets, str(b['name']), defaultBranch, b['protected'] === true),
		})),
		tags: tags.map((t) => str(t['name'])),
	};
}

const BRANCHES = `query($o: String!, $n: String!, $d: String!, $after: String) {
	viewer { login }
	repository(owner: $o, name: $n) {
		refs(refPrefix: "refs/heads/", first: 100, after: $after, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
			pageInfo { hasNextPage endCursor }
			nodes {
				name
				target { ... on Commit { oid committedDate author { name user { login } } statusCheckRollup { state } } }
				associatedPullRequests(first: 1, orderBy: { field: UPDATED_AT, direction: DESC }) {
					nodes { number state isDraft }
				}
				compare(headRef: $d) { aheadBy behindBy }
			}
		}
	}
}`;

/** A pull request's state in one word, a draft told apart. */
const pullState = (p: Rec): NonNullable<BranchRow['pull']>['state'] =>
	p['isDraft'] === true && str(p['state']) === 'OPEN'
		? 'draft'
		: (str(p['state']).toLowerCase() as NonNullable<BranchRow['pull']>['state']);

/**
 * Every branch (newest first, up to 1,000) for the Branches page: its newest commit, who wrote it, its checks, how
 * far behind and ahead of the default branch it is, its newest pull request and whether a rule guards it.
 */
export async function branchesOf(repository: string, key: string, defaultBranch: string): Promise<CodeBranches> {
	const sets = await branchRulesets(repository, key);
	const rows: BranchRow[] = [];
	let viewer: string;
	let after: string | null = null;
	do {
		const data = await graphql(key, BRANCHES, { ...ownerName(repository), d: defaultBranch, after });
		viewer = str(rec(data['viewer'])['login']);
		const refs = rec(rec(data['repository'])['refs']);
		for (const node of arr(refs['nodes']).map(rec)) {
			const tip = commitOf(node['target']);
			const compare = rec(node['compare']);
			const pull = rec(arr(rec(node['associatedPullRequests'])['nodes'])[0]);
			const name = str(node['name']);
			rows.push({
				name,
				isDefault: name === defaultBranch,
				rule: ruled(sets, name, defaultBranch),
				sha: tip.sha,
				date: tip.date,
				author: tip.author,
				login: tip.login,
				// `compare` counts from the default branch's side: what it lacks is what this branch is ahead by.
				behind: num(compare['aheadBy']),
				ahead: num(compare['behindBy']),
				pull: pull['number'] ? { number: num(pull['number']), state: pullState(pull) } : null,
				checks: tip.checks,
			});
		}
		const page = rec(refs['pageInfo']);
		after = page['hasNextPage'] === true && rows.length < BRANCH_LIMIT ? str(page['endCursor']) : null;
	} while (after);
	return { defaultBranch, viewer, rows };
}

/** The rules that apply to one branch, each with its ruleset's name. */
export async function branchRules(repository: string, key: string, branch: string): Promise<BranchRules> {
	const [rules, sets] = await Promise.all([
		gh(`${API}/repos/${repository}/rules/branches/${refPath(branch)}`, key),
		gh(`${API}/repos/${repository}/rulesets?per_page=100`, key),
	]);
	const names = new Map(arr(sets.body).map((s) => [num(rec(s)['id']), str(rec(s)['name'])]));
	return {
		branch,
		rules: arr(rules.body).map((r) => ({
			type: str(rec(r)['type']),
			ruleset: names.get(num(rec(r)['ruleset_id'])) ?? '',
		})),
	};
}

const TAGS = `query($o: String!, $n: String!, $after: String) { repository(owner: $o, name: $n) {
	refs(refPrefix: "refs/tags/", first: 30, after: $after, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
		pageInfo { hasNextPage endCursor }
		nodes { name target {
			... on Commit { oid committedDate }
			... on Tag { target { ... on Commit { oid committedDate } } }
		} }
	}
	releases(first: 100) { nodes { tagName } }
} }`;

/** Tags, newest first, 30 a page: each one's commit and date, and whether a release was made from it. */
export async function tagsOf(repository: string, key: string, after: string): Promise<CodeTags> {
	const r = rec((await graphql(key, TAGS, { ...ownerName(repository), after: after || null }))['repository']);
	const released = new Set(arr(rec(r['releases'])['nodes']).map((x) => str(rec(x)['tagName'])));
	const refs = rec(r['refs']);
	const page = rec(refs['pageInfo']);
	return {
		tags: arr(refs['nodes']).map((x) => {
			const target = rec(rec(x)['target']);
			const commit = str(target['oid']) ? target : rec(target['target']);
			const name = str(rec(x)['name']);
			return {
				name,
				sha: str(commit['oid']),
				date: str(commit['committedDate']) || null,
				release: released.has(name),
			};
		}),
		next: page['hasNextPage'] === true ? str(page['endCursor']) : null,
	};
}

/** A release as GitHub sends it. */
export function releaseOf(x: unknown, latestId: number): CodeRelease {
	const r = rec(x);
	return {
		id: num(r['id']),
		name: str(r['name']) || str(r['tag_name']),
		tag: str(r['tag_name']),
		target: str(r['target_commitish']),
		draft: r['draft'] === true,
		prerelease: r['prerelease'] === true,
		latest: num(r['id']) === latestId,
		publishedAt: str(r['published_at']) || null,
		author: str(rec(r['author'])['login']),
		body: str(r['body']),
		bodyHtml: str(r['body_html']),
		url: str(r['html_url']),
		assets: arr(r['assets']).map((a) => ({
			id: num(rec(a)['id']),
			name: str(rec(a)['name']),
			size: num(rec(a)['size']),
			downloads: num(rec(a)['download_count']),
			url: str(rec(a)['browser_download_url']),
		})),
	};
}

/** Releases, newest first, ten a page, with GitHub's drawing of their notes; drafts too (the key can push). */
export async function releasesOf(repository: string, key: string, page: number): Promise<CodeReleases> {
	const base = `${API}/repos/${repository}/releases`;
	const [list, latest] = await Promise.all([
		gh(`${base}?per_page=10&page=${page}`, key, FULL),
		gh(`${base}/latest`, key).catch(() => null),
	]);
	const latestId = latest ? num(rec(latest.body)['id']) : 0;
	const releases = arr(list.body).map((r) => releaseOf(r, latestId));
	return { releases, more: releases.length === 10 };
}

/** GitHub's own release notes for a tag: the pull requests since the previous release. */
export async function releaseNotes(
	repository: string,
	key: string,
	q: { tag: string; target: string; previous: string },
): Promise<ReleaseNotes> {
	const a = await ghSend('POST', `${API}/repos/${repository}/releases/generate-notes`, key, {
		tag_name: q.tag,
		target_commitish: q.target,
		...(q.previous ? { previous_tag_name: q.previous } : {}),
	});
	return { name: str(rec(a)['name']), body: str(rec(a)['body']) };
}

/* ===== history and activity ===== */

const HISTORY = `query($o: String!, $n: String!, $r: String!, $p: String, $after: String, $since: GitTimestamp,
	$until: GitTimestamp, $author: CommitAuthor) { repository(owner: $o, name: $n) {
	object(expression: $r) { ... on Commit {
		history(first: 100, after: $after, path: $p, since: $since, until: $until, author: $author) {
			totalCount pageInfo { hasNextPage endCursor }
			nodes { oid messageHeadline committedDate author { name user { login } } statusCheckRollup { state } }
		}
	} }
} }`;

/** The commits that reach a branch (or one file on it), newest first, 100 a page, by author and date if asked. */
export async function historyOf(
	repository: string,
	key: string,
	q: { ref: string; path: string; author: string; since: string; until: string; after: string },
): Promise<CodeHistory> {
	const author = q.author ? { id: str(rec((await gh(`${API}/users/${q.author}`, key)).body)['node_id']) } : null;
	const data = await graphql(key, HISTORY, {
		...ownerName(repository),
		r: `${q.ref}^{commit}`,
		p: q.path || null,
		after: q.after || null,
		since: q.since ? `${q.since}T00:00:00Z` : null,
		until: q.until ? `${q.until}T23:59:59Z` : null,
		author,
	});
	const history = rec(rec(rec(data['repository'])['object'])['history']);
	const page = rec(history['pageInfo']);
	return {
		total: num(history['totalCount']),
		next: page['hasNextPage'] === true ? str(page['endCursor']) : null,
		commits: arr(history['nodes']).map(commitOf),
	};
}

/** The repository's activity (pushes, force pushes, branches made and deleted, merges), newest first, 30 a page. */
export async function activityOf(
	repository: string,
	key: string,
	q: { ref: string; actor: string; kind: string; after: string },
): Promise<CodeActivity> {
	const params = new URLSearchParams({ per_page: '30', direction: 'desc' });
	if (q.ref) params.set('ref', q.ref);
	if (q.actor) params.set('actor', q.actor);
	if (q.kind) params.set('activity_type', q.kind);
	if (q.after) params.set('after', q.after);
	const a = await gh(`${API}/repos/${repository}/activity?${params.toString()}`, key);
	return {
		rows: arr(a.body).map((x) => {
			const r = rec(x);
			return {
				kind: str(r['activity_type']),
				ref: str(r['ref']).replace(/^refs\/heads\//, ''),
				actor: str(rec(r['actor'])['login']),
				at: str(r['timestamp']),
				before: str(r['before']),
				after: str(r['after']),
			};
		}),
		next: nextCursor(a.headers.get('link')),
	};
}

/* ===== compare ===== */

/** Two refs compared on GitHub: where they stand, the newest 250 commits, its first 300 files and an open pull request. */
export async function compareOf(repository: string, key: string, base: string, head: string) {
	const range = `${refPath(base)}...${refPath(head)}`;
	const at = `${API}/repos/${repository}/compare/${range}`;
	const first = rec((await gh(`${at}?per_page=100&page=1`, key)).body);
	const total = num(first['total_commits']);
	const pages = Math.ceil(total / 100);
	// GitHub lists a comparison's commits oldest first; the newest 250 are on its last pages.
	const wanted = Array.from({ length: Math.min(pages, 3) }, (_, i) => pages - i).filter((p) => p > 1);
	const later = await Promise.all(
		wanted.map(async (p) => arr(rec((await gh(`${at}?per_page=100&page=${p}`, key)).body)['commits'])),
	);
	const commits = [...arr(first['commits']), ...later.reverse().flat()].map(rec).slice(-250);
	const { o } = ownerName(repository);
	const open = await gh(
		`${API}/repos/${repository}/pulls?state=open&per_page=1&base=${encodeURIComponent(base)}&head=${encodeURIComponent(`${o}:${head}`)}`,
		key,
	);
	const pull = rec(arr(open.body)[0]);
	return {
		status: str(first['status']) as 'identical' | 'ahead' | 'behind' | 'diverged',
		ahead: num(first['ahead_by']),
		behind: num(first['behind_by']),
		mergeBase: str(rec(first['merge_base_commit'])['sha']),
		files: arr(first['files']),
		commits: commits.reverse().map((c) => {
			const commit = rec(c['commit']);
			const login = str(rec(c['author'])['login']);
			return {
				sha: str(c['sha']),
				headline: str(commit['message']).split('\n')[0] as string,
				author: login || str(rec(commit['author'])['name']),
				login: login || null,
				date: str(rec(commit['committer'])['date']),
				checks: 'none' as const,
			};
		}),
		pull: pull['number'] ? { number: num(pull['number']), title: str(pull['title']) } : null,
	};
}

/* ===== changes ===== */

/** A change through GitHub's REST API; a refusal throws GitHub's own words. */
export async function ghSend(
	method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
	url: string,
	key: string,
	payload?: unknown,
): Promise<unknown> {
	const res = await fetch(url, {
		method,
		headers: {
			authorization: `Bearer ${key}`,
			accept: 'application/vnd.github+json',
			'user-agent': 'release-console',
			...VERSION,
			...(payload === undefined ? {} : { 'content-type': 'application/json' }),
		},
		...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
		signal: AbortSignal.timeout(120_000),
	});
	const body: unknown = await res.json().catch(() => null);
	if (res.status >= 400) {
		const said = str(rec(body)['message']);
		const detail = arr(rec(body)['errors'])
			.map((e) => str(rec(e)['message']) || str(rec(e)['code']))
			.filter(Boolean)
			.join('; ');
		throw new VendorError(
			`GitHub refused it: ${[said, detail].filter(Boolean).join(' · ') || `it answered ${res.status}`}.`,
			res.status,
		);
	}
	return body;
}
