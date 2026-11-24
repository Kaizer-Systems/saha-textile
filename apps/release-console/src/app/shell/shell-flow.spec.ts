import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { describe, expect, it, vi } from 'vitest';

import { Shell } from './shell';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { ConsoleState } from '../data/console-state';
import { repositoryMenu } from '../menu/repo-menu';

import type { MenuGroup, ConsoleMenu } from '../menu/menu.types';
import type { Environment, Project, Repository } from '@saha-textile/release-console-contracts';

const ENVS = [
	{ name: 'local', label: 'Local', cloudId: null, domains: [], secretsId: null, secretsPath: '', branch: '' },
	{
		name: 'staging',
		label: 'Staging',
		cloudId: 'digitalocean',
		domains: ['staging.example.com'],
		secretsId: null,
		secretsPath: '',
		branch: '',
	},
] as Environment[];
const REPO: Repository = {
	id: 'shop',
	name: 'shop',
	role: 'monorepo',
	sourceCode: { vendor: 'github', repository: 'own/shop', keyId: null },
	environments: ENVS,
	cloud: [{ id: 'digitalocean', vendor: 'digitalocean', account: '', keyIds: [] }],
	edge: [{ id: 'cloudflare', vendor: 'cloudflare', account: '', zones: ['example.com'], keyIds: [] }],
	secrets: [],
	menus: ['payments'],
} as Repository;
const PROJECT = { id: 'proj_1', name: 'Saha Textile', repositories: [REPO], keys: [] } as unknown as Project;

/** The shell's members these tests use (protected on the component). */
interface ShellView {
	envSwitch: () => boolean;
	load: () => { loader: string; source: string; what: string };
	openGroup: () => string;
	scope: () => string;
	firstReads: () => number;
	hits: () => Array<{ label: string; link: string[]; query: Record<string, string>; icon: string }>;
	query: { set(v: string): void; (): string };
	active: { set(v: number): void; (): number };
	projectOpen: () => boolean;
	repoOpen: () => boolean;
	menu: () => ConsoleMenu | null;
	planLock(key: string): unknown;
	groupIcon(g: MenuGroup): string;
	envIcon(e: Environment): string;
	count(label: string): number;
	isLater(key: string): boolean;
	currentEnvLabel(): string;
	go(link: string[], query?: Record<string, string>): void;
	goScreen(key: string): void;
	openGroupFirst(label: string): void;
	pick(hit: unknown): void;
	lockNow(): void;
	onSearchKey(e: KeyboardEvent): void;
	onKey(e: KeyboardEvent): void;
	closeMenus(e: MouseEvent): void;
	toggleProject(e: Event): void;
	toggleRepo(e: Event): void;
}

function make() {
	const level = signal<'console' | 'project' | 'repository'>('repository');
	const page = signal('overview');
	const tab = signal<string | null>(null);
	const repo = signal<Repository | null>(REPO);
	const project = signal<Project | null>(PROJECT);
	const projectId = signal<string | null>('proj_1');
	const repoId = signal<string | null>('shop');
	const environments = signal<Environment[]>(ENVS);
	const menuOverride = signal<ConsoleMenu | null | undefined>(undefined);
	const ctx = {
		level,
		page,
		tab,
		repo,
		project,
		projectId,
		repoId,
		environments,
		menuOverride,
		repoMenu: computed(() => {
			const forced = menuOverride();
			if (forced !== undefined) return forced;
			const r = repo();
			return r ? repositoryMenu(r) : null;
		}),
		projects: { data: () => ({ projects: [PROJECT] }) },
	};
	const api = new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
		get: (target, key: string) => (target[key] ??= vi.fn(async () => ({}))),
	});
	const router = { navigate: vi.fn(async () => true) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ConsoleApi, useValue: api },
			{ provide: ConsoleContext, useValue: ctx },
			{ provide: Router, useValue: router },
		],
	});
	TestBed.overrideComponent(Shell, { set: { imports: [], template: '', templateUrl: undefined } });
	const state = TestBed.inject(ConsoleState);
	state.setEnvironment('production');
	const fixture = TestBed.createComponent(Shell);
	fixture.detectChanges();
	return { c: fixture.componentInstance as unknown as ShellView, ctx, router, api, state, fixture };
}
const key = (k: string, over: object = {}) =>
	({ key: k, preventDefault: vi.fn(), ...over }) as unknown as KeyboardEvent;

describe('the shell at repository level', () => {
	it('moves the chosen environment to one the repository has', () => {
		const { state } = make();
		expect(state.environment()).toBe('local');
	});

	it('shows the environment switch, the loader and the open group for every screen in the menu', () => {
		const { c, ctx } = make();
		const menu = c.menu() as ConsoleMenu;
		const seen = new Set<string>();
		for (const g of menu.menu)
			for (const sub of g.subs)
				for (const item of sub.items) {
					ctx.page.set(item);
					ctx.tab.set(null);
					const plain = c.load();
					const states = Object.keys(menu.screens[item]?.states ?? {});
					ctx.tab.set(states[1] ?? 'nope');
					const tabbed = c.load();
					seen.add(`${String(c.envSwitch())}|${plain.source}|${tabbed.what !== ''}`);
					expect(c.openGroup()).not.toBe('');
				}
		expect(seen.size).toBeGreaterThan(3);
		for (const page of ['overview', 'settings', 'not-a-screen']) {
			ctx.page.set(page);
			expect(c.load().source).toBeTruthy();
		}
		expect(c.envSwitch()).toBe(false);
		expect(c.scope()).toBe('shop');
	});

	it('falls back to words for the repository and GitHub while the repository is not read yet', () => {
		const { c, ctx } = make();
		const menu = c.menu() as ConsoleMenu;
		const shipPage = menu.menu.find((g) => g.label.startsWith('Ship'))?.subs[0]?.items[0] as string;
		const ownPage = menu.menu.find((g) => g.own)?.subs[0]?.items[0];
		ctx.repo.set(null);
		expect(c.menu()).toBeNull();
		expect(c.envSwitch()).toBe(false);
		ctx.page.set(shipPage);
		expect(c.load().source).toBeTruthy();
		expect(c.scope()).toBe('this repository');
		ctx.repo.set(REPO);
		if (ownPage) {
			ctx.page.set(ownPage);
			expect(c.load().source).toBe('shop');
		}
	});

	it('searches the repository’s own menu, and moves through the results with the keys', () => {
		const { c, router } = make();
		c.query.set('secret');
		const hits = c.hits();
		expect(hits.length).toBeGreaterThan(0);
		expect(hits[0]?.link.slice(0, 4)).toEqual(['/p', 'proj_1', 'r', 'shop']);
		c.onSearchKey(key('ArrowDown'));
		c.onSearchKey(key('ArrowUp'));
		c.onSearchKey(key('ArrowUp'));
		expect(c.active()).toBe(hits.length - 1);
		c.onSearchKey(key('Enter'));
		expect(router.navigate).toHaveBeenCalled();
		c.query.set('zzzz-no-such-thing');
		expect(c.hits()).toEqual([]);
		c.onSearchKey(key('ArrowDown'));
		c.onSearchKey(key('ArrowUp'));
		expect(c.active()).toBe(0);
		c.onSearchKey(key('Escape'));
		expect(c.query()).toBe('');
		c.onSearchKey(key('Tab'));
	});

	it('reads screens, groups, counts and plan locks from the menu, and goes to screens', () => {
		const { c, router, ctx, api } = make();
		const menu = c.menu() as ConsoleMenu;
		const first = menu.menu[0] as MenuGroup;
		expect(c.count(first.label)).toBeGreaterThan(0);
		expect(c.count('No such group')).toBe(0);
		expect(c.groupIcon(first)).toBeTruthy();
		expect(c.groupIcon({ label: 'Unknown', subs: [] } as unknown as MenuGroup)).toBe('tabler/folder');
		expect(c.groupIcon({ label: 'Mine', own: true, subs: [] } as unknown as MenuGroup)).toBeTruthy();
		expect(c.envIcon(ENVS[0] as Environment)).toBeTruthy();
		expect(c.isLater('not-a-screen')).toBe(false);
		expect(c.currentEnvLabel()).toBe('Local');
		const planned = Object.entries(menu.screens).find(([, s]) => s.plan)?.[0];
		if (planned) expect(c.planLock(planned)).toBeTruthy();
		expect(c.planLock('not-a-screen')).toBeNull();
		c.openGroupFirst(first.label);
		expect(router.navigate).toHaveBeenCalled();
		c.openGroupFirst('No such group');
		ctx.projectId.set(null);
		const calls = router.navigate.mock.calls.length;
		c.goScreen('overview');
		expect(router.navigate.mock.calls.length).toBe(calls);
		c.pick(undefined);
		c.lockNow();
		expect(api['lockNow']).toHaveBeenCalled();
		ctx.repo.set(null);
		expect(c.count(first.label)).toBe(0);
		expect(c.isLater('x')).toBe(false);
	});

	it('opens search with ⌘K or Ctrl+K, closes menus with Escape or a click elsewhere, and toggles the switchers', () => {
		const { c } = make();
		c.onKey(key('k', { metaKey: true }));
		c.onKey(key('K', { ctrlKey: true }));
		c.onKey(key('x'));
		const stop = { stopPropagation: vi.fn() } as unknown as Event;
		c.toggleProject(stop);
		expect(c.projectOpen()).toBe(true);
		c.toggleRepo(stop);
		expect(c.repoOpen()).toBe(true);
		expect(c.projectOpen()).toBe(false);
		c.onKey(key('Escape'));
		expect(c.repoOpen()).toBe(false);
		const inside = document.createElement('div');
		inside.className = 'pj-switch';
		const child = document.createElement('span');
		inside.append(child);
		c.toggleProject(stop);
		c.closeMenus({ target: child } as unknown as MouseEvent);
		expect(c.projectOpen()).toBe(true);
		c.closeMenus({ target: document.createElement('p') } as unknown as MouseEvent);
		expect(c.projectOpen()).toBe(false);
		c.closeMenus({ target: null } as unknown as MouseEvent);
	});
});

describe('the shell at project and console level', () => {
	it('names the project, finds its pages, settings tabs and repositories, and their icons', () => {
		const { c, ctx } = make();
		ctx.level.set('project');
		ctx.page.set('settings');
		expect(c.load().source).toBe('the console');
		expect(c.scope()).toBe('Saha Textile');
		c.query.set('keys');
		expect(c.hits().some((h) => h.query['tab'] === 'connections')).toBe(true);
		c.query.set('shop');
		expect(c.hits().some((h) => h.link.length > 3 && h.icon === 'tabler/brand-git')).toBe(true);
		c.query.set('');
		expect(c.hits().every((h) => h.icon)).toBe(true);
		ctx.project.set(null);
		expect(c.scope()).toBe('this project');
		expect(c.hits().every((h) => h.link[0] === '/console')).toBe(true);
	});

	it('names the console, finds its pages, and draws a known or a plain loader', () => {
		const { c, ctx } = make();
		ctx.level.set('console');
		ctx.page.set('projects');
		expect(c.load().source).toBe('the console');
		ctx.page.set('some-new-page');
		expect(c.load()).toMatchObject({ loader: 'boot', what: 'some new page' });
		expect(c.scope()).toBe('the console');
		c.query.set('audit');
		expect(c.hits()[0]?.link).toEqual(['/console', 'audit']);
	});

	it('leaves the environment alone when the project has none or already has it', () => {
		const { ctx, state, fixture } = make();
		ctx.environments.set([]);
		state.setEnvironment('production');
		fixture.detectChanges();
		expect(state.environment()).toBe('production');
	});
});

describe('the shell with menus of every shape', () => {
	const menu = (groups: object[]): ConsoleMenu =>
		({
			menu: groups,
			screens: { a: { label: 'A', states: {} }, b: { label: 'B', states: { x: 'X' } } },
			later: [],
		}) as unknown as ConsoleMenu;

	it('words the source of own, Ship and Shop groups, and an unlabelled Ship part, without a repository', async () => {
		const { c, ctx } = make();
		// A first read still on its way shows in the top bar.
		void TestBed.inject(QueryClient).fetchQuery({
			queryKey: ['first-read'],
			queryFn: () => new Promise(() => undefined),
		});
		await vi.waitFor(() => expect(c.firstReads()).toBeGreaterThan(0));
		ctx.repo.set(null);
		expect(c.openGroup()).toBe('');
		ctx.menuOverride.set(
			menu([
				{ label: 'Mine', own: true, subs: [{ items: ['a'] }] },
				{ label: 'Ship', subs: [{ items: ['b'] }] },
				{ label: 'Shop', subs: [{ items: ['c'] }] },
			]),
		);
		ctx.page.set('a');
		expect(c.load().source).toBe('the repository');
		ctx.page.set('b');
		expect(c.load().source).toBe('GitHub');
		expect(c.envSwitch()).toBe(false);
		ctx.page.set('c');
		expect(c.load().source).toBe('the shop');
	});

	it('says no environment while the chosen one is not among them', () => {
		const { c, ctx } = make();
		ctx.environments.set([]);
		expect(c.currentEnvLabel()).toBe('');
	});
});
