import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodeController } from './code.controller.js';
import { CODE_REFSPECS, CodeService, communityFrom } from './code.service.js';

import type { LockService } from '../lock/lock.service.js';
import type { VendorReadsService } from '../projects/vendor-reads.service.js';
import type { RepoCopy } from '../pulls/repo-copy.js';
import type { ConsoleStore } from '../store/console-store.js';

/** GitHub's answers by address and body; every call is kept as "METHOD url body". */
type Route = [RegExp, unknown, number?];
function github(routes: Route[]) {
	const sent: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const body = typeof init?.body === 'string' ? init.body : '';
			const line = `${init?.method ?? 'GET'} ${String(url)} ${body}`;
			sent.push(line);
			const hit = routes.find(([re]) => re.test(line));
			const answer = hit?.[1] ?? {};
			return new Response(typeof answer === 'string' ? answer : JSON.stringify(answer), {
				status: hit?.[2] ?? 200,
			});
		}),
	);
	return sent;
}
afterEach(() => vi.unstubAllGlobals());

/** The repository's key lookup, as VendorReadsService does it: the read's answer, or its refusal in words. */
const reads = {
	sourceCode: async (_p: string, _r: string, read: (repo: string, key: string) => Promise<unknown>) => {
		try {
			return { state: 'ok', readAt: 'now', data: await read('o/r', 'k') };
		} catch (error) {
			return { state: 'error', message: (error as Error).message };
		}
	},
} as unknown as VendorReadsService;

const SHA = 'a'.repeat(40);
/** The copy answering git from memory: a top folder, a README, a picture, a search and a blame. */
function copyOf() {
	const asked: string[] = [];
	const copy = {
		ready: vi.fn(async () => '/copy'),
		run: vi.fn(async (_dir: string, args: string[]) => {
			asked.push(args.join(' '));
			if (args[0] === 'ls-tree' && args.includes('-r'))
				return 'README.md\x00LICENSE\x00.github/SECURITY.md\x00apps/a.ts\x00';
			if (args[0] === 'ls-tree') return `040000 tree x\tapps\x00100644 blob y\tREADME.md\x00`;
			if (args[0] === 'log') return `\x1e${SHA}\x1ffix: a\x1f2026-11-24T00:00:00Z\nREADME.md\napps/a.ts\n`;
			if (args[0] === 'cat-file') return '12\n';
			if (args[0] === 'grep') return `${SHA}:apps/a.ts\x001\x00const port = 1;\n`;
			return `${SHA} 1 1 1\nauthor Test\nauthor-time 1\nsummary first\n\tline one\n`;
		}),
		bytes: vi.fn(async (_dir: string, object: string) =>
			object.endsWith('data.bin')
				? Buffer.from([0, 1])
				: object.endsWith('LICENSE')
					? Buffer.from('<a href="x">&</a>')
					: Buffer.from('# Shop\n'),
		),
		files: vi.fn(async () => [
			{ path: 'big.ts', previous: null, status: 'added', additions: 1, deletions: 0, binary: false },
		]),
		diff: vi.fn(async () => ({
			binary: false,
			sizeBefore: null,
			sizeAfter: null,
			lines: [{ kind: 'add', old: null, new: 1, text: 'x' }],
		})),
	};
	return { copy: copy as unknown as RepoCopy, asked, raw: copy };
}
const store = () => {
	const audit = vi.fn();
	return { store: { audit } as unknown as ConsoleStore, audit };
};
const ok = <T>(a: unknown) => (a as { state: string; data: T }).data;

const HEAD: Route = [
	/graphql.*\^\{commit\}/,
	{
		data: {
			repository: {
				object: {
					oid: SHA,
					history: {
						totalCount: 1700,
						nodes: [
							{
								oid: SHA,
								messageHeadline: 'fix: a',
								committedDate: '2026-11-24T00:00:00Z',
								author: { name: 'T' },
							},
						],
					},
				},
			},
		},
	},
];

describe('the Code pages’ reads', () => {
	it('names the community files a branch has', () => {
		expect(
			communityFrom([
				'README.md',
				'docs/CODE_OF_CONDUCT.md',
				'CONTRIBUTING',
				'LICENSE.txt',
				'.github/SECURITY.md',
				'a.ts',
			]),
		).toEqual([
			{ key: 'readme', label: 'README', path: 'README.md' },
			{ key: 'conduct', label: 'Code of conduct', path: 'docs/CODE_OF_CONDUCT.md' },
			{ key: 'contributing', label: 'Contributing', path: 'CONTRIBUTING' },
			{ key: 'license', label: 'License', path: 'LICENSE.txt' },
			{ key: 'security', label: 'Security', path: '.github/SECURITY.md' },
		]);
		expect(communityFrom(['apps/README.md'])).toEqual([]);
	});

	it('reads the repository with its community files, a folder with its entries’ last commits and README, and every path', async () => {
		const { copy, raw } = copyOf();
		const s = new CodeService(reads, copy, store().store);
		github([
			HEAD,
			[/graphql.*viewerSubscription/, { data: { repository: { defaultBranchRef: { name: 'main' } } } }],
			[/contributors/, []],
			[/readme\?ref=dev/, { path: 'README.md' }],
		]);
		vi.mocked(fetch).mockImplementation(async (url, init) => {
			const u = String(url);
			const body = typeof init?.body === 'string' ? init.body : '';
			if (u.includes('graphql') && body.includes('viewerSubscription'))
				return new Response(JSON.stringify({ data: { repository: { defaultBranchRef: { name: 'main' } } } }));
			if (u.includes('graphql')) return new Response(JSON.stringify(HEAD[1]));
			if (u.includes('/readme')) {
				const html = (init?.headers as Record<string, string>)['accept'] === 'application/vnd.github.html+json';
				return new Response(html ? '<p>Shop</p>' : JSON.stringify({ path: 'README.md' }));
			}
			return new Response('[]');
		});
		const repo = ok<{ community: unknown[]; defaultBranch: string }>(await s.repo('p', 'r'));
		expect(repo.community.map((c) => (c as { key: string }).key)).toEqual(['readme', 'license', 'security']);
		expect(raw.ready).toHaveBeenCalledWith('o/r', 'k', [SHA], CODE_REFSPECS);
		const tree = ok<{
			entries: Array<{ name: string; last: { headline: string } | null }>;
			readme: unknown;
			commits: number;
		}>(await s.tree('p', 'r', 'dev', ''));
		expect(tree.commits).toBe(1700);
		expect(tree.entries.map((e) => [e.name, e.last?.headline])).toEqual([
			['apps', 'fix: a'],
			['README.md', 'fix: a'],
		]);
		expect(tree.readme).toEqual({ path: 'README.md', html: '<p>Shop</p>' });
		await s.tree('p', 'r', 'dev', '');
		expect(raw.run.mock.calls.filter((c) => (c[1] as string[])[0] === 'log')).toHaveLength(1);
		expect(ok<{ paths: string[] }>(await s.allPaths('p', 'r', 'dev')).paths).toHaveLength(4);
	});

	it('reads a path with nothing under it (a file) as an empty folder, without asking GitHub for a README', async () => {
		const { copy, raw } = copyOf();
		raw.run.mockImplementation(async () => '');
		const s = new CodeService(reads, copy, store().store);
		const sent = github([HEAD]);
		const tree = ok<{ entries: unknown[]; readme: unknown }>(await s.tree('p', 'r', 'dev', 'AGENTS.md'));
		expect(tree).toMatchObject({ entries: [], readme: null });
		expect(sent.some((line) => line.includes('/readme'))).toBe(false);
	});

	it('reads a file (with its Preview when Markdown), its bytes, its blame, a community file and a search', async () => {
		const { copy } = copyOf();
		const s = new CodeService(reads, copy, store().store);
		github([HEAD, [/contents\/README\.md/, '<h1>Shop</h1>'], [/contents\/gone\.md/, '', 404]]);
		const md = ok<{ kind: string; html: string; last: { headline: string } }>(
			await s.file('p', 'r', 'dev', 'README.md'),
		);
		expect(md).toMatchObject({ kind: 'text', html: '<h1>Shop</h1>', last: { headline: 'fix: a' } });
		expect(ok<{ html: string | null }>(await s.file('p', 'r', 'dev', 'a.ts')).html).toBeNull();
		expect(ok<{ kind: string; html: null }>(await s.file('p', 'r', 'dev', 'logo.png'))).toMatchObject({
			kind: 'image',
			html: null,
		});
		expect(await s.raw('p', 'r', 'dev', 'logo.png')).toMatchObject({ type: 'image/png' });
		expect(ok<{ html: string }>(await s.doc('p', 'r', 'dev', 'README.md')).html).toBe('<h1>Shop</h1>');
		expect(ok<{ html: string }>(await s.doc('p', 'r', 'dev', 'LICENSE')).html).toBe(
			'<pre>&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;</pre>',
		);
		expect(ok<{ html: string }>(await s.doc('p', 'r', 'dev', 'data.bin')).html).toBe('<pre></pre>');
		expect(ok<{ lines: string[] }>(await s.blame('p', 'r', 'dev', 'a.ts')).lines).toEqual(['line one']);
		expect(ok<{ total: number }>(await s.search('p', 'r', 'dev', 'port')).total).toBe(1);
		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(JSON.stringify({ data: { repository: { object: null } } })),
		);
		expect(await s.raw('p', 'r', 'nope', 'a.ts')).toEqual({
			error: 'GitHub has no branch, tag or commit called nope.',
		});
	});

	it('passes the other reads to GitHub: refs, history, branches, rules, tags, releases, notes and activity', async () => {
		const { copy } = copyOf();
		const s = new CodeService(reads, copy, store().store);
		const sent = github([
			[/repos\/o\/r /, { default_branch: 'main' }],
			[/rulesets/, []],
			[/branches\?/, [{ name: 'main' }]],
			[/tags\?/, []],
			[/rules\/branches/, []],
			[
				/graphql.*viewer \{ login/,
				{ data: { viewer: { login: 'me' }, repository: { refs: { pageInfo: {}, nodes: [] } } } },
			],
			[
				/graphql.*history\(first: 100/,
				{ data: { repository: { object: { history: { totalCount: 0, pageInfo: {}, nodes: [] } } } } },
			],
			[/graphql.*refs\/tags/, { data: { repository: { refs: { pageInfo: {}, nodes: [] } } } }],
			[/releases\/latest/, {}, 404],
			[/releases\?/, []],
			[/generate-notes/, { name: 'v1', body: 'b' }],
			[/activity/, []],
		]);
		expect(ok<{ defaultBranch: string }>(await s.refs('p', 'r')).defaultBranch).toBe('main');
		expect(
			ok<{ total: number }>(
				await s.history('p', 'r', { ref: 'dev', path: '', author: '', since: '', until: '', after: '' }),
			).total,
		).toBe(0);
		expect(ok<{ viewer: string }>(await s.branches('p', 'r')).viewer).toBe('me');
		expect(ok<{ branch: string }>(await s.rules('p', 'r', 'dev')).branch).toBe('dev');
		expect(ok<{ tags: unknown[] }>(await s.tags('p', 'r', '')).tags).toEqual([]);
		expect(ok<{ more: boolean }>(await s.releases('p', 'r', 1)).more).toBe(false);
		expect(ok<{ name: string }>(await s.notes('p', 'r', { tag: 'v1', target: 'main', previous: '' })).name).toBe(
			'v1',
		);
		expect(
			ok<{ rows: unknown[] }>(await s.activity('p', 'r', { ref: '', actor: '', kind: '', after: '' })).rows,
		).toEqual([]);
		vi.mocked(fetch).mockResolvedValueOnce(new Response('[]'));
		expect(ok<{ packages: unknown[] }>(await s.packages('p', 'r'))).toEqual({ packages: [] });
		vi.mocked(fetch).mockResolvedValueOnce(new Response('PK'));
		expect(await s.zip('p', 'r', 'feat/x')).toMatchObject({ name: 'r-feat-x.zip' });
		vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }));
		expect(await s.zip('p', 'r', 'gone')).toEqual({ error: 'GitHub answered 404.' });
		vi.mocked(fetch).mockResolvedValueOnce(new Response('<p>Drawn</p>'));
		expect(ok<{ html: string }>(await s.markdown('p', 'r', 'Drawn'))).toEqual({ html: '<p>Drawn</p>' });
		expect(sent.length).toBeGreaterThan(8);
	});

	it('compares two refs from GitHub’s list, or from the copy past GitHub’s 300 files, and draws one file’s changes', async () => {
		const { copy, raw } = copyOf();
		const s = new CodeService(reads, copy, store().store);
		const compare = (files: number) => ({
			status: 'ahead',
			ahead_by: 2,
			behind_by: 0,
			total_commits: 2,
			merge_base_commit: { sha: 'mb' },
			commits: [],
			files: Array.from({ length: files }, (_, i) =>
				i === 0
					? {
							filename: 'a.ts',
							status: 'modified',
							additions: 1,
							deletions: 1,
							changes: 2,
							patch: '@@ -1 +1 @@\n-a\n+b',
						}
					: { filename: `f${i}.png`, status: 'added', changes: 0 },
			),
		});
		github([HEAD, [/compare\/dev\.\.\.small/, compare(2)], [/compare\/dev\.\.\.big/, compare(300)], [/pulls/, []]]);
		const small = ok<{ files: { source: string; total: number } }>(await s.compare('p', 'r', 'dev', 'small'));
		expect(small.files).toMatchObject({ source: 'github', total: 2 });
		const big = ok<{ files: { source: string; note: string } }>(await s.compare('p', 'r', 'dev', 'big'));
		expect(big.files.source).toBe('copy');
		expect(big.files.note).toContain("GitHub's compare lists the first 300");
		expect(raw.files).toHaveBeenCalledWith('/copy', ['mb', SHA]);
		const patched = ok<{ source: string }>(await s.compareDiff('p', 'r', 'dev', 'small', 'a.ts', false));
		expect(patched.source).toBe('github');
		expect(
			ok<{ source: string; whole: boolean }>(await s.compareDiff('p', 'r', 'dev', 'small', 'a.ts', true)),
		).toMatchObject({
			source: 'copy',
			whole: true,
		});
		expect(ok<{ source: string }>(await s.compareDiff('p', 'r', 'dev', 'small', 'f1.png', false)).source).toBe(
			'copy',
		);
		expect(ok<{ path: string }>(await s.compareDiff('p', 'r', 'dev', 'big', 'big.ts', false)).path).toBe('big.ts');
		const missing = await s.compareDiff('p', 'r', 'dev', 'big', 'nowhere.ts', false);
		expect(missing).toEqual({ state: 'error', message: 'nowhere.ts is not changed between dev and big.' });
	});
});

describe('the Code pages’ changes', () => {
	it('keep each change and each refusal in the audit log, and forget compares read before', async () => {
		const { copy } = copyOf();
		const { store: st, audit } = store();
		const s = new CodeService(reads, copy, st);
		const done = await s.change('p', 'r', 'branch', async () => ({
			message: 'Branch x made from dev',
			url: null,
			branch: 'x',
		}));
		expect(done).toMatchObject({ state: 'ok' });
		const refused = await s.change('p', 'r', 'commit', async () => {
			throw new Error('GitHub refused it: Protected branch.');
		});
		expect(refused).toEqual({ state: 'error', message: 'GitHub refused it: Protected branch.' });
		expect(audit.mock.calls).toEqual([
			['p', 'code-branch', 'Branch x made from dev'],
			['p', 'code-commit-refused', 'GitHub refused it: Protected branch.'],
		]);
	});
});

describe('the Code routes', () => {
	const calls: unknown[][] = [];
	const service = new Proxy(
		{},
		{
			get:
				(_t, name) =>
				(...args: unknown[]) => {
					calls.push([name, ...args.map((a) => (typeof a === 'function' ? 'make' : a))]);
					if (name === 'zip')
						return Promise.resolve(
							args[2] === 'gone' ? { error: 'no zip' } : { body: Buffer.from('PK'), name: 'r-dev.zip' },
						);
					if (name === 'raw')
						return Promise.resolve(
							args[3] === 'gone' ? { error: 'not there' } : { body: Buffer.from('x'), type: 'image/png' },
						);
					if (name === 'change')
						return (args[3] as (repo: string, key: string) => Promise<unknown>)('o/r', 'k').catch(
							(e: Error) => e.message,
						);
					return Promise.resolve(null);
				},
		},
	) as CodeService;
	const confirmed: unknown[] = [];
	const lock = { confirm: (...a: unknown[]) => confirmed.push(a[1]) } as unknown as LockService;
	const c = new CodeController(service, lock);
	const req = { headers: {} } as never;

	it('read the ref, path and filters from the address, and refuse bad ones', async () => {
		calls.length = 0;
		c.repo('p', 'r');
		c.tree('p', 'r', { ref: 'dev' });
		c.doc('p', 'r', { ref: 'dev', path: 'LICENSE' });
		c.refs('p', 'r');
		c.paths('p', 'r', { ref: 'dev' });
		c.file('p', 'r', { ref: 'dev', path: 'a.ts' });
		c.blame('p', 'r', { ref: 'dev', path: 'a.ts' });
		c.history('p', 'r', { ref: 'dev', author: 'kaizer03' });
		c.branches('p', 'r');
		c.rules('p', 'r', { branch: 'dev' });
		c.tags('p', 'r', {});
		c.releases('p', 'r', { page: '2' });
		c.notes('p', 'r', { tag: 'v1', target: 'main' });
		c.search('p', 'r', { ref: 'dev', q: 'port' });
		c.activity('p', 'r', { kind: 'push' });
		c.compare('p', 'r', { base: 'dev', head: 'feat/x' });
		c.compareDiff('p', 'r', { base: 'dev', head: 'feat/x', path: 'a.ts', whole: '1' });
		c.markdown('p', 'r', { text: '# Hi' });
		c.packages('p', 'r');
		expect(calls.map((x) => x[0])).toEqual([
			'repo',
			'tree',
			'doc',
			'refs',
			'allPaths',
			'file',
			'blame',
			'history',
			'branches',
			'rules',
			'tags',
			'releases',
			'notes',
			'search',
			'activity',
			'compare',
			'compareDiff',
			'markdown',
			'packages',
		]);
		expect(calls[1]).toEqual(['tree', 'p', 'r', 'dev', '']);
		expect(calls[11]).toEqual(['releases', 'p', 'r', 2]);
		expect(calls[16]).toEqual(['compareDiff', 'p', 'r', 'dev', 'feat/x', 'a.ts', true]);
		expect(() => c.tree('p', 'r', { ref: 'a..b' })).toThrow(BadRequestException);
		expect(() => c.tree('p', 'r', { ref: 'dev', path: '../etc' })).toThrow(BadRequestException);
		expect(() => c.file('p', 'r', { ref: 'dev' })).toThrow(BadRequestException);
	});

	it('send a file’s bytes as themselves, or say why not', async () => {
		const sent: unknown[] = [];
		const reply = {
			status: (n: number) => (sent.push(n), reply),
			header: (k: string, v: string) => (sent.push(`${k}: ${v}`), reply),
			send: (b: unknown) => sent.push(b),
		};
		await c.raw('p', 'r', { ref: 'dev', path: 'logo.png' }, reply);
		expect(sent).toContain('content-type: image/png');
		sent.length = 0;
		await c.raw('p', 'r', { ref: 'dev', path: 'gone' }, reply);
		expect(sent).toEqual([404, 'content-type: text/plain; charset=utf-8', 'not there']);
		sent.length = 0;
		await c.zip('p', 'r', { ref: 'dev' }, reply);
		expect(sent).toContain('content-disposition: attachment; filename="r-dev.zip"');
		sent.length = 0;
		await c.zip('p', 'r', { ref: 'gone' }, reply);
		expect(sent).toEqual([404, 'content-type: text/plain; charset=utf-8', 'no zip']);
	});

	it('check the PIN, then make each change through GitHub', async () => {
		github([[/./, {}]]);
		const pin = { pin: '123456' };
		const answers = await Promise.all([
			c.createBranch('p', 'r', { ...pin, name: 'x', from: 'dev' }, req),
			c.renameBranch('p', 'r', { ...pin, name: 'x', to: 'y' }, req),
			c.deleteBranch('p', 'r', { ...pin, name: 'y' }, req),
			c.commit('p', 'r', { ...pin, branch: 'dev', message: 'm', changes: [{ path: 'a', content: null }] }, req),
			c.release('p', 'r', { ...pin, tag: 'v1', target: 'main' }, req),
			c.deleteRelease('p', 'r', { ...pin, id: 1 }, req),
			c.asset('p', 'r', { ...pin, release: 1, name: 'a.zip', content: 'eA==' }, req),
			c.deleteAsset('p', 'r', { ...pin, id: 2 }, req),
			c.about('p', 'r', { ...pin, description: 'Shop' }, req),
			c.watch('p', 'r', { ...pin, watching: 'none' }, req),
			c.star('p', 'r', { ...pin, starred: true }, req),
			c.fork('p', 'r', { ...pin }, req),
			c.pull('p', 'r', { ...pin, base: 'dev', head: 'x', title: 't' }, req),
		]);
		expect(confirmed).toHaveLength(13);
		expect(answers).toHaveLength(13);
		expect(() => c.star('p', 'r', { pin: '12', starred: true }, req)).toThrow(BadRequestException);
	});
});
