import { type Type, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CodeBranches } from './code-branches';
import { CodeCompare } from './code-compare';
import { CodeCommit, CodeHistoryTab } from './code-history';
import { CodeActivityTab, CodeSearchTab } from './code-more';
import { CodeNav } from './code-nav';
import { CodeReleasesTab, CodeTagsTab } from './code-releases';
import { ConsoleApi } from '../../data/console-api';
import { ConsoleContext } from '../../data/console-context';

const AT = '2026-11-24T10:00:00.000Z';
const ok = <T>(data: T) => ({ state: 'ok' as const, readAt: AT, data });
const refused = (message: string) => ({ state: 'error' as const, message });
const INFO = { owner: 'o', name: 'r', url: 'https://github.com/o/r', defaultBranch: 'main', viewer: 'kaizer03' };
const commit = (sha: string, date = AT) => ({
	sha,
	headline: `c ${sha}`,
	author: 'kaizer03',
	login: 'kaizer03',
	date,
	checks: 'passed' as const,
});
const branch = (name: string, over: Record<string, unknown> = {}) => ({
	name,
	isDefault: false,
	rule: false,
	sha: 's',
	date: AT,
	author: 'kaizer03',
	login: 'kaizer03',
	behind: 1,
	ahead: 2,
	pull: null,
	checks: 'none',
	...over,
});
const release = (id: number, over: Record<string, unknown> = {}) => ({
	id,
	name: `Release ${id}`,
	tag: `v${id}`,
	target: 'main',
	draft: false,
	prerelease: false,
	latest: id === 1,
	publishedAt: AT,
	author: 'kaizer03',
	body: 'Notes',
	bodyHtml: '<p>Notes</p>',
	url: 'https://github.com/o/r/releases/tag/v1',
	assets: [{ id: 7, name: 'a.zip', size: 10, downloads: 2, url: 'https://x/a.zip' }],
	...over,
});
const DIFF = {
	path: 'a.ts',
	previous: null,
	status: 'modified',
	binary: false,
	sizeBefore: null,
	sizeAfter: null,
	whole: false,
	source: 'github',
	lines: [{ kind: 'add', old: null, new: 1, text: 'const a = 1;' }],
};
const FILES = [
	{ path: 'apps/api/a.ts', previous: null, status: 'modified', additions: 1, deletions: 0, binary: false },
	{ path: 'README.md', previous: null, status: 'modified', additions: 1, deletions: 1, binary: false },
];

function apiOf() {
	return {
		codeHistory: vi.fn(async (_p: string, _r: string, q: Record<string, string>) =>
			ok({ total: 101, next: q['after'] ? null : 'h2', commits: [commit(q['after'] ? 'b2' : 'a1')] }),
		),
		pullCommit: vi.fn(async () =>
			ok({
				sha: 'abc1234',
				message: 'fix: a thing\n\nWhy it was wrong.\n\nWhat changed.',
				author: 'kaizer03',
				date: AT,
				checks: { total: 1, running: 0, passed: 1, failed: 0 },
				files: { total: 2, source: 'github', note: 'A note.', files: FILES },
			}),
		),
		pullDiff: vi.fn(async () => ok(DIFF)),
		codeBranches: vi.fn(async () =>
			ok({
				defaultBranch: 'main',
				viewer: 'kaizer03',
				rows: [
					branch('main', { isDefault: true, rule: true }),
					branch('feat/a', { pull: { number: 7, state: 'open' } }),
					branch('feat/b'),
				],
			}),
		),
		codeRules: vi.fn(async (_p: string, _r: string, b: string) =>
			ok({ branch: b, rules: [{ type: 'deletion', ruleset: 'Protected' }] }),
		),
		codeTags: vi.fn(async (_p: string, _r: string, after: string) =>
			ok({
				tags: [{ name: after ? 'v0' : 'v1', sha: 'abcdef1', date: after ? null : AT, release: !after }],
				next: after ? null : 't2',
			}),
		),
		codeReleases: vi.fn(async (_p: string, _r: string, page: number) =>
			ok({
				releases:
					page === 1
						? [release(1), release(2, { draft: true, prerelease: true, publishedAt: null, bodyHtml: '' })]
						: [],
				more: page === 1,
			}),
		),
		codeNotes: vi.fn(async () => ok({ name: 'v3', body: '## What’s changed' })),
		codeCompare: vi.fn(async (_p: string, _r: string, base: string, head: string) =>
			ok({
				base,
				head,
				status: head === 'same' ? 'identical' : head === 'old' ? 'behind' : 'ahead',
				ahead: head === 'old' ? 0 : 3,
				behind: head === 'both' ? 2 : 0,
				commits: head === 'empty' ? [] : [commit('x1')],
				files: { total: 2, source: 'copy', note: 'From the copy.', files: FILES },
				pull: head === 'feat/a' ? { number: 7, title: 'feat: a' } : null,
			}),
		),
		codeCompareDiff: vi.fn(async () => ok(DIFF)),
		codeSearch: vi.fn(async () =>
			ok({
				total: 2,
				cut: false,
				files: [
					{
						path: 'a.ts',
						lines: [
							{ n: 3, text: 'const port = 1;' },
							{ n: 9, text: 'port' },
						],
					},
				],
			}),
		),
		codeActivity: vi.fn(async (_p: string, _r: string, q: Record<string, string>) =>
			ok({
				rows: [
					{
						kind: 'push',
						ref: 'dev',
						actor: 'kaizer03',
						at: AT,
						before: 'a'.repeat(40),
						after: 'b'.repeat(40),
					},
					{
						kind: 'branch_creation',
						ref: 'x',
						actor: 'kaizer03',
						at: AT,
						before: '0'.repeat(40),
						after: 'c'.repeat(40),
					},
				],
				next: q['after'] ? null : 'n2',
			}),
		),
		codeChange: vi.fn(async () => ok({ message: 'Done', url: null, branch: null })),
		codeRefs: vi.fn(async () => ok({ defaultBranch: 'main', branches: [{ name: 'main', rule: true }], tags: [] })),
	};
}
type Api = ReturnType<typeof apiOf>;

async function render<T>(component: Type<T>, url: string, inputs: Record<string, unknown> = {}, api: Api = apiOf()) {
	TestBed.resetTestingModule();
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	TestBed.configureTestingModule({
		providers: [
			provideRouter([{ path: '**', children: [] }]),
			provideTanStackQuery(queries),
			{ provide: ConsoleApi, useValue: api },
			{ provide: ConsoleContext, useValue: { projectId: signal('p'), repoId: signal('r'), repo: signal(null) } },
			CodeNav,
		],
	});
	const router = TestBed.inject(Router);
	await router.navigateByUrl(url);
	const fixture: ComponentFixture<T> = TestBed.createComponent(component);
	for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
	const settle = async () => {
		for (let i = 0; i < 10; i++) {
			await new Promise((r) => setTimeout(r, 0));
			fixture.detectChanges();
		}
	};
	await settle();
	const el = fixture.nativeElement as HTMLElement;
	const c = fixture.componentInstance as unknown as Record<string, (...a: unknown[]) => unknown>;
	return { fixture, c, el, api, settle, router, queries };
}
const params = (router: Router) => new URL(`http://x${router.url}`).searchParams;
const set = (c: Record<string, unknown>, name: string, value: unknown) =>
	(c[name] as { set: (v: unknown) => void }).set(value);
const run = (c: Record<string, unknown>, name: string, ...args: unknown[]) => {
	const f = c[name] as (...a: unknown[]) => unknown;
	return args.length
		? (f.apply(c, args) as (pin: string) => Promise<unknown>)('123456')
		: (f.call(c, '123456') as Promise<unknown>);
};

beforeEach(() => {
	Element.prototype.scrollIntoView = vi.fn();
	window.scrollTo = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe('history', () => {
	it('pages commits by cursor as the end comes into view, copies an id, and says why GitHub refused', async () => {
		const seen: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
		vi.stubGlobal(
			'IntersectionObserver',
			class {
				constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
					seen.push(cb);
				}
				observe = vi.fn();
				disconnect = vi.fn();
			},
		);
		const { c, api, settle, fixture } = await render(CodeHistoryTab, '/?tab=commits&author=kaizer03', {
			ref: 'main',
		});
		expect(api.codeHistory).toHaveBeenCalledWith('p', 'r', {
			ref: 'main',
			path: '',
			author: 'kaizer03',
			since: '',
			until: '',
			after: '',
		});
		expect(c['total']?.()).toBe(101);
		seen.at(-1)?.([{ isIntersecting: true }]);
		await settle();
		expect((c['commits']?.() as Array<{ sha: string }>).map((x) => x.sha)).toEqual(['a1', 'b2']);
		c['next']?.();
		const writeText = vi.fn(async () => undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		vi.useFakeTimers({ toFake: ['setTimeout'] });
		c['copy']?.('a1');
		await Promise.resolve();
		expect(c['copied']?.()).toBe('a1');
		vi.advanceTimersByTime(1500);
		expect(c['copied']?.()).toBe('');
		vi.useRealTimers();
		writeText.mockRejectedValueOnce(new Error('denied'));
		c['copy']?.('a1');
		Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
		c['copy']?.('a1');
		fixture.destroy();
		vi.unstubAllGlobals();
		const bad = apiOf();
		bad.codeHistory.mockResolvedValue(refused('GitHub refused the request.') as never);
		const b = await render(CodeHistoryTab, '/?tab=commits', { ref: 'main' }, bad);
		expect([b.c['failure']?.(), b.c['total']?.(), b.c['commits']?.()]).toEqual([
			'GitHub refused the request.',
			0,
			[],
		]);
		const waiting = apiOf();
		waiting.codeHistory.mockReturnValue(new Promise(() => undefined) as never);
		const w = await render(CodeHistoryTab, '/', { ref: 'main' }, waiting);
		expect([w.c['failure']?.(), w.c['commits']?.()]).toEqual([null, []]);
	});

	it('opens one commit with its message, files and changes, and closes and opens its folders', async () => {
		const { c, api, settle } = await render(CodeCommit, '/?tab=commits&sha=abc1234', { sha: 'abc1234' });
		expect(api.pullCommit).toHaveBeenCalledWith('p', 'r', 1, 'abc1234');
		expect([c['headline']?.(), c['body']?.()]).toEqual(['fix: a thing', ['Why it was wrong.', 'What changed.']]);
		expect(c['chosen']?.()).toBe('apps/api/a.ts');
		expect((c['lines']?.() as unknown[]).length).toBe(1);
		c['pick']?.('apps', true);
		expect((c['rows']?.() as Array<{ path: string }>).map((r) => r.path)).toEqual(['apps', 'README.md']);
		c['pick']?.('apps', true);
		c['pick']?.('README.md', false);
		await settle();
		expect(api.pullDiff).toHaveBeenLastCalledWith('p', 'r', 1, 'README.md', false, 'abc1234');
		expect([c['commitError']?.(), c['diffError']?.()]).toEqual([
			'The commit could not be read.',
			'The changes could not be read.',
		]);
		const bad = apiOf();
		bad.pullCommit.mockResolvedValue(refused('No such commit.') as never);
		bad.pullDiff.mockResolvedValue(refused('No diff.') as never);
		const b = await render(CodeCommit, '/', { sha: 'zzz' }, bad);
		expect([b.c['commitError']?.(), b.c['headline']?.(), b.c['body']?.(), b.c['chosen']?.()]).toEqual([
			'No such commit.',
			'',
			[],
			'',
		]);
		const d = await render(CodeCommit, '/', { sha: 'abc' }, { ...apiOf(), pullDiff: bad.pullDiff });
		expect(d.c['diffError']?.()).toBe('No diff.');
		expect(d.c['lines']?.()).toBeNull();
	});
});

describe('branches', () => {
	it('shows the views, opens a pull request, lists rules, and makes, renames and deletes with the PIN', async () => {
		const { c, api, router, settle, queries } = await render(CodeBranches, '/?tab=branches');
		expect((c['sections']?.() as Array<{ title: string }>).map((s) => s.title)).toEqual([
			'Default',
			'Your branches',
			'Active branches',
		]);
		await router.navigateByUrl('/?tab=branches&view=stale');
		await settle();
		expect(c['view']?.()).toBe('stale');
		expect(['open', 'draft', 'merged', 'closed', 'odd'].map((s) => c['pullTone']?.(s))).toEqual([
			'ok',
			'muted',
			'cy',
			'red',
			'muted',
		]);
		c['openPull']?.(7);
		await settle();
		expect(router.url).toBe('/p/p/r/r/pulls?tab=overview&pr=7');
		set(c, 'rulesFor', 'main');
		await settle();
		expect(api.codeRules).toHaveBeenCalledWith('p', 'r', 'main');
		expect(c['rules']?.()).toEqual([{ type: 'deletion', ruleset: 'Protected' }]);
		expect(c['rulesError']?.()).toBe('The rules could not be read.');
		c['startNew']?.();
		expect(c['newFrom']?.()).toBe('main');
		set(c, 'newName', ' fix/x ');
		await run(c, 'createRun');
		c['startRename']?.({ name: 'feat/b' });
		set(c, 'renameTo', 'feat/c');
		await run(c, 'renameRun', 'feat/b');
		await run(c, 'deleteRun', 'feat/c');
		expect(api.codeChange.mock.calls.map((x) => [x[2], x[3]])).toEqual([
			['branch', { pin: '123456', name: 'fix/x', from: 'main' }],
			['branch/rename', { pin: '123456', name: 'feat/b', to: 'feat/c' }],
			['branch/delete', { pin: '123456', name: 'feat/c' }],
		]);
		const invalidate = vi.spyOn(queries, 'invalidateQueries');
		c['changed']?.();
		expect(invalidate).toHaveBeenCalledTimes(2);
		expect(c['error']?.()).toBe('The branches could not be read.');
	});

	it('says why GitHub refused the branches or their rules', async () => {
		const bad = apiOf();
		bad.codeBranches.mockResolvedValue(refused('Not connected.') as never);
		bad.codeRules.mockResolvedValue(refused('No rules read.') as never);
		const { c, settle } = await render(CodeBranches, '/', {}, bad);
		expect([c['error']?.(), c['sections']?.()]).toEqual(['Not connected.', []]);
		c['startNew']?.();
		expect(c['newFrom']?.()).toBe('');
		set(c, 'rulesFor', 'dev');
		await settle();
		expect([c['rulesError']?.(), c['rules']?.()]).toEqual(['No rules read.', null]);
	});
});

describe('tags and releases', () => {
	it('pages tags by cursor, and says why GitHub refused', async () => {
		const { c, settle } = await render(CodeTagsTab, '/?tab=tags', { info: INFO });
		expect((c['tags']?.() as Array<{ name: string }>).map((t) => t.name)).toEqual(['v1']);
		await (c['q'] as unknown as { fetchNextPage: () => Promise<unknown> }).fetchNextPage();
		await settle();
		expect((c['tags']?.() as Array<{ name: string }>).map((t) => t.name)).toEqual(['v1', 'v0']);
		expect(c['error']?.()).toBe('');
		const bad = apiOf();
		bad.codeTags.mockResolvedValue(refused('Not connected.') as never);
		const b = await render(CodeTagsTab, '/', { info: INFO }, bad);
		expect([b.c['error']?.(), b.c['tags']?.()]).toEqual(['Not connected.', []]);
		const waiting = apiOf();
		waiting.codeTags.mockReturnValue(new Promise(() => undefined) as never);
		const w = await render(CodeTagsTab, '/', { info: INFO }, waiting);
		expect([w.c['error']?.(), w.c['tags']?.()]).toEqual(['', []]);
	});

	it('drafts, edits, writes notes, attaches and removes files, and deletes releases with the PIN', async () => {
		const { c, api, router, settle, queries } = await render(CodeReleasesTab, '/?tab=releases&new=1', {
			info: INFO,
		});
		expect(c['editing']?.()).toBe(true);
		expect(params(router).get('new')).toBeNull();
		expect([c['target']?.(), c['latest']?.()]).toEqual(['main', true]);
		expect((c['releases']?.() as unknown[]).length).toBe(2);
		await (c['q'] as unknown as { fetchNextPage: () => Promise<unknown> }).fetchNextPage();
		await settle();
		expect(c['error']?.()).toBe('');
		set(c, 'tag', 'v3');
		await c['generate']?.();
		expect([c['notes']?.(), c['title']?.()]).toEqual(['## What’s changed', 'v3']);
		set(c, 'title', 'Kept');
		await c['generate']?.();
		expect(c['title']?.()).toBe('Kept');
		api.codeNotes.mockResolvedValueOnce(refused('No previous release.') as never);
		await c['generate']?.();
		expect(c['notesError']?.()).toBe('No previous release.');
		const big = new File(['x'], 'big.bin');
		Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
		c['attach']?.([new File(['a'], 'a.zip'), big]);
		c['attach']?.(null);
		expect((c['files']?.() as File[]).map((f) => f.name)).toEqual(['a.zip']);
		await run(c, 'saveRun');
		expect(api.codeChange).toHaveBeenLastCalledWith(
			'p',
			'r',
			'release',
			expect.objectContaining({
				id: null,
				tag: 'v3',
				name: 'Kept',
				assets: [{ name: 'a.zip', content: 'YQ==' }],
			}),
		);
		const second = (c['releases']?.() as Array<Record<string, unknown>>)[1];
		c['draft']?.(second);
		expect([c['editingId']?.(), c['asDraft']?.(), c['prerelease']?.(), c['latest']?.()]).toEqual([
			2,
			true,
			true,
			false,
		]);
		await run(c, 'removeRun', 7);
		c['removedAsset']?.(7);
		expect(c['existing']?.()).toEqual([]);
		await run(c, 'deleteRun', 2);
		expect(api.codeChange.mock.calls.slice(-2).map((x) => x[2])).toEqual(['asset/delete', 'release/delete']);
		const invalidate = vi.spyOn(queries, 'invalidateQueries');
		c['changed']?.();
		expect(invalidate).toHaveBeenCalledTimes(3);
		const bad = apiOf();
		bad.codeReleases.mockResolvedValue(refused('Not connected.') as never);
		const b = await render(CodeReleasesTab, '/', { info: INFO }, bad);
		expect([b.c['error']?.(), b.c['releases']?.()]).toEqual(['Not connected.', []]);
		const waiting = apiOf();
		waiting.codeReleases.mockReturnValue(new Promise(() => undefined) as never);
		const w = await render(CodeReleasesTab, '/', { info: INFO }, waiting);
		expect([w.c['error']?.(), w.c['releases']?.()]).toEqual(['', []]);
	});
});

describe('compare', () => {
	it('compares two refs, opens their pull request, draws a file’s changes and opens a new pull request', async () => {
		const { c, api, router, settle, queries } = await render(
			CodeCompare,
			'/?tab=compare&base=dev&head=feat/x&part=files',
			{
				info: INFO,
			},
		);
		expect([c['base']?.(), c['head']?.(), c['part']?.()]).toEqual(['dev', 'feat/x', 'files']);
		expect(api.codeCompare).toHaveBeenCalledWith('p', 'r', 'dev', 'feat/x');
		expect(c['chosen']?.()).toBe('apps/api/a.ts');
		expect((c['lines']?.() as unknown[]).length).toBe(1);
		c['pick']?.('apps', true);
		expect((c['rows']?.() as Array<{ path: string }>).map((r) => r.path)).toEqual(['apps', 'README.md']);
		c['pick']?.('apps', true);
		c['pick']?.('README.md', false);
		await settle();
		expect(api.codeCompareDiff).toHaveBeenLastCalledWith('p', 'r', {
			base: 'dev',
			head: 'feat/x',
			path: 'README.md',
			whole: false,
		});
		expect([c['error']?.(), c['diffError']?.(), (c['days']?.() as unknown[]).length]).toEqual([
			'GitHub could not compare them.',
			'The changes could not be read.',
			1,
		]);
		c['startPull']?.('c x1');
		expect([c['pulling']?.(), c['pullTitle']?.()]).toEqual([true, 'c x1']);
		await run(c, 'pullRun');
		expect(api.codeChange).toHaveBeenLastCalledWith('p', 'r', 'pull', {
			pin: '123456',
			base: 'dev',
			head: 'feat/x',
			title: 'c x1',
			body: '',
			draft: false,
		});
		const invalidate = vi.spyOn(queries, 'invalidateQueries');
		c['pulled']?.();
		expect(invalidate).toHaveBeenCalled();
		c['openPull']?.(7);
		await settle();
		expect(router.url).toBe('/p/p/r/r/pulls?tab=overview&pr=7');
	});

	it('defaults both sides to the default branch, and says why GitHub could not compare', async () => {
		const same = await render(CodeCompare, '/?tab=compare', { info: INFO });
		expect([same.c['base']?.(), same.c['head']?.(), same.c['part']?.(), same.c['chosen']?.()]).toEqual([
			'main',
			'main',
			'commits',
			'',
		]);
		expect(same.api.codeCompare).not.toHaveBeenCalled();
		expect(same.c['days']?.()).toEqual([]);
		const bad = apiOf();
		bad.codeCompare.mockResolvedValue(refused('No common history.') as never);
		bad.codeCompareDiff.mockResolvedValue(refused('No diff.') as never);
		const b = await render(CodeCompare, '/?base=dev&head=x&part=files', { info: INFO }, bad);
		expect(b.c['error']?.()).toBe('No common history.');
		const d = await render(
			CodeCompare,
			'/?base=dev&head=x&part=files',
			{ info: INFO },
			{ ...apiOf(), codeCompareDiff: bad.codeCompareDiff },
		);
		expect([d.c['diffError']?.(), d.c['lines']?.()]).toEqual(['No diff.', null]);
	});
});

describe('search and activity', () => {
	it('searches only once asked, colours each matching line, and says why it could not', async () => {
		const none = await render(CodeSearchTab, '/?tab=search', { ref: 'main' });
		expect(none.api.codeSearch).not.toHaveBeenCalled();
		const { c, api } = await render(CodeSearchTab, '/?tab=search&q=port', { ref: 'dev' });
		expect(api.codeSearch).toHaveBeenCalledWith('p', 'r', 'dev', 'port');
		expect(c['typed']?.()).toBe('port');
		expect((c['found']?.() as { total: number }).total).toBe(2);
		const lines = c['lines']?.('a.ts', [{ n: 3, text: 'const port = 1;' }]) as Array<{ n: number; html: string }>;
		expect(lines[0]?.n).toBe(3);
		expect(lines[0]?.html).toContain('hljs-keyword');
		expect(lines[0]?.html).toContain('<mark>port</mark>');
		const blank = c['lines']?.('a.ts', [
			{ n: 1, text: 'x' },
			{ n: 2, text: '' },
		]) as Array<{ html: string }>;
		expect(blank[1]?.html).toBe('');
		expect(c['error']?.()).toBe('The repository could not be searched.');
		const bad = apiOf();
		bad.codeSearch.mockResolvedValue(refused('The copy could not be read.') as never);
		const b = await render(CodeSearchTab, '/?q=x', { ref: 'main' }, bad);
		expect([b.c['error']?.(), b.c['found']?.()]).toEqual(['The copy could not be read.', null]);
	});

	it('lists activity by its filters, pages it, and tells a branch made from a push', async () => {
		const { c, api, settle } = await render(CodeActivityTab, '/?tab=activity&kind=push&actor=kaizer03&branch=dev');
		expect(api.codeActivity).toHaveBeenCalledWith('p', 'r', {
			ref: 'dev',
			actor: 'kaizer03',
			kind: 'push',
			after: '',
		});
		expect([c['made']?.('0'.repeat(40)), c['made']?.(''), c['made']?.('a1')]).toEqual([true, true, false]);
		await (c['q'] as unknown as { fetchNextPage: () => Promise<unknown> }).fetchNextPage();
		await settle();
		expect((c['rows']?.() as unknown[]).length).toBe(4);
		expect(c['error']?.()).toBe('');
		const bad = apiOf();
		bad.codeActivity.mockResolvedValue(refused('Not connected.') as never);
		const b = await render(CodeActivityTab, '/', {}, bad);
		expect([b.c['error']?.(), b.c['rows']?.()]).toEqual(['Not connected.', []]);
		const waiting = apiOf();
		waiting.codeActivity.mockReturnValue(new Promise(() => undefined) as never);
		const w = await render(CodeActivityTab, '/', {}, waiting);
		expect([w.c['error']?.(), w.c['rows']?.()]).toEqual(['', []]);
	});
});
