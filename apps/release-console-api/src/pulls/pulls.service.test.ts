import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PullsController } from './pulls.controller.js';
import { PullsService } from './pulls.service.js';

import type { RepoCopy } from './repo-copy.js';
import type { VendorReadsService } from '../projects/vendor-reads.service.js';

/** GitHub answers by address; every call is kept. */
type Route = [RegExp, unknown];
function github(routes: Route[]) {
	const sent: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const line = `${init?.method ?? 'GET'} ${String(url)} `;
			sent.push(line);
			return new Response(JSON.stringify(routes.find(([re]) => re.test(line))?.[1] ?? {}), { status: 200 });
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

/** The repository copy, answering from memory; `failing` makes it refuse to fetch. */
function copyOf(failing = false) {
	const calls: string[] = [];
	const copy = {
		ready: vi.fn(async (_repo: string, _key: string, shas: string[]) => {
			calls.push(`ready ${shas.join(',')}`);
			if (failing) throw new Error('git fetch failed: no network');
			return '/copy';
		}),
		files: vi.fn(async () => [
			{ path: 'big.ts', previous: null, status: 'added', additions: 1, deletions: 0, binary: false },
		]),
		diff: vi.fn(async (_dir: string, range: string[], path: string, previous: string | null, whole: boolean) => {
			calls.push(`diff ${range.join(' ')} ${path} ${previous} ${whole}`);
			return {
				binary: false,
				sizeBefore: null,
				sizeAfter: null,
				lines: [{ kind: 'add', old: null, new: 1, text: 'x' }],
			};
		}),
		parent: vi.fn(async () => 'parent0'),
	};
	return { copy: copy as unknown as RepoCopy, calls };
}

const pr = (files: number, head = 'head1') => ({
	number: 7,
	base: { ref: 'dev', sha: 'base1' },
	head: { ref: 'feat', sha: head },
	changed_files: files,
});
const FILES = [
	{ filename: 'a.ts', status: 'modified', additions: 1, deletions: 1, changes: 2, patch: '@@ -1 +1 @@\n-a\n+b' },
	{ filename: 'logo.png', status: 'modified', changes: 0 },
];
const ok = <T>(a: unknown) => (a as { data: T }).data;

describe('the pull request page’s reads', () => {
	it('lists, reads the page and pages the commits through the repository’s key', async () => {
		github([[/graphql/, { data: { repository: { pullRequests: { nodes: [] } } } }]]);
		const s = new PullsService(reads, copyOf().copy);
		expect(ok(await s.list('p', 'r', 'open'))).toEqual([]);
		github([
			[/\/pulls\/7 /, pr(2)],
			[/graphql/, { data: {} }],
		]);
		expect(ok<{ number: number }>(await s.page('p', 'r', 7)).number).toBe(7);
		github([
			[/\/pulls\/7 /, pr(2)],
			[/compare/, { total_commits: 0 }],
		]);
		expect(ok(await s.commits('p', 'r', 7, 1))).toEqual({ total: 0, page: 1, pages: 0, commits: [] });
	});

	it('lists files from GitHub up to 3,000, reading the list once per head commit', async () => {
		const sent = github([
			[/\/pulls\/7 /, pr(2)],
			[/\/files\?/, FILES],
		]);
		const { copy } = copyOf();
		const s = new PullsService(reads, copy);
		const files = ok<{ source: string; note: string; files: unknown[] }>(await s.changedFiles('p', 'r', 7));
		expect(files).toMatchObject({ total: 2, source: 'github', note: '' });
		await s.changedFiles('p', 'r', 7);
		expect(sent.filter((x) => x.includes('/files?'))).toHaveLength(1);
		// From the kept list: a patch is drawn as GitHub sent it.
		const diff = ok<{ source: string; lines: unknown[] }>(await s.diff('p', 'r', 7, { path: 'a.ts', whole: '0' }));
		expect(diff).toMatchObject({ source: 'github', whole: false, binary: false });
		expect(diff.lines).toHaveLength(3);
	});

	it('reads past 3,000 files from its own copy, and says what is missing when the copy cannot be brought up to date', async () => {
		github([
			[/\/pulls\/7 /, pr(4105)],
			[/\/files\?/, FILES],
		]);
		const { copy, calls } = copyOf();
		const big = ok<{ source: string; note: string; total: number }>(
			await new PullsService(reads, copy).changedFiles('p', 'r', 7),
		);
		expect(big).toMatchObject({ source: 'copy', total: 1 });
		expect(big.note).toBe(
			"1 files. GitHub lists a pull request's first 3,000, so this list and every change come from the console's own copy of the repository.",
		);
		expect(calls).toEqual(['ready base1,head1']);
		const failing = ok<{ source: string; note: string; total: number }>(
			await new PullsService(reads, copyOf(true).copy).changedFiles('p', 'r', 7),
		);
		expect(failing).toMatchObject({ source: 'github', total: 4105 });
		expect(failing.note).toBe(
			"4,105 files. GitHub lists the first 3,000, and the console's own copy of the repository could not be brought up to date (git fetch failed: no network), so 1,105 are not listed here.",
		);
	});

	it('draws a binary file, a whole file and a file GitHub sent no patch for from the copy', async () => {
		github([
			[/\/pulls\/7 /, pr(2)],
			[/\/files\?/, FILES],
		]);
		const { copy, calls } = copyOf();
		const s = new PullsService(reads, copy);
		const logo = ok<{ source: string }>(await s.diff('p', 'r', 7, { path: 'logo.png', whole: '0' }));
		expect(logo.source).toBe('copy');
		expect(ok<{ whole: boolean }>(await s.diff('p', 'r', 7, { path: 'a.ts', whole: '1' })).whole).toBe(true);
		expect(calls.filter((c) => c.startsWith('diff'))).toEqual([
			'diff base1...head1 logo.png null false',
			'diff base1...head1 a.ts null true',
		]);
		expect(await s.diff('p', 'r', 7, { path: 'nope.ts', whole: '0' })).toEqual({
			state: 'error',
			message: 'nope.ts is not changed in #7.',
		});
	});

	it('keeps the newest eight file lists and reads a failed one again', async () => {
		let head = 0;
		const sent: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				sent.push(String(url));
				if (String(url).includes('/files?')) {
					if (head === 99) return new Response('{}', { status: 500 });
					return new Response(JSON.stringify(FILES), { status: 200 });
				}
				return new Response(JSON.stringify(pr(2, `head${head}`)), { status: 200 });
			}),
		);
		const s = new PullsService(reads, copyOf().copy);
		for (head = 0; head < 9; head += 1) await s.changedFiles('p', 'r', 7);
		head = 0;
		await s.changedFiles('p', 'r', 7);
		// head0 was the oldest of nine and left the memory, so it is read again.
		expect(sent.filter((u) => u.includes('/files?'))).toHaveLength(10);
		head = 99;
		expect((await s.changedFiles('p', 'r', 7)).state).toBe('error');
		expect((await s.changedFiles('p', 'r', 7)).state).toBe('error');
		expect(sent.filter((u) => u.includes('/files?'))).toHaveLength(12);
	});
});

describe('a check’s log', () => {
	it('reads its last 200 lines through the repository’s key', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('a\nb', { status: 200 })),
		);
		expect(ok(await new PullsService(reads, copyOf().copy).log('p', 'r', 31))).toEqual({
			lines: [
				{ n: 1, text: 'a', bad: false },
				{ n: 2, text: 'b', bad: false },
			],
		});
	});
});

describe('a commit opened from the Commits tab', () => {
	const COMMIT = {
		sha: 'abc1234',
		commit: { message: 'fix: x', author: { name: 'Owner', date: 'd' } },
		files: [
			{ filename: 'a.ts', status: 'modified', changes: 2, patch: '@@ -1 +1 @@\n-a\n+b' },
			{ filename: 'new.ts', previous_filename: 'old.ts', status: 'renamed', changes: 0 },
		],
	};

	it('reads its message, checks and files, and says when GitHub stopped at 3,000', async () => {
		github([[/commits\/abc1234 /, COMMIT]]);
		const s = new PullsService(reads, copyOf().copy);
		expect(ok(await s.commit('p', 'r', 'abc1234'))).toMatchObject({
			sha: 'abc1234',
			message: 'fix: x',
			files: { total: 2, source: 'github', note: '' },
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async (url: string) =>
					new Response(JSON.stringify(COMMIT), {
						status: 200,
						headers: String(url).endsWith('abc9999') ? { link: '<x?page=11>; rel="last"' } : {},
					}),
			),
		);
		expect(ok<{ files: { note: string } }>(await s.commit('p', 'r', 'abc9999')).files.note).toBe(
			"GitHub lists a commit's first 3,000 files; this one has more.",
		);
	});

	it('draws its changes from GitHub’s patch, or from the copy against its parent', async () => {
		github([[/commits\/abc1234 /, COMMIT]]);
		const { copy, calls } = copyOf();
		const s = new PullsService(reads, copy);
		expect(
			ok<{ source: string }>(await s.diff('p', 'r', 7, { path: 'a.ts', whole: '0', commit: 'abc1234' })).source,
		).toBe('github');
		expect(
			ok<{ source: string }>(await s.diff('p', 'r', 7, { path: 'a.ts', whole: '1', commit: 'abc1234' })).source,
		).toBe('copy');
		expect(
			ok<{ previous: string }>(await s.diff('p', 'r', 7, { path: 'new.ts', whole: '0', commit: 'abc1234' }))
				.previous,
		).toBe('old.ts');
		expect(calls.filter((c) => c.startsWith('diff'))).toEqual([
			'diff parent0 abc1234 a.ts null true',
			'diff parent0 abc1234 new.ts old.ts false',
		]);
		expect(await s.diff('p', 'r', 7, { path: 'x.ts', whole: '0', commit: 'abc1234' })).toEqual({
			state: 'error',
			message: 'x.ts is not changed in abc1234.',
		});
	});
});

describe('changing the base: what the pull request would hold', () => {
	it('counts GitHub’s commits and files, and its own copy’s files once GitHub stops listing at 300', async () => {
		const compare = (files: number) => ({
			total_commits: 12,
			files: Array.from({ length: files }, () => ({})),
			base_commit: { sha: 'stag1' },
		});
		const small = copyOf();
		github([
			[/pulls\/7 /, pr(4196)],
			[/compare\/staging\.\.\.head1/, compare(40)],
		]);
		expect(ok(await new PullsService(reads, small.copy).basePreview('p', 'r', 7, 'staging'))).toEqual({
			base: 'staging',
			commits: 12,
			files: 40,
		});
		expect(small.calls).toEqual([]);
		const big = copyOf();
		github([
			[/pulls\/7 /, pr(4196)],
			[/compare\/staging\.\.\.head1/, compare(300)],
		]);
		expect(ok(await new PullsService(reads, big.copy).basePreview('p', 'r', 7, 'staging'))).toEqual({
			base: 'staging',
			commits: 12,
			files: 1,
		});
		expect(big.calls).toEqual(['ready stag1,head1']);
		expect(big.copy.files).toHaveBeenCalledWith('/copy', ['stag1...head1']);
	});
});

describe('the pull request routes', () => {
	const calls: unknown[][] = [];
	const service = new Proxy(
		{},
		{
			get:
				(_t, name) =>
				(...args: unknown[]) =>
					calls.push([name, ...args]),
		},
	) as PullsService;
	const c = new PullsController(service);

	it('read the number, the page, the file and the commit from the address, and refuse bad ones', () => {
		c.list('p', 'r', {});
		c.list('p', 'r', { state: 'closed' });
		c.page('p', 'r', '7');
		c.commits('p', 'r', '7', { page: '2' });
		c.commit('p', 'r', '7', 'abcdef1');
		c.files('p', 'r', '7');
		c.log('p', 'r', '7', '31');
		c.diff('p', 'r', '7', { path: 'a.ts', whole: '1' });
		c.basePreview('p', 'r', '7', { base: 'staging' });
		expect(calls).toEqual([
			['list', 'p', 'r', 'open'],
			['list', 'p', 'r', 'closed'],
			['page', 'p', 'r', 7],
			['commits', 'p', 'r', 7, 2],
			['commit', 'p', 'r', 'abcdef1'],
			['changedFiles', 'p', 'r', 7],
			['log', 'p', 'r', 31],
			['diff', 'p', 'r', 7, { path: 'a.ts', whole: '1' }],
			['basePreview', 'p', 'r', 7, 'staging'],
		]);
		expect(() => c.page('p', 'r', 'seven')).toThrow(BadRequestException);
		expect(() => c.commit('p', 'r', '7', 'not-a-commit')).toThrow(BadRequestException);
		expect(() => c.diff('p', 'r', '7', {})).toThrow(BadRequestException);
		expect(() => c.basePreview('p', 'r', '7', { base: 'dev..main' })).toThrow(BadRequestException);
	});
});
