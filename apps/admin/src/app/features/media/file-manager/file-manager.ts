import { Component, DestroyRef, type TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { readApiErrorMessage } from '@saha-textile/http-transport';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { type Observable, lastValueFrom } from 'rxjs';

import {
	type MediaBrowseQuery,
	type MediaCategory,
	type MediaFileRow,
	MediaLibraryGateway,
	type MediaOperationResult,
} from '@core/media-library/media-library.gateway';
import {
	MEDIA_LIBRARY_KEY,
	injectMediaBrowseQuery,
	injectMediaStorageQuery,
	injectMediaTreeQuery,
} from '@data-access/queries/media-library.queries';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { FileSizePipe, PluralPipe } from '@shared/pipes/language.pipes';
import { Button } from '@shared/ui/button/button';

import { FmFileList, type TrashItem } from './fm-file-list';
import { FM_CATEGORIES, FmSidebar, type FmNav } from './fm-sidebar';

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

/** The filter menu (A11): what each choice is called in the address and on its chip. */
export interface FmFilters {
	cats: MediaCategory[];
	state: 'ready' | 'processing' | 'failed' | null;
	size: 'under1' | '1to25' | 'over25' | null;
	up: '7d' | '30d' | '90d' | '365d' | null;
	used: 'in' | 'out' | null;
}
export const FM_FILTER_OPTIONS = {
	state: ['ready', 'processing', 'failed'],
	size: ['under1', '1to25', 'over25'],
	up: ['7d', '30d', '90d', '365d'],
	used: ['in', 'out'],
} as const;
const NO_FILTERS: FmFilters = { cats: [], state: null, size: null, up: null, used: null };

/** What a confirmation popup is about: restore (A19), delete forever, or empty Trash. */
export type FmAsk =
	| { kind: 'restore'; item: TrashItem; folderName: string }
	| { kind: 'delete'; item: TrashItem }
	| { kind: 'empty'; count: number };

/**
 * Admin › Media as a file manager (media build step 1.5). The folder, search, category, sort and
 * list-or-thumbnails choice live in the address (S2, A38), so Refresh and Back keep the place and a
 * copied link opens the same view for another admin.
 */
@Component({
	selector: 'app-file-manager',
	templateUrl: './file-manager.html',
	imports: [PageWrapper, TranslocoModule, FmSidebar, FmFileList, FileSizePipe, PluralPipe, Button],
})
export class FileManager {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
	private readonly gateway = inject(MediaLibraryGateway);
	private readonly queries = inject(QueryClient);
	private readonly modals = inject(NgbModal);
	private readonly notifications = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private searchTimer: ReturnType<typeof setTimeout> | null = null;

	readonly confirmTemplate = viewChild<TemplateRef<unknown>>('fmConfirm');
	readonly ask = signal<FmAsk | null>(null);
	/** A19: put the folder back too (the default), or the file in My files. */
	readonly restoreChoice = signal<'restore_folder' | 'my_files'>('restore_folder');

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

	readonly filters = computed<FmFilters>(() => {
		const read = <K extends keyof typeof FM_FILTER_OPTIONS>(key: K) => {
			const value = this.params().get(key);
			return (FM_FILTER_OPTIONS[key] as readonly string[]).includes(value ?? '') ? (value as FmFilters[K]) : null;
		};
		const cats = (this.params().get('cats') ?? '')
			.split(',')
			.filter((key): key is MediaCategory => FM_CATEGORIES.some((item) => item.key === key));
		return { cats, state: read('state'), size: read('size'), up: read('up'), used: read('used') };
	});
	readonly filterCount = computed(() => {
		const f = this.filters();
		return f.cats.length + [f.state, f.size, f.up, f.used].filter(Boolean).length;
	});
	/** The menu's choices before Show results. */
	readonly draft = signal<FmFilters>(NO_FILTERS);
	readonly filtersOpen = signal(false);
	readonly categoryOptions = FM_CATEGORIES;
	readonly filterOptions = FM_FILTER_OPTIONS;

	readonly query = computed<Partial<MediaBrowseQuery>>(() => {
		const sort = FM_SORTS[this.sortKey()];
		return {
			view: this.nav(),
			folderId: this.folderId() ?? undefined,
			category: this.category() ?? undefined,
			search: this.search() || undefined,
			who: this.nav() === 'favourites' ? this.who() : undefined,
			categories: this.filters().cats.length ? this.filters().cats : undefined,
			state: this.filters().state ?? undefined,
			size: this.filters().size ?? undefined,
			uploaded: this.filters().up ?? undefined,
			used: this.filters().used ?? undefined,
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
	readonly showLocation = computed(
		() => !!this.search() || !!this.category() || this.filterCount() > 0 || this.nav() !== 'folder',
	);
	readonly empty = computed(() => {
		const data = this.result();
		return !!data && !data.folders.length && !data.files.length;
	});

	constructor() {
		inject(DestroyRef).onDestroy(() => this.searchTimer && clearTimeout(this.searchTimer));
	}

	go(changes: Record<string, string | null>): void {
		this.selected.set(new Set());
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

	// --- Selection, stars, New folder (A17, A23, A27) ----------------------------------------------

	readonly selected = signal<ReadonlySet<string>>(new Set());
	readonly newFolderTemplate = viewChild<TemplateRef<unknown>>('fmNewFolder');
	readonly newFolderName = signal('');
	readonly newFolderError = signal<string | null>(null);
	readonly creating = signal(false);
	/** Where a new folder goes: the folder shown, or My files. */
	readonly newFolderPlace = computed(() => {
		const steps = this.result()?.breadcrumb ?? [];
		return [this.transloco.translate('fm_my_files'), ...steps.map((step) => step.name)].join(' › ');
	});

	toggleSelect(id: string): void {
		const next = new Set(this.selected());
		if (next.has(id)) next.delete(id);
		else next.add(id);
		this.selected.set(next);
	}

	toggleAll(on: boolean): void {
		this.selected.set(on ? new Set((this.result()?.files ?? []).map((file) => file.id)) : new Set());
	}

	async star(file: MediaFileRow): Promise<void> {
		await this.run(
			this.gateway.star({ targetType: 'file', targetId: file.id, starred: !file.starred }),
			file.starred ? 'fm_unstarred' : 'fm_starred',
		);
	}

	openNewFolder(): void {
		const template = this.newFolderTemplate();
		if (!template) return;
		this.newFolderName.set('');
		this.newFolderError.set(null);
		this.modals.open(template, {
			centered: true,
			windowClass: 'theme-modal',
			ariaLabelledBy: 'fm_new_folder_title',
		});
	}

	/** Creates the folder where the page is; a taken name becomes “(1)” on the server (A23). */
	async createFolder(close: () => void): Promise<void> {
		const name = this.newFolderName().trim();
		if (!name || this.creating()) return;
		this.creating.set(true);
		try {
			await lastValueFrom(this.gateway.createFolder({ name, parentId: this.folderId() ?? null }));
			close();
			this.notifications.showSuccess(this.transloco.translate('fm_folder_created'));
			void this.queries.invalidateQueries({ queryKey: MEDIA_LIBRARY_KEY });
		} catch (error) {
			this.newFolderError.set(readApiErrorMessage(error) ?? this.transloco.translate('fm_action_failed'));
		} finally {
			this.creating.set(false);
		}
	}

	// --- Filters (A11, A12) ---------------------------------------------------------------------

	toggleFilters(): void {
		this.draft.set({ ...this.filters(), cats: [...this.filters().cats] });
		this.filtersOpen.update((open) => !open);
	}

	toggleDraftCategory(key: MediaCategory): void {
		this.draft.update((d) => ({
			...d,
			cats: d.cats.includes(key) ? d.cats.filter((one) => one !== key) : [...d.cats, key],
		}));
	}

	setDraft<K extends Exclude<keyof FmFilters, 'cats'>>(key: K, value: string): void {
		this.draft.update((d) => ({ ...d, [key]: value || null }));
	}

	applyFilters(filters: FmFilters = this.draft()): void {
		this.filtersOpen.set(false);
		this.go({
			cats: filters.cats.length ? filters.cats.join(',') : null,
			state: filters.state,
			size: filters.size,
			up: filters.up,
			used: filters.used,
		});
	}

	clearFilters(): void {
		this.draft.set(NO_FILTERS);
		this.applyFilters(NO_FILTERS);
	}

	/** A chip's ×: that one filter goes. */
	removeFilter(key: keyof FmFilters, category?: MediaCategory): void {
		const f = this.filters();
		this.applyFilters(
			key === 'cats' ? { ...f, cats: f.cats.filter((one) => one !== category) } : { ...f, [key]: null },
		);
	}

	// --- Trash (A18, A19) ------------------------------------------------------------------------

	/** Puts an item back. A file whose folder is in Trash too asks where it should go first (A19). */
	async restoreItem(item: TrashItem): Promise<void> {
		const parent =
			item.type === 'file' && item.folderId
				? this.result()?.folders.find((row) => row.id === item.folderId)
				: null;
		this.restoreChoice.set('restore_folder');
		if (
			parent &&
			!(await this.confirm({
				kind: 'restore',
				item,
				folderName: parent.location === '' ? parent.name : `${parent.location} › ${parent.name}`,
			}))
		)
			return;
		await this.run(
			this.gateway.restore({ ...selection(item), whenFolderGone: this.restoreChoice() }),
			'fm_restored',
		);
	}

	async deleteItem(item: TrashItem): Promise<void> {
		if (!(await this.confirm({ kind: 'delete', item }))) return;
		await this.run(this.gateway.deleteForever(selection(item)), 'fm_deleted_for_good');
	}

	/** Deletes for good everything Trash shows. */
	async emptyTrash(): Promise<void> {
		const data = this.result();
		if (!data) return;
		const fileIds = data.files.map((row) => row.id);
		const folderIds = data.folders.map((row) => row.id);
		if (!fileIds.length && !folderIds.length) return;
		if (!(await this.confirm({ kind: 'empty', count: fileIds.length + folderIds.length }))) return;
		await this.run(this.gateway.deleteForever({ fileIds, folderIds }), 'fm_deleted_for_good');
	}

	private confirm(ask: FmAsk): Promise<boolean> {
		const template = this.confirmTemplate();
		if (!template) return Promise.resolve(false);
		this.ask.set(ask);
		return this.modals
			.open(template, {
				centered: true,
				windowClass: 'theme-modal text-center',
				ariaLabelledBy: 'fm_confirm_title',
			})
			.result.then(
				() => true,
				() => false,
			);
	}

	private async run(work: Observable<MediaOperationResult | { starred: boolean }>, done: string): Promise<void> {
		try {
			await lastValueFrom(work);
			this.notifications.showSuccess(this.transloco.translate(done));
		} catch (error) {
			this.notifications.showError(readApiErrorMessage(error) ?? this.transloco.translate('fm_action_failed'));
		} finally {
			// The lists refresh in the background; the toast does not wait for them.
			void this.queries.invalidateQueries({ queryKey: MEDIA_LIBRARY_KEY });
		}
	}
}

const selection = (item: TrashItem) => ({
	fileIds: item.type === 'file' ? [item.id] : [],
	folderIds: item.type === 'folder' ? [item.id] : [],
});
