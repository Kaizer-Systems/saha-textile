import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { describe, expect, it, vi } from 'vitest';

import { CoverageScreen, firstRun, lineFrom } from './coverage-screen';
import { ConsoleApi, type CoverageQuery } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';

import type { CoverageNode, CoverageRuns, CoverageTreeAnswer } from '@saha-textile/release-console-contracts';

const AT = '2026-11-24T03:00:00.000Z';
const ROOT: CoverageNode = {
	n: 'saha-textile',
	c: [7, 18, 3, 6, 2, 3, 7, 18],
	k: [
		{
			n: 'apps',
			c: [7, 18, 3, 6, 2, 3, 7, 18],
			k: [
				{
					n: 'admin',
					c: [6, 8, 3, 4, 2, 2, 6, 8],
					k: [
						{ n: 'a.ts', c: [4, 4, 2, 2, 1, 1, 4, 4] },
						{ n: 'b.ts', c: [2, 4, 1, 2, 1, 1, 2, 4] },
					],
				},
				{ n: 'shop', c: [1, 10, 0, 2, 0, 1, 1, 10], k: [{ n: 'c.ts', c: [1, 10, 0, 2, 0, 1, 1, 10] }] },
			],
		},
		{ n: 'docs', c: null, k: [{ n: 'intro.md', c: null }] },
		{ n: 'README.md', c: null },
	],
};
const runs = (over: Partial<CoverageRuns> = {}): CoverageRuns => ({
	ci: [
		{
			id: '902',
			sha: 'f00dfeed00',
			ref: 'dev',
			title: 'still going',
			finishedAt: null,
			state: 'running',
			url: 'u',
		},
		{ id: '901', sha: 'abcdef1200', ref: 'dev', title: 'the last run', finishedAt: AT, state: 'failed', url: 'u' },
		{ id: '900', sha: '0123456700', ref: 'dev', title: 'before', finishedAt: AT, state: 'passed', url: 'u' },
		{ id: '899', sha: '0000000000', ref: 'dev', title: 'old', finishedAt: AT, state: 'no-reports', url: 'u' },
	],
	ciMessage: null,
	mac: { sha: 'abcdef1200', ref: 'claude/x', finishedAt: AT, uncommitted: true },
	macMessage: null,
	...over,
});
const tree = (
	q: CoverageQuery,
	root: CoverageNode = ROOT,
): { state: 'ok'; readAt: string; data: CoverageTreeAnswer } => ({
	state: 'ok',
	readAt: AT,
	data: {
		source: q.source,
		run: q.run,
		sha: 'abcdef1200',
		ref: 'dev',
		finishedAt: AT,
		uncommitted: false,
		tree: root,
		workspaces: [
			{ name: 'admin', dir: 'apps/admin', passed: false, failed: 2, measuredAt: null },
			{ name: 'shop', dir: 'apps/shop', passed: true, failed: 0, measuredAt: null },
		],
		tests: { passed: 5, failed: q.run === '900' ? 0 : 2, skipped: 1, slowest: [] },
		changed: q.base
			? {
					label: q.base === 'commit' ? 'commit abcdef12' : `since ${q.base}`,
					files: [{ path: 'apps/admin/b.ts', run: [1], missed: q.base === 'commit' ? [2] : [] }],
				}
			: null,
	},
});

async function render(opts: { runs?: CoverageRuns; url?: string; root?: CoverageNode; ids?: null; main?: null } = {}) {
	const api = {
		coverageRuns: vi.fn(async () => opts.runs ?? runs()),
		coverageTree: vi.fn(async (_p: string, _r: string, q: CoverageQuery) => tree(q, opts.root)),
		coverageFile: vi.fn(async (_p: string, _r: string, q: CoverageQuery & { path: string }) => ({
			state: 'ok' as const,
			readAt: AT,
			data: {
				path: q.path,
				sha: 'abcdef1200',
				counts: null,
				text: ['a', 'b', 'c'],
				lines: [
					{ h: 1, c: 'run' as const, notes: [] },
					{ h: 0, c: 'miss' as const, notes: [] },
					{ h: 1, c: 'run' as const, notes: [] },
				],
				gaps: [{ kind: 'miss' as const, from: 2, to: 2, say: 'never ran', code: 'b' }],
				specs: [],
				failures: [],
				changed: [],
				note: null,
			},
		})),
		repositoryBranches: vi.fn(async () => ({ defaultBranch: opts.main === null ? null : 'dev', names: ['dev'] })),
	};
	const ctx = {
		projectId: signal(opts.ids === null ? null : 'p'),
		repoId: signal(opts.ids === null ? null : 'r'),
		repo: signal({ sourceCode: { repository: 'o/r' } }),
	};
	TestBed.configureTestingModule({
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ConsoleApi, useValue: api },
			{ provide: ConsoleContext, useValue: ctx },
		],
	});
	const router = TestBed.inject(Router);
	if (opts.url) await router.navigateByUrl(opts.url);
	const navigate = vi.spyOn(router, 'navigate');
	const fixture = TestBed.createComponent(CoverageScreen);
	const settle = async () => {
		for (let i = 0; i < 8; i++) {
			await new Promise((r) => setTimeout(r, 0));
			fixture.detectChanges();
		}
	};
	await settle();
	const el = fixture.nativeElement as HTMLElement;
	const c = fixture.componentInstance;
	const rows = () => [...el.querySelectorAll<HTMLTableRowElement>('tr.row')].map((r) => r.dataset['path']);
	const row = (path: string) =>
		el.querySelector<HTMLTableRowElement>(`tr.row[data-path="${path}"]`) as HTMLTableRowElement;
	const chip = (text: string) =>
		[...el.querySelectorAll<HTMLButtonElement>('button')].find(
			(b) => b.textContent?.trim() === text,
		) as HTMLButtonElement;
	return { fixture, el, c, api, router, navigate, settle, rows, row, chip };
}
const key = (key: string, target: Element = document.body, extra: KeyboardEventInit = {}) =>
	target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...extra }));

describe('the first run and the address', () => {
	it('opens the newest CI run with reports, else this Mac', () => {
		expect(firstRun(runs())).toEqual({ source: 'ci', run: '901' });
		expect(firstRun(runs({ ci: [] }))).toEqual({ source: 'mac', run: 'mac' });
		expect(firstRun(runs({ ci: [], mac: null }))).toBeNull();
		expect(firstRun(undefined)).toBeNull();
	});
	it('reads a line number from the address', () => {
		expect([lineFrom('12'), lineFrom('0'), lineFrom('x'), lineFrom(null), lineFrom(undefined)]).toEqual([
			{ n: 12 },
			null,
			null,
			null,
			null,
		]);
	});
});

describe('the coverage screen', () => {
	it('opens the newest run with reports: its totals, its tests, and the whole codebase’s first level', async () => {
		const { el, rows, api } = await render();
		expect(api.coverageTree).toHaveBeenCalledWith('p', 'r', { source: 'ci', run: '901', base: null });
		const options = [...el.querySelectorAll<HTMLOptionElement>('select option')];
		expect(options.map((o) => [o.value, o.disabled, o.selected])).toEqual([
			['902', true, false],
			['901', false, true],
			['900', false, false],
			['899', true, false],
		]);
		expect(options[0]?.textContent).toContain('still running');
		expect(options[1]?.textContent).toContain('tests failed');
		expect([...el.querySelectorAll('.rc-stat b')].map((b) => b.textContent?.trim())).toEqual([
			'38.8%',
			'50.0%',
			'66.6%',
			'38.8%',
			'2 failed',
		]);
		expect(rows()).toEqual(['', 'apps', 'docs', 'README.md']);
		expect(el.textContent).toContain('whole codebase');
	});

	it('opens and closes folders, all the gaps below one at once, and marks the rows that arrive', async () => {
		const { row, rows, fixture, c, el } = await render();
		row('apps').click();
		fixture.detectChanges();
		expect(rows()).toEqual(['', 'apps', 'apps/admin', 'apps/shop', 'docs', 'README.md']);
		expect(row('apps/admin').classList).toContain('in');
		expect(row('apps/admin').textContent).toContain('2 tests failed');
		row('apps').click();
		fixture.detectChanges();
		expect(rows()).toEqual(['', 'apps', 'docs', 'README.md']);
		row('apps').dispatchEvent(new MouseEvent('click', { altKey: true, bubbles: true }));
		fixture.detectChanges();
		expect(rows()).toEqual([
			'',
			'apps',
			'apps/admin',
			'apps/admin/a.ts',
			'apps/admin/b.ts',
			'apps/shop',
			'apps/shop/c.ts',
			'docs',
			'README.md',
		]);
		c.toggle('');
		fixture.detectChanges();
		expect(rows()).toEqual(['']);
		c.toggle('', true);
		fixture.detectChanges();
		expect(rows()).toContain('apps/shop/c.ts');
		row('docs').dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
		fixture.detectChanges();
		expect(rows()).toContain('docs/intro.md');
		expect(row('docs/intro.md').classList).toContain('unmeasured');
		expect(row('docs/intro.md').textContent).toContain('—');
		el.querySelector<HTMLButtonElement>('button[title="Open every folder that is below 100%"]')?.click();
		fixture.detectChanges();
		expect(rows()).not.toContain('docs/intro.md');
	});

	it('filters what is shown, finds files by name and puts the lowest first', async () => {
		const { chip, rows, fixture, el, c } = await render();
		c['openEveryGap']();
		fixture.detectChanges();
		expect(rows()).toContain('apps/admin/a.ts');
		chip('Below 100%').click();
		fixture.detectChanges();
		expect(rows()).not.toContain('apps/admin/a.ts');
		expect(chip('Below 100%').classList).toContain('on');
		chip('Below 100%').click();
		chip('Measured only').click();
		fixture.detectChanges();
		expect(rows()).not.toContain('README.md');
		chip('Measured only').click();
		chip('Lowest first').click();
		fixture.detectChanges();
		expect(rows().slice(1, 4)).toEqual(['apps', 'apps/shop', 'apps/shop/c.ts']);
		chip('Lowest first').click();
		const find = el.querySelector<HTMLInputElement>('input[aria-label="Find a file"]') as HTMLInputElement;
		find.value = 'c.ts';
		find.dispatchEvent(new Event('input'));
		fixture.detectChanges();
		expect(rows()).toEqual(['', 'apps', 'apps/shop', 'apps/shop/c.ts']);
	});

	it('marks a commit’s or a branch’s changed lines and keeps only the files they touch', async () => {
		const { chip, rows, settle, el, api } = await render();
		chip('Changed in this commit').click();
		await settle();
		expect(api.coverageTree).toHaveBeenLastCalledWith('p', 'r', { source: 'ci', run: '901', base: 'commit' });
		expect(el.textContent).toContain('1 of 2 changed lines ran');
		expect(el.textContent).toContain('1 changed lines no test ran');
		expect(rows()).toEqual(['', 'apps', 'apps/admin', 'apps/admin/b.ts']);
		chip('Changed since dev').click();
		await settle();
		expect(el.textContent).toContain('1 of 1 changed lines ran');
		expect(el.textContent).not.toContain('no test ran');
		chip('Changed since dev').click();
		await settle();
		expect(el.textContent).not.toContain('changed lines ran');
	});

	it('switches between CI runs and this Mac', async () => {
		const { chip, settle, api, el, c } = await render();
		chip('This Mac').click();
		await settle();
		expect(api.coverageTree).toHaveBeenLastCalledWith('p', 'r', { source: 'mac', run: 'mac', base: null });
		expect(el.textContent).toContain('claude/x · abcdef12 · measured');
		expect(el.textContent).toContain('with uncommitted changes');
		chip('CI run').click();
		await settle();
		// the CI run read before is shown again from memory
		expect(c['chosen']()).toEqual({ source: 'ci', run: '901' });
		const select = el.querySelector<HTMLSelectElement>('select') as HTMLSelectElement;
		select.value = '900';
		select.dispatchEvent(new Event('change'));
		await settle();
		expect(api.coverageTree).toHaveBeenLastCalledWith('p', 'r', { source: 'ci', run: '900', base: null });
		expect(el.textContent).toContain('0 failed');
		expect(c).toBeTruthy();
	});

	it('opens a file at the side, puts it in the address, jumps within it and to others, and closes it', async () => {
		const { c, row, settle, navigate, api, el, fixture } = await render();
		c.toggle('apps', true);
		fixture.detectChanges();
		row('apps/admin/a.ts').click();
		await settle();
		expect(api.coverageFile).toHaveBeenLastCalledWith('p', 'r', {
			source: 'ci',
			run: '901',
			base: null,
			path: 'apps/admin/a.ts',
		});
		expect(navigate).toHaveBeenLastCalledWith(
			[],
			expect.objectContaining({ queryParams: { file: 'apps/admin/a.ts', line: null } }),
		);
		expect(row('apps/admin/a.ts').classList).toContain('sel');
		expect(el.querySelector('rc-coverage-file')).not.toBeNull();
		expect(el.querySelector('.rc-cov-split')?.classList).toContain('open');
		expect(el.querySelector<HTMLAnchorElement>('a.rc-btn')?.href).toContain(
			'https://github.com/o/r/blob/abcdef1200/apps/admin/a.ts',
		);
		c['jump']({ path: 'apps/admin/a.ts', line: 2 });
		expect(navigate).toHaveBeenLastCalledWith(
			[],
			expect.objectContaining({ queryParams: { file: 'apps/admin/a.ts', line: 2 } }),
		);
		c['jump']({ path: 'apps/admin/a.ts', line: 3, tab: 'gaps' });
		c['jump']({ path: 'apps/shop/c.ts', line: 1, tab: 'tests' });
		await settle();
		expect(api.coverageFile).toHaveBeenLastCalledWith(
			'p',
			'r',
			expect.objectContaining({ path: 'apps/shop/c.ts' }),
		);
		c['jump']({ path: 'apps/admin/b.ts', line: 1 });
		c.close();
		await settle();
		expect(el.querySelector('rc-coverage-file')).toBeNull();
		expect(navigate).toHaveBeenLastCalledWith(
			[],
			expect.objectContaining({ queryParams: { file: null, line: null } }),
		);
	});

	it('answers the keys: / finds, Esc closes, n and p step, t shows tests, arrows and Enter move in the tree', async () => {
		const { c, el, row, fixture, settle } = await render();
		key('/');
		expect(document.activeElement?.getAttribute('aria-label')).toBe('Find a file');
		const find = el.querySelector('input') as HTMLInputElement;
		key('Escape', find);
		expect(document.activeElement).not.toBe(find);
		key('x', find);
		key('/', document.body, { metaKey: true });
		row('apps').focus();
		key('ArrowRight', row('apps'));
		fixture.detectChanges();
		expect(row('apps').getAttribute('aria-expanded')).toBe('true');
		key('ArrowRight', row('apps'));
		key('ArrowDown', row('apps'));
		expect(document.activeElement).toBe(row('apps/admin'));
		key('ArrowUp', row('apps/admin'));
		expect(document.activeElement).toBe(row('apps'));
		key('ArrowLeft', row('apps'));
		fixture.detectChanges();
		expect(row('apps').getAttribute('aria-expanded')).toBe('false');
		key('ArrowLeft', row('apps'));
		key('Enter', row('apps'));
		fixture.detectChanges();
		key(' ', row('apps/admin'));
		fixture.detectChanges();
		key('Enter', row('apps/admin/a.ts'));
		await settle();
		expect(el.querySelector('rc-coverage-file')).not.toBeNull();
		key('n');
		key('p');
		key('t');
		fixture.detectChanges();
		expect(el.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('Tests');
		key('q', row('apps'));
		key('Escape');
		await settle();
		expect(el.querySelector('rc-coverage-file')).toBeNull();
		key('n');
		key('z');
		const ghost = document.createElement('tr');
		ghost.className = 'row';
		ghost.dataset['path'] = 'gone';
		el.querySelector('tbody')?.appendChild(ghost);
		key('Enter', ghost);
		const stray = document.createElement('tr');
		stray.className = 'row';
		el.querySelector('tbody')?.appendChild(stray);
		key('Enter', stray);
		expect(c).toBeTruthy();
	});

	it('shows the map, goes into a folder there and opens a file from it', async () => {
		vi.stubGlobal(
			'ResizeObserver',
			class {
				observe(): void {}
				disconnect(): void {}
			},
		);
		const { fixture, el, c, settle } = await render();
		fixture.componentRef.setInput('tab', 'map');
		await settle();
		expect(el.querySelector('rc-coverage-map')).not.toBeNull();
		expect(el.querySelector('table')).toBeNull();
		el.querySelector('rc-coverage-map')?.dispatchEvent(new Event('noop'));
		c['mapFocus'].set('apps');
		c.openFile('apps/shop/c.ts', 4, 'tests');
		await settle();
		expect(c['line']()).toEqual({ n: 4 });
		expect(c['paneTab']()).toBe('tests');
	});

	it('opens the file and line the address names', async () => {
		const { el, api } = await render({ url: '/?file=apps%2Fshop%2Fc.ts&line=2' });
		expect(api.coverageFile).toHaveBeenCalledWith('p', 'r', expect.objectContaining({ path: 'apps/shop/c.ts' }));
		expect(el.querySelector('rc-coverage-file')).not.toBeNull();
	});

	it('says when there is no coverage yet, and copes with a run that measured nothing', async () => {
		const none = await render({
			runs: runs({
				ci: [],
				ciMessage: 'No CI run has kept reports yet.',
				mac: null,
				macMessage: 'Run pnpm coverage.',
			}),
		});
		expect(none.el.textContent).toContain('No coverage to show yet.');
		expect(none.el.textContent).toContain('No CI run has kept reports yet. Run pnpm coverage.');
		expect(none.chip('CI run').disabled).toBe(true);
		expect(none.chip('This Mac').disabled).toBe(true);
		none.c['openEveryGap']();
		expect(none.c['tiles']()).toEqual([]);
		expect(none.c['patch']()).toEqual({ run: 0, missed: 0 });
		expect(none.c['failedIn']('apps/admin')).toBe(0);
		none.c['pickSource']('ci');
		expect(none.c['chosen']()).toEqual({ source: 'ci', run: '' });
		none.c.toggle('x', true);
		TestBed.resetTestingModule();
		const empty = await render({ root: { n: 'saha-textile', c: null, k: [] } });
		expect([...empty.el.querySelectorAll('.rc-stat b')].map((b) => b.textContent?.trim())).toEqual([
			'100%',
			'100%',
			'100%',
			'100%',
			'2 failed',
		]);
		expect(empty.c['cells']({ path: 'x', name: 'x', depth: 0, folder: false, open: false, counts: null })).toEqual([
			null,
			null,
			null,
			null,
		]);
		TestBed.resetTestingModule();
		// outside a repository (no ids) and with no default branch: no “Changed since” choice
		const bare = await render({ ids: null, main: null });
		expect(bare.api.coverageRuns).toHaveBeenCalledWith('', '');
		expect(bare.api.coverageTree).toHaveBeenCalledWith('', '', { source: 'ci', run: '901', base: null });
		expect(bare.el.textContent).not.toContain('Changed since');
		bare.c.openFile('a.ts');
		await bare.settle();
		expect(bare.api.coverageFile).toHaveBeenCalledWith('', '', expect.objectContaining({ path: 'a.ts' }));
	});
});

export type Fixture = ComponentFixture<CoverageScreen>;
