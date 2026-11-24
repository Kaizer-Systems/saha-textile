import { NgTemplateOutlet } from '@angular/common';
import {
	ChangeDetectionStrategy,
	Component,
	ElementRef,
	computed,
	effect,
	inject,
	signal,
	viewChild,
} from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';

import { VENDOR_NAMES } from '@saha-textile/release-console-contracts';
import { injectIsFetching } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { ConsoleState } from '../data/console-state';
import { type ListItem, placeOf, searchList, searchMenu } from '../menu/menu-search';
import { injectPlanFeatures } from '../screens/product-screen';
import { ConfirmHost } from '../shared/confirm-dialog';
import {
	CONSOLE_PAGE_ICONS,
	GROUP_ICONS,
	Icon,
	OWN_GROUP_ICON,
	PROJECT_PAGE_ICONS,
	SETTINGS_TAB_ICONS,
	environmentIcon,
	screenIcon,
} from '../shared/icons';
import { LoadOverlay } from '../shared/loaders/load-overlay';
import { LOADER_OF_PAGE, LOADER_OF_SCREEN } from '../shared/loaders/loader-art';
import { VendorLogo } from '../shared/vendor-logo';

import type { MenuGroup } from '../menu/menu.types';
import type { Environment, Project } from '@saha-textile/release-console-contracts';

/** The five console-level menus. */
export const CONSOLE_PAGES: [string, string][] = [
	['projects', 'All projects'],
	['add', 'Add a project'],
	['attention', 'Attention'],
	['audit', 'Audit (every project)'],
	['settings', 'Console settings'],
];
/** The six project-level menus. */
export const PROJECT_PAGES: [string, string][] = [
	['overview', 'Overview'],
	['repositories', 'Repositories'],
	['environments', 'Environments'],
	['attention', 'Attention'],
	['audit', 'Audit'],
	['settings', 'Project settings'],
];
/** Project settings tabs. */
export const SETTINGS_TABS: [string, string][] = [
	['connections', 'Connections'],
	['repositories', 'Repositories'],
	['environments', 'Environments'],
	['menus', 'Project menus'],
	['remove', 'Remove project'],
];

interface Hit {
	label: string;
	path: string;
	link: string[];
	query: Record<string, string>;
	via: string;
	icon: string;
}

const tabQuery = (tab: string | null): Record<string, string> => (tab ? { tab } : {});

const PAGE_WORDS: Record<string, string[]> = {
	attention: ['expiring', 'failed', 'approval', 'needs me'],
	audit: ['who did what', 'history', 'log'],
	settings: ['pin', 'lock', 'keys', 'connections', 'infisical'],
	add: ['new project', 'wizard'],
	repositories: ['repo', 'source code'],
	environments: ['staging', 'production', 'local'],
};

@Component({
	selector: 'rc-shell',
	imports: [RouterOutlet, NgTemplateOutlet, Icon, VendorLogo, ConfirmHost, LoadOverlay],
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { '(document:keydown)': 'onKey($event)', '(document:click)': 'closeMenus($event)' },
	templateUrl: './shell.html',
})
export class Shell {
	private readonly router = inject(Router);
	private readonly api = inject(ConsoleApi);
	protected readonly state = inject(ConsoleState);
	protected readonly ctx = inject(ConsoleContext);
	/**
	 * The Local / Staging / Production switch shows only where a page is about one environment (owner,
	 * 23 Nov, "Yes, as planned"): Ship › Release, Run, Watch, the repository's own menus (Shop) and
	 * Secrets. Elsewhere a page covers every environment and labels each thing with its own.
	 */
	protected readonly envSwitch = computed(() => {
		if (this.ctx.level() !== 'repository') return false;
		const page = this.ctx.page();
		const m = this.menu();
		if (!m) return false;
		for (const g of m.menu)
			for (const sub of g.subs) {
				if (!sub.items.includes(page)) continue;
				const group = g.label.toLowerCase();
				return (
					!!g.own ||
					group === 'run' ||
					group === 'watch' ||
					group.startsWith('secrets') ||
					(group === 'ship' && (sub.label ?? '').toLowerCase() === 'release')
				);
			}
		return false;
	});
	/** Live plan answer for the open repository: a whole screen's plan badge shows until it is on. */
	private readonly planFeatures = injectPlanFeatures(
		() => this.ctx.projectId(),
		() => this.ctx.repoId(),
	);
	/** A screen-level plan lock while the account lacks the feature (null once Cloudflare says on). */
	protected planLock(key: string) {
		const lock = this.screen(key)?.plan ?? null;
		return lock && !this.planFeatures()?.[lock.feature] ? lock : null;
	}
	/**
	 * Reads that have no answer yet (first loads only, not the screens' own refreshes, which would
	 * make it flicker): the top bar says so, so a screen is never silently blank (owner, 21 Nov).
	 */
	protected readonly firstReads = injectIsFetching({ predicate: (q) => q.state.data === undefined });
	/**
	 * Which loader the content area shows on its first read, who it says it is reading and what
	 * (brief N5kmX6DLJv1ECitVUPFHJ8): each screen's own drawing, picked by its place in the menu.
	 */
	protected readonly load = computed(() => {
		const page = this.ctx.page();
		if (this.ctx.level() !== 'repository')
			return { loader: LOADER_OF_PAGE[page] ?? 'boot', source: 'the console', what: page.replace(/-/g, ' ') };
		const menu = this.ctx.repoMenu();
		const info = menu?.screens[page];
		const group = menu?.menu.find((g) => g.subs.some((s) => s.items.includes(page)));
		const tab = this.ctx.tab();
		const tabLabel = info ? (tab && info.states[tab]) || Object.values(info.states)[0] : '';
		const label = group?.label ?? '';
		const repo = this.ctx.repo();
		const source =
			page === 'overview'
				? 'this Mac'
				: group?.own
					? (repo?.name ?? 'the repository')
					: group?.vendor
						? VENDOR_NAMES[group.vendor]
						: label.startsWith('Ship')
							? repo
								? VENDOR_NAMES[repo.sourceCode.vendor]
								: 'GitHub'
							: label.startsWith('Shop')
								? 'the shop'
								: label.startsWith('Governance') || page === 'settings'
									? 'the console'
									: 'this Mac';
		return {
			loader: LOADER_OF_SCREEN[page] ?? 'reactor',
			source,
			what: [info?.label, tabLabel].filter(Boolean).join(' · '),
		};
	});
	protected readonly consolePages = CONSOLE_PAGES;
	protected readonly projectPages = PROJECT_PAGES;
	protected readonly consoleIcons = CONSOLE_PAGE_ICONS;
	protected readonly projectIcons = PROJECT_PAGE_ICONS;
	protected readonly screenIcon = screenIcon;
	private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');

	protected readonly projectOpen = signal(false);
	protected readonly repoOpen = signal(false);
	protected readonly query = signal('');
	protected readonly active = signal(0);

	protected readonly menu = this.ctx.repoMenu;
	private readonly place = computed(() => {
		const m = this.menu();
		return m ? placeOf(m) : new Map<string, string[]>();
	});
	protected readonly openGroup = computed(() => this.place().get(this.ctx.page())?.[0] ?? '');

	protected readonly scope = computed(() => {
		if (this.ctx.level() === 'repository') return this.ctx.repo()?.name ?? 'this repository';
		if (this.ctx.level() === 'project') return this.ctx.project()?.name ?? 'this project';
		return 'the console';
	});

	/** Search finds only what the current level can open; never across projects or repositories. */
	protected readonly hits = computed<Hit[]>(() => {
		const q = this.query();
		const project = this.ctx.project();
		const repo = this.ctx.repo();
		const menu = this.menu();
		if (this.ctx.level() === 'repository' && project && repo && menu)
			return searchMenu(menu, q).map((h) => ({
				label: h.label,
				path: `${repo.name} › ${h.path}`,
				link: ['/p', project.id, 'r', repo.id, h.screen],
				query: tabQuery(h.state),
				via: h.via,
				icon: screenIcon(h.screen),
			}));
		const items: ListItem[] =
			this.ctx.level() === 'project' && project ? this.projectItems(project) : this.consoleItems();
		return searchList(items, q).map((h) => ({
			label: h.label,
			path: h.path,
			link: h.link,
			query: h.query ?? {},
			via: h.via,
			icon: this.linkIcon(h.link, h.query ?? {}),
		}));
	});

	constructor() {
		// Keep the chosen environment one that the current repository or project has.
		effect(() => {
			const envs = this.ctx.environments();
			if (envs.length && !envs.some((e) => e.name === this.state.environment()))
				this.state.setEnvironment((envs[0] as Environment).name);
		});
	}

	private consoleItems(): ListItem[] {
		return CONSOLE_PAGES.map(([key, label]) => ({
			label,
			path: 'Console',
			link: ['/console', key],
			aliases: PAGE_WORDS[key],
		}));
	}

	private projectItems(p: Project): ListItem[] {
		const at = `${p.name} › project level`;
		return [
			...PROJECT_PAGES.map(([key, label]) => ({
				label,
				path: at,
				link: ['/p', p.id, key],
				aliases: PAGE_WORDS[key],
			})),
			...SETTINGS_TABS.map(([tab, label]) => ({
				label: `Project settings › ${label}`,
				path: at,
				link: ['/p', p.id, 'settings'],
				query: { tab },
				aliases:
					tab === 'connections'
						? ['keys', 'tokens', 'infisical', 'secrets', 'github', 'digitalocean', 'cloudflare']
						: [],
			})),
			...p.repositories.map((r) => ({
				label: r.name,
				path: `${p.name} › repositories`,
				link: ['/p', p.id, 'r', r.id, 'overview'],
				aliases: [r.sourceCode.repository.toLowerCase()],
			})),
		];
	}

	/** The icon of a console or project search result, from where it leads. */
	private linkIcon(link: string[], query: Record<string, string>): string {
		// Every console page and every settings tab has its own icon (shared/icons.ts).
		if (link[0] === '/console') return CONSOLE_PAGE_ICONS[link[1] as string] as string;
		if (link.length > 3) return 'tabler/brand-git';
		if (link[2] === 'settings' && query['tab']) return SETTINGS_TAB_ICONS[query['tab']] as string;
		return PROJECT_PAGE_ICONS[link[2] ?? ''] ?? 'tabler/circle';
	}
	protected groupIcon(g: MenuGroup): string {
		return g.own ? OWN_GROUP_ICON : (GROUP_ICONS[g.label] ?? 'tabler/folder');
	}
	protected envIcon(e: Environment): string {
		return environmentIcon(e.name, e.cloudId === null);
	}

	protected screen(key: string) {
		return this.menu()?.screens[key];
	}
	protected count(groupLabel: string): number {
		return (
			this.menu()
				?.menu.find((g) => g.label === groupLabel)
				?.subs.reduce((n, s) => n + s.items.length, 0) ?? 0
		);
	}
	protected isLater(key: string): boolean {
		return this.menu()?.later.includes(key) ?? false;
	}
	protected currentEnvLabel(): string {
		return this.ctx.environments().find((e) => e.name === this.state.environment())?.label ?? '';
	}

	protected go(link: string[], query: Record<string, string> = {}): void {
		this.query.set('');
		this.projectOpen.set(false);
		this.repoOpen.set(false);
		void this.router.navigate(link, { queryParams: query });
	}
	protected goScreen(key: string): void {
		const p = this.ctx.projectId();
		const r = this.ctx.repoId();
		if (p && r) this.go(['/p', p, 'r', r, key]);
	}
	protected openGroupFirst(groupLabel: string): void {
		const first = this.menu()
			?.menu.find((g) => g.label === groupLabel)
			?.subs[0]?.items.find((k) => !this.menu()?.screens[k]?.off);
		if (first) this.goScreen(first);
	}
	protected pick(hit: Hit | undefined): void {
		if (hit) this.go(hit.link, hit.query);
	}
	protected lockNow(): void {
		void this.api.lockNow();
	}

	protected onSearchKey(e: KeyboardEvent): void {
		const n = this.hits().length;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			this.active.set(n ? (this.active() + 1) % n : 0);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			this.active.set(n ? (this.active() - 1 + n) % n : 0);
		} else if (e.key === 'Enter') {
			this.pick(this.hits()[this.active()]);
		} else if (e.key === 'Escape') {
			this.query.set('');
		}
	}
	protected onKey(e: KeyboardEvent): void {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			this.searchBox()?.nativeElement.focus();
		}
		if (e.key === 'Escape') {
			this.projectOpen.set(false);
			this.repoOpen.set(false);
		}
	}
	protected closeMenus(e: MouseEvent): void {
		const t = e.target as HTMLElement | null;
		if (!t?.closest('.pj-switch')) {
			this.projectOpen.set(false);
			this.repoOpen.set(false);
		}
	}
	protected toggleProject(e: Event): void {
		e.stopPropagation();
		this.repoOpen.set(false);
		this.projectOpen.update((v) => !v);
	}
	protected toggleRepo(e: Event): void {
		e.stopPropagation();
		this.projectOpen.set(false);
		this.repoOpen.update((v) => !v);
	}
}
