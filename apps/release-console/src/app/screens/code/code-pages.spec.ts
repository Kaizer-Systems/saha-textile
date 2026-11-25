import { type Type, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CodeHome, save } from './code-home';
import { CodeNav } from './code-nav';
import { CodeScreen } from './code-screen';
import { ConsoleApi } from '../../data/console-api';
import { ConsoleContext } from '../../data/console-context';

import type { RepoInfo } from '@saha-textile/release-console-contracts';

const AT = '2026-11-24T10:00:00.000Z';
const ok = <T>(data: T) => ({ state: 'ok' as const, readAt: AT, data });
const refused = (message: string) => ({ state: 'error' as const, message });
const COMMIT = {
	sha: 'c'.repeat(40),
	headline: 'fix: a thing',
	author: 'kaizer03',
	login: 'kaizer03',
	date: AT,
	checks: 'passed' as const,
};

const INFO: RepoInfo = {
	owner: 'o',
	name: 'r',
	url: 'https://github.com/o/r',
	visibility: 'public',
	description: null,
	homepage: 'https://example.com',
	topics: ['shop'],
	stars: 0,
	watchers: 1,
	forks: 0,
	defaultBranch: 'main',
	viewer: 'kaizer03',
	license: 'MIT License',
	watching: 'none',
	starred: false,
	branches: 10,
	tags: 0,
	releases: { total: 1, latest: { name: 'One', tag: 'v1', publishedAt: AT } },
	environments: [
		{ name: 'staging', deployedAt: AT, state: 'success' },
		{ name: 'production', deployedAt: null, state: null },
	],
	contributors: { total: 1, people: [{ login: 'kaizer03', contributions: 1700 }] },
	languages: [{ name: 'TypeScript', color: '#3178c6', share: 69.5 }],
	community: [
		{ key: 'readme', label: 'README', path: 'README.md' },
		{ key: 'license', label: 'License', path: 'LICENSE' },
	],
};
const TREE = {
	ref: 'main',
	sha: 's'.repeat(40),
	path: '',
	head: COMMIT,
	commits: 1700,
	entries: [
		{ name: 'apps', path: 'apps', kind: 'dir' as const, last: { sha: 'a1', headline: 'feat: apps', date: AT } },
		{ name: 'vendor', path: 'vendor', kind: 'module' as const, last: null },
		{ name: 'link.md', path: 'link.md', kind: 'link' as const, last: null },
		{ name: 'README.md', path: 'README.md', kind: 'file' as const, last: null },
	],
	readme: { path: 'README.md', html: '<h2>Shop</h2><p>The shop.</p>' },
};
const FILE = (path: string, over: Record<string, unknown> = {}) => ({
	ref: 'main',
	sha: 'f'.repeat(40),
	path,
	size: 30,
	kind: 'text' as const,
	text: '# Shop\n\nThe shop.\n',
	lines: 3,
	html: path.endsWith('.md') ? '<h1>Shop</h1>' : null,
	last: COMMIT,
	...over,
});

function apiOf() {
	return {
		codeRepo: vi.fn(async () => ok(INFO)),
		codeTree: vi.fn(async (_p: string, _r: string, ref: string, path: string) => ok({ ...TREE, ref, path })),
		codeDoc: vi.fn(async (_p: string, _r: string, _ref: string, path: string) =>
			ok({ path, html: '<pre>MIT</pre>' }),
		),
		codeRefs: vi.fn(async () =>
			ok({
				defaultBranch: 'main',
				branches: [
					{ name: 'main', rule: true },
					{ name: 'dev', rule: true },
					{ name: 'feat/x', rule: false },
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
				runs: [{ start: 1, end: 3, sha: 'b1', headline: 'first', author: 'T', date: AT, previous: null }],
			}),
		),
		codeMarkdown: vi.fn(async (_p: string, _r: string, text: string) => ok({ html: `<p>${text}</p>` })),
		codePackages: vi.fn(async () => ok({ packages: [] })),
		codeChange: vi.fn(async () =>
			ok({ message: 'Done', url: 'https://github.com/o/r', branch: 'kaizer03-patch-1' }),
		),
		codeRaw: vi.fn(async () => new Blob(['x'])),
		codeZip: vi.fn(async () => new Blob(['PK'])),
	};
}
type Api = ReturnType<typeof apiOf>;

async function render<T>(component: Type<T>, url: string, inputs: Record<string, unknown> = {}, api: Api = apiOf()) {
	TestBed.resetTestingModule();
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	TestBed.configureTestingModule({
		providers: [
			provideRouter([]),
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

describe('the Code page', () => {
	it('reads the repository, opens each tab, and keeps GitHub’s keys', async () => {
		const { c, el, router, settle } = await render(CodeScreen, '/?tab=files');
		expect(el.textContent).toContain('o / r');
		expect(c['error']?.()).toBe('The repository could not be read.');
		expect(c['visibility']?.('public')).toBe('Public');
		expect(c['visibility']?.('odd')).toBe('odd');
		expect([c['tabCount']?.('branches'), c['tabCount']?.('releases'), c['tabCount']?.('files')]).toEqual([
			10, 1, 0,
		]);
		for (const tab of ['commits', 'branches', 'tags', 'releases', 'compare', 'activity', 'search']) {
			await router.navigateByUrl(`/?tab=${tab}`);
			await settle();
		}
		await router.navigateByUrl('/?tab=commits&sha=abc1234');
		await settle();
		for (const type of ['blob', 'edit', 'upload']) {
			await router.navigateByUrl(`/?tab=files&type=${type}&path=README.md`);
			await settle();
			expect(c['mode']?.()).toBe(type === 'blob' ? 'blob' : 'edit');
		}
		c['key']?.(key('t'));
		c['key']?.(key('w'));
		c['key']?.(key('/'));
		c['key']?.(key('s'));
		c['key']?.(key('t', document.createElement('input')));
		c['key']?.(key('t', document.body, { metaKey: true }));
		c['key']?.(key('x'));
		(c['words'] as unknown as { set: (v: string) => void }).set('  ');
		c['search']?.();
		(c['words'] as unknown as { set: (v: string) => void }).set('port');
		c['search']?.();
		await settle();
		expect(params(router).get('tab')).toBe('search');
		c['toggle']?.('watch');
		expect(c['menu']?.()).toBe('watch');
		c['toggle']?.('watch');
		expect(c['menu']?.()).toBeNull();
	});

	it('asks for the PIN to watch, star and fork, then reads the repository again', async () => {
		const { c, api, queries } = await render(CodeScreen, '/?tab=files');
		const invalidate = vi.spyOn(queries, 'invalidateQueries');
		for (const [kind, value] of [
			['watch', 'subscribed'],
			['star', 'on'],
			['star', 'off'],
			['fork', ''],
		]) {
			c['ask']?.(kind, value);
			const a = c['asking']?.() as { run: (pin: string) => Promise<unknown>; title: string };
			await a.run('123456');
		}
		expect(api.codeChange.mock.calls.map((x) => x[2])).toEqual(['watch', 'star', 'star', 'fork']);
		expect(api.codeChange.mock.calls[3]?.[3]).toEqual({ pin: '123456', name: '', defaultOnly: true });
		c['changed']?.();
		expect(c['asking']?.()).toBeNull();
		expect(invalidate).toHaveBeenCalled();
	});

	it('says why when GitHub cannot be read', async () => {
		const api = apiOf();
		api.codeRepo.mockResolvedValue(refused('GitHub is not connected.') as never);
		const { el, c } = await render(CodeScreen, '/', {}, api);
		expect(el.textContent).toContain('GitHub is not connected.');
		expect([c['ref']?.(), c['tabCount']?.('tags')]).toEqual(['', 0]);
	});
});

describe('a folder', () => {
	it('lists the top with its README, community tabs and the right column', async () => {
		const { c, el, api, router, settle } = await render(CodeHome, '/?tab=files', { info: INFO, ref: 'main' });
		expect(el.textContent).toContain('feat: apps');
		expect(c['treeError']?.()).toBe('The folder could not be read.');
		expect((c['clone']?.() as unknown[]).length).toBe(3);
		expect(el.textContent).toContain('The shop.');
		expect((c['docs']?.() as Array<{ key: string }>).map((d) => d.key)).toEqual(['readme', 'license']);
		expect(['dir', 'module', 'link', 'file'].map((k) => c['icon']?.(k))).toEqual([
			'tabler/folder',
			'tabler/folder-symlink',
			'tabler/link',
			'tabler/file',
		]);
		(c['doc'] as unknown as { set: (v: string) => void }).set('license');
		await settle();
		expect(api.codeDoc).toHaveBeenCalledWith('p', 'r', 'main', 'LICENSE');
		expect(c['docHtml']?.()).toBe('<pre>MIT</pre>');
		expect(c['packages']?.()).toEqual([]);
		c['openEntry']?.('apps', 'dir');
		await settle();
		expect(params(router).get('path')).toBe('apps');
		expect(c['parent']?.()).toBe('');
		c['openEntry']?.('README.md', 'file');
		await settle();
		expect(params(router).get('type')).toBe('blob');
	});

	it('reads a subfolder without the right column, and says why a read failed', async () => {
		const api = apiOf();
		api.codeDoc.mockResolvedValue(refused('No such file') as never);
		api.codePackages.mockResolvedValue(refused("Packages needs GitHub's read:packages right") as never);
		const { c, settle } = await render(CodeHome, '/?tab=files&path=apps/api', { info: INFO, ref: 'main' }, api);
		expect((c['docs']?.() as unknown[]).length).toBe(1);
		expect(c['crumbs']?.()).toEqual([
			{ name: 'apps', path: 'apps' },
			{ name: 'api', path: 'apps/api' },
		]);
		expect(c['packagesError']?.()).toBe('Reading packages…');
		const { c: top, settle: s2 } = await render(CodeHome, '/?tab=files', { info: INFO, ref: 'main' }, api);
		expect(top['needsRight']?.()).toBe(true);
		(top['signing'] as unknown as { set: (v: boolean) => void }).set(false);
		top['rightAdded']?.();
		(top['doc'] as unknown as { set: (v: string) => void }).set('license');
		await s2();
		expect(top['docHtml']?.()).toBe('<p>No such file</p>');
		await settle();
		const broken = apiOf();
		broken.codeTree.mockResolvedValue(refused('The ref is gone') as never);
		const { c: gone } = await render(
			CodeHome,
			'/?tab=files',
			{ info: { ...INFO, community: [] }, ref: 'x' },
			broken,
		);
		expect(gone['treeError']?.()).toBe('The ref is gone');
		expect(gone['docs']?.()).toEqual([]);
		expect(gone['docHtml']?.()).toBe('');
	});

	it('opens Add file and Code, copies a clone address, saves the .zip, and edits About', async () => {
		const { c, api, router, settle, queries } = await render(CodeHome, '/?tab=files', {
			info: INFO,
			ref: 'feat/x',
		});
		c['toggle']?.('add');
		expect(c['menu']?.()).toBe('add');
		c['toggle']?.('add');
		expect(c['menu']?.()).toBeNull();
		c['add']?.('new');
		await settle();
		expect(params(router).get('type')).toBe('new');
		const writeText = vi.fn(async () => undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		vi.useFakeTimers({ toFake: ['setTimeout'] });
		c['copy']?.('gh repo clone o/r');
		await Promise.resolve();
		expect(c['copied']?.()).toBe('gh repo clone o/r');
		vi.advanceTimersByTime(1500);
		expect(c['copied']?.()).toBe('');
		vi.useRealTimers();
		writeText.mockRejectedValueOnce(new Error('denied'));
		c['copy']?.('x');
		await Promise.resolve();
		Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
		c['copy']?.('x');
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
		await c['zip']?.();
		expect(api.codeZip).toHaveBeenCalledWith('p', 'r', 'feat/x');
		expect(click).toHaveBeenCalled();
		api.codeZip.mockRejectedValueOnce(new Error('GitHub answered 404.'));
		await c['zip']?.();
		expect(c['zipError']?.()).toBe('GitHub answered 404.');
		c['editAbout']?.();
		expect(c['aboutTopics']?.()).toBe('shop');
		(c['aboutTopics'] as unknown as { set: (v: string) => void }).set('Shop, sarees  kolkata');
		await (c['aboutRun'] as unknown as (pin: string) => Promise<unknown>)('123456');
		expect(api.codeChange).toHaveBeenLastCalledWith('p', 'r', 'about', {
			pin: '123456',
			description: '',
			homepage: 'https://example.com',
			topics: ['shop', 'sarees', 'kolkata'],
		});
		const invalidate = vi.spyOn(queries, 'invalidateQueries');
		c['changed']?.();
		expect(invalidate).toHaveBeenCalled();
		c['editAbout']?.();
		const bare = await render(CodeHome, '/?tab=files', {
			info: { ...INFO, homepage: null, description: 'D' },
			ref: 'main',
		});
		bare.c['editAbout']?.();
		expect([bare.c['aboutHome']?.(), bare.c['aboutText']?.()]).toEqual(['', 'D']);
		click.mockRestore();
	});

	it('saves bytes under a name and lets the address go after a while', () => {
		vi.useFakeTimers();
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
		save(new Blob(['x']), 'a.txt');
		vi.advanceTimersByTime(10_000);
		expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
		click.mockRestore();
		vi.useRealTimers();
	});
});
