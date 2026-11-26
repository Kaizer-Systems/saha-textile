import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	commitFiles,
	createBranch,
	deleteAsset,
	deleteBranch,
	deleteRelease,
	forkRepository,
	openPull,
	renameBranch,
	saveAbout,
	saveRelease,
	setStarred,
	setWatching,
	uploadAsset,
} from './code-writes.js';

/** GitHub's answers by address and body; every call is kept as "METHOD url body". */
type Route = [RegExp, number, unknown];
function github(routes: Route[]) {
	const sent: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const body = typeof init?.body === 'string' ? init.body : init?.body ? '<bytes>' : '';
			const line = `${init?.method ?? 'GET'} ${String(url)} ${body}`;
			sent.push(line);
			const hit = routes.find(([re]) => re.test(line));
			const status = hit?.[1] ?? 200;
			return new Response(status === 204 ? null : JSON.stringify(hit?.[2] ?? {}), { status });
		}),
	);
	return sent;
}
afterEach(() => vi.unstubAllGlobals());

const R = 'o/r';
/** Just the changes, without GitHub's address. */
const changes = (sent: string[]) =>
	sent
		.filter((s) => !s.startsWith('GET'))
		.map((s) => s.replace(/https:\/\/(api|uploads)\.github\.com\/repos\/o\/r/, ''));

describe('branches', () => {
	it('makes one from a ref, renames and deletes one', async () => {
		const sent = github([[/commits\/v1/, 200, { sha: 'abc' }]]);
		expect(await createBranch(R, 'k', 'fix/x', 'v1')).toEqual({
			message: 'Branch fix/x made from v1',
			url: null,
			branch: 'fix/x',
		});
		expect((await renameBranch(R, 'k', 'fix/x', 'fix/y')).message).toBe('Branch fix/x is now fix/y');
		expect((await deleteBranch(R, 'k', 'fix/y')).message).toBe('Branch fix/y deleted');
		expect(changes(sent)).toEqual([
			'POST /git/refs {"ref":"refs/heads/fix/x","sha":"abc"}',
			'POST /branches/fix/x/rename {"new_name":"fix/y"}',
			'DELETE /git/refs/heads/fix/y ',
		]);
	});
});

describe('a commit of files', () => {
	const change = { pin: '123456', branch: 'dev', message: 'docs: a line', description: '', pull: true };
	const answers: Route[] = [
		[/git\/ref\/heads\/dev/, 200, { object: { sha: 'tip1' } }],
		[
			/graphql/,
			200,
			{
				data: {
					createCommitOnBranch: {
						commit: { oid: 'abcdef1234', url: 'https://github.com/o/r/commit/abcdef1234' },
					},
				},
			},
		],
		[/POST .*\/pulls /, 200, { number: 12, html_url: 'https://github.com/o/r/pull/12' }],
	];

	it('goes on a new branch with a pull request, adding and deleting in one signed commit', async () => {
		const sent = github(answers);
		const out = await commitFiles(R, 'k', {
			...change,
			description: 'Why it changed',
			changes: [
				{ path: 'README.md', content: 'IyBTaG9w' },
				{ path: 'old.txt', content: null },
			],
			newBranch: 'docs/readme',
		});
		expect(out).toEqual({
			message: 'abcdef1 committed to docs/readme, pull request #12 opened into dev',
			url: 'https://github.com/o/r/pull/12',
			branch: 'docs/readme',
		});
		const all = changes(sent);
		expect(all[0]).toBe('POST /git/refs {"ref":"refs/heads/docs/readme","sha":"tip1"}');
		const mutation = JSON.parse((all[1] as string).replace(/^POST https:\/\/api\.github\.com\/graphql /, '')) as {
			variables: { input: Record<string, unknown> };
		};
		expect(mutation.variables.input).toEqual({
			branch: { repositoryNameWithOwner: R, branchName: 'docs/readme' },
			message: { headline: 'docs: a line', body: 'Why it changed' },
			fileChanges: { additions: [{ path: 'README.md', contents: 'IyBTaG9w' }], deletions: [{ path: 'old.txt' }] },
			expectedHeadOid: 'tip1',
		});
		expect(all[2]).toBe(
			'POST /pulls {"base":"dev","head":"docs/readme","title":"docs: a line","body":"Why it changed"}',
		);
	});

	it('goes straight onto the branch, or onto a new one without a pull request', async () => {
		const sent = github(answers);
		const straight = await commitFiles(R, 'k', {
			...change,
			changes: [{ path: 'a.txt', content: 'YQ==' }],
			newBranch: '',
		});
		expect(straight).toEqual({
			message: 'abcdef1 committed to dev',
			url: 'https://github.com/o/r/commit/abcdef1234',
			branch: 'dev',
		});
		expect(changes(sent).some((s) => s.includes('/git/refs'))).toBe(false);
		expect(changes(sent)[0]).not.toContain('"body"');
		const noPull = await commitFiles(R, 'k', {
			...change,
			pull: false,
			changes: [{ path: 'a.txt', content: 'YQ==' }],
			newBranch: 'fix/a',
		});
		expect(noPull.message).toBe('abcdef1 committed to fix/a');
		expect(changes(sent).filter((s) => s.includes('/pulls'))).toEqual([]);
	});
});

describe('releases', () => {
	const w = {
		pin: '123456',
		id: null,
		tag: 'v1',
		target: 'main',
		name: '',
		body: 'Notes',
		draft: false,
		prerelease: false,
		latest: true,
		assets: [] as Array<{ name: string; content: string }>,
	};

	it('publishes, saves a draft or a change, and deletes', async () => {
		const sent = github([[/releases/, 200, { html_url: 'https://github.com/o/r/releases/tag/v1' }]]);
		expect(await saveRelease(R, 'k', w)).toEqual({
			message: 'Release v1 published',
			url: 'https://github.com/o/r/releases/tag/v1',
			branch: null,
		});
		expect((await saveRelease(R, 'k', { ...w, draft: true, name: 'First' })).message).toBe(
			'Release First saved as a draft',
		);
		expect((await saveRelease(R, 'k', { ...w, id: 9, prerelease: true })).message).toBe('Release v1 saved');
		expect((await deleteRelease(R, 'k', 9)).message).toBe('Release deleted');
		github([
			[/POST .*\/releases /, 201, { id: 21, html_url: 'https://github.com/o/r/releases/tag/v1' }],
			[/assets\?name=/, 201, {}],
		]);
		const files = [
			{ name: 'a.zip', content: 'eA==' },
			{ name: 'b.zip', content: 'eQ==' },
		];
		expect((await saveRelease(R, 'k', { ...w, assets: files })).message).toBe('Release v1 published with 2 files');
		expect((await saveRelease(R, 'k', { ...w, assets: files.slice(0, 1) })).message).toBe(
			'Release v1 published with 1 file',
		);
		const uploads = vi
			.mocked(fetch)
			.mock.calls.map((c) => String(c[0]))
			.filter((u) => u.includes('/releases/21/assets'));
		expect(uploads).toHaveLength(3);
		const all = changes(sent);
		expect(all[0]).toContain(
			'POST /releases {"tag_name":"v1","target_commitish":"main","name":"v1","body":"Notes","draft":false,"prerelease":false,"make_latest":"true"}',
		);
		expect(all[1]).toContain('"make_latest":"false"');
		expect(all[2]).toMatch(/^PATCH \/releases\/9 .*"make_latest":"false"/);
		expect(all[3]).toBe('DELETE /releases/9 ');
	});

	it('attaches a file through GitHub’s upload address, removes one, and passes a refusal on', async () => {
		const sent = github([
			[
				/assets\?name=a%20b\.zip/,
				201,
				{ browser_download_url: 'https://github.com/o/r/releases/download/v1/a.b.zip' },
			],
			[/assets\?name=plain/, 201, {}],
			[/assets\?name=taken/, 422, { message: 'Validation Failed' }],
			[/assets\?name=broken/, 500, {}],
		]);
		expect(await uploadAsset(R, 'k', 9, 'a b.zip', Buffer.from('zip'))).toEqual({
			message: 'a b.zip attached',
			url: 'https://github.com/o/r/releases/download/v1/a.b.zip',
			branch: null,
		});
		expect((await uploadAsset(R, 'k', 9, 'plain', Buffer.from('x'))).url).toBeNull();
		await expect(uploadAsset(R, 'k', 9, 'taken', Buffer.from('x'))).rejects.toThrow(
			'GitHub refused the file: Validation Failed.',
		);
		await expect(uploadAsset(R, 'k', 9, 'broken', Buffer.from('x'))).rejects.toThrow('it answered 500');
		vi.mocked(fetch).mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }));
		await expect(uploadAsset(R, 'k', 9, 'gateway', Buffer.from('x'))).rejects.toThrow('it answered 502');
		expect(sent[0]).toMatch(
			/^POST https:\/\/uploads\.github\.com\/repos\/o\/r\/releases\/9\/assets\?name=a%20b\.zip <bytes>/,
		);
		expect((await deleteAsset(R, 'k', 5)).message).toBe('File removed from the release');
		expect(changes(sent).pop()).toBe('DELETE /releases/assets/5 ');
	});
});

describe('the repository', () => {
	it('saves About, watching, the star, a fork and a pull request', async () => {
		const sent = github([
			[/forks/, 202, { full_name: 'me/r', html_url: 'https://github.com/me/r' }],
			[/pulls/, 201, { number: 13, html_url: 'https://github.com/o/r/pull/13' }],
			[/starred/, 204, ''],
			[/subscription/, 200, {}],
		]);
		expect((await saveAbout(R, 'k', { description: 'Shop', homepage: '', topics: ['shop'] })).message).toBe(
			'About saved',
		);
		expect((await setWatching(R, 'k', 'subscribed')).message).toBe('Watching all activity');
		expect((await setWatching(R, 'k', 'ignored')).message).toBe('Ignoring');
		expect((await setWatching(R, 'k', 'none')).message).toBe('Watching only when taking part');
		expect((await setStarred(R, 'k', true)).message).toBe('Starred');
		expect((await setStarred(R, 'k', false)).message).toBe('Star removed');
		expect(await forkRepository(R, 'k', { name: '', defaultOnly: true })).toEqual({
			message: 'Forked to me/r',
			url: 'https://github.com/me/r',
			branch: null,
		});
		await forkRepository(R, 'k', { name: 'shop-copy', defaultOnly: false });
		expect(
			(await openPull(R, 'k', { base: 'dev', head: 'fix/a', title: 'fix: a', body: '', draft: true })).message,
		).toBe('Pull request #13 opened');
		expect(changes(sent).map((s) => s.replace('https://api.github.com', ''))).toEqual([
			'PATCH  {"description":"Shop","homepage":""}',
			'PUT /topics {"names":["shop"]}',
			'PUT /subscription {"subscribed":true}',
			'PUT /subscription {"ignored":true}',
			'DELETE /subscription ',
			'PUT /user/starred/o/r ',
			'DELETE /user/starred/o/r ',
			'POST /forks {"default_branch_only":true}',
			'POST /forks {"name":"shop-copy","default_branch_only":false}',
			'POST /pulls {"base":"dev","head":"fix/a","title":"fix: a","body":"","draft":true}',
		]);
	});
});
