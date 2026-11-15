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

	private async run(work: Observable<MediaOperationResult>, done: string): Promise<void> {
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
