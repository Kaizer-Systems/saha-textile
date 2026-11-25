import { type Type, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CodeChange } from './code-change';
import { CodeEdit } from './code-edit';
import { CodeFileView } from './code-file';
import { CodeFinder } from './code-finder';
import { CodeMarkdown } from './code-markdown';
import { CodeNav } from './code-nav';
import { CodeSwitcher } from './code-switcher';
import { ConsoleApi } from '../../data/console-api';
import { ConsoleContext } from '../../data/console-context';

const AT = '2026-11-24T10:00:00.000Z';
const ok = <T>(data: T) => ({ state: 'ok' as const, readAt: AT, data });
const refused = (message: string) => ({ state: 'error' as const, message });
const COMMIT = {
	sha: 'c'.repeat(40),
	headline: 'fix: a thing',
	author: 'kaizer03',
	login: 'kaizer03',
	date: AT,
	checks: 'none' as const,
};
const INFO = { owner: 'o', name: 'r', url: 'https://github.com/o/r', defaultBranch: 'main', viewer: 'kaizer03' };
const FILE = (path: string, over: Record<string, unknown> = {}) => ({
	ref: 'main',
	sha: 'f'.repeat(40),
	path,
	size: 30,
	kind: 'text',
	text: '# Shop\n\nThe shop.\n',
	lines: 3,
	html: path.endsWith('.md') ? '<h1>Shop</h1>' : null,
	last: COMMIT,
	...over,
});

function apiOf() {
	return {
		codeRefs: vi.fn(async () =>
			ok({
				defaultBranch: 'main',
				branches: [
					{ name: 'feat/x', rule: false },
					{ name: 'main', rule: true },
					{ name: 'alpha', rule: false },
				],
				tags: ['v1'],
			}),
		),
		codePaths: vi.fn(async () =>
			ok({ ref: 'main', sha: 's', paths: ['README.md', 'apps/api/main.ts', 'apps/admin/x.ts'] }),
		),
		codeFile: vi.fn(async (_p: string, _r: string, _ref: string, path: string) => ok(FILE(path))),
		codeBlame: vi.fn(async (_p: string, _r: string, _ref: string, path: string) =>
			ok({
				ref: 'main',
				sha: 's',
				path,
				lines: ['# Shop', '', 'The shop.'],
				runs: [
					{ start: 1, end: 2, sha: 'b1', headline: 'first', author: 'T', date: AT, previous: null },
					{
						start: 3,
						end: 3,
						sha: 'b2',
						headline: 'second',
						author: 'T',
						date: AT,
						previous: { sha: 'b1', path: 'docs/old.md' },
					},
				],
			}),
		),
		codeMarkdown: vi.fn(async (_p: string, _r: string, text: string) => ok({ html: `<p>${text}</p>` })),
		codeChange: vi.fn(async () => ok({ message: 'Done', url: null, branch: 'kaizer03-patch-1' })),
		codeRaw: vi.fn(async () => new Blob(['x'])),
	};
}
type Api = ReturnType<typeof apiOf>;

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
				useValue: { projectId: signal(ids && 'p'), repoId: signal(ids && 'r'), repo: signal(null) },
			},
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
	return { fixture, c, el, api, settle, router, queries, nav: TestBed.inject(CodeNav) };
}
const params = (router: Router) => new URL(`http://x${router.url}`).searchParams;
const set = (c: Record<string, unknown>, name: string, value: unknown) =>
	(c[name] as { set: (v: unknown) => void }).set(value);
const key = (k: string, target: Element = document.body, more: Partial<KeyboardEvent> = {}) =>
	({
		key: k,
		target,
		preventDefault: vi.fn(),
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		...more,
	}) as unknown as KeyboardEvent;

beforeEach(() => {
	Element.prototype.scrollIntoView = vi.fn();
	URL.createObjectURL = vi.fn(() => 'blob:x');
	URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe('a file’s page', () => {
	it('shows a Markdown file as Preview, Code or Blame, with its tree open to it', async () => {
		const { c, el, router, settle } = await render(CodeFileView, '/?tab=files&type=blob&path=docs/a.md#L2', {
			info: INFO,
			ref: 'main',
		});
		expect(c['shown']?.()).toBe('preview');
		expect(c['fileError']?.()).toBe('The file could not be read.');
		expect((c['views']?.() as Array<{ key: string }>).map((v) => v.key)).toEqual(['preview', 'code', 'blame']);
		expect(c['crumbs']?.()).toEqual([
			{ name: 'docs', path: 'docs' },
			{ name: 'a.md', path: 'docs/a.md' },
		]);
		expect((c['rows']?.() as unknown[]).length).toBeGreaterThan(1);
		expect([c['isMarked']?.(2), c['isMarked']?.(3)]).toEqual([true, false]);
		await router.navigateByUrl('/?tab=files&type=blob&path=docs/a.md&view=blame');
		await settle();
		expect((c['blamed']?.() as unknown[]).length).toBe(3);
		expect(c['blameError']?.()).toBe('The blame could not be read.');
		expect(el.textContent).toContain('first');
		// ⟲ opens the blame on the commit before, under the path the file had there.
		expect(el.querySelectorAll('[aria-label="The file before this change"]')).toHaveLength(1);
		(el.querySelector('[aria-label="The file before this change"]') as HTMLElement).click();
		await settle();
		expect([params(router).get('ref'), params(router).get('path'), params(router).get('view')]).toEqual([
			'b1',
			'docs/old.md',
			'blame',
		]);
		await router.navigateByUrl('/?tab=files&type=blob&path=docs/a.md&view=code');
		await settle();
		expect((c['lines']?.() as unknown[]).length).toBe(3);
	});

	it('marks lines and ranges, opens folders in the tree, and keeps GitHub’s b, y and l', async () => {
		const { c, router, settle } = await render(CodeFileView, '/?tab=files&type=blob&path=apps/api/main.ts', {
			info: INFO,
			ref: 'main',
		});
		c['markLine']?.(5, { shiftKey: false });
		c['markLine']?.(2, { shiftKey: true });
		await settle();
		expect(router.url).toContain('#L2-L5');
		c['markLine']?.(4, { shiftKey: true });
		await settle();
		expect(router.url).toContain('#L4-L5');
		c['pickRow']?.('apps/admin', true);
		expect((c['opened']?.() as Set<string>).has('apps/admin')).toBe(true);
		c['pickRow']?.('apps/admin', true);
		expect((c['opened']?.() as Set<string>).has('apps/admin')).toBe(false);
		c['pickRow']?.('README.md', false);
		await settle();
		expect(params(router).get('path')).toBe('README.md');
		await router.navigateByUrl('/?tab=files&type=blob&path=apps/api/main.ts');
		await settle();
		c['key']?.(key('b'));
		await settle();
		expect(params(router).get('view')).toBe('blame');
		c['key']?.(key('b'));
		await settle();
		expect(params(router).get('view')).toBeNull();
		c['key']?.(key('y'));
		await settle();
		expect(params(router).get('ref')).toBe('f'.repeat(40));
		await router.navigateByUrl('/?tab=files&type=blob&path=apps/api/main.ts#L1');
		await settle();
		c['key']?.(key('y'));
		await settle();
		expect(router.url).toContain('#L1');
		c['key']?.(key('l'));
		expect(c['jumping']?.()).toBe(true);
		set(c, 'jumpTo', '3');
		c['jump']?.();
		await settle();
		expect(router.url).toContain('#L3');
		set(c, 'jumpTo', '9');
		c['jump']?.();
		c['key']?.(key('b', document.createElement('textarea')));
		c['key']?.(key('b', document.body, { ctrlKey: true }));
		c['key']?.(key('q'));
	});

	it('copies the path and a permalink, opens Raw, downloads, and deletes the file with the PIN', async () => {
		const { c, api, router, settle } = await render(
			CodeFileView,
			'/?tab=files&type=blob&path=apps/api/main.ts#L1-L2',
			{
				info: INFO,
				ref: 'main',
			},
		);
		const writeText = vi.fn(async () => undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		vi.useFakeTimers({ toFake: ['setTimeout'] });
		c['copy']?.('apps/api/main.ts', 'path');
		await Promise.resolve();
		expect(c['copied']?.()).toBe('path');
		vi.advanceTimersByTime(1500);
		expect(c['copied']?.()).toBe('');
		vi.useRealTimers();
		writeText.mockRejectedValueOnce(new Error('denied'));
		c['copy']?.('x', 'path');
		await Promise.resolve();
		c['permalink']?.();
		expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining(`ref=${'f'.repeat(40)}`));
		expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('#L1-L2'));
		Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
		c['copy']?.('x', 'raw');
		const opened = vi.fn();
		vi.stubGlobal('open', opened);
		await c['raw']?.();
		expect(opened).toHaveBeenCalledWith('blob:x', '_blank', 'noopener');
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
		await c['download']?.();
		expect(click).toHaveBeenCalled();
		click.mockRestore();
		set(c, 'message', 'Delete main.ts');
		await (c['deleteRun'] as unknown as (pin: string) => Promise<unknown>)('123456');
		expect(api.codeChange).toHaveBeenLastCalledWith('p', 'r', 'commit', {
			pin: '123456',
			branch: 'main',
			message: 'Delete main.ts',
			changes: [{ path: 'apps/api/main.ts', content: null }],
			newBranch: '',
			pull: true,
		});
		c['deleted']?.();
		await settle();
		expect(params(router).get('path')).toBe('apps/api');
		set(c, 'branchFor', 'fix/x');
		await router.navigateByUrl('/?tab=files&type=blob&path=README.md');
		await settle();
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		c['permalink']?.();
		expect(writeText).toHaveBeenLastCalledWith(expect.not.stringContaining('#'));
		Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
		c['deleted']?.();
		await settle();
		expect(params(router).get('ref')).toBe('fix/x');
	});

	it('shows a picture from its bytes, and says why a file or its blame cannot be read', async () => {
		const api = apiOf();
		api.codeFile.mockImplementation(async (_p: string, _r: string, _ref: string, path: string) =>
			ok(FILE(path, { kind: 'image', text: null, lines: null, html: null })),
		);
		const pic = await render(CodeFileView, '/?tab=files&type=blob&path=logo.png', { info: INFO, ref: 'main' }, api);
		expect(pic.c['picture']?.()).toBe('blob:x');
		expect(pic.c['lines']?.()).toEqual([]);
		pic.fixture.destroy();
		expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
		api.codeRaw.mockRejectedValueOnce(new Error('gone'));
		const none = await render(
			CodeFileView,
			'/?tab=files&type=blob&path=logo.png',
			{ info: INFO, ref: 'main' },
			api,
		);
		expect(none.c['picture']?.()).toBeNull();
		none.fixture.destroy();
		const bad = apiOf();
		bad.codeFile.mockResolvedValue(refused('logo.png is not on main.') as never);
		bad.codeBlame.mockResolvedValue(refused('No blame') as never);
		const b = await render(
			CodeFileView,
			'/?tab=files&type=blob&path=x.ts&view=blame',
			{ info: INFO, ref: 'main' },
			bad,
		);
		expect(b.c['fileError']?.()).toBe('logo.png is not on main.');
		expect(b.c['blameError']?.()).toBe('No blame');
		expect(b.c['blamed']?.()).toBeNull();
		b.c['permalink']?.();
		b.c['key']?.(key('b'));
		b.c['jump']?.();
	});
});

describe('the editor', () => {
	it('edits a file with Preview, and commits it on a new branch with a pull request', async () => {
		const { c, api, router, settle, queries } = await render(CodeEdit, '/?tab=files&type=edit&path=docs/a.md', {
			info: INFO,
			ref: 'main',
			viewer: 'kaizer03',
			mode: 'edit',
		});
		expect(c['text']?.()).toBe('# Shop\n\nThe shop.\n');
		expect(c['changes']?.()).toEqual([]);
		set(c, 'text', '# Shop\n');
		expect(c['changes']?.()).toEqual(['docs/a.md']);
		expect(c['ruled']?.()).toBe(true);
		expect(c['markdownFile']?.()).toBe(true);
		await c['preview']?.();
		expect(c['previewHtml']?.()).toBe('<p># Shop\n</p>');
		api.codeMarkdown.mockResolvedValueOnce(refused('GitHub answered 500.') as never);
		await c['preview']?.();
		expect(c['previewHtml']?.()).toBe('<p>GitHub answered 500.</p>');
		set(c, 'committing', true);
		await settle();
		expect([c['message']?.(), c['branchName']?.()]).toEqual(['Update a.md', 'kaizer03-patch-1']);
		await (c['commitRun'] as unknown as (pin: string) => Promise<unknown>)('123456');
		expect(api.codeChange).toHaveBeenLastCalledWith(
			'p',
			'r',
			'commit',
			expect.objectContaining({
				branch: 'main',
				newBranch: 'kaizer03-patch-1',
				changes: [{ path: 'docs/a.md', content: 'IyBTaG9wCg==' }],
			}),
		);
		set(c, 'toNewBranch', false);
		await (c['commitRun'] as unknown as (pin: string) => Promise<unknown>)('123456');
		expect(api.codeChange).toHaveBeenLastCalledWith('p', 'r', 'commit', expect.objectContaining({ newBranch: '' }));
		const invalidate = vi.spyOn(queries, 'invalidateQueries');
		c['done']?.({ message: 'ok', url: null, branch: 'kaizer03-patch-1' });
		await settle();
		expect(invalidate).toHaveBeenCalledTimes(2);
		expect([params(router).get('ref'), params(router).get('type')]).toEqual(['kaizer03-patch-1', 'blob']);
		c['cancel']?.();
	});

	it('names a new file and uploads files, leaving out ones too big, and goes back on Cancel', async () => {
		const fresh = await render(CodeEdit, '/?tab=files&type=new&path=docs', {
			info: INFO,
			ref: 'feat/x',
			mode: 'new',
		});
		expect(fresh.c['changes']?.()).toEqual([]);
		set(fresh.c, 'newName', 'b.txt');
		expect(fresh.c['target']?.()).toBe('docs/b.txt');
		expect(fresh.c['ruled']?.()).toBe(false);
		set(fresh.c, 'committing', true);
		await fresh.settle();
		expect(fresh.c['message']?.()).toBe('Create b.txt');
		fresh.c['cancel']?.();
		await fresh.settle();
		expect(params(fresh.router).get('type')).toBeNull();
		const up = await render(CodeEdit, '/?tab=files&type=upload', { info: INFO, ref: 'main', mode: 'upload' });
		const big = new File(['x'], 'huge.bin');
		Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
		up.c['take']?.([new File(['a'], 'a.txt'), new File(['b'], 'b.txt'), big]);
		expect((up.c['uploads']?.() as Array<{ path: string }>).map((u) => u.path)).toEqual(['a.txt', 'b.txt']);
		expect(up.c['refused']?.()).toContain('huge.bin');
		up.c['take']?.(null);
		expect(up.c['refused']?.()).toBe('');
		up.c['drop']?.(0);
		expect(up.c['changes']?.()).toEqual(['b.txt']);
		set(up.c, 'committing', true);
		await up.settle();
		expect(up.c['message']?.()).toBe('Add files via upload');
		await (up.c['commitRun'] as unknown as (pin: string) => Promise<unknown>)('123456');
		expect(up.api.codeChange).toHaveBeenLastCalledWith(
			'p',
			'r',
			'commit',
			expect.objectContaining({ changes: [{ path: 'b.txt', content: 'Yg==' }] }),
		);
		up.c['done']?.({ message: 'ok', url: null, branch: null });
		await up.settle();
		expect(params(up.router).get('type')).toBeNull();
		const binary = apiOf();
		binary.codeFile.mockImplementation(async (_p: string, _r: string, _ref: string, path: string) =>
			ok(FILE(path, { text: null })),
		);
		const nb = await render(
			CodeEdit,
			'/?tab=files&type=edit&path=data.bin',
			{ info: INFO, ref: 'main', mode: 'edit' },
			binary,
		);
		expect(nb.c['text']?.()).toBe('');
		const noRefs = apiOf();
		noRefs.codeRefs.mockResolvedValue(refused('no') as never);
		const r = await render(CodeEdit, '/?tab=files&type=new', { info: INFO, ref: 'main', mode: 'new' }, noRefs);
		set(r.c, 'committing', true);
		await r.settle();
		expect(r.c['branchName']?.()).toBe('console-patch-1');
		expect(r.c['ruled']?.()).toBe(false);
	});
});

describe('Go to file', () => {
	it('finds by letters in order, moves with the arrows and opens with Enter', async () => {
		const { c, router, settle, nav } = await render(CodeFinder, '/?tab=files', { ref: 'main' });
		nav.finding.set(true);
		set(c, 'query', 'main');
		expect((c['hits']?.() as Array<{ path: string }>).map((h) => h.path)).toEqual(['apps/api/main.ts']);
		expect(c['error']?.()).toBe('The files could not be read.');
		set(c, 'query', 'x');
		c['key']?.(key('ArrowDown'));
		c['key']?.(key('ArrowUp'));
		c['key']?.(key('Tab'));
		c['key']?.(key('Enter'));
		await settle();
		expect(params(router).get('path')).toBe('apps/admin/x.ts');
		expect(nav.finding()).toBe(false);
		set(c, 'query', 'nothing at all');
		c['key']?.(key('Enter'));
		const bad = apiOf();
		bad.codePaths.mockResolvedValue(refused('The copy could not be read.') as never);
		const b = await render(CodeFinder, '/', { ref: 'main' }, bad);
		expect(b.c['error']?.()).toBe('The copy could not be read.');
		expect(b.c['hits']?.()).toEqual([]);
	});
});

describe('the change box', () => {
	it('says what changed, or GitHub’s reason, or what failed', async () => {
		const run = vi
			.fn()
			.mockResolvedValueOnce(ok({ message: 'Done', url: null, branch: null }))
			.mockResolvedValueOnce(refused('GitHub refused it: Protected branch.'))
			.mockRejectedValueOnce(new Error('The console API is not answering.'));
		const { c, el, settle } = await render(CodeChange, '/', {
			title: 'Delete',
			submit: 'Delete',
			run,
			danger: true,
		});
		set(c, 'pin', '123456');
		await c['send']?.();
		await settle();
		expect(el.textContent).toContain('Done');
		set(c, 'done', null);
		await c['send']?.();
		expect(c['error']?.()).toBe('GitHub refused it: Protected branch.');
		await c['send']?.();
		expect(c['error']?.()).toBe('The console API is not answering.');
		expect(run).toHaveBeenCalledWith('123456');
	});
});

describe('the branch and tag switcher', () => {
	it('lists branches (the default first) and tags, picks with keys, and creates a branch', async () => {
		const { c, api, settle, fixture } = await render(CodeSwitcher, '/', { current: 'feat/x' });
		const picked: string[] = [];
		(fixture.componentInstance as CodeSwitcher).picked.subscribe((n) => picked.push(n));
		c['toggle']?.();
		await settle();
		expect(c['hits']?.()).toEqual(['main', 'alpha', 'feat/x']);
		expect([c['where']?.('main'), c['where']?.('feat/x'), c['where']?.('gone')]).toEqual([
			'default · protected by a rule',
			'',
			'',
		]);
		expect(c['isTag']?.()).toBe(false);
		c['key']?.(key('ArrowDown'));
		c['key']?.(key('ArrowDown'));
		c['key']?.(key('ArrowUp'));
		c['key']?.(key('ArrowUp'));
		c['key']?.(key('Enter'));
		expect(picked).toEqual(['main']);
		c['toggle']?.();
		c['toggle']?.();
		expect(c['open']?.()).toBe(false);
		set(c, 'tab', 'tags');
		expect(c['hits']?.()).toEqual(['v1']);
		expect(c['where']?.('v1')).toBe('');
		set(c, 'tab', 'branches');
		set(c, 'query', 'fix/new');
		c['key']?.(key('Enter'));
		expect(c['creating']?.()).toBe('fix/new');
		await (c['createRun']?.('fix/new') as (pin: string) => Promise<unknown>)('123456');
		expect(api.codeChange).toHaveBeenLastCalledWith('p', 'r', 'branch', {
			pin: '123456',
			name: 'fix/new',
			from: 'feat/x',
		});
		c['created']?.('fix/new', { message: '', url: null, branch: 'fix/new' });
		expect(picked).toEqual(['main', 'fix/new']);
		c['toggle']?.();
		c['outside']?.({ target: document.body } as unknown as MouseEvent);
		expect(c['open']?.()).toBe(false);
		c['outside']?.({ target: document.body } as unknown as MouseEvent);
		c['toggle']?.();
		c['key']?.(key('Escape'));
		expect(c['open']?.()).toBe(false);
		fixture.componentRef.setInput('canCreate', false);
		set(c, 'query', 'nope');
		c['key']?.(key('Enter'));
		c['key']?.(key('a'));
	});

	it('says why GitHub’s branches could not be read, and knows a tag shown', async () => {
		const bad = apiOf();
		bad.codeRefs.mockResolvedValue(refused('GitHub is not connected.') as never);
		const b = await render(CodeSwitcher, '/', { current: 'v1' }, bad);
		b.c['toggle']?.();
		await b.settle();
		expect(b.c['refsError']?.()).toBe('GitHub is not connected.');
		expect(b.c['hits']?.()).toEqual([]);
		expect(b.c['where']?.('x')).toBe('');
		const t = await render(CodeSwitcher, '/', { current: 'v1' });
		t.c['toggle']?.();
		await t.settle();
		expect(t.c['isTag']?.()).toBe(true);
		expect(t.c['refsError']?.()).toBe('GitHub could not be read.');
	});
});

describe('Markdown as GitHub draws it', () => {
	it('opens this repository’s links here, others in a new tab, and outlines its headings', async () => {
		const html =
			'<h2>One</h2><h3>Two</h3><h3>Three</h3><a id="in" href="https://github.com/o/r/blob/main/docs/a.md">in</a>' +
			'<a id="out" href="https://example.com/">out</a><img alt="logo" src="https://github.com/o/r/raw/main/logo.png" />';
		const { c, el, router, settle } = await render(CodeMarkdown, '/', {
			html,
			repoUrl: 'https://github.com/o/r',
			ref: 'main',
		});
		expect((c['outline']?.() as unknown[]).length).toBe(3);
		const links = el.querySelectorAll('.rc-md a');
		const inside = links[0] as HTMLAnchorElement;
		const ev = { target: inside, preventDefault: vi.fn() } as unknown as MouseEvent;
		c['follow']?.(ev);
		await settle();
		expect(params(router).get('path')).toBe('docs/a.md');
		const outside = { target: links[1], preventDefault: vi.fn() } as unknown as MouseEvent;
		c['follow']?.(outside);
		expect((outside.preventDefault as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
		c['follow']?.({ target: el.querySelector('h2'), preventDefault: vi.fn() } as unknown as MouseEvent);
		el.querySelector('img')?.dispatchEvent(new Event('error'));
		expect(el.textContent).toContain('Picture: logo ↗');
		c['unshown']?.(Object.assign(document.createElement('img'), { src: 'https://x/a.png' }));
		set(c, 'outlineShown', true);
		c['jump']?.('pr-h-2');
		expect(c['outlineShown']?.()).toBe(false);
	});
});

describe('before a project and repository are chosen', () => {
	it('asks with empty names, and the page’s state falls back to its first tab', async () => {
		const { c, api, nav } = await render(CodeSwitcher, '/', { current: 'main' }, apiOf(), null);
		c['toggle']?.();
		await new Promise((r) => setTimeout(r, 0));
		expect(api.codeRefs).toHaveBeenCalledWith('', '');
		await (c['createRun']?.('x') as (pin: string) => Promise<unknown>)('123456');
		expect(api.codeChange).toHaveBeenLastCalledWith('', '', 'branch', expect.anything());
		expect([nav.p(), nav.r(), nav.tab(), nav.view(), nav.lines()]).toEqual(['', '', 'files', '', null]);
	});
});
