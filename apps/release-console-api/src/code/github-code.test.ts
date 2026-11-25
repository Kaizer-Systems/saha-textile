import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	activityOf,
	branchRules,
	branchesOf,
	checksOf,
	commitOf,
	compareOf,
	ghHtml,
	ghSend,
	historyOf,
	lastPage,
	packagesOf,
	zipOf,
	PACKAGES_RIGHT,
	renderMarkdown,
	markdownOf,
	nextCursor,
	readmeOf,
	refHead,
	refPath,
	refsOf,
	releaseNotes,
	releaseOf,
	releasesOf,
	repoInfo,
	ruleCovers,
	ruled,
	tagsOf,
} from './github-code.js';

/** GitHub's answers by address and body; every call is kept as "METHOD url body". */
type Route = [RegExp, number, unknown, string?];
function github(routes: Route[]) {
	const sent: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const body = typeof init?.body === 'string' ? init.body : '';
			const line = `${init?.method ?? 'GET'} ${String(url)} ${body}`;
			sent.push(line);
			const hit = routes.find(([re]) => re.test(line));
			const status = hit?.[1] ?? 200;
			const answer = hit?.[2] ?? {};
			const headers = hit?.[3] ? { link: hit[3] } : undefined;
			const text = typeof answer === 'string' ? answer : JSON.stringify(answer);
			return new Response(status === 204 ? null : text, { status, headers });
		}),
	);
	return sent;
}
afterEach(() => vi.unstubAllGlobals());

const R = 'o/r';
const commit = (over: Record<string, unknown> = {}) => ({
	oid: 'c'.repeat(40),
	messageHeadline: 'fix: a thing',
	committedDate: '2026-11-24T10:00:00Z',
	author: { name: 'Moulik Patra', user: { login: 'kaizer03' } },
	statusCheckRollup: { state: 'SUCCESS' },
	...over,
});

describe('small words', () => {
	it('escape a ref for an address, word checks, and read a commit', () => {
		expect(refPath('feat/a b')).toBe('feat/a%20b');
		expect(
			['SUCCESS', 'FAILURE', 'ERROR', 'PENDING', 'EXPECTED', 'NEW'].map((s) => checksOf({ state: s })),
		).toEqual(['passed', 'failed', 'failed', 'running', 'running', 'none']);
		expect(checksOf(null)).toBe('none');
		expect(commitOf(commit())).toMatchObject({ author: 'kaizer03', login: 'kaizer03', checks: 'passed' });
		expect(commitOf(commit({ author: { name: 'Someone', user: null } }))).toMatchObject({
			author: 'Someone',
			login: null,
		});
	});

	it('read GitHub’s Link header for the next cursor and the last page', () => {
		const link =
			'<https://api.github.com/x?per_page=30&after=abc%3D%3D>; rel="next", <https://api.github.com/x?page=9>; rel="last"';
		expect(nextCursor(link)).toBe('abc==');
		expect(nextCursor('<https://api.github.com/x?page=2>; rel="next"')).toBeNull();
		expect(nextCursor(null)).toBeNull();
		expect(lastPage(link, 1)).toBe(9);
		expect(lastPage(null, 1)).toBe(1);
		expect(lastPage('<https://x>; rel="last"', 0)).toBe(0);
	});

	it('cover rules by exact name, glob, the default branch and every branch', () => {
		expect(ruleCovers('~ALL', 'x', 'main')).toBe(true);
		expect(ruleCovers('~DEFAULT_BRANCH', 'main', 'main')).toBe(true);
		expect(ruleCovers('~DEFAULT_BRANCH', 'dev', 'main')).toBe(false);
		expect(ruleCovers('refs/heads/release/*', 'release/1.0', 'main')).toBe(true);
		expect(ruleCovers('refs/heads/release/*', 'release/1/0', 'main')).toBe(false);
		expect(ruleCovers('refs/heads/release/**', 'release/1/0', 'main')).toBe(true);
		expect(ruleCovers('refs/heads/v?.x', 'v1.x', 'main')).toBe(true);
		const sets = [{ name: 'all', include: ['~ALL'], exclude: ['refs/heads/wip/*'] }];
		expect(ruled(sets, 'dev', 'main')).toBe(true);
		expect(ruled(sets, 'wip/a', 'main')).toBe(false);
		expect(ruled([], 'old', 'main', true)).toBe(true);
	});
});

describe('the repository', () => {
	it('reads its facts, languages, environments and contributors', async () => {
		github([
			[
				/graphql.*viewerSubscription/,
				200,
				{
					data: {
						viewer: { login: 'kaizer03' },
						repository: {
							name: 'r',
							owner: { login: 'o' },
							url: 'https://github.com/o/r',
							visibility: 'PUBLIC',
							description: 'The shop',
							homepageUrl: 'https://example.com',
							stargazerCount: 2,
							forkCount: 1,
							watchers: { totalCount: 3 },
							viewerSubscription: 'SUBSCRIBED',
							viewerHasStarred: true,
							defaultBranchRef: { name: 'main' },
							licenseInfo: { name: 'MIT License' },
							repositoryTopics: { nodes: [{ topic: { name: 'shop' } }] },
							languages: {
								totalSize: 300,
								edges: [
									{ size: 200, node: { name: 'TypeScript', color: '#3178c6' } },
									{ size: 100, node: { name: 'Odd', color: null } },
								],
							},
							latestRelease: { name: 'One', tagName: 'v1', publishedAt: null },
							releases: { totalCount: 4 },
							heads: { totalCount: 10 },
							tags: { totalCount: 2 },
							environments: { nodes: [{ name: 'staging' }, { name: 'production' }] },
							deployments: {
								nodes: [
									{ environment: 'staging', createdAt: '2026-11-24T10:00:00Z', latestStatus: null },
								],
							},
						},
					},
				},
			],
			[/contributors\?per_page=12/, 200, [{ login: 'kaizer03', contributions: 1700 }]],
			[/contributors\?per_page=1 /, 200, [{ login: 'kaizer03' }], '<https://x?per_page=1&page=3>; rel="last"'],
		]);
		const info = await repoInfo(R, 'k');
		expect(info).toMatchObject({
			visibility: 'public',
			viewer: 'kaizer03',
			description: 'The shop',
			homepage: 'https://example.com',
			topics: ['shop'],
			watching: 'subscribed',
			starred: true,
			license: 'MIT License',
			releases: { total: 4, latest: { name: 'One', tag: 'v1', publishedAt: null } },
			environments: [
				{ name: 'staging', deployedAt: '2026-11-24T10:00:00Z', state: null },
				{ name: 'production', deployedAt: null, state: null },
			],
			contributors: { total: 3, people: [{ login: 'kaizer03', contributions: 1700 }] },
		});
		expect(info.languages).toEqual([
			{ name: 'TypeScript', color: '#3178c6', share: 66.7 },
			{ name: 'Odd', color: null, share: 33.3 },
		]);
	});

	it('says none for missing facts, and a deployment’s state in small letters', async () => {
		github([
			[
				/graphql.*viewerSubscription/,
				200,
				{
					data: {
						repository: {
							visibility: 'PRIVATE',
							viewerSubscription: 'IGNORED',
							languages: { totalSize: 0, edges: [{ size: 0, node: { name: 'Empty' } }] },
							environments: { nodes: [{ name: 'staging' }] },
							deployments: {
								nodes: [{ environment: 'staging', createdAt: 'x', latestStatus: { state: 'SUCCESS' } }],
							},
						},
					},
				},
			],
		]);
		const info = await repoInfo(R, 'k');
		expect(info).toMatchObject({
			description: null,
			homepage: null,
			license: null,
			watching: 'ignored',
			starred: false,
		});
		expect(info.releases.latest).toBeNull();
		expect(info.languages[0]?.share).toBe(0);
		expect(info.environments[0]?.state).toBe('success');
		github([[/graphql/, 200, { data: { repository: { viewerSubscription: 'UNSUBSCRIBED' } } }]]);
		expect((await repoInfo(R, 'k')).watching).toBe('none');
	});

	it('finds where a ref points with the newest commit reaching a path, and refuses one GitHub does not know', async () => {
		const sent = github([
			[/"r":"nope\^\{commit\}"/, 200, { data: { repository: { object: null } } }],
			[
				/"p":"gone.txt"/,
				200,
				{ data: { repository: { object: { oid: 'a1', history: { totalCount: 0, nodes: [] } } } } },
			],
			[
				/graphql/,
				200,
				{ data: { repository: { object: { oid: 'a1', history: { totalCount: 1700, nodes: [commit()] } } } } },
			],
		]);
		expect(await refHead(R, 'k', 'dev', '')).toMatchObject({
			sha: 'a1',
			commits: 1700,
			head: { headline: 'fix: a thing' },
		});
		expect(sent[0]).toContain('"p":null');
		await expect(refHead(R, 'k', 'nope', '')).rejects.toThrow('GitHub has no branch, tag or commit called nope.');
		await expect(refHead(R, 'k', 'dev', 'gone.txt')).rejects.toThrow('gone.txt is not on dev.');
	});

	it('reads a folder’s README as GitHub draws it, and says when there is none', async () => {
		const sent = github([
			[/readme\/apps\/api/, 404, { message: 'Not Found' }],
			[/readme\/docs/, 500, {}],
			[/readme\/empty/, 200, { path: 'empty/README.md' }],
			[/readme\?ref=dev .*/, 200, { path: 'README.md' }],
		]);
		vi.mocked(fetch).mockImplementation(async (url, init) => {
			const line = `GET ${String(url)} `;
			sent.push(line);
			const html = (init?.headers as Record<string, string>)['accept'] === 'application/vnd.github.html+json';
			if (line.includes('apps/api')) return new Response('{}', { status: 404 });
			if (line.includes('docs')) return new Response('{}', { status: 500 });
			if (line.includes('empty'))
				return new Response(html ? '' : '{"path":"empty/README.md"}', { status: html ? 404 : 200 });
			return new Response(html ? '<article>Hi</article>' : '{"path":"README.md"}', { status: 200 });
		});
		expect(await readmeOf(R, 'k', 'dev', '')).toEqual({ path: 'README.md', html: '<article>Hi</article>' });
		expect(await readmeOf(R, 'k', 'dev', 'apps/api')).toBeNull();
		await expect(readmeOf(R, 'k', 'dev', 'docs')).rejects.toThrow('GitHub answered 500.');
		expect(await readmeOf(R, 'k', 'dev', 'empty')).toEqual({ path: 'empty/README.md', html: '' });
	});

	it('draws a Markdown file, and says when it is not there or GitHub refuses', async () => {
		github([
			[/contents\/gone\.md/, 404, ''],
			[/contents\/broken\.md/, 502, ''],
			[/contents\/a\.md/, 200, '<p>A</p>'],
		]);
		expect(await markdownOf(R, 'k', 'dev', 'a.md')).toBe('<p>A</p>');
		await expect(markdownOf(R, 'k', 'dev', 'gone.md')).rejects.toThrow('gone.md is not on dev.');
		await expect(ghHtml('https://api.github.com/repos/o/r/contents/broken.md', 'k')).rejects.toThrow(
			'GitHub answered 502.',
		);
	});
});

describe('Markdown while editing', () => {
	it('is drawn by GitHub with the repository’s links, and a refusal is said', async () => {
		const sent = github([
			[/markdown .*"text":"# Hi"/, 200, '<h1>Hi</h1>'],
			[/markdown/, 503, ''],
		]);
		expect(await renderMarkdown(R, 'k', '# Hi')).toBe('<h1>Hi</h1>');
		expect(sent[0]).toContain('"mode":"gfm","context":"o/r"');
		await expect(renderMarkdown(R, 'k', 'x')).rejects.toThrow('GitHub answered 503.');
	});
});

describe('packages and the .zip', () => {
	it('lists the owner’s container packages that belong to the repository, newest first', async () => {
		const pkg = (name: string, repo: string, updated: string) => ({
			name,
			visibility: 'private',
			updated_at: updated,
			html_url: `https://github.com/o/r/pkgs/container/${name}`,
			version_count: 3,
			repository: { full_name: repo },
		});
		github([
			[
				/orgs\/o\/packages/,
				200,
				[pkg('api', R, '2026-11-01'), pkg('other', 'o/x', '2026-11-02'), pkg('web', R, '2026-11-03')],
			],
		]);
		expect((await packagesOf(R, 'k')).packages.map((p) => p.name)).toEqual(['web', 'api']);
		const sent = github([
			[/orgs\//, 404, {}],
			[/users\/o\/packages/, 200, []],
		]);
		expect(await packagesOf(R, 'k')).toEqual({ packages: [] });
		expect(sent[1]).toContain('/users/o/packages');
		github([[/orgs\//, 403, {}]]);
		await expect(packagesOf(R, 'k')).rejects.toThrow(PACKAGES_RIGHT);
		github([[/orgs\//, 401, {}]]);
		await expect(packagesOf(R, 'k')).rejects.toThrow(PACKAGES_RIGHT);
		github([[/orgs\//, 500, {}]]);
		await expect(packagesOf(R, 'k')).rejects.toThrow('GitHub answered 500.');
	});

	it('reads a ref’s files as GitHub’s .zip, and says when it cannot', async () => {
		github([
			[/zipball\/feat\/x/, 200, 'PK'],
			[/zipball\/gone/, 404, ''],
		]);
		expect((await zipOf(R, 'k', 'feat/x')).toString()).toBe('PK');
		await expect(zipOf(R, 'k', 'gone')).rejects.toThrow('GitHub answered 404.');
	});
});

describe('branches and tags', () => {
	const RULESETS: Route[] = [
		[
			/rulesets\?per_page=100/,
			200,
			[
				{ id: 1, name: 'Protected', target: 'branch', enforcement: 'active' },
				{ id: 2, name: 'Off', target: 'branch', enforcement: 'disabled' },
				{ id: 3, name: 'Tags', target: 'tag', enforcement: 'active' },
			],
		],
		[
			/rulesets\/1 /,
			200,
			{
				name: 'Protected',
				conditions: {
					ref_name: { include: ['refs/heads/dev', '~DEFAULT_BRANCH'], exclude: ['refs/heads/wip/*'] },
				},
			},
		],
	];

	it('lists every branch and tag for the switcher, marking the ones a rule guards', async () => {
		const page = Array.from({ length: 100 }, (_, i) => ({ name: `b${i}` }));
		github([
			...RULESETS,
			[
				/branches\?per_page=100&page=1 /,
				200,
				[{ name: 'main' }, { name: 'dev' }, { name: 'old', protected: true }, ...page.slice(3)],
			],
			[/branches\?per_page=100&page=2 /, 200, [{ name: 'feat/x' }]],
			[/tags\?per_page=100&page=1 /, 200, [{ name: 'v1' }]],
		]);
		const refs = await refsOf(R, 'k', 'main');
		expect(refs.branches).toHaveLength(101);
		expect(refs.branches.filter((b) => b.rule).map((b) => b.name)).toEqual(['main', 'dev', 'old']);
		expect(refs.tags).toEqual(['v1']);
	});

	it('reads every branch for the Branches page with its distance from the default branch, its pull request and checks', async () => {
		const node = (name: string, over: Record<string, unknown> = {}) => ({
			name,
			target: commit(),
			associatedPullRequests: { nodes: [] },
			compare: { aheadBy: 2, behindBy: 5 },
			...over,
		});
		const sent = github([
			...RULESETS,
			[
				/"after":null/,
				200,
				{
					data: {
						viewer: { login: 'kaizer03' },
						repository: {
							refs: {
								pageInfo: { hasNextPage: true, endCursor: 'c1' },
								nodes: [
									node('main', { compare: { aheadBy: 0, behindBy: 0 } }),
									node('feat/a', {
										associatedPullRequests: {
											nodes: [{ number: 7, state: 'OPEN', isDraft: false }],
										},
									}),
									node('feat/b', {
										associatedPullRequests: {
											nodes: [{ number: 8, state: 'OPEN', isDraft: true }],
										},
									}),
								],
							},
						},
					},
				},
			],
			[
				/"after":"c1"/,
				200,
				{
					data: {
						viewer: { login: 'kaizer03' },
						repository: {
							refs: {
								pageInfo: { hasNextPage: false },
								nodes: [
									node('old', {
										associatedPullRequests: { nodes: [{ number: 3, state: 'MERGED' }] },
									}),
								],
							},
						},
					},
				},
			],
		]);
		const b = await branchesOf(R, 'k', 'main');
		expect(b.viewer).toBe('kaizer03');
		expect(b.rows.map((r) => [r.name, r.isDefault, r.rule, r.behind, r.ahead, r.pull])).toEqual([
			['main', true, true, 0, 0, null],
			['feat/a', false, false, 2, 5, { number: 7, state: 'open' }],
			['feat/b', false, false, 2, 5, { number: 8, state: 'draft' }],
			['old', false, false, 2, 5, { number: 3, state: 'merged' }],
		]);
		expect(sent.filter((s) => s.includes('graphql'))).toHaveLength(2);
	});

	it('names the rules on one branch with their rulesets', async () => {
		github([
			[
				/rules\/branches\/dev/,
				200,
				[
					{ type: 'deletion', ruleset_id: 1 },
					{ type: 'pull_request', ruleset_id: 9 },
				],
			],
			[/rulesets\?per_page=100/, 200, [{ id: 1, name: 'Protected' }]],
		]);
		expect(await branchRules(R, 'k', 'dev')).toEqual({
			branch: 'dev',
			rules: [
				{ type: 'deletion', ruleset: 'Protected' },
				{ type: 'pull_request', ruleset: '' },
			],
		});
	});

	it('pages tags with their commits and dates, through annotated tags too, and marks those with a release', async () => {
		const sent = github([
			[
				/graphql/,
				200,
				{
					data: {
						repository: {
							refs: {
								pageInfo: { hasNextPage: true, endCursor: 't2' },
								nodes: [
									{ name: 'v2', target: { oid: 'a2', committedDate: '2026-11-24T00:00:00Z' } },
									{ name: 'v1', target: { target: { oid: 'a1', committedDate: '' } } },
								],
							},
							releases: { nodes: [{ tagName: 'v2' }] },
						},
					},
				},
			],
		]);
		expect(await tagsOf(R, 'k', '')).toEqual({
			tags: [
				{ name: 'v2', sha: 'a2', date: '2026-11-24T00:00:00Z', release: true },
				{ name: 'v1', sha: 'a1', date: null, release: false },
			],
			next: 't2',
		});
		expect(sent[0]).toContain('"after":null');
		github([[/graphql/, 200, { data: { repository: { refs: { pageInfo: { hasNextPage: false }, nodes: [] } } } }]]);
		expect(await tagsOf(R, 'k', 'x')).toEqual({ tags: [], next: null });
	});
});

describe('releases', () => {
	const release = (id: number, over: Record<string, unknown> = {}) => ({
		id,
		name: `Release ${id}`,
		tag_name: `v${id}`,
		target_commitish: 'main',
		draft: false,
		prerelease: false,
		published_at: '2026-11-24T00:00:00Z',
		author: { login: 'kaizer03' },
		body: 'Notes',
		body_html: '<p>Notes</p>',
		html_url: `https://github.com/o/r/releases/tag/v${id}`,
		assets: [{ id: 5, name: 'a.zip', size: 10, download_count: 2, browser_download_url: 'https://x/a.zip' }],
		...over,
	});

	it('reads a page of releases with GitHub’s drawing of their notes, marking the latest', async () => {
		github([
			[/releases\/latest/, 200, { id: 2 }],
			[/releases\?per_page=10&page=1/, 200, Array.from({ length: 10 }, (_, i) => release(i + 1))],
		]);
		const page = await releasesOf(R, 'k', 1);
		expect(page.more).toBe(true);
		expect(page.releases.filter((r) => r.latest).map((r) => r.tag)).toEqual(['v2']);
		expect(page.releases[0]?.assets).toEqual([
			{ id: 5, name: 'a.zip', size: 10, downloads: 2, url: 'https://x/a.zip' },
		]);
		github([
			[/releases\/latest/, 404, { message: 'Not Found' }],
			[/releases\?/, 200, [release(1, { name: '', draft: true, published_at: null })]],
		]);
		const drafts = await releasesOf(R, 'k', 2);
		expect(drafts.more).toBe(false);
		expect(drafts.releases[0]).toMatchObject({ name: 'v1', draft: true, latest: false, publishedAt: null });
		expect(releaseOf({}, 0)).toMatchObject({ id: 0, name: '', latest: true, assets: [] });
	});

	it('asks GitHub to write release notes, from the previous tag when given', async () => {
		const sent = github([[/generate-notes/, 200, { name: 'v2', body: '## What’s changed' }]]);
		expect(await releaseNotes(R, 'k', { tag: 'v2', target: 'main', previous: '' })).toEqual({
			name: 'v2',
			body: '## What’s changed',
		});
		await releaseNotes(R, 'k', { tag: 'v2', target: 'main', previous: 'v1' });
		expect(sent[0]).not.toContain('previous_tag_name');
		expect(sent[1]).toContain('"previous_tag_name":"v1"');
	});
});

describe('history, activity and compare', () => {
	it('pages a branch’s commits, one file’s, by author and dates', async () => {
		const sent = github([
			[/users\/kaizer03/, 200, { node_id: 'U_1' }],
			[
				/graphql/,
				200,
				{
					data: {
						repository: {
							object: {
								history: {
									totalCount: 121,
									pageInfo: { hasNextPage: true, endCursor: 'h1' },
									nodes: [commit()],
								},
							},
						},
					},
				},
			],
		]);
		const all = await historyOf(R, 'k', { ref: 'dev', path: '', author: '', since: '', until: '', after: '' });
		expect(all).toMatchObject({ total: 121, next: 'h1', commits: [{ headline: 'fix: a thing' }] });
		expect(sent[0]).toContain('"author":null');
		await historyOf(R, 'k', {
			ref: 'dev',
			path: 'a.ts',
			author: 'kaizer03',
			since: '2026-11-01',
			until: '2026-11-24',
			after: 'h1',
		});
		const asked = sent[sent.length - 1] as string;
		expect(asked).toContain('"author":{"id":"U_1"}');
		expect(asked).toContain('"since":"2026-11-01T00:00:00Z"');
		expect(asked).toContain('"until":"2026-11-24T23:59:59Z"');
		expect(asked).toContain('"p":"a.ts"');
		github([
			[
				/graphql/,
				200,
				{ data: { repository: { object: { history: { totalCount: 0, pageInfo: {}, nodes: [] } } } } },
			],
		]);
		expect(
			(await historyOf(R, 'k', { ref: 'dev', path: '', author: '', since: '', until: '', after: '' })).next,
		).toBeNull();
	});

	it('reads activity newest first with its filters and next cursor', async () => {
		const sent = github([
			[
				/activity/,
				200,
				[
					{
						activity_type: 'force_push',
						ref: 'refs/heads/dev',
						actor: { login: 'kaizer03' },
						timestamp: '2026-11-23T10:00:00Z',
						before: 'a',
						after: 'b',
					},
				],
				'<https://api.github.com/repos/o/r/activity?after=n1>; rel="next"',
			],
		]);
		expect(await activityOf(R, 'k', { ref: '', actor: '', kind: '', after: '' })).toEqual({
			rows: [
				{
					kind: 'force_push',
					ref: 'dev',
					actor: 'kaizer03',
					at: '2026-11-23T10:00:00Z',
					before: 'a',
					after: 'b',
				},
			],
			next: 'n1',
		});
		await activityOf(R, 'k', { ref: 'dev', actor: 'kaizer03', kind: 'push', after: 'n1' });
		expect(sent[1]).toContain('ref=dev&actor=kaizer03&activity_type=push&after=n1');
	});

	it('compares two refs: the newest 250 commits, newest first, its files and an open pull request', async () => {
		const page = (n: number, from: number) =>
			Array.from({ length: n }, (_, i) => ({
				sha: `s${from + i}`,
				commit: {
					message: `c${from + i}\nbody`,
					author: { name: 'Name' },
					committer: { date: '2026-11-24T00:00:00Z' },
				},
				author: from + i === 0 ? null : { login: 'kaizer03' },
			}));
		const sent = github([
			[
				/compare\/dev\.\.\.feat\/x\?per_page=100&page=1 /,
				200,
				{
					status: 'ahead',
					ahead_by: 450,
					behind_by: 0,
					total_commits: 450,
					merge_base_commit: { sha: 'mb' },
					files: [{ filename: 'a.ts' }],
					commits: page(100, 0),
				},
			],
			[/page=5 /, 200, { commits: page(50, 400) }],
			[/page=4 /, 200, { commits: page(100, 300) }],
			[/page=3 /, 200, { commits: page(100, 200) }],
			[/pulls\?state=open/, 200, [{ number: 7, title: 'feat: x' }]],
		]);
		const c = await compareOf(R, 'k', 'dev', 'feat/x');
		expect(c.commits).toHaveLength(250);
		expect(c.commits[0]?.sha).toBe('s449');
		expect(c.commits[249]?.sha).toBe('s200');
		expect(c).toMatchObject({
			status: 'ahead',
			ahead: 450,
			behind: 0,
			mergeBase: 'mb',
			pull: { number: 7, title: 'feat: x' },
		});
		expect(sent.some((s) => s.includes('page=2 '))).toBe(false);
		expect(sent.find((s) => s.includes('pulls?'))).toContain('head=o%3Afeat%2Fx');
		github([
			[/compare/, 200, { status: 'identical', total_commits: 1, commits: page(1, 0) }],
			[/pulls/, 200, []],
		]);
		const small = await compareOf(R, 'k', 'dev', 'dev');
		expect(small.commits[0]).toMatchObject({ author: 'Name', login: null, headline: 'c0', checks: 'none' });
		expect(small.pull).toBeNull();
	});
});

describe('changes', () => {
	it('send JSON or nothing, and pass GitHub’s refusal on in its own words', async () => {
		const sent = github([
			[/ok/, 200, { done: true }],
			[/empty/, 204, ''],
			[
				/listed/,
				422,
				{ message: 'Validation Failed', errors: [{ message: 'name taken' }, { code: 'invalid' }, {}] },
			],
			[/plain/, 403, { message: 'Forbidden' }],
			[/bare/, 500, ''],
		]);
		expect(await ghSend('POST', 'https://api.github.com/ok', 'k', { a: 1 })).toEqual({ done: true });
		expect(await ghSend('DELETE', 'https://api.github.com/empty', 'k')).toBeNull();
		expect(sent[0]).toContain('{"a":1}');
		await expect(ghSend('POST', 'https://api.github.com/listed', 'k', {})).rejects.toThrow(
			'GitHub refused it: Validation Failed · name taken; invalid.',
		);
		await expect(ghSend('PUT', 'https://api.github.com/plain', 'k')).rejects.toThrow(
			'GitHub refused it: Forbidden.',
		);
		await expect(ghSend('PATCH', 'https://api.github.com/bare', 'k', {})).rejects.toThrow(
			'GitHub refused it: it answered 500.',
		);
	});
});
