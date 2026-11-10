import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, PLATFORM_ID, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { filter, map } from 'rxjs';

import {
	AdminSearchEntry,
	QUICK_LINKS,
	canOpen,
	entryForUrl,
	indexEntry,
	searchAdmin,
	searchEntries,
} from '@core/admin-search/admin-search';
import { AuthStore } from '@core/state/auth.store';
import { NavService } from '@data-access/services/nav.service';
import * as data from '@shared/data/menu';
import { ClickOutsideDirective } from '@shared/directives/out-side-directive';

/** Recently opened places, kept in this browser only. */
const RECENT_KEY = 'st_admin_recent_pages';
const RECENT_MAX = 5;

interface ResultGroup {
	titleKey: string;
	entries: AdminSearchEntry[];
}

/**
 * The header search (owner brief, approved 2026-11-10). The theme's own search box, with a
 * dropdown of admin places drawn from Bootstrap's card and list classes and the theme colour
 * classes, so it follows the Brand Kit colour and dark mode with no styles of its own.
 */
@Component({
	selector: 'app-search',
	templateUrl: './search.html',
	styleUrls: ['./search.scss'],
	imports: [ClickOutsideDirective, TranslocoModule],
	host: { '(document:keydown)': 'onDocumentKey($event)' },
})
export class Search {
	readonly navServices = inject(NavService);
	private readonly router = inject(Router);
	private readonly transloco = inject(TranslocoService);
	private readonly authStore = inject(AuthStore);
	private readonly page = inject(DOCUMENT);
	private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

	readonly input = viewChild<ElementRef<HTMLInputElement>>('searchInput');

	private readonly entries = searchEntries(data.menu);
	private readonly language = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
	/** Fires once a language file has loaded, so hints are indexed in the language shown. */
	private readonly loaded = toSignal(
		this.transloco.events$.pipe(filter((event) => event.type === 'translationLoadSuccess')),
	);

	readonly query = signal('');
	readonly open = signal(false);
	readonly active = signal(0);
	readonly place = signal({ left: 0, top: 0, width: 600 });
	private readonly recentIds = signal<string[]>(this.readRecent());

	private readonly allowed = computed(() => {
		const held = this.authStore.permissions();
		return this.entries.filter((entry) => canOpen(entry, held));
	});

	private readonly index = computed(() => {
		this.language();
		this.loaded();
		return this.allowed().map((entry) => indexEntry(entry, (key) => this.transloco.translate(key)));
	});

	readonly outcome = computed(() => searchAdmin(this.index(), this.query()));

	readonly groups = computed<ResultGroup[]>(() => {
		const query = this.query().trim();
		const byId = new Map(this.allowed().map((entry) => [entry.id, entry]));
		const recent = this.recentIds()
			.map((id) => byId.get(id))
			.filter((entry): entry is AdminSearchEntry => !!entry);
		if (query) {
			const found = this.outcome().entries;
			const shown = new Set(found.map((entry) => entry.id));
			const groups: ResultGroup[] = [];
			if (found.length) groups.push({ titleKey: 'search_group_pages', entries: found });
			const alsoRecent = found.length ? recent.filter((entry) => !shown.has(entry.id)).slice(0, 1) : [];
			if (alsoRecent.length) groups.push({ titleKey: 'search_group_recent', entries: alsoRecent });
			return groups;
		}
		const quick = QUICK_LINKS.map((id) => byId.get(id)).filter(
			(entry): entry is AdminSearchEntry => !!entry && !recent.slice(0, 3).includes(entry),
		);
		return [
			{ titleKey: 'search_group_recent', entries: recent.slice(0, 3) },
			{ titleKey: 'search_group_go_to', entries: quick },
		].filter((group) => group.entries.length);
	});

	/** Every row in display order, for the arrow keys. */
	readonly rows = computed(() => this.groups().flatMap((group) => group.entries));

	constructor() {
		this.router.events
			.pipe(
				filter((event): event is NavigationEnd => event instanceof NavigationEnd),
				map((event) => entryForUrl(this.entries, event.urlAfterRedirects)),
			)
			.subscribe((entry) => entry && this.remember(entry.id));
	}

	/** Trail of a row: its menu path, in the language shown. */
	trail(entry: AdminSearchEntry): string[] {
		return entry.trailKeys.length ? entry.trailKeys : ['search_home'];
	}

	isActive(entry: AdminSearchEntry): boolean {
		return this.rows()[this.active()] === entry;
	}

	focusRow(entry: AdminSearchEntry): void {
		this.active.set(Math.max(0, this.rows().indexOf(entry)));
	}

	type(value: string): void {
		this.query.set(value);
		this.active.set(0);
		this.show();
	}

	show(): void {
		const box = this.input()?.nativeElement.getBoundingClientRect();
		if (box && this.isBrowser) {
			const viewport = this.page.defaultView?.innerWidth ?? 1200;
			const width = Math.min(Math.max(600, box.width + 24), viewport - 16);
			const left = Math.min(Math.max(8, box.left - 12), viewport - width - 8);
			this.place.set({ left, top: box.bottom + 8, width });
		}
		this.open.set(true);
	}

	close(): void {
		this.open.set(false);
	}

	closeSearch(): void {
		this.close();
		this.navServices.search = false;
	}

	onKey(event: KeyboardEvent): void {
		const count = this.rows().length;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (!this.open()) this.show();
			if (count) this.active.set((this.active() + (event.key === 'ArrowDown' ? 1 : count - 1)) % count);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const entry = this.rows()[this.active()];
			if (entry) this.go(entry);
		} else if (event.key === 'Escape') {
			this.close();
			this.input()?.nativeElement.blur();
		}
	}

	/** ⌘K or Ctrl K from any admin page. */
	onDocumentKey(event: KeyboardEvent): void {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			this.navServices.search = true;
			this.input()?.nativeElement.focus();
			this.show();
		}
	}

	go(entry: AdminSearchEntry): void {
		this.remember(entry.id);
		this.query.set('');
		this.closeSearch();
		this.input()?.nativeElement.blur();
		void this.router.navigate([entry.path], {
			...(entry.queryParams ? { queryParams: entry.queryParams } : {}),
			...(entry.fragment ? { fragment: entry.fragment } : {}),
		});
	}

	private remember(id: string): void {
		const next = [id, ...this.recentIds().filter((seen) => seen !== id)].slice(0, RECENT_MAX);
		this.recentIds.set(next);
		if (!this.isBrowser) return;
		try {
			this.page.defaultView?.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
		} catch {
			// A browser that refuses storage keeps the list for this visit only.
		}
	}

	private readRecent(): string[] {
		if (!this.isBrowser) return [];
		try {
			const stored: unknown = JSON.parse(this.page.defaultView?.localStorage.getItem(RECENT_KEY) ?? '[]');
			return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
		} catch {
			return [];
		}
	}
}
