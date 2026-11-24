import { type Type, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PullChecksTab } from './pull-checks';
import { PullCommitsTab } from './pull-commits';
import { PullFilesTab } from './pull-files';
import { PullOverview } from './pull-overview';
import { PullPage } from './pull-page';
import { PullsScreen } from './pulls-screen';
import { ConsoleApi } from '../../data/console-api';
import { ConsoleContext } from '../../data/console-context';

import type { PullCheck, PullFile, PullPage as Page, PullRow } from '@saha-textile/release-console-contracts';

const AT = '2026-11-24T08:00:00.000Z';
const ok = <T>(data: T) => ({ state: 'ok' as const, readAt: AT, data });
const refused = (message: string) => ({ state: 'error' as const, message });

const ROW: PullRow = {
	number: 7,
	title: 'feat: everything since PR #6',
	author: 'kaizer03',
	branch: 'feat/combined-after-pr6',
	base: 'dev',
	draft: true,
	state: 'merged',
	updatedAt: AT,
	url: 'https://github.com/o/r/pull/7',
	commits: 1,
	additions: 623963,
	deletions: 41288,
	checks: { total: 12, running: 10, passed: 2, failed: 0 },
	review: 'required',
};
const check = (over: Partial<PullCheck> = {}): PullCheck => ({
	id: 31,
	name: 'Browser tests',
	app: 'GitHub Actions',
	status: 'failed',
	startedAt: AT,
	completedAt: AT,
	url: 'https://github.com/o/r/runs/31',
	actionsJob: true,
	...over,
});
const PAGE: Page = {
	number: 7,
	title: ROW.title,
	state: 'open',
	draft: false,
	author: 'kaizer03',
	base: 'dev',
	head: 'feat/combined-after-pr6',
	baseSha: 'base0001',
	headSha: 'head0001abcdef',
	url: ROW.url,
	createdAt: AT,
	updatedAt: AT,
	mergedAt: null,
	mergedBy: '',
	closedAt: null,
	bodyHtml:
		'<h2>Headline features</h2><p>See <a href="https://github.com/o/r/pull/6">#6</a> and <a href="https://example.com/x">x</a>.</p><h3>Shop</h3><img src="https://example.com/p.png" alt="shot"><h3>Admin</h3>',
	bodyLength: 37071,
	commits: 1339,
	additions: 623963,
	deletions: 41288,
	changedFiles: 3,
	mergeable: true,
	mergeableState: 'blocked',
	autoMerge: false,
	canAutoMerge: true,
	checks: { total: 2, running: 1, passed: 0, failed: 1 },
	checkList: [
		check(),
		check({ id: 32, name: 'Sonar', app: 'SonarCloud', status: 'running', completedAt: null, actionsJob: false }),
	],
	review: 'required',
	reviewers: [{ login: 'anna', state: 'approved' }],
	labels: ['big'],
	events: [
		{
			kind: 'opened',
			who: 'kaizer03',
			at: AT,
			text: 'opened this pull request',
			html: '',
			tone: null,
			sha: '',
			checkId: null,
			url: ROW.url,
		},
		{
			kind: 'other',
			who: '',
			at: '',
			text: 'about 200 earlier events',
			html: '',
			tone: null,
			sha: '',
			checkId: null,
			url: ROW.url,
		},
		{
			kind: 'commented',
			who: 'anna',
			at: AT,
			text: 'commented',
			html: '<p>See <a href="https://github.com/o/r/pull/5">#5</a></p>',
			tone: null,
			sha: '',
			checkId: null,
			url: '',
		},
		{
			kind: 'check-failed',
			who: '',
			at: AT,
			text: 'Browser tests failed',
			html: '',
			tone: 'red',
			sha: 'h',
			checkId: 31,
			url: '',
		},
	],
};
const file = (path: string, over: Partial<PullFile> = {}): PullFile => ({
	path,
	previous: null,
	status: 'modified',
	additions: 2,
	deletions: 1,
	binary: false,
	...over,
});
const FILES = [
	file('apps/api/b.ts'),
	file('apps/api/a.ts', { previous: 'apps/api/old.ts', status: 'renamed' }),
	file('README.md'),
];
const lines = (n: number) => [
	{ kind: 'hunk' as const, old: null, new: null, text: '@@ -1 +1 @@' },
	...Array.from({ length: n }, (_, i) => ({
		kind: i % 2 ? ('add' as const) : ('del' as const),
		old: i,
		new: i,
		text: `line ${i}`,
	})),
];

/** The console API, answering from memory; each test changes what it needs. */
function apiOf() {
	return {
		pulls: vi.fn(async (_p: string, _r: string, state: string) =>
			ok([{ ...ROW, state: state === 'open' ? 'open' : 'merged' }]),
		),
		pull: vi.fn(async () => ok(PAGE)),
		pullCommits: vi.fn(async (_p: string, _r: string, _n: number, page: number) =>
			ok({
				total: 300,
				page,
				pages: 2,
				commits: [
					{
						sha: `c${page}a0000000`,
						headline: `commit ${page}a`,
						author: 'kaizer03',
						date: AT,
						checks: 'passed' as const,
					},
					{
						sha: `c${page}b0000000`,
						headline: `commit ${page}b`,
						author: 'kaizer03',
						date: '2026-11-23T08:00:00Z',
						checks: 'none' as const,
					},
				],
			}),
		),
		pullCommit: vi.fn(async () =>
			ok({
				sha: 'abc1234def',
				message: 'fix: a thing\n\nWhy it was wrong.\n\nWhat changed.',
				author: 'kaizer03',
				date: AT,
				checks: { total: 2, running: 1, passed: 1, failed: 0 },
				files: { total: 1, source: 'github' as const, note: '', files: [file('apps/api/b.ts')] },
			}),
		),
		pullFiles: vi.fn(async () => ok({ total: 3, source: 'github' as const, note: '', files: FILES })),
		pullDiff: vi.fn(async (_p: string, _r: string, _n: number, path: string) =>
			ok({
				path,
				previous: null,
				status: 'modified' as const,
				binary: false,
				sizeBefore: null,
				sizeAfter: null,
				whole: false,
				source: 'github' as const,
				lines: lines(4),
			}),
		),
		pullLog: vi.fn(async () =>
			ok({
				lines: [
					{ n: 1, text: '##[error] boom', bad: true },
					{ n: 2, text: 'ok', bad: false },
				],
			}),
		),
		productForm: vi.fn(async (_p: string, _r: string, _s: string, form: string) =>
			ok({
				type: 'form' as const,
				picker: null,
				form: {
					key: form,
					title: form,
					submit: 'Do it',
					fields: [
						{
							key: 'body',
							label: 'Comment',
							type: 'textarea',
							value: '',
							options: [],
							help: '',
							required: false,
							min: null,
							max: null,
						},
						{
							key: 'other',
							label: 'Other',
							type: 'text',
							value: 'x',
							options: [],
							help: '',
							required: false,
							min: null,
							max: null,
						},
					],
					cost: null,
					notes: [],
					confirmName: null,
					danger: false,
					blocked: null,
				},
			}),
		),
		repositoryBranches: vi.fn(async () => ({ defaultBranch: 'main', branches: [] })),
	};
}
type Api = ReturnType<typeof apiOf>;
const ENVS = [{ name: 'staging', label: 'Staging', branch: 'dev', domains: [], cloudId: null }];

let navigate: ReturnType<typeof vi.spyOn>;
async function render<T>(
	component: Type<T>,
	url: string,
	inputs: Record<string, unknown> = {},
	api: Api = apiOf(),
	ids: 'set' | null = 'set',
) {
	TestBed.resetTestingModule();
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	TestBed.configureTestingModule({
		providers: [
			provideRouter([]),
			provideTanStackQuery(queries),
			{ provide: ConsoleApi, useValue: api },
			{
				provide: ConsoleContext,
				useValue: {
					projectId: signal(ids && 'p'),
					repoId: signal(ids && 'r'),
					repo: signal(ids && { environments: ENVS, sourceCode: { vendor: 'github', repository: 'o/r' } }),
				},
			},
		],
	});
	const router = TestBed.inject(Router);
	await router.navigateByUrl(url);
	navigate = vi.spyOn(router, 'navigate');
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
	// The members the tests drive (protected in the components).
	const c = fixture.componentInstance as unknown as Record<string, (...a: unknown[]) => unknown>;
	return { fixture, c, el, api, settle, queries };
}
const navigatedWith = () => navigate.mock.calls.map((call) => (call[1] as { queryParams: unknown }).queryParams);

beforeEach(() => {
	Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
	vi.unstubAllGlobals();
	localStorage.clear();
});

describe('the list', () => {
	it('shows open pull requests with their size, checks and review, and each row opens its page', async () => {
		const { c, el } = await render(PullsScreen, '/?tab=list');
		expect(el.textContent).toContain('Open pull requests · 1');
		expect(el.textContent).toContain('10 running');
		expect(el.textContent).toContain('needs review');
		expect(el.textContent).toContain('1 commit');
		expect(c['envOfBranch']?.('dev')).toBe('Staging');
		expect(c['envOfBranch']?.('x')).toBe('—');
		(el.querySelector('tbody tr') as HTMLElement).click();
		c['show']?.('closed');
		c['show']?.('open');
		expect(navigatedWith()).toEqual([{ pr: 7, tab: 'overview' }, { state: 'closed' }, { state: null }]);
	});

	it('lists closed and merged ones on asking, and says when GitHub refuses', async () => {
		const closed = await render(PullsScreen, '/?state=closed');
		expect(closed.el.textContent).toContain('Closed and merged pull requests');
		expect(closed.el.textContent).toContain('merged');
		const api = apiOf();
		api.pulls.mockResolvedValue(refused('GitHub refused the key (401).') as never);
		const failing = await render(PullsScreen, '/', {}, api);
		expect(failing.c['rows']?.()).toEqual([]);
		expect(failing.c['readAt']?.()).toBeNull();
		const none = apiOf();
		none.pulls.mockResolvedValue(ok([]) as never);
		expect((await render(PullsScreen, '/', {}, none)).el.textContent).toContain('No open pull requests.');
		none.pulls.mockResolvedValue(ok([]) as never);
		expect((await render(PullsScreen, '/?state=closed', {}, none)).el.textContent).toContain(
			'No closed or merged pull requests.',
		);
	});

	it('opens the page for ?pr=7 and ignores a number that is not one', async () => {
		const page = await render(PullsScreen, '/?pr=7');
		expect(page.c['pr']?.()).toBe(7);
		expect(page.el.querySelector('rc-pull-page')).not.toBeNull();
		expect((await render(PullsScreen, '/?pr=seven')).c['pr']?.()).toBeNull();
	});
});

describe('the page', () => {
	it('shows the title, merge status and tabs, and opens a tab from the address or by key', async () => {
		const { c, el, fixture } = await render(PullPage, '/?pr=7&tab=files&file=README.md', { number: 7 });
		expect(c['tab']?.()).toBe('files');
		expect(el.querySelector('.rc-pr-title')?.textContent).toContain('merge blocked');
		expect(el.querySelector('.rc-mergebox')?.textContent).toContain('Merge when ready');
		expect(
			[...el.querySelectorAll('.rc-tabs [role=tab]')].map((t) => t.textContent?.replace(/\s+/g, ' ').trim()),
		).toEqual(['Overview', 'Commits 1,339', 'Checks 2', 'Files changed 3']);
		(el.querySelectorAll('.rc-tabs [role=tab]')[1] as HTMLElement).click();
		const key = (k: string, more: Partial<KeyboardEvent> = {}, target: EventTarget = document.body) =>
			c['key']?.({
				key: k,
				metaKey: false,
				ctrlKey: false,
				altKey: false,
				target,
				...more,
			} as unknown as KeyboardEvent);
		key('3');
		key('Escape');
		key('4', { metaKey: true });
		key('2', {}, document.createElement('input'));
		key('x');
		expect(navigatedWith()).toEqual([
			{ tab: 'commits', commit: null, check: null, file: null },
			{ tab: 'checks', commit: null, check: null, file: null },
			{ pr: null, tab: 'list', commit: null, check: null, file: null },
		]);
		expect(['overview', 'commits', 'checks', 'files'].map((t) => c['label']?.(t))).toEqual([
			'Overview',
			'Commits',
			'Checks',
			'Files changed',
		]);
		fixture.destroy();
	});

	it('words where it stands: running, ready, not ready, merged', async () => {
		const word = async (over: Partial<Page>) => {
			const api = apiOf();
			api.pull.mockResolvedValue(ok({ ...PAGE, ...over }) as never);
			return (await render(PullPage, '/?pr=7&tab=other', { number: 7 }, api)).c['stateWord']?.();
		};
		expect(await word({ checks: { total: 2, running: 1, passed: 1, failed: 0 } })).toBe('checks running');
		expect(
			await word({
				checks: { total: 2, running: 0, passed: 2, failed: 0 },
				mergeableState: 'clean',
				review: 'approved',
			}),
		).toBe('ready to merge');
		expect(await word({ checks: { total: 2, running: 0, passed: 2, failed: 0 } })).toBe('not ready');
		expect(await word({ state: 'merged', mergedBy: 'kaizer03', mergedAt: AT })).toBe('merged');
		const api = apiOf();
		api.pull.mockResolvedValue(refused('no') as never);
		const failing = await render(PullPage, '/?pr=7', { number: 7 }, api);
		expect([failing.c['stateWord']?.(), failing.c['status']?.()]).toEqual(['', null]);
	});

	it('opens each button’s form over the page, carries the comment into it, and reads again once sent', async () => {
		const { c, el, settle, queries, fixture } = await render(PullPage, '/?pr=7', { number: 7 });
		const invalidate = vi.spyOn(queries, 'invalidateQueries');
		c['act']?.('merge');
		await settle();
		expect(el.querySelector('.rc-modal')?.getAttribute('aria-label')).toBe('Merge');
		expect((c['modalForm']?.() as { fields: Array<{ value: unknown }> }).fields[0]?.value).toBe('');
		c['comment']?.('Looks good');
		await settle();
		expect(el.querySelector('.rc-modal')?.getAttribute('aria-label')).toBe('Comment');
		expect((c['modalForm']?.() as { fields: Array<{ value: unknown }> }).fields.map((f) => f.value)).toEqual([
			'Looks good',
			'x',
		]);
		expect(c['formTitle']?.('somewhere')).toBe('somewhere');
		c['key']?.({ key: '2', target: document.body } as unknown as KeyboardEvent);
		expect(navigatedWith()).toEqual([]);
		c['sent']?.();
		expect([c['modal']?.(), c['draft']?.()]).toEqual([null, '']);
		expect(invalidate).toHaveBeenCalledTimes(2);
		fixture.destroy();
		const api = apiOf();
		api.productForm.mockResolvedValue(refused('no') as never);
		const notForm = await render(PullPage, '/?pr=7', { number: 7 }, api);
		notForm.c['act']?.('review');
		await notForm.settle();
		expect(notForm.c['modalForm']?.()).toBeNull();
	});
});

describe('the Overview tab', () => {
	it('shows the whole description with its outline, opens other pull requests here and the rest in a new tab', async () => {
		const { c, el, fixture } = await render(PullOverview, '/?pr=7', { pull: PAGE });
		expect(c['outline']?.()).toEqual([
			{ id: 'pr-h-1', level: 2, text: 'Headline features' },
			{ id: 'pr-h-2', level: 3, text: 'Shop' },
			{ id: 'pr-h-3', level: 3, text: 'Admin' },
		]);
		const links = [...el.querySelectorAll('.rc-md a')] as HTMLAnchorElement[];
		expect(links[0]?.target).toBe('_blank');
		// A picture GitHub will not show becomes a link with its name.
		el.querySelector('.rc-md img')?.dispatchEvent(new Event('error'));
		expect(el.querySelector('.rc-md')?.textContent).toContain('Picture: shot ↗');
		const click = (target: Element) => {
			const e = new MouseEvent('click', { bubbles: true, cancelable: true });
			target.dispatchEvent(e);
			return e.defaultPrevented;
		};
		expect(click(links[0] as Element)).toBe(true);
		expect(click(links[1] as Element)).toBe(false);
		expect(click(el.querySelector('.rc-md p') as Element)).toBe(false);
		c['track']?.();
		expect(c['reading']?.()).toBe('pr-h-3');
		c['jump']?.('pr-h-2');
		expect(c['reading']?.()).toBe('pr-h-2');
		(el.querySelector('.rc-pr-tl .rc-btn') as HTMLElement).click();
		expect(navigatedWith()).toEqual([
			{ pr: 6, tab: 'overview' },
			{ tab: 'checks', check: 31 },
		]);
		expect(c['reviewers']?.()).toBe('anna ✓');
		expect(c['goesTo']?.()).toBe('Staging (dev)');
		fixture.destroy();
		expect(c['outline']?.()).toEqual([]);
	});

	it('writes a comment, says when there is no description, and finds no outline in a short one', async () => {
		const bare = { ...PAGE, bodyHtml: '', reviewers: [], base: 'main' };
		const { c, el, fixture } = await render(PullOverview, '/', { pull: bare });
		expect(el.textContent).toContain('No description.');
		expect(c['reviewers']?.()).toBe('none yet');
		expect(c['goesTo']?.()).toBe('— (main)');
		c['track']?.();
		expect(c['reading']?.()).toBeNull();
		const sent: string[] = [];
		fixture.componentInstance.comment.subscribe((t) => sent.push(t));
		c['draft']?.set?.(' Looks good ');
		(fixture.componentInstance as unknown as { draft: { set(v: string): void } }).draft.set(' Looks good ');
		c['send']?.();
		expect(sent).toEqual(['Looks good']);
		const short = await render(PullOverview, '/', { pull: { ...PAGE, bodyHtml: '<p>Short.</p>' } });
		short.c['track']?.();
		expect([short.c['outline']?.(), short.c['reading']?.()]).toEqual([[], null]);
	});
});

describe('the Commits tab', () => {
	it('loads 100 at a time as the end comes into view, by day, and opens a commit', async () => {
		const seen: Array<(e: Array<{ isIntersecting: boolean }>) => void> = [];
		vi.stubGlobal(
			'IntersectionObserver',
			class {
				constructor(fire: (e: Array<{ isIntersecting: boolean }>) => void) {
					seen.push(fire);
				}
				observe() {}
				disconnect() {}
			},
		);
		const { c, el, settle, api, fixture } = await render(PullCommitsTab, '/?pr=7&tab=commits', { pull: PAGE });
		expect(el.textContent).toContain('300 commits, all from GitHub');
		expect(c['shown']?.()).toBe(2);
		seen[0]?.([{ isIntersecting: false }]);
		seen[0]?.([{ isIntersecting: true }]);
		await settle();
		expect(api.pullCommits).toHaveBeenCalledTimes(2);
		expect(c['shown']?.()).toBe(4);
		c['next']?.();
		expect(api.pullCommits).toHaveBeenCalledTimes(2);
		(el.querySelector('tbody tr[tabindex]') as HTMLElement).click();
		expect(navigatedWith()).toEqual([{ tab: 'files', commit: 'c1a0000000', file: null }]);
		fixture.destroy();
	});

	it('says why when GitHub refuses, and counts from the page meanwhile', async () => {
		const api = apiOf();
		api.pullCommits.mockResolvedValue(refused('GitHub answered 502.') as never);
		const { c, el } = await render(PullCommitsTab, '/', { pull: PAGE }, api);
		expect(el.textContent).toContain('GitHub answered 502.');
		expect(c['total']?.()).toBe(1339);
		const one = apiOf();
		one.pullCommits.mockResolvedValue(ok({ total: 0, page: 1, pages: 0, commits: [] }) as never);
		expect((await render(PullCommitsTab, '/', { pull: PAGE }, one)).el.textContent).toContain('No commits.');
	});
});

describe('the Checks tab', () => {
	it('lists every check, and a failed one’s log opens below', async () => {
		const { c, el } = await render(PullChecksTab, '/?pr=7&tab=checks&check=31', { pull: PAGE });
		expect(c['openCheck']?.()).toMatchObject({ id: 31 });
		expect(el.querySelector('.rc-log .l.err')?.textContent).toContain('##[error] boom');
		expect(el.textContent).toContain('open on SonarCloud ↗');
		(el.querySelector('.rc-check .rc-btn') as HTMLElement).click();
		expect(navigatedWith()).toEqual([{ check: 31 }]);
	});

	it('says why a log could not be read, and opens none without a check', async () => {
		const api = apiOf();
		api.pullLog.mockResolvedValue(refused('GitHub answered 410.') as never);
		const { c, el } = await render(PullChecksTab, '/?check=31', { pull: PAGE }, api);
		expect(c['lines']?.()).toBeNull();
		expect(el.textContent).toContain('GitHub answered 410.');
		const none = await render(PullChecksTab, '/', { pull: { ...PAGE, checkList: [] } });
		expect([none.c['open']?.(), none.c['openCheck']?.(), none.c['logError']?.()]).toEqual([
			null,
			null,
			'The console API is not answering.',
		]);
		expect(none.el.textContent).toContain('No checks ran on this commit.');
	});
});

describe('the Files changed tab', () => {
	it('draws the tree and the chosen file’s changes, and opens or closes a folder', async () => {
		const { c, el, settle } = await render(PullFilesTab, '/?pr=7&tab=files', { pull: PAGE });
		// Three files: every folder opens, and the first file in tree order is chosen.
		expect((c['chosen']?.() as PullFile).path).toBe('apps/api/a.ts');
		expect(el.querySelector('.rc-ph .cy')?.textContent).toContain('apps/api/old.ts → apps/api/a.ts');
		expect(el.querySelectorAll('.rc-cov-code .l.add').length).toBe(2);
		c['pick']?.({ path: 'apps', folder: true });
		await settle();
		expect((c['rows']?.() as unknown[]).length).toBe(2);
		c['pick']?.({ path: 'apps', folder: true });
		c['pick']?.({ path: 'README.md', folder: false });
		c['allFiles']?.();
		expect(navigatedWith()).toEqual([{ file: 'README.md' }, { commit: null, file: null }]);
		expect([c['size']?.(512), c['size']?.(2048), c['size']?.(3_145_728)]).toEqual(['512 B', '2.0 KB', '3.0 MB']);
	});

	it('folds a long file behind Show all, shows binary sizes and says when there is nothing to show', async () => {
		const api = apiOf();
		api.pullDiff.mockResolvedValueOnce(
			ok({
				path: 'apps/api/a.ts',
				previous: null,
				status: 'modified',
				binary: false,
				sizeBefore: null,
				sizeAfter: null,
				whole: false,
				source: 'github',
				lines: lines(450),
			}) as never,
		);
		const { c, el, settle } = await render(PullFilesTab, '/', { pull: PAGE }, api);
		expect(c['folded']?.()).toBe(true);
		expect((c['drawn']?.() as unknown[]).length).toBe(400);
		(el.querySelector('.rc-center .rc-btn') as HTMLElement).click();
		await settle();
		expect((c['drawn']?.() as unknown[]).length).toBe(451);
		const sizes = apiOf();
		sizes.pullDiff.mockResolvedValue(
			ok({
				path: 'a',
				previous: null,
				status: 'modified',
				binary: true,
				sizeBefore: null,
				sizeAfter: 2048,
				whole: false,
				source: 'copy',
				lines: [],
			}) as never,
		);
		expect((await render(PullFilesTab, '/', { pull: PAGE }, sizes)).el.textContent).toContain('new → 2.0 KB');
		sizes.pullDiff.mockResolvedValue(
			ok({
				path: 'a',
				previous: null,
				status: 'removed',
				binary: true,
				sizeBefore: 9,
				sizeAfter: null,
				whole: false,
				source: 'copy',
				lines: [],
			}) as never,
		);
		expect((await render(PullFilesTab, '/', { pull: PAGE }, sizes)).el.textContent).toContain('9 B → removed');
		sizes.pullDiff.mockResolvedValue(
			ok({
				path: 'a',
				previous: null,
				status: 'renamed',
				binary: false,
				sizeBefore: null,
				sizeAfter: null,
				whole: false,
				source: 'copy',
				lines: [],
			}) as never,
		);
		expect((await render(PullFilesTab, '/', { pull: PAGE }, sizes)).el.textContent).toContain(
			'Renamed with no changes to its lines.',
		);
		sizes.pullDiff.mockResolvedValue(
			ok({
				path: 'a',
				previous: null,
				status: 'modified',
				binary: false,
				sizeBefore: null,
				sizeAfter: null,
				whole: false,
				source: 'copy',
				lines: [],
			}) as never,
		);
		const noLines = await render(PullFilesTab, '/?file=README.md', { pull: PAGE }, sizes);
		expect(noLines.el.textContent).toContain('No changed lines.');
	});

	it('says why a diff or the list could not be read, and notes where a big list came from', async () => {
		const api = apiOf();
		api.pullDiff.mockResolvedValue(refused('GitHub answered 404.') as never);
		api.pullFiles.mockResolvedValue(
			ok({
				total: 3,
				source: 'copy',
				note: '4,105 files. GitHub lists a pull request’s first 3,000…',
				files: FILES,
			}) as never,
		);
		const { c, el } = await render(PullFilesTab, '/', { pull: PAGE }, api);
		expect(c['diffError']?.()).toBe('GitHub answered 404.');
		expect(el.querySelector('.rc-banner.amber')?.textContent).toContain('4,105 files');
		api.pullFiles.mockResolvedValue(
			ok({ total: 4105, source: 'github', note: 'the copy could not be brought up to date', files: [] }) as never,
		);
		const partial = await render(PullFilesTab, '/', { pull: PAGE }, api);
		expect(partial.el.querySelector('.rc-banner.red')).not.toBeNull();
		expect(partial.el.textContent).toContain('Choose a file.');
		expect(partial.c['diffError']?.()).toBe('The console API is not answering.');
		api.pullFiles.mockResolvedValue(refused('GitHub answered 502.') as never);
		const failing = await render(PullFilesTab, '/', { pull: PAGE }, api);
		expect(failing.c['filesError']?.()).toBe('GitHub answered 502.');
		expect(failing.c['list']?.()).toBeNull();
	});

	it('opens a commit with its message, paragraphs and checks', async () => {
		const { c, el } = await render(PullFilesTab, '/?commit=abc1234def', { pull: PAGE });
		expect(c['commitInfo']?.()).toMatchObject({
			headline: 'fix: a thing',
			body: ['Why it was wrong.', 'What changed.'],
		});
		expect(el.textContent).toContain('1 running');
		const api = apiOf();
		api.pullCommit.mockResolvedValue(refused('no such commit') as never);
		const missing = await render(PullFilesTab, '/?commit=abc1234def', { pull: PAGE }, api);
		expect([missing.c['commitInfo']?.(), missing.c['filesError']?.()]).toEqual([null, 'no such commit']);
		const bare = apiOf();
		bare.pullCommit.mockResolvedValue(
			ok({
				sha: 'abc1234def',
				message: 'one line',
				author: 'a',
				date: AT,
				checks: { total: 0, running: 0, passed: 0, failed: 0 },
				files: { total: 0, source: 'github', note: '', files: [] },
			}) as never,
		);
		expect(
			(await render(PullFilesTab, '/?commit=abc1234def', { pull: PAGE }, bare)).c['commitInfo']?.(),
		).toMatchObject({ body: [] });
	});

	it('opens only the chosen file’s folders in a big pull request, and finds files by name', async () => {
		const many = Array.from({ length: 90 }, (_, i) => file(`apps/f${String(i).padStart(2, '0')}/x.ts`));
		const api = apiOf();
		api.pullFiles.mockResolvedValue(ok({ total: 90, source: 'github', note: '', files: many }) as never);
		const { c, el, settle } = await render(PullFilesTab, '/?file=apps/f42/x.ts', { pull: PAGE }, api);
		expect([...(c['open']?.() as Set<string>)].sort()).toEqual(['apps', 'apps/f42']);
		(c['findText'] as unknown as { set(v: string): void }).set('f07');
		await settle();
		expect((c['rows']?.() as Array<{ path: string }>).map((r) => r.path)).toEqual([
			'apps',
			'apps/f07',
			'apps/f07/x.ts',
		]);
		(c['findText'] as unknown as { set(v: string): void }).set('nothing');
		await settle();
		expect(el.textContent).toContain('No file matches.');
	});

	it('ticks files viewed for this person, even when the browser keeps nothing', async () => {
		const { c, settle } = await render(PullFilesTab, '/', { pull: PAGE });
		c['toggleViewed']?.('README.md');
		await settle();
		expect([...(c['viewed']?.() as Set<string>)]).toEqual(['README.md']);
		c['toggleViewed']?.('README.md');
		expect([...(c['viewed']?.() as Set<string>)]).toEqual([]);
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('refused');
		});
		expect(() => c['toggleViewed']?.('a.ts')).not.toThrow();
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('refused');
		});
		c['toggleViewed']?.('a.ts');
		expect([...(c['viewed']?.() as Set<string>)]).toEqual([]);
		vi.restoreAllMocks();
	});

	it('moves by key: / finds, j and k step through files, n and p through changes', async () => {
		const { c, el, settle } = await render(PullFilesTab, '/', { pull: PAGE });
		const key = (k: string, more: Partial<KeyboardEvent> = {}, target: EventTarget = document.body) => {
			const e = {
				key: k,
				metaKey: false,
				ctrlKey: false,
				altKey: false,
				target,
				preventDefault: vi.fn(),
				...more,
			};
			c['key']?.(e as unknown as KeyboardEvent);
			return e;
		};
		expect(key('/').preventDefault).toHaveBeenCalled();
		expect(document.activeElement).toBe(el.querySelector('.rc-msearch input'));
		key('j');
		key('k');
		key('n');
		key('n');
		key('p');
		key('j', { metaKey: true });
		key('j', {}, document.createElement('textarea'));
		key('z');
		expect(navigatedWith()).toEqual([{ file: 'apps/api/b.ts' }, { file: 'apps/api/a.ts' }]);
		expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(3);
		const api = apiOf();
		api.pullDiff.mockResolvedValue(
			ok({
				path: 'a',
				previous: null,
				status: 'modified',
				binary: false,
				sizeBefore: null,
				sizeAfter: null,
				whole: false,
				source: 'github',
				lines: [],
			}) as never,
		);
		const empty = await render(PullFilesTab, '/', { pull: PAGE }, api);
		empty.c['jump']?.(1);
		const none = apiOf();
		none.pullFiles.mockResolvedValue(ok({ total: 0, source: 'github', note: '', files: [] }) as never);
		const nothing = await render(PullFilesTab, '/', { pull: PAGE }, none);
		nothing.c['step']?.(1);
		expect(navigatedWith()).toEqual([]);
		await settle();
	});
});

describe('before a project and repository are chosen', () => {
	it('asks the console API with empty names and shows no environment', async () => {
		const api = apiOf();
		api.repositoryBranches.mockRejectedValue(new Error('no repository'));
		const list = await render(PullsScreen, '/', {}, api, null);
		expect(api.pulls).toHaveBeenCalledWith('', '', 'open');
		expect(list.c['envOfBranch']?.('dev')).toBe('—');
		const page = await render(PullPage, '/', { number: 7 }, api, null);
		page.c['act']?.('merge');
		await page.settle();
		expect(api.pull).toHaveBeenCalledWith('', '', 7);
		expect(api.productForm).toHaveBeenCalledWith('', '', 'pulls', 'merge', '7');
		expect((await render(PullOverview, '/', { pull: PAGE }, api, null)).c['goesTo']?.()).toBe('— (dev)');
		await render(PullCommitsTab, '/', { pull: PAGE }, api, null);
		expect(api.pullCommits).toHaveBeenCalledWith('', '', 7, 1);
		await render(PullChecksTab, '/?check=31', { pull: PAGE }, api, null);
		expect(api.pullLog).toHaveBeenCalledWith('', '', 7, 31);
		await render(PullFilesTab, '/', { pull: PAGE }, api, null);
		expect(api.pullFiles).toHaveBeenCalledWith('', '', 7);
		expect(api.pullDiff).toHaveBeenCalledWith('', '', 7, 'apps/api/a.ts', false, null);
	});
});

describe('the rarer cases', () => {
	it('names a picture by its file when it has no words, and lights the first heading before any is passed', async () => {
		const pull = { ...PAGE, bodyHtml: '<h2>A</h2><h2>B</h2><h2>C</h2><img src="https://example.com/dir/p.png">' };
		const { c, el } = await render(PullOverview, '/', { pull });
		el.querySelector('.rc-md img')?.dispatchEvent(new Event('error'));
		expect(el.querySelector('.rc-md')?.textContent).toContain('Picture: p.png ↗');
		vi.spyOn(el.querySelector('.rc-md') as HTMLElement, 'getBoundingClientRect').mockReturnValue({
			top: -100,
		} as DOMRect);
		c['track']?.();
		expect(c['reading']?.()).toBe('pr-h-1');
	});

	it('keeps nothing from a refused page of commits, a failed list or a refused file', async () => {
		const api = apiOf();
		api.pullCommits.mockResolvedValue(refused('GitHub answered 502.') as never);
		expect((await render(PullCommitsTab, '/', { pull: PAGE }, api)).c['commits']?.()).toEqual([]);
		api.pullFiles.mockRejectedValue(new Error('down'));
		expect((await render(PullFilesTab, '/', { pull: PAGE }, api)).c['filesError']?.()).toBe(
			'The console API is not answering.',
		);
		const files = apiOf();
		files.pullDiff.mockResolvedValue(refused('GitHub answered 404.') as never);
		const shown = await render(PullFilesTab, '/', { pull: PAGE }, files);
		expect([shown.c['rowsAll']?.(), shown.c['filesError']?.()]).toEqual([[], 'The console API is not answering.']);
	});
});
