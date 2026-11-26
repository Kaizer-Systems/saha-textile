import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	checkEvents,
	checkStatus,
	countChecks,
	eventOf,
	githubCommit,
	githubFile,
	githubPullFiles,
	gh,
	graphql,
	jobLog,
	lastPage,
	pullCommits,
	pullHead,
	compareCounts,
	pullPage,
	pullRows,
	withPushes,
} from './github-pulls.js';

/** GitHub answers by method and address; the first matching route wins; a route can carry a Link header. */
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
			const headers = hit?.[3] ? { link: hit[3] } : undefined;
			return new Response(JSON.stringify(hit?.[2] ?? []), { status: hit?.[1] ?? 200, headers });
		}),
	);
	return sent;
}
afterEach(() => vi.unstubAllGlobals());

const link = (last: number) =>
	`<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=${last}>; rel="last"`;

describe('GitHub’s answers in words', () => {
	it('names a refused key, a missing pull request and any other refusal', async () => {
		github([
			[/one/, 401, {}],
			[/two/, 404, {}],
			[/three/, 502, {}],
		]);
		await expect(gh('https://x/one', 'k')).rejects.toThrow('refused the key (401)');
		await expect(gh('https://x/two', 'k')).rejects.toThrow('(404)');
		await expect(gh('https://x/three', 'k')).rejects.toThrow('GitHub answered 502.');
		github([[/graphql/, 200, { errors: [{ message: 'Resource not accessible' }] }]]);
		await expect(graphql('k', 'q', {})).rejects.toThrow('GitHub refused the request: Resource not accessible.');
		github([[/graphql/, 502, {}]]);
		await expect(graphql('k', 'q', {})).rejects.toThrow('GitHub refused the request: it answered 502.');
		github([[/graphql/, 200, { data: { ok: true } }]]);
		expect(await graphql('k', 'q', {})).toEqual({ ok: true });
		expect(lastPage(null)).toBe(1);
		expect(lastPage(link(7))).toBe(7);
	});

	it('reads checks the same from GitHub’s REST (lower case) and GraphQL (upper case)', () => {
		expect(['queued', 'requested', 'WAITING', 'PENDING'].map((s) => checkStatus(s, ''))).toEqual([
			'queued',
			'queued',
			'queued',
			'queued',
		]);
		expect(checkStatus('in_progress', '')).toBe('running');
		expect(
			['success', 'SKIPPED', 'neutral', 'cancelled', 'failure', 'TIMED_OUT'].map((c) =>
				checkStatus('completed', c),
			),
		).toEqual(['passed', 'skipped', 'neutral', 'cancelled', 'failed', 'failed']);
		expect(countChecks(['queued', 'running', 'passed', 'skipped', 'neutral', 'failed', 'cancelled'])).toEqual({
			total: 7,
			running: 2,
			passed: 3,
			failed: 2,
		});
	});
});

describe('the list', () => {
	it('reads open pull requests with their size, checks and review in one query, and closed ones on asking', async () => {
		const rollup = (nodes: unknown[]) => ({
			totalCount: 1339,
			nodes: [{ commit: { statusCheckRollup: { contexts: { nodes } } } }],
		});
		const sent = github([
			[
				/graphql/,
				200,
				{
					data: {
						repository: {
							pullRequests: {
								nodes: [
									{
										number: 7,
										title: 'feat: everything since PR #6',
										url: 'https://github.com/o/r/pull/7',
										isDraft: false,
										state: 'OPEN',
										updatedAt: '2026-11-24T07:52:00Z',
										headRefName: 'feat/combined-after-pr6',
										baseRefName: 'dev',
										additions: 623963,
										deletions: 41288,
										reviewDecision: 'REVIEW_REQUIRED',
										author: { login: 'kaizer03' },
										commits: rollup([
											{ __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: null },
											{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
											{ __typename: 'StatusContext', state: 'SUCCESS' },
											{ __typename: 'StatusContext', state: 'PENDING' },
											{ __typename: 'StatusContext', state: 'EXPECTED' },
											{ __typename: 'StatusContext', state: 'ERROR' },
										]),
									},
									{
										number: 8,
										title: 'Draft',
										url: 'https://github.com/o/r/pull/8',
										isDraft: true,
										state: 'OPEN',
										reviewDecision: null,
										commits: { totalCount: 0, nodes: [] },
									},
								],
							},
						},
					},
				},
			],
		]);
		const [seven, eight] = await pullRows('o/r', 'k', 'open');
		expect(seven).toMatchObject({
			number: 7,
			author: 'kaizer03',
			branch: 'feat/combined-after-pr6',
			base: 'dev',
			draft: false,
			state: 'open',
			commits: 1339,
			checks: { total: 6, running: 3, passed: 2, failed: 1 },
			review: 'required',
		});
		expect(eight).toMatchObject({ draft: true, checks: null, review: 'none', commits: 0 });
		expect(sent[0]).toContain('"states":["OPEN"]');
		expect(sent[0]).toContain('"owner":"o","name":"r"');
		await pullRows('o/r', 'k', 'closed');
		expect(sent[1]).toContain('"states":["CLOSED","MERGED"]');
	});
});

describe('the conversation', () => {
	const at = '2026-11-24T08:00:00Z';
	it('words every kind of event GitHub keeps, and leaves out the noise', () => {
		const item = (event: string, more: Record<string, unknown> = {}) =>
			eventOf({ event, actor: { login: 'kaizer03' }, created_at: at, ...more });
		expect(item('commented', { body_html: '<p>Hi</p>', html_url: 'u' })).toMatchObject({
			kind: 'commented',
			who: 'kaizer03',
			html: '<p>Hi</p>',
			url: 'u',
		});
		const reviewed = (state: string) =>
			eventOf({ event: 'reviewed', user: { login: 'reviewer' }, submitted_at: at, state, body_html: '' });
		expect(reviewed('approved')).toMatchObject({ who: 'reviewer', at, text: 'approved these changes', tone: 'ok' });
		expect(reviewed('changes_requested')).toMatchObject({ text: 'asked for changes', tone: 'red' });
		expect(reviewed('dismissed')).toMatchObject({ tone: 'muted' });
		expect(reviewed('commented')).toMatchObject({ text: 'reviewed', tone: 'cy' });
		expect(item('labeled', { label: { name: 'ready' } })?.text).toBe('added the label ready');
		expect(item('unlabeled', { label: { name: 'ready' } })?.text).toBe('removed the label ready');
		expect(item('review_requested', { requested_reviewer: { login: 'anna' } })?.text).toBe(
			'asked anna for a review',
		);
		expect(item('review_requested', { requested_team: { name: 'owners' } })?.text).toBe(
			'asked owners for a review',
		);
		expect(item('renamed', { rename: { from: 'Old name' } })?.text).toBe('renamed it from “Old name”');
		expect(item('merged', { commit_id: 'abc' })).toMatchObject({ kind: 'merged', sha: 'abc', tone: 'ok' });
		expect(item('head_ref_force_pushed')).toMatchObject({ kind: 'force-pushed', tone: 'amber' });
		expect(item('closed')?.kind).toBe('closed');
		expect(item('reopened')?.kind).toBe('reopened');
		expect(item('ready_for_review')?.kind).toBe('ready');
		expect(item('subscribed')).toBeNull();
	});

	it('groups commits in a row into one push, as GitHub does', () => {
		const commit = (sha: string, date: string) => ({ event: 'committed', sha, committer: { date } });
		const events = withPushes(
			[
				commit('aaaaaaaa1', '2026-11-24T01:00:00Z'),
				commit('bbbbbbbb2', '2026-11-24T02:00:00Z'),
				{ event: 'commented', actor: { login: 'x' }, created_at: at },
				{ event: 'subscribed' },
				commit('cccccccc3', '2026-11-24T09:00:00Z'),
			],
			'kaizer03',
		);
		expect(events.map((e) => e.text)).toEqual([
			'pushed 2 commits aaaaaaaa … bbbbbbbb',
			'commented',
			'pushed 1 commit cccccccc',
		]);
		expect(events[0]).toMatchObject({ who: 'kaizer03', at: '2026-11-24T02:00:00Z', sha: 'bbbbbbbb2' });
	});

	it('adds the newest commit’s checks: when they started, each failure, and all passed', () => {
		const check = (status: 'running' | 'passed' | 'failed', started: string | null, done: string | null) => ({
			id: 1,
			name: status,
			app: 'GitHub Actions',
			status,
			startedAt: started,
			completedAt: done,
			url: 'u',
			actionsJob: true,
		});
		expect(checkEvents([], 'abc')).toEqual([]);
		const running = checkEvents(
			[
				check('running', '2026-11-24T02:00:00Z', null),
				check('failed', '2026-11-24T01:00:00Z', '2026-11-24T03:00:00Z'),
			],
			'abcdef123',
		);
		expect(running.map((e) => [e.kind, e.at, e.text])).toEqual([
			['checks-started', '2026-11-24T01:00:00Z', '2 checks started on abcdef12'],
			['check-failed', '2026-11-24T03:00:00Z', 'failed failed on abcdef12'],
		]);
		const passed = checkEvents(
			[
				check('passed', null, '2026-11-24T04:00:00Z'),
				check('passed', '2026-11-24T01:00:00Z', '2026-11-24T05:00:00Z'),
			],
			'abc',
		);
		expect(passed.at(-1)).toMatchObject({
			kind: 'checks-passed',
			at: '2026-11-24T05:00:00Z',
			text: 'All 2 checks passed on abc',
		});
	});
});

const PR = {
	number: 7,
	title: 'feat: everything since PR #6',
	state: 'open',
	draft: false,
	user: { login: 'kaizer03' },
	head: { ref: 'feat/combined-after-pr6', sha: 'head1234567' },
	base: { ref: 'dev', sha: 'base1234567' },
	html_url: 'https://github.com/o/r/pull/7',
	created_at: '2026-11-23T13:34:00Z',
	updated_at: '2026-11-24T07:52:00Z',
	merged_at: null,
	merged_by: null,
	closed_at: null,
	body: 'x'.repeat(37071),
	body_html: '<h2>Headline features</h2>',
	commits: 1339,
	additions: 623963,
	deletions: 41288,
	changed_files: 4105,
	mergeable: true,
	mergeable_state: 'blocked',
	auto_merge: null,
	requested_reviewers: [{ login: 'asked' }],
	labels: [{ name: 'big' }],
	node_id: 'PR_node',
};
const RUNS = {
	check_runs: [
		{
			id: 31,
			name: 'Lint',
			status: 'completed',
			conclusion: 'success',
			started_at: '2026-11-24T08:00:00Z',
			completed_at: '2026-11-24T08:03:00Z',
			html_url: 'c',
			app: { name: 'GitHub Actions', slug: 'github-actions' },
		},
		{
			id: 32,
			name: 'Sonar',
			status: 'queued',
			conclusion: null,
			started_at: null,
			completed_at: null,
			html_url: 'd',
			app: { name: 'SonarCloud', slug: 'sonarcloud' },
		},
	],
};

describe('the page', () => {
	it('reads the whole description, the merge status, reviewers and the conversation with its checks', async () => {
		const sent = github([
			[/\/pulls\/7 /, 200, PR],
			[
				/\/pulls\/7\/reviews/,
				200,
				[
					{ user: { login: 'anna' }, state: 'APPROVED' },
					{ user: { login: 'ben' }, state: 'COMMENTED' },
					{ user: { login: 'cy' }, state: 'DISMISSED' },
					{ user: { login: 'dee' }, state: 'CHANGES_REQUESTED' },
				],
			],
			[
				/graphql/,
				200,
				{
					data: {
						repository: { autoMergeAllowed: true, pullRequest: { reviewDecision: 'CHANGES_REQUESTED' } },
					},
				},
			],
			[
				/timeline\?per_page=100&page=1 /,
				200,
				[{ event: 'committed', sha: 'c1', committer: { date: '2026-11-23T14:00:00Z' } }],
				link(12),
			],
			[
				/timeline/,
				200,
				[
					{
						event: 'commented',
						actor: { login: 'anna' },
						created_at: '2026-11-24T09:00:00Z',
						body_html: '<p>ok</p>',
					},
				],
			],
			[/check-runs/, 200, RUNS],
		]);
		const page = await pullPage('o/r', 'k', 7);
		expect(page).toMatchObject({
			state: 'open',
			bodyHtml: '<h2>Headline features</h2>',
			bodyLength: 37071,
			changedFiles: 4105,
			mergeable: true,
			autoMerge: false,
			canAutoMerge: true,
			review: 'changes',
			checks: { total: 2, running: 1, passed: 1, failed: 0 },
			labels: ['big'],
			mergedAt: null,
			closedAt: null,
		});
		expect(page.reviewers).toEqual([
			{ login: 'anna', state: 'approved' },
			{ login: 'ben', state: 'commented' },
			{ login: 'cy', state: 'dismissed' },
			{ login: 'dee', state: 'changes' },
			{ login: 'asked', state: 'requested' },
		]);
		expect(page.checkList.map((c) => [c.status, c.actionsJob, c.startedAt])).toEqual([
			['passed', true, '2026-11-24T08:00:00Z'],
			['queued', false, null],
		]);
		// Twelve pages of conversation: the first, then the newest nine; about 200 events in between stay on GitHub.
		expect(sent.filter((s) => s.includes('timeline')).map((s) => /&page=(\d+)/.exec(s)?.[1])).toEqual([
			'1',
			'4',
			'5',
			'6',
			'7',
			'8',
			'9',
			'10',
			'11',
			'12',
		]);
		expect(page.events.map((e) => e.kind)).toEqual([
			'opened',
			'other',
			'pushed',
			'checks-started',
			...Array(9).fill('commented'),
		]);
		expect(page.events[1]?.text).toBe('about 200 earlier events (mostly commits) are on GitHub');
		expect(sent.find((s) => s.includes('/pulls/7 '))).toBeDefined();
	});

	it('says merged or closed, and adds no check lines then', async () => {
		const merged = {
			...PR,
			state: 'closed',
			merged_at: '2026-11-25T00:00:00Z',
			merged_by: { login: 'kaizer03' },
			closed_at: '2026-11-25T00:00:00Z',
			mergeable: null,
			auto_merge: { method: 'merge' },
		};
		github([
			[/\/pulls\/7 /, 200, merged],
			[
				/graphql/,
				200,
				{ data: { repository: { autoMergeAllowed: false, pullRequest: { reviewDecision: null } } } },
			],
			[/check-runs/, 200, RUNS],
		]);
		const page = await pullPage('o/r', 'k', 7);
		expect(page).toMatchObject({
			state: 'merged',
			mergedBy: 'kaizer03',
			mergeable: null,
			autoMerge: true,
			canAutoMerge: false,
			review: 'none',
		});
		expect(page.events.map((e) => e.kind)).toEqual(['opened']);
		github([
			[/\/pulls\/7 /, 200, { ...PR, state: 'closed', closed_at: '2026-11-25T00:00:00Z' }],
			[/graphql/, 200, { data: {} }],
			[/check-runs/, 200, {}],
		]);
		expect((await pullPage('o/r', 'k', 7)).state).toBe('closed');
	});
});

describe('commits', () => {
	it('pages newest first past GitHub’s 250, with each commit’s checks', async () => {
		const sent = github([
			[/\/pulls\/7 /, 200, PR],
			[/compare\/base1234567\.\.\.head1234567\?per_page=1 /, 200, { total_commits: 250 }],
			[
				/compare/,
				200,
				{
					commits: [
						{
							sha: 'old1',
							node_id: 'n1',
							author: null,
							commit: {
								message: 'first\n\nbody',
								author: { name: 'Owner', date: '2026-11-07T00:00:00Z' },
							},
						},
						{
							sha: 'new1',
							node_id: 'n2',
							author: { login: 'kaizer03' },
							commit: { message: 'second', author: { name: 'Owner', date: '2026-11-08T00:00:00Z' } },
						},
						{
							sha: 'new2',
							node_id: 'n3',
							author: { login: 'kaizer03' },
							commit: { message: 'third', author: { date: '2026-11-08T00:00:00Z' } },
						},
					],
				},
			],
			[
				/graphql/,
				200,
				{
					data: {
						nodes: [
							{ oid: 'old1', statusCheckRollup: { state: 'FAILURE' } },
							{ oid: 'new1', statusCheckRollup: { state: 'SUCCESS' } },
							{ oid: 'new2', statusCheckRollup: null },
						],
					},
				},
			],
		]);
		const page = await pullCommits('o/r', 'k', 7, 1);
		expect(page).toMatchObject({ total: 250, page: 1, pages: 3 });
		expect(page.commits.map((c) => [c.sha, c.headline, c.author, c.checks])).toEqual([
			['new2', 'third', 'kaizer03', 'none'],
			['new1', 'second', 'kaizer03', 'passed'],
			['old1', 'first', 'Owner', 'failed'],
		]);
		// The newest page is GitHub's last.
		expect(sent.some((s) => s.includes('per_page=100&page=3'))).toBe(true);
		expect(await pullCommits('o/r', 'k', 7, 4)).toEqual({ total: 250, page: 4, pages: 3, commits: [] });
	});

	it('leaves commits’ checks unknown when GraphQL refuses', async () => {
		github([
			[/\/pulls\/7 /, 200, PR],
			[/per_page=1 /, 200, { total_commits: 1 }],
			[
				/compare/,
				200,
				{ commits: [{ sha: 'a', node_id: 'n', commit: { message: 'one', author: { name: 'O', date: 'd' } } }] },
			],
			[/graphql/, 502, {}],
		]);
		expect((await pullCommits('o/r', 'k', 7, 1)).commits[0]?.checks).toBe('none');
	});
});

describe('files', () => {
	it('reads GitHub’s file entries, renames and binary files included', () => {
		expect(
			githubFile({
				filename: 'a.ts',
				status: 'modified',
				additions: 2,
				deletions: 1,
				changes: 3,
				patch: '@@ -1 +1 @@',
			}),
		).toEqual({
			file: { path: 'a.ts', previous: null, status: 'modified', additions: 2, deletions: 1, binary: false },
			patch: '@@ -1 +1 @@',
		});
		expect(githubFile({ filename: 'logo.png', status: 'modified', changes: 0 }).file.binary).toBe(true);
		expect(
			githubFile({ filename: 'b.ts', previous_filename: 'a.ts', status: 'renamed', changes: 0 }).file,
		).toMatchObject({ previous: 'a.ts', binary: false });
		expect(githubFile({ filename: 'huge.json', status: 'modified', changes: 90000 }).file.binary).toBe(false);
	});

	it('reads the head and every page of the list, up to GitHub’s 3,000', async () => {
		const sent = github([
			[/\/pulls\/7 /, 200, PR],
			[
				/files/,
				200,
				[{ filename: 'a.ts', status: 'added', additions: 1, changes: 1, patch: '@@ -0,0 +1 @@\n+a' }],
			],
		]);
		expect(await pullHead('o/r', 'k', 7)).toEqual({
			base: 'dev',
			baseSha: 'base1234567',
			headSha: 'head1234567',
			changedFiles: 4105,
		});
		expect(await githubPullFiles('o/r', 'k', 7, 0)).toEqual([]);
		expect(await githubPullFiles('o/r', 'k', 7, 250)).toHaveLength(3);
		await githubPullFiles('o/r', 'k', 7, 4105);
		expect(sent.filter((s) => s.includes('/files?')).length).toBe(3 + 30);
	});

	it('compares a branch with a commit: commits ahead, files listed, and the branch’s own commit', async () => {
		const sent = github([
			[
				/compare\/feat\/combined-after-pr6\.\.\.head1234567\?per_page=1/,
				200,
				{ total_commits: 1383, files: [{}, {}], base_commit: { sha: 'b'.repeat(40) } },
			],
		]);
		expect(await compareCounts('o/r', 'k', 'feat/combined-after-pr6', 'head1234567')).toEqual({
			commits: 1383,
			files: 2,
			baseSha: 'b'.repeat(40),
		});
		expect(sent).toHaveLength(1);
	});

	it('reads one commit with its checks and every page of its files', async () => {
		github([
			[/commits\/abc\?page=2/, 200, { files: [{ filename: 'b.ts', status: 'added', changes: 1, patch: '+' }] }],
			[/commits\/abc\/check-runs/, 200, RUNS],
			[
				/commits\/abc /,
				200,
				{
					sha: 'abc',
					author: null,
					commit: { message: 'fix: x\n\nWhy', author: { name: 'Owner', date: 'd' } },
					files: [{ filename: 'a.ts', status: 'modified', changes: 2, patch: '@@' }],
				},
				link(2),
			],
		]);
		const c = await githubCommit('o/r', 'k', 'abc');
		expect(c).toMatchObject({
			sha: 'abc',
			message: 'fix: x\n\nWhy',
			author: 'Owner',
			checks: { total: 2, running: 1 },
			cut: false,
		});
		expect(c.files.map((f) => f.file.path)).toEqual(['a.ts', 'b.ts']);
		const sent = github([
			[/check-runs/, 200, {}],
			[/commits\/big /, 200, { sha: 'big', author: { login: 'kaizer03' }, commit: { author: {} } }, link(14)],
			[/commits\/big\?page/, 200, {}],
		]);
		const big = await githubCommit('o/r', 'k', 'big');
		expect(big).toMatchObject({ author: 'kaizer03', cut: true, files: [] });
		expect(sent.filter((s) => s.includes('commits/big?page=')).length).toBe(9);
	});
});

describe('a check’s log', () => {
	it('keeps the last lines, marks the errors, and says when GitHub refuses', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) =>
				String(url).includes('/jobs/9/')
					? new Response(
							'2026-11-24T08:00:00.0000000Z one\n2026-11-24T08:00:01.0000000Z ##[error]two\nthree',
							{ status: 200 },
						)
					: new Response('', { status: 410 }),
			),
		);
		expect(await jobLog('o/r', 'k', '9', 2)).toEqual([
			{ n: 2, text: '##[error]two', bad: true },
			{ n: 3, text: 'three', bad: false },
		]);
		expect(await jobLog('o/r', 'k', '8')).toEqual([
			{
				n: 0,
				text: 'GitHub answered 410 for this job’s log (it may still be running, or older than 90 days).',
				bad: false,
			},
		]);
	});
});
