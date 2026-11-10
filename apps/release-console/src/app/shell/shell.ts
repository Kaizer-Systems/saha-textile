import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';

import { filter, map } from 'rxjs';

import { ConsoleState } from '../data/console-state';
import { CONSOLE_MENU } from '../menu/console-menu.data';
import { type SearchHit, placeOf, searchMenu } from '../menu/menu-search';

import type { ConsoleEnvironment } from '@saha-textile/release-console-contracts';

const ENVS: [ConsoleEnvironment, string][] = [
	['local', 'Local stack'],
	['staging', 'Staging'],
	['production', 'Production'],
];

@Component({
	selector: 'rc-shell',
	imports: [RouterOutlet, NgTemplateOutlet],
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { '(document:keydown)': 'onKey($event)' },
	templateUrl: './shell.html',
})
export class Shell {
	private readonly router = inject(Router);
	protected readonly state = inject(ConsoleState);
	protected readonly menu = CONSOLE_MENU;
	protected readonly envs = ENVS;
	private readonly place = placeOf(CONSOLE_MENU);
	private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');

	private readonly url = toSignal(
		this.router.events.pipe(
			filter((e): e is NavigationEnd => e instanceof NavigationEnd),
			map((e) => e.urlAfterRedirects),
		),
		{ initialValue: this.router.url },
	);
	protected readonly current = computed(() => this.url().split(/[/?#]/)[1] || 'overview');
	protected readonly openGroup = computed(() => this.place.get(this.current())?.[0] ?? 'Overview');

	protected readonly query = signal('');
	protected readonly active = signal(0);
	protected readonly hits = computed<SearchHit[]>(() => searchMenu(this.menu, this.query()));

	protected screen(key: string) {
		return this.menu.screens[key];
	}
	protected count(groupLabel: string): number {
		return this.menu.menu.find((g) => g.label === groupLabel)?.subs.reduce((n, s) => n + s.items.length, 0) ?? 0;
	}
	protected isLater(key: string): boolean {
		return this.menu.later.includes(key);
	}

	protected go(screen: string, tab: string | null = null): void {
		this.query.set('');
		void this.router.navigate(['/', screen], { queryParams: tab ? { tab } : {} });
	}
	protected openGroupFirst(groupLabel: string): void {
		const first = this.menu.menu
			.find((g) => g.label === groupLabel)
			?.subs[0]?.items.find((k) => !this.menu.screens[k]?.off);
		if (first) this.go(first);
	}
	protected pick(hit: SearchHit | undefined): void {
		if (!hit || this.menu.screens[hit.screen]?.off) return;
		this.go(hit.screen, hit.state);
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
	}
}
