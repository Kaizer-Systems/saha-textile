import { afterEach, describe, expect, it, vi } from 'vitest';

import { PIPELINE_EXTRA, PULLS_EXTRA, ROLLBACK_EXTRA, SECRETS_EXTRA, depsAlertsScreen } from './gh-more.js';

import type { ProductCtx } from './kit.js';

/** GitHub answers locally by method and address; the first matching route wins. */
type Route = [RegExp, number, unknown];
function github(routes: Route[]) {
	const sent: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const line = `${init?.method ?? 'GET'} ${String(url)}`;
			sent.push(`${line} ${typeof init?.body === 'string' ? init.body : ''}`.trim());
			const hit = routes.find(([re]) => re.test(line));
			const status = hit?.[1] ?? 200;
			if (status === 204) return new Response(null, { status });
			return new Response(JSON.stringify(hit?.[2] ?? []), { status });
		}),
	);
	return sent;
}
let n = 0;
const ctx = (over: Partial<ProductCtx> = {}): ProductCtx => {
	const i = ++n;
	return {
		key: `gh-more-key-${i}`,
		id: null,
		repository: 'owner/shop',
		writeKey: async () => `gh-more-write-${i}`,
		...over,
	} as unknown as ProductCtx;
};
const write = (values: Record<string, unknown>, id: string | null = null, confirm = '') =>
	({ pin: '123456', confirm, id, values }) as never;
const shown = (v: unknown) => JSON.stringify(v);
const changes = (sent: string[]) =>
	sent.filter((s) => !s.startsWith('GET')).map((s) => s.replace(/ .*\/repos\/owner\/shop/, ' '));

afterEach(() => vi.unstubAllGlobals());

const OPEN = [
	{
		number: 7,
		title: 'New sarees',
		state: 'open',
		head: { ref: 'feat/sarees', sha: 'abc', repo: { full_name: 'owner/shop' } },
	},
	{ number: 8, title: 'Docs', state: 'open', head: { ref: 'dev', sha: 'def', repo: { full_name: 'owner/shop' } } },
	{
		number: 11,
		title: 'Fork',
		state: 'open',
		head: { ref: 'patch', sha: 'f00', repo: { full_name: 'someone/shop' } },
	},
];
const CLOSED = [
	{ number: 9, title: 'Old', state: 'closed', merged_at: null, head: { sha: 'old' } },
	{ number: 10, title: 'Merged', state: 'closed', merged_at: '2026-11-01T00:00:00Z' },
];
const PULLS: Route[] = [
	[/(PUT|PATCH|POST|DELETE)/, 200, {}],
	[/pulls\?state=open/, 200, OPEN],
	[/pulls\?state=closed/, 200, CLOSED],
];

describe('pull requests', () => {
	it('merges by the method asked for, deleting only a feature branch of this repository', async () => {
		const sent = github(PULLS);
		const merge = PULLS_EXTRA.forms?.['merge'];
		await expect(merge?.send(ctx(), write({}, '99', '99'))).rejects.toThrow('Choose an open pull request.');
		expect(
			(await merge?.send(ctx(), write({ method: 'squash', title: 'Sarees', deleteBranch: true }, '7', '7')))
				?.message,
		).toBe('#7 merged (squash)');
		expect(
			(await merge?.send(ctx({ id: '8' }), write({ method: 'octopus', deleteBranch: true }, null, '8')))?.message,
		).toBe('#8 merged (merge)');
		await merge?.send(ctx(), write({ deleteBranch: true }, '11', '11'));
		expect(changes(sent)).toEqual([
			'PUT /pulls/7/merge {"merge_method":"squash","commit_title":"Sarees"}',
			'DELETE /git/refs/heads/feat%2Fsarees {}',
			'PUT /pulls/8/merge {"merge_method":"merge"}',
			'PUT /pulls/11/merge {"merge_method":"merge"}',
		]);
	});

	it('sends a review, asking for words unless it approves', async () => {
		const sent = github(PULLS);
		const review = PULLS_EXTRA.forms?.['review'];
		await expect(review?.send(ctx(), write({ event: 'APPROVE' }))).rejects.toThrow('Choose a pull request.');
		await expect(review?.send(ctx(), write({ event: 'LIKE' }, '7'))).rejects.toThrow('Choose a review.');
		await expect(review?.send(ctx(), write({ event: 'COMMENT' }, '7'))).rejects.toThrow('Write the comment.');
		expect((await review?.send(ctx({ id: '7' }), write({ event: 'APPROVE' })))?.message).toBe('#7: approve sent');
		expect(
			(await review?.send(ctx(), write({ event: 'REQUEST_CHANGES', body: 'Fix the price' }, '7')))?.message,
		).toBe('#7: request changes sent');
		expect(changes(sent)[1]).toBe('POST /pulls/7/reviews {"event":"REQUEST_CHANGES","body":"Fix the price"}');
	});

	it('posts a comment on the conversation, asking for words', async () => {
		const sent = github(PULLS);
		const comment = PULLS_EXTRA.forms?.['comment'];
		expect(shown(await comment?.read(ctx({ id: '7' })))).toContain('Comment on #7');
		expect(shown(await comment?.read(ctx()))).toContain('Open a pull request first.');
		await expect(comment?.send(ctx(), write({ body: 'Hi' }))).rejects.toThrow('Choose a pull request.');
		await expect(comment?.send(ctx(), write({ body: ' ' }, '7'))).rejects.toThrow('Write the comment.');
		expect((await comment?.send(ctx({ id: '7' }), write({ body: 'Looks good' })))?.message).toBe(
			'#7: comment posted',
		);
		expect(changes(sent)).toEqual(['POST /issues/7/comments {"body":"Looks good"}']);
	});

	it('turns merge when ready on and off through GitHub’s GraphQL', async () => {
		const sent = github([
			[/GET .*\/pulls\/7$/, 200, { number: 7, node_id: 'PR_7' }],
			[/graphql/, 200, { data: {} }],
		]);
		const auto = PULLS_EXTRA.forms?.['automerge'];
		expect(shown(await auto?.read(ctx({ id: '7' })))).toContain('Merge #7 when ready');
		expect(shown(await auto?.read(ctx()))).toContain('Open a pull request first.');
		await expect(auto?.send(ctx(), write({ on: true }))).rejects.toThrow('Choose a pull request.');
		expect((await auto?.send(ctx(), write({ on: true }, '7')))?.message).toBe('#7: merge when ready is on');
		expect((await auto?.send(ctx({ id: '7' }), write({ on: false })))?.message).toBe('#7: merge when ready is off');
		const asked = sent.filter((s) => s.includes('graphql'));
		expect(asked[0]).toContain('enablePullRequestAutoMerge');
		expect(asked[0]).toContain('"id":"PR_7"');
		expect(asked[1]).toContain('disablePullRequestAutoMerge');
	});

	it('changes the base branch, refusing the same base, the head branch and anything not a branch', async () => {
		const sent = github([
			[/GET .*\/pulls\/7$/, 200, { number: 7, base: { ref: 'dev' }, head: { ref: 'feat/combined-after-pr6' } }],
			[/PATCH .*\/pulls\/7$/, 200, {}],
		]);
		const base = PULLS_EXTRA.forms?.['base'];
		const form = shown(await base?.read(ctx({ id: '7:staging' })));
		expect(form).toContain('Change the base branch');
		expect(form).toContain('was dev');
		expect(form).toContain('worked out again against staging');
		expect(form).toContain('"blocked":null');
		expect(shown(await base?.read(ctx({ id: '7:dev' })))).toContain('#7 already merges into dev.');
		expect(shown(await base?.read(ctx({ id: '7:feat/combined-after-pr6' })))).toContain(
			'feat/combined-after-pr6 is the branch #7 comes from.',
		);
		expect(shown(await base?.read(ctx({ id: '7' })))).toContain('Choose a branch.');
		expect(shown(await base?.read(ctx()))).toContain('Open a pull request first.');
		await expect(base?.send(ctx(), write({ base: 'staging' }))).rejects.toThrow('Choose a branch.');
		await expect(base?.send(ctx(), write({ base: 'a..b' }, '7:a..b'))).rejects.toThrow('Choose a branch.');
		expect((await base?.send(ctx(), write({}, '7:staging')))?.message).toBe('#7 now merges into staging');
		expect((await base?.send(ctx({ id: '7:x' }), write({ base: 'main' })))?.message).toBe(
			'#7 now merges into main',
		);
		expect(changes(sent)).toEqual(['PATCH /pulls/7 {"base":"staging"}', 'PATCH /pulls/7 {"base":"main"}']);
	});

	it('closes, reopens, updates and re-runs failed checks, and refuses anything else', async () => {
		const sent = github([
			[
				/actions\/runs\?head_sha=abc/,
				200,
				{
					workflow_runs: [
						{ id: 1, conclusion: 'failure' },
						{ id: 2, conclusion: 'success' },
					],
				},
			],
			[
				/actions\/runs\?head_sha=def/,
				200,
				{
					workflow_runs: [
						{ id: 3, conclusion: 'timed_out' },
						{ id: 4, conclusion: 'cancelled' },
					],
				},
			],
			...PULLS,
		]);
		const state = PULLS_EXTRA.forms?.['prstate'];
		expect(shown(await state?.read(ctx({ id: '9' })))).toContain('"value":"reopen"');
		expect(shown(await state?.read(ctx({ id: '7' })))).toContain('"value":"update"');
		await expect(state?.send(ctx(), write({ what: 'close' }, '10'))).rejects.toThrow('Choose a pull request.');
		expect((await state?.send(ctx(), write({ what: 'close' }, '7')))?.message).toBe('#7 closed');
		expect((await state?.send(ctx({ id: '9' }), write({ what: 'reopen' })))?.message).toBe('#9 reopened');
		expect((await state?.send(ctx(), write({ what: 'update' }, '7')))?.message).toBe(
			'#7: branch brought up to date',
		);
		expect((await state?.send(ctx(), write({ what: 'recheck' }, '7')))?.message).toBe(
			'#7: 1 failed run started again',
		);
		expect((await state?.send(ctx(), write({ what: 'recheck' }, '8')))?.message).toBe(
			'#8: 2 failed runs started again',
		);
		await expect(state?.send(ctx(), write({ what: 'merge' }, '7'))).rejects.toThrow('Choose what to do.');
		expect(changes(sent)).toContain('PUT /pulls/7/update-branch {"expected_head_sha":"abc"}');
	});
});

describe('runs, workflows and releases', () => {
	it('cancels or re-runs a run, and turns a workflow on or off', async () => {
		const sent = github([
			[/(POST|PUT)/, 204, null],
			[
				/actions\/runs/,
				200,
				{
					workflow_runs: [
						{ id: 1, name: 'CI', head_branch: 'dev', status: 'completed', conclusion: 'failure' },
						{ id: 2, name: 'Deploy', head_branch: 'main', status: 'in_progress' },
					],
				},
			],
		]);
		const view = shown(await PIPELINE_EXTRA.forms?.['run']?.read(ctx()));
		expect(view).toContain('CI · dev · completed (failure)');
		expect(view).toContain('Deploy · main · in_progress"');
		const run = PIPELINE_EXTRA.forms?.['run'];
		await expect(run?.send(ctx(), write({ what: 'cancel' }))).rejects.toThrow('Choose a run.');
		expect((await run?.send(ctx(), write({ what: 'cancel' }, '2')))?.message).toBe('Run 2: cancelled');
		expect((await run?.send(ctx({ id: '1' }), write({ what: 'rerun' })))?.message).toBe('Run 1: started again');
		await expect(run?.send(ctx(), write({ what: 'pause' }, '1'))).rejects.toThrow('Choose what to do.');
		const flow = PIPELINE_EXTRA.forms?.['workflow'];
		await expect(flow?.send(ctx(), write({ on: 'on' }))).rejects.toThrow('Choose a workflow.');
		expect((await flow?.send(ctx(), write({ on: 'on' }, '5')))?.message).toBe('Workflow 5 on');
		expect((await flow?.send(ctx({ id: '5' }), write({ on: 'off' })))?.message).toBe('Workflow 5 off');
		expect(changes(sent).slice(-2)).toEqual([
			'PUT /actions/workflows/5/enable {}',
			'PUT /actions/workflows/5/disable {}',
		]);
	});

	it('reads a running workflow as on, and one turned off as off', async () => {
		github([
			[
				/actions\/workflows/,
				200,
				{
					workflows: [
						{ id: 5, name: 'CI', state: 'active' },
						{ id: 6, name: 'Deploy', state: 'disabled_manually' },
					],
				},
			],
		]);
		const flow = PIPELINE_EXTRA.forms?.['workflow'];
		const on = shown(await flow?.read(ctx({ id: '5' })));
		expect(on).toContain('CI (active)');
		expect(on).toContain('"value":"on"');
		expect(shown(await flow?.read(ctx({ id: '6' })))).toContain('"value":"off"');
	});

	it('publishes, drafts and saves releases, and deletes one with or without its tag', async () => {
		const sent = github([
			[/(POST|PATCH|DELETE)/, 200, {}],
			[/releases/, 200, [{ id: 1, tag_name: 'v1.0.0', name: 'First', draft: true }]],
		]);
		const release = ROLLBACK_EXTRA.forms?.['release'];
		const edit = shown(await release?.read(ctx({ id: '1' })));
		expect(edit).toContain('Edit v1.0.0');
		expect(edit).toContain('v1.0.0 First (draft)');
		expect(shown(await release?.read(ctx()))).toContain('Publish release');
		await expect(release?.send(ctx(), write({ tag: 'v 1' }))).rejects.toThrow('Tag like v1.4.0.');
		expect((await release?.send(ctx(), write({ tag: 'v1.1.0', body: 'Notes' }, 'new')))?.message).toBe(
			'Release v1.1.0 published',
		);
		expect((await release?.send(ctx(), write({ tag: 'v1.2.0', draft: true })))?.message).toBe(
			'Release v1.2.0 saved as draft',
		);
		expect((await release?.send(ctx(), write({ name: 'First', target: 'dev' }, '1')))?.message).toBe(
			'Release saved',
		);
		const posts = changes(sent);
		expect(posts[0]).not.toContain('generate_release_notes');
		expect(posts[1]).toContain('"generate_release_notes":true');
		const del = ROLLBACK_EXTRA.forms?.['releasedelete'];
		await expect(del?.send(ctx(), write({}, '9', 'v9'))).rejects.toThrow('Choose a release.');
		expect((await del?.send(ctx(), write({ tagToo: true }, '1', 'v1.0.0')))?.message).toBe(
			'Release v1.0.0 deleted with its tag',
		);
		expect((await del?.send(ctx({ id: '1' }), write({}, null, 'v1.0.0')))?.message).toBe('Release v1.0.0 deleted');
		expect(changes(sent).filter((s) => s.startsWith('DELETE'))).toEqual([
			'DELETE /releases/1 {}',
			'DELETE /git/refs/tags/v1.0.0 {}',
			'DELETE /releases/1 {}',
		]);
	});
});

describe('Actions variables and alerts', () => {
	it('lists repository and environment variables, and adds, changes and deletes them', async () => {
		const sent = github([
			[/(POST|PATCH|DELETE)/, 204, null],
			[/environments\/staging\/variables/, 200, { variables: [{ name: 'API_URL' }] }],
			[/environments\/production\/variables/, 403, { message: 'No' }],
			[/environments/, 200, { environments: [{ name: 'staging' }, { name: 'production' }] }],
			[/actions\/variables/, 200, { variables: [{ name: 'SHOP' }] }],
		]);
		const view = shown(await SECRETS_EXTRA.tabs?.['variables']?.(ctx({ id: 'staging:API_URL' })));
		expect(view).toContain('API_URL (staging)');
		expect(view).toContain('SHOP (repository)');
		const vars = SECRETS_EXTRA.forms?.['variables'];
		await expect(vars?.send(ctx(), write({ name: 'x y' }))).rejects.toThrow('Name: capitals');
		await expect(vars?.send(ctx(), write({}, 'LONELY'))).rejects.toThrow('Name: capitals');
		await expect(vars?.send(ctx(), write({ name: 'NEW', delete: true }, 'new'))).rejects.toThrow(
			'Choose a variable to delete.',
		);
		expect((await vars?.send(ctx(), write({ name: 'api_url', value: 'https://api.example.test' })))?.message).toBe(
			'API_URL saved (repository)',
		);
		expect((await vars?.send(ctx(), write({ value: 'x' }, ':SHOP')))?.message).toBe('SHOP saved (repository)');
		expect((await vars?.send(ctx(), write({ value: 'y' }, 'staging:API_URL')))?.message).toBe(
			'API_URL saved (staging)',
		);
		expect((await vars?.send(ctx({ id: 'staging:API_URL' }), write({ delete: true })))?.message).toBe(
			'API_URL deleted',
		);
		expect(changes(sent)).toEqual([
			'POST /actions/variables {"name":"API_URL","value":"https://api.example.test"}',
			'PATCH /actions/variables/SHOP {"name":"SHOP","value":"x"}',
			'PATCH /environments/staging/variables/API_URL {"name":"API_URL","value":"y"}',
			'DELETE /environments/staging/variables/API_URL {}',
		]);
		github([[/./, 403, { message: 'No' }]]);
		expect(shown(await SECRETS_EXTRA.tabs?.['variables']?.(ctx()))).toContain('New variable');
	});

	it('dismisses an open alert with a reason, and reopens a dismissed one', async () => {
		const sent = github([
			[/PATCH/, 200, {}],
			[
				/dependabot\/alerts/,
				200,
				[
					{
						number: 1,
						state: 'dismissed',
						dependency: { package: { name: 'sharp' } },
						security_advisory: { severity: 'high' },
					},
					{ number: 2, state: 'open', dependency: { package: { name: 'axios' } } },
				],
			],
			[
				/code-scanning\/alerts/,
				200,
				[
					{ number: 3, state: 'open', rule: { description: 'SQL injection' } },
					{ number: 4, state: 'dismissed', rule: { id: 'js/xss' } },
				],
			],
		]);
		const dismiss = depsAlertsScreen.forms.dismiss;
		expect(shown(await dismiss.read(ctx({ id: 'dependabot:1' })))).toContain('"submit":"Reopen"');
		expect(shown(await dismiss.read(ctx({ id: 'code-scanning:3' })))).toContain('"value":"false positive"');
		expect(shown(await depsAlertsScreen.tabs.dismiss(ctx({ id: 'dependabot:2' })))).toContain(
			'"value":"tolerable_risk"',
		);
		await expect(dismiss.send(ctx(), write({}, 'dependabot:9'))).rejects.toThrow('Choose an alert.');
		expect((await dismiss.send(ctx(), write({}, 'dependabot:1')))?.message).toBe('sharp reopened');
		expect((await dismiss.send(ctx({ id: 'dependabot:2' }), write({})))?.message).toBe('axios dismissed');
		expect(
			(await dismiss.send(ctx(), write({ reason: "won't fix", comment: 'Test only' }, 'code-scanning:3')))
				?.message,
		).toBe('SQL injection dismissed');
		expect((await dismiss.send(ctx(), write({}, 'code-scanning:4')))?.message).toBe('js/xss reopened');
		expect((await dismiss.send(ctx(), write({}, 'code-scanning:3')))?.message).toBe('SQL injection dismissed');
		expect(changes(sent)).toEqual([
			'PATCH /dependabot/alerts/1 {"state":"open"}',
			'PATCH /dependabot/alerts/2 {"state":"dismissed","dismissed_reason":"tolerable_risk","dismissed_comment":""}',
			'PATCH /code-scanning/alerts/3 {"state":"dismissed","dismissed_reason":"won\'t fix","dismissed_comment":"Test only"}',
			'PATCH /code-scanning/alerts/4 {"state":"open"}',
			'PATCH /code-scanning/alerts/3 {"state":"dismissed","dismissed_reason":"false positive","dismissed_comment":""}',
		]);
		github([[/./, 403, { message: 'No' }]]);
		expect(shown(await dismiss.read(ctx()))).toContain('No Dependabot or code-scanning alerts');
	});
});
