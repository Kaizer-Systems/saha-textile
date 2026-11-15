import { Component, DestroyRef, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import {
	injectMediaBrowseQuery,
	injectMediaStorageQuery,
	injectMediaTreeQuery,
} from '@data-access/queries/media-library.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { FileSizePipe, PluralPipe } from '@shared/pipes/language.pipes';

import { FmFileList } from './fm-file-list';
import { FM_CATEGORIES, FmSidebar, type FmNav } from './fm-sidebar';

import type { MediaBrowseQuery, MediaCategory } from '@core/media-library/media-library.gateway';

const VIEWS: readonly FmNav[] = ['recent', 'favourites', 'trash'];
/** The sort menu: what each choice asks the API for. */
export const FM_SORTS = {
	name: { sort: 'name', direction: 'asc', label: 'fm_sort_name' },
	newest: { sort: 'created', direction: 'desc', label: 'fm_sort_newest' },
	largest: { sort: 'size', direction: 'desc', label: 'fm_sort_largest' },
} as const;
export type FmSort = keyof typeof FM_SORTS;
/** Typing in search waits this long before asking, so a word is not sent letter by letter. */
export const SEARCH_PAUSE_MS = 300;

/**
 * Admin › Media as a file manager (media build step 1.5). The folder, search, category, sort and
 * list-or-thumbnails choice live in the address (S2, A38), so Refresh and Back keep the place and a
 * copied link opens the same view for another admin.
 */
@Component({
	selector: 'app-file-manager',
	templateUrl: './file-manager.html',
	imports: [PageWrapper, TranslocoModule, FmSidebar, FmFileList, FileSizePipe, PluralPipe],
})
export class FileManager {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
	private searchTimer: ReturnType<typeof setTimeout> | null = null;

	readonly nav = computed<FmNav>(() => {
		const view = this.params().get('view') as FmNav | null;
		return view && VIEWS.includes(view) ? view : 'folder';
	});
	readonly folderId = computed(() => (this.nav() === 'folder' ? this.params().get('folder') : null));
	readonly category = computed<MediaCategory | null>(() => {
		const value = this.params().get('category');
		return FM_CATEGORIES.some((item) => item.key === value) ? (value as MediaCategory) : null;
	});
	readonly search = computed(() => this.params().get('q') ?? '');
	readonly sortKey = computed<FmSort>(() => {
		const value = this.params().get('sort') as FmSort | null;
		return value && value in FM_SORTS ? value : 'name';
	});
	readonly display = computed<'list' | 'grid'>(() => (this.params().get('show') === 'grid' ? 'grid' : 'list'));
	readonly who = computed<'mine' | 'everyone'>(() => (this.params().get('who') === 'everyone' ? 'everyone' : 'mine'));

	readonly query = computed<Partial<MediaBrowseQuery>>(() => {
		const sort = FM_SORTS[this.sortKey()];
		return {
			view: this.nav(),
			folderId: this.folderId() ?? undefined,
			category: this.category() ?? undefined,
			search: this.search() || undefined,
			who: this.nav() === 'favourites' ? this.who() : undefined,
			sort: sort.sort,
			direction: sort.direction,
			page: 1,
			pageSize: 200,
		};
	});

	readonly browse = injectMediaBrowseQuery(() => this.query());
	readonly tree = injectMediaTreeQuery();
	readonly storage = injectMediaStorageQuery();
	readonly sorts = Object.entries(FM_SORTS).map(([key, value]) => ({ key: key as FmSort, label: value.label }));

	readonly result = computed(() => this.browse.data());
	readonly folderName = computed(() => this.result()?.folder?.name ?? null);
	/** Where a search looks: inside a folder, that folder and below (A09); otherwise everywhere (A08). */
	readonly searchScope = computed(() => (this.nav() === 'folder' ? this.folderName() : null));
	readonly showLocation = computed(() => !!this.search() || !!this.category() || this.nav() !== 'folder');
	readonly empty = computed(() => {
		const data = this.result();
		return !!data && !data.folders.length && !data.files.length;
	});

	constructor() {
		inject(DestroyRef).onDestroy(() => this.searchTimer && clearTimeout(this.searchTimer));
	}

	go(changes: Record<string, string | null>): void {
		void this.router.navigate([], { relativeTo: this.route, queryParams: changes, queryParamsHandling: 'merge' });
	}

	openNav(view: FmNav): void {
		this.go({ view: view === 'folder' ? null : view, folder: null, category: null, q: null, who: null });
	}

	openFolder(id: string | null): void {
		this.go({ view: null, folder: id, category: null, q: null });
	}

	openCategory(category: MediaCategory): void {
		this.go({ view: null, folder: null, category, q: null });
	}

	typed(value: string): void {
		if (this.searchTimer) clearTimeout(this.searchTimer);
		this.searchTimer = setTimeout(() => this.go({ q: value.trim() || null }), SEARCH_PAUSE_MS);
	}

	setSort(key: string): void {
		this.go({ sort: key === 'name' ? null : key });
	}

	setDisplay(display: 'list' | 'grid'): void {
		this.go({ show: display === 'grid' ? 'grid' : null });
	}

	setWho(who: 'mine' | 'everyone'): void {
		this.go({ who: who === 'everyone' ? 'everyone' : null });
	}
}
