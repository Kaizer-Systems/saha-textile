import {
	Component,
	DestroyRef,
	type ElementRef,
	HostListener,
	type TemplateRef,
	computed,
	inject,
	signal,
	viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { estimateVersionBytes, looksLikeHeic } from '@saha-textile/core-domain/media-files';
import { readApiErrorMessage } from '@saha-textile/http-transport';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { type Observable, lastValueFrom } from 'rxjs';

import { heicToJpeg } from '@core/media-library/heic';
import {
	type MediaBrowseQuery,
	type MediaCategory,
	type MediaFileRow,
	type MediaFolderRow,
	MediaLibraryGateway,
	type MediaOperationResult,
	type MediaSelection,
	type MediaTrashCheck,
} from '@core/media-library/media-library.gateway';
import { type CutOffUpload, MediaUploads } from '@core/media-library/media-uploads';
import {
	MEDIA_LIBRARY_KEY,
	injectMediaBrowseQuery,
	injectMediaStorageQuery,
	injectMediaTreeQuery,
} from '@data-access/queries/media-library.queries';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { FileSizePipe, PluralPipe, translateCount } from '@shared/pipes/language.pipes';
import { Button } from '@shared/ui/button/button';

import { fileKind } from './file-kinds';
import { FmCleanUp } from './fm-clean-up';
import { FmDetails, type FmDetailsAction } from './fm-details';
import { FmFileList, type FmItemEvent, type TrashItem } from './fm-file-list';
import { FmFocal, type FmPoint } from './fm-focal';
import { FmMenu, type FmMenuKey, type FmMenuLine } from './fm-menu';
import { FmNewFolder } from './fm-new-folder';
import { FmReplace } from './fm-replace';
import { FmReplaceProgress } from './fm-replace-progress';
import { FmReprocess, type FmReprocessChoice } from './fm-reprocess';
import {
	type FmItemRef,
	type FmSelection,
	BULK_PART,
	VERSIONS_PER_CALL,
	NO_SELECTION,
	blockedTargets,
	commonPlace,
	isPicked,
	pickHow,
	pickItem,
	pickedCount,
	splitSelection,
	stepItem,
} from './fm-selection';
import { FmShare } from './fm-share';
import { FM_CATEGORIES, FmSidebar, type FmNav } from './fm-sidebar';
import { FmStorageDetails } from './fm-storage-details';
import { FmUndoToast } from './fm-undo-toast';
import { FmUploadFlow, type FmUploadPopups as FmUploadPopupRefs } from './fm-upload-flow';
import { pastedName, planUpload, readDropped, readPhotoSize, readPickedFolder, sha256Hex } from './fm-upload-plan';
import { FmUploadPopups } from './fm-upload-popups';

const VIEWS: readonly FmNav[] = ['recent', 'favourites', 'trash', 'clean'];
/** R4-7: the banner and the bell speak up from 85% of the plan. */
export const STORAGE_ALERT_PERCENT = 85;
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

/** What a confirmation popup is about: restore (A19), delete forever, empty Trash, or Trash (A25). */
export type FmAsk =
	| { kind: 'restore'; item: TrashItem; folderName: string }
	| { kind: 'delete'; item: TrashItem }
	| { kind: 'empty'; count: number }
	| { kind: 'trash'; folder: MediaFolderRow | null; fileName: string | null; count: number };

/** Undo stays on screen this long (S1); ⌘/Ctrl+Z works until the next change. */
export const UNDO_SECONDS = 8;
/** The menu's width in the brief's look (`fm-ctx`), to keep it inside the page. */
const MENU_WIDTH = 230;
/** Marks a drag that started on this page, so files dropped from the computer stay uploads (A29). */
export const MEDIA_DRAG_TYPE = 'application/x-saha-textile-media';
/** A see-through drag picture: the page draws its own label by the pointer (A28). */
const BLANK_PICTURE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** The Rename popup (A24): a file keeps its extension, shown beside the box. */
export interface FmRenaming {
	type: 'folder' | 'file';
	id: string;
	base: string;
	extension: string;
	before: string;
}

/** What is being dragged (A28), and the words by the pointer. */
interface FmDrag {
	fileIds: string[];
	folderIds: string[];
	what: string;
	thumb: string | null;
}

/** The keys list (A39): what is pressed, and what it does. `click` is the word Click. */
export const FM_KEY_ROWS: ReadonlyArray<{ keys: readonly string[]; does: string }> = [
	{ keys: ['click'], does: 'fm_key_click' },
	{ keys: ['Shift', 'click'], does: 'fm_key_shift_click' },
	{ keys: ['⌘ / Ctrl', 'click'], does: 'fm_key_command_click' },
	{ keys: ['⌘ / Ctrl', 'A'], does: 'fm_key_select_all' },
	{ keys: ['↑ ↓ ← →'], does: 'fm_key_arrows' },
	{ keys: ['Enter'], does: 'fm_key_enter' },
	{ keys: ['F2'], does: 'rename' },
	{ keys: ['Delete'], does: 'fm_key_delete' },
	{ keys: ['⌘ / Ctrl', 'Z'], does: 'fm_key_undo' },
	{ keys: ['⌘ / Ctrl', 'V'], does: 'fm_key_paste' },
	{ keys: ['Esc'], does: 'fm_key_escape' },
	{ keys: ['?'], does: 'fm_key_help' },
];

/** Keys type into boxes, never into the page (A39). */
const typing = (target: EventTarget | null): boolean => {
	const element = target as HTMLElement | null;
	return !!element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName ?? ''));
};

/**
 * Admin › Media as a file manager (media build step 1.5). The folder, search, category, sort and
 * list-or-thumbnails choice live in the address (S2, A38), so Refresh and Back keep the place and a
 * copied link opens the same view for another admin.
 */
@Component({
	selector: 'app-file-manager',
	templateUrl: './file-manager.html',
	imports: [
		FmUploadPopups,
		FmCleanUp,
		PageWrapper,
		TranslocoModule,
		FmSidebar,
		FmFileList,
		FmMenu,
		FileSizePipe,
		PluralPipe,
		Button,
	],
	providers: [FmUploadFlow],
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
	private readonly toastr = inject(ToastrService);
	private searchTimer: ReturnType<typeof setTimeout> | null = null;
	readonly mainRef = viewChild<ElementRef<HTMLElement>>('fmMain');

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
		const nav = this.nav();
		return {
			// Clean up has its own lists; the file list is switched off there.
			view: nav === 'clean' ? 'folder' : nav,
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

	// Clean up shows its own lists (FmCleanUp), so the file list asks for nothing there.
	readonly browse = injectMediaBrowseQuery(
		() => this.query(),
		() => this.nav() !== 'clean',
	);
	readonly tree = injectMediaTreeQuery();
	readonly storage = injectMediaStorageQuery();
	/** A45: the storage summary once it reaches 85% of the plan (and past it), for the banner. */
	readonly storageAlert = computed(() => {
		const summary = this.storage.data();
		return summary && summary.percent >= STORAGE_ALERT_PERCENT ? summary : null;
	});
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
		this.clearSelection();
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

	// --- Selection (A27, A39) --------------------------------------------------------------------

	readonly selection = signal<FmSelection>(NO_SELECTION);
	/** Where Shift+click counts from, and where the arrow keys start. */
	private anchor: FmItemRef | null = null;
	private cursor: FmItemRef | null = null;
	/** Ticked files, for the list's checkboxes and tiles. */
	readonly selected = computed(() => this.selection().files);
	readonly selectedFolders = computed(() => this.selection().folders);
	/** Folder cards, then files, as the page shows them: the order Shift+click and arrows follow. */
	readonly ordered = computed<FmItemRef[]>(() => {
		const data = this.result();
		if (!data || this.nav() === 'trash') return [];
		return [
			...data.folders.map((row) => ({ type: 'folder' as const, id: row.id })),
			...data.files.map((row) => ({ type: 'file' as const, id: row.id })),
		];
	});
	readonly chosen = computed(() => {
		const data = this.result();
		const picked = this.selection();
		return {
			folders: (data?.folders ?? []).filter((row) => picked.folders.has(row.id)),
			files: (data?.files ?? []).filter((row) => picked.files.has(row.id)),
		};
	});
	readonly chosenCount = computed(() => pickedCount(this.selection()));
	/** “2 folders and 3 files”, for the bulk bar (A27) and the toasts. */
	readonly chosenWhat = computed(() => this.what(this.chosen().folders.length, this.chosen().files.length));

	clearSelection(): void {
		this.selection.set(NO_SELECTION);
		this.anchor = null;
		this.cursor = null;
		this.menu.set(null);
	}

	/** A click on a folder card, a row or a tile (A39). */
	pick(item: FmItemRef, event: MouseEvent): void {
		const how = pickHow(event);
		this.selection.set(pickItem(this.selection(), this.ordered(), item, how, this.anchor));
		if (how !== 'range') this.anchor = item;
		this.cursor = item;
	}

	toggleSelect(id: string): void {
		const item: FmItemRef = { type: 'file', id };
		this.selection.set(pickItem(this.selection(), this.ordered(), item, 'toggle', this.anchor));
		this.anchor = item;
		this.cursor = item;
	}

	/** The table head's box: every file shown, or none (folders keep their own picks). */
	toggleAll(on: boolean): void {
		this.selection.update((current) => ({
			folders: current.folders,
			files: on ? new Set((this.result()?.files ?? []).map((file) => file.id)) : new Set(),
		}));
	}

	selectEverything(): void {
		const items = this.ordered();
		this.selection.set({
			folders: new Set(items.filter((item) => item.type === 'folder').map((item) => item.id)),
			files: new Set(items.filter((item) => item.type === 'file').map((item) => item.id)),
		});
	}

	// --- Menus (A20–A22) ------------------------------------------------------------------------

	readonly menu = signal<{
		at: { x: number; y: number };
		lines: FmMenuLine[];
		moveOnly: boolean;
		flip: boolean;
	} | null>(null);
	/** Move to: a chosen folder cannot go into itself or anything inside it. */
	readonly moveBlocked = computed(() => blockedTargets(this.tree.data()?.folders ?? [], this.selection().folders));
	/** Where everything chosen is now: moving there does nothing, so it is greyed. */
	readonly moveHere = computed(() => {
		const { folders, files } = this.chosen();
		return commonPlace([...folders.map((row) => row.parentId ?? null), ...files.map((row) => row.folderId)]);
	});

	/** What the menu offers for what is chosen: one folder, one image, one other file, or several. */
	menuLines(): FmMenuLine[] {
		const { folders, files } = this.chosen();
		if (folders.length + files.length > 1) return ['move', 'divider', 'trash'];
		const folder = folders[0];
		if (folder)
			return ['open', 'new_inside', 'rename', 'move', folder.starred ? 'unstar' : 'star', 'divider', 'trash'];
		const file = files[0];
		if (!file) return [];
		const star: FmMenuLine = file.starred ? 'unstar' : 'star';
		if (file.state === 'awaiting_upload') return ['rename', 'move', star, 'divider', 'trash'];
		if (file.kind === 'image')
			return [
				'details',
				'rename',
				'download_original',
				'share',
				'move',
				'reprocess',
				'replace',
				star,
				'divider',
				'trash',
			];
		return ['preview', 'details', 'rename', 'download', 'share', 'move', star, 'divider', 'trash'];
	}

	/** Right-click, or the ⋮ on a row, tile or folder card. An item not picked yet becomes the pick. */
	openMenu({ item, event, anchor }: FmItemEvent): void {
		event.preventDefault();
		event.stopPropagation();
		if (!isPicked(this.selection(), item)) {
			this.selection.set(pickItem(NO_SELECTION, [], item, 'only', null));
			this.anchor = item;
		}
		this.cursor = item;
		this.showMenu(this.menuLines(), event, anchor, false);
	}

	/** The bulk bar's Move to: the folder list opens under the button. */
	openMoveMenu(event: MouseEvent): void {
		event.stopPropagation();
		this.showMenu([], event, event.currentTarget as HTMLElement, true);
	}

	private showMenu(lines: FmMenuLine[], event: MouseEvent, anchor: HTMLElement | null, moveOnly: boolean): void {
		const box = this.mainRef()?.nativeElement.getBoundingClientRect();
		if (!box) return;
		let x = event.clientX - box.left;
		let y = event.clientY - box.top;
		if (anchor) {
			const spot = anchor.getBoundingClientRect();
			x = (moveOnly ? spot.left : spot.right - MENU_WIDTH) - box.left;
			y = spot.bottom - box.top + 4;
		}
		x = Math.max(0, Math.min(x, box.width - MENU_WIDTH));
		this.menu.set({ at: { x, y }, lines, moveOnly, flip: x + MENU_WIDTH * 2 > box.width });
	}

	@HostListener('document:click')
	@HostListener('document:contextmenu')
	closeMenu(): void {
		if (this.menu()) this.menu.set(null);
	}

	async menuChoose(key: FmMenuKey): Promise<void> {
		this.menu.set(null);
		const { folders, files } = this.chosen();
		const folder = folders[0];
		const file = files[0];
		switch (key) {
			case 'open':
				if (folder) this.openFolder(folder.id);
				return;
			case 'new_inside':
				if (folder) this.openNewFolder(folder);
				return;
			case 'preview':
				if (file) await this.openFile(file, 'view');
				return;
			case 'download':
			case 'download_original':
				if (file) await this.openFile(file, 'save');
				return;
			case 'rename':
				this.openRename();
				return;
			case 'share':
				if (file) this.openShare(file);
				return;
			case 'details':
				if (file) this.openDetails(file);
				return;
			case 'reprocess':
				if (file) await this.openReprocess([file]);
				return;
			case 'replace':
				if (file) this.pickReplacement(file);
				return;
			case 'star':
			case 'unstar':
				if (folder)
					await this.run(
						this.gateway.star({ targetType: 'folder', targetId: folder.id, starred: key === 'star' }),
						key === 'star' ? 'fm_starred' : 'fm_unstarred',
					);
				else if (file) await this.star(file);
				return;
			case 'trash':
				await this.trashChosen(false);
				return;
			case 'move':
				return;
		}
	}

	/** Double-click or Enter: a folder opens; a photo shows its details (A31); another file opens in a new tab. */
	async activate(item: FmItemRef): Promise<void> {
		if (item.type === 'folder') return this.openFolder(item.id);
		const file = this.result()?.files.find((row) => row.id === item.id);
		if (!file || file.state === 'awaiting_upload') return;
		if (file.kind === 'image') this.openDetails(file);
		else await this.openFile(file, 'view');
	}

	/**
	 * Image or file details (A31, A31B, A32) with the item's Activity (A43). Its buttons (Add versions, Download
	 * original, Share) close it and carry on here; removing a version refreshes the list.
	 */
	openDetails(file: MediaFileRow): void {
		const popup = this.modals.open(FmDetails, {
			size: 'xl',
			centered: true,
			scrollable: true,
			windowClass: 'theme-modal media-modal',
			ariaLabelledBy: 'fm_details_title',
		});
		void (popup.componentInstance as FmDetails).start(file.id);
		popup.result.then(
			(action: FmDetailsAction | undefined) => {
				void this.queries.invalidateQueries({ queryKey: MEDIA_LIBRARY_KEY });
				if (action?.kind === 'add_versions') void this.openReprocess([file], action.versions);
				if (action?.kind === 'download') void this.openFile(file, 'save');
				if (action?.kind === 'share') this.openShare(file);
				if (action?.kind === 'focal') void this.openFocal(file);
			},
			() => void this.queries.invalidateQueries({ queryKey: MEDIA_LIBRARY_KEY }),
		);
	}

	/** Replace file (S7): the browser's file chooser first; the chosen photo goes to the C05 check. */
	pickReplacement(file: MediaFileRow): void {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'image/jpeg,image/png,image/heic,image/heif,.heic,.heif';
		input.addEventListener('change', () => {
			const picked = input.files?.[0];
			if (picked) void this.openReplace(file, picked);
		});
		input.click();
	}

	/**
	 * Replace (C05 → C08): the new photo is read in the browser (a HEIC becomes a full-size JPEG first), checked
	 * against every version in the popup, then the shared storage check runs, the upload starts and the progress
	 * popup follows its three steps (it can be closed: the tray carries on).
	 */
	async openReplace(file: MediaFileRow, picked: File): Promise<void> {
		let photo: File = picked;
		const preview: { url: string | null } = { url: null };
		try {
			if (looksLikeHeic(picked.type, picked.name)) photo = await heicToJpeg(picked);
			const size = await readPhotoSize(photo);
			if (!size) {
				this.notifications.showError(this.transloco.translate('fm_unreadable_photo'));
				return;
			}
			const details = await lastValueFrom(this.gateway.details(file.id));
			preview.url = URL.createObjectURL(photo);
			const contentType = photo.type || 'image/jpeg';
			const popup = this.modals.open(FmReplace, {
				size: 'lg',
				centered: true,
				scrollable: true,
				windowClass: 'theme-modal media-modal',
				ariaLabelledBy: 'fm_rpl_title',
			});
			(popup.componentInstance as FmReplace).start({
				name: file.name,
				folder: details.folderPath.join(' › '),
				bytes: details.bytes,
				width: details.width,
				height: details.height,
				preview: file.thumbnailUrl,
				versions: details.versions,
				usedOn: details.usedOn,
				next: {
					name: picked.name,
					bytes: photo.size,
					width: size.width,
					height: size.height,
					contentType,
					preview: preview.url,
				},
			});
			const yes = await popup.result.then(
				(answer: string) => answer === 'replace',
				() => false,
			);
			if (!yes) return;
			const onDemand = this.onDemandTemplate();
			const refused = this.refusedTemplate();
			if (!onDemand || !refused) return;
			const bytes = photo.size + estimateVersionBytes(photo.size, details.versions.length);
			const what = this.transloco.translate('fm_rpl_storage_what', { name: file.name });
			const reservationId = await this.flow.storageCheck('replace', bytes, 1, what, { onDemand, refused });
			if (reservationId === false) return;
			const sha256 = await sha256Hex(photo);
			void this.uploads.replacePhoto({
				fileId: file.id,
				name: file.name,
				file: photo,
				request: {
					fileName: picked.name,
					contentType,
					byteSize: photo.size,
					width: size.width,
					height: size.height,
					...(sha256 ? { sha256 } : {}),
					...(reservationId ? { reservationId } : {}),
				},
			});
			const progress = this.modals.open(FmReplaceProgress, {
				size: 'lg',
				centered: true,
				windowClass: 'theme-modal media-modal',
				ariaLabelledBy: 'fm_rpp_title',
			});
			(progress.componentInstance as FmReplaceProgress).start(file.id, file.name, picked.name);
		} catch (error) {
			this.notifications.showError(readApiErrorMessage(error) ?? this.transloco.translate('fm_action_failed'));
		} finally {
			if (preview.url) setTimeout(() => URL.revokeObjectURL(preview.url ?? ''), 60_000);
		}
	}

	/**
	 * Focal point (S10, C06): the whole photo through a 5-minute address, the point picked on it, then the photo's
	 * Crop versions are remade around it (the tray follows; other versions stay as they are).
	 */
	async openFocal(file: MediaFileRow): Promise<void> {
		try {
			const details = await lastValueFrom(this.gateway.details(file.id));
			const crops = [
				...new Set(details.versions.filter((row) => row.fill === 'crop').map((row) => row.profileKey)),
			];
			if (!details.width || !details.height) return;
			const { url } = await lastValueFrom(this.gateway.fileAddress(file.id, 'view'));
			const popup = this.modals.open(FmFocal, {
				size: 'xl',
				centered: true,
				scrollable: true,
				windowClass: 'theme-modal media-modal',
				ariaLabelledBy: 'fm_focal_title',
			});
			(popup.componentInstance as FmFocal).start({
				name: file.name,
				picture: url,
				width: details.width,
				height: details.height,
				focal: details.focal ?? null,
				crops,
			});
			const answer = await popup.result.then(
				(result: { focal: FmPoint | null }) => result,
				() => null,
			);
			if (!answer) return;
			const done = this.uploads.refocus(file.id, file.name, answer.focal);
			await done;
			this.toastr.success(this.transloco.translate(crops.length ? 'fm_focal_saved_remaking' : 'fm_focal_saved'));
		} catch (error) {
			this.notifications.showError(readApiErrorMessage(error) ?? this.transloco.translate('fm_action_failed'));
		}
	}

	/** The photos among the picked files, for the bulk bar's “Add a version” (C07). */
	readonly chosenPhotos = computed(() =>
		this.chosen().files.filter((row) => row.kind === 'image' && row.state !== 'awaiting_upload'),
	);

	/**
	 * Reprocess (C01 for one photo, C07 for many): the popup picks the versions, then the shared storage check runs
	 * (asking a super admin past 250 GB), the API queues them, and one tray row counts the photos as they finish.
	 */
	async openReprocess(
		files: readonly MediaFileRow[],
		versions?: readonly { id: string; state: string }[],
	): Promise<void> {
		const photos = files.filter((row) => row.kind === 'image' && row.state !== 'awaiting_upload');
		const first = photos[0];
		if (!first) return;
		let existing = versions;
		if (!existing && photos.length === 1) {
			existing = await lastValueFrom(this.gateway.details(first.id))
				.then((details) => details.versions)
				.catch(() => []);
		}
		const popup = this.modals.open(FmReprocess, {
			size: 'xl',
			centered: true,
			scrollable: true,
			windowClass: 'theme-modal media-modal',
			ariaLabelledBy: 'fm_rp_title',
		});
		(popup.componentInstance as FmReprocess).start({
			photos: photos.map((row) => ({
				id: row.id,
				name: row.name,
				width: row.width,
				height: row.height,
				bytes: row.bytes,
				contentType: row.contentType,
				thumbnailUrl: row.thumbnailUrl,
			})),
			versions: existing ?? [],
		});
		const choice = await popup.result.then(
			(answer: FmReprocessChoice) => answer,
			() => null,
		);
		if (choice?.versions.length) await this.addVersions(photos, choice);
	}

	private async addVersions(photos: readonly MediaFileRow[], choice: FmReprocessChoice): Promise<void> {
		const onDemand = this.onDemandTemplate();
		const refused = this.refusedTemplate();
		if (!onDemand || !refused) return;
		const many = photos.length > 1;
		const what = many
			? translateCount(this.transloco, 'fm_rp_for_photos', photos.length, { versions: choice.label })
			: this.transloco.translate('fm_rp_for_photo', { versions: choice.label, name: photos[0]?.name ?? '' });
		const bytes = estimateVersionBytes(
			photos.reduce((sum, row) => sum + row.bytes, 0),
			choice.versions.length,
		);
		const reservationId = await this.flow.storageCheck('versions', bytes, photos.length, what, {
			onDemand,
			refused,
		});
		if (reservationId === false) return;
		const held = reservationId ? { reservationId } : {};
		try {
			const ids = photos.map((row) => row.id);
			const parts: string[][] = [];
			for (let at = 0; at < ids.length; at += VERSIONS_PER_CALL)
				parts.push(ids.slice(at, at + VERSIONS_PER_CALL));
			const answers =
				parts.length === 1 && !many
					? [
							await lastValueFrom(
								this.gateway.addVersions(ids[0] ?? '', { versions: choice.versions, ...held }),
							),
						]
					: await this.uploads.operation(
							translateCount(this.transloco, 'fm_rp_asking', photos.length),
							'ri-refresh-line',
							parts.map((part) => part.length),
							(index) =>
								lastValueFrom(
									this.gateway.addVersionsToMany({
										fileIds: parts[index] ?? [],
										versions: choice.versions,
										...held,
									}),
								),
						);
			const added = answers.reduce((sum, answer) => sum + answer.added, 0);
			const skipped = answers.flatMap((answer) => answer.skipped);
			const asked = new Set(choice.versions.map((row) => `${row.profileKey}.${row.fill}`)).size;
			const skippedBy = new Map<string, number>();
			for (const row of skipped) skippedBy.set(row.fileId, (skippedBy.get(row.fileId) ?? 0) + 1);
			const working = ids.filter((id) => (skippedBy.get(id) ?? 0) < asked);
			if (added) {
				this.notifications.showSuccess(translateCount(this.transloco, 'fm_rp_started', added));
				this.uploads.watchVersions(what.replace(/\.$/, ''), working);
			}
			if (skipped.length) {
				const message = translateCount(this.transloco, 'fm_rp_skipped', skipped.length);
				if (added) this.toastr.warning(message);
				else this.notifications.showError(message);
			}
			void this.queries.invalidateQueries({ queryKey: MEDIA_LIBRARY_KEY });
		} catch (error) {
			this.notifications.showError(readApiErrorMessage(error) ?? this.transloco.translate('fm_action_failed'));
		}
	}

	/**
	 * Preview opens the original in a new tab; Download saves it. The tab opens at the click, so the
	 * browser does not block it, and loses its link back to this page before anything loads in it.
	 */
	async openFile(file: MediaFileRow, as: 'view' | 'save'): Promise<void> {
		const tab = as === 'view' ? window.open('', '_blank') : null;
		if (tab) tab.opener = null;
		try {
			const { url } = await lastValueFrom(this.gateway.fileAddress(file.id, as));
			if (tab) tab.location.href = url;
			else if (as === 'view') window.open(url, '_blank', 'noopener');
			else {
				const link = document.createElement('a');
				link.href = url;
				link.rel = 'noopener';
				document.body.appendChild(link);
				link.click();
				link.remove();
			}
		} catch (error) {
			tab?.close();
			this.notifications.showError(readApiErrorMessage(error) ?? this.transloco.translate('fm_action_failed'));
		}
	}

	/** Share (A35–A35D): links, a public address, or the website's picture. */
	openShare(file: MediaFileRow): void {
		const popup = this.modals.open(FmShare, {
			size: 'xl',
			centered: true,
			windowClass: 'theme-modal media-modal',
			ariaLabelledBy: 'fm_share_title',
		});
		void (popup.componentInstance as FmShare).start(file);
		// Links stop, files go public or private: the list refreshes when the popup closes.
		popup.result
			.finally(() => void this.queries.invalidateQueries({ queryKey: MEDIA_LIBRARY_KEY }))
			.catch(() => undefined);
	}

	/** Storage details (A47), from the storage box. */
	openStorageDetails(): void {
		const summary = this.storage.data();
		if (!summary) return;
		const popup = this.modals.open(FmStorageDetails, {
			size: 'lg',
			centered: true,
			windowClass: 'theme-modal media-modal',
			ariaLabelledBy: 'fm_storage_title',
		});
		(popup.componentInstance as FmStorageDetails).start(summary);
	}

	// --- Stars, New folder, Rename (A17, A23, A24) ----------------------------------------------

	/** “My files › Product photos › Banarasi”: the folder shown, or My files in the other views. */
	readonly herePlace = computed(() => {
		const steps = this.nav() === 'folder' ? (this.result()?.breadcrumb ?? []) : [];
		return [this.transloco.translate('fm_my_files'), ...steps.map((step) => step.name)].join(' › ');
	});

	async star(file: MediaFileRow): Promise<void> {
		await this.run(
			this.gateway.star({ targetType: 'file', targetId: file.id, starred: !file.starred }),
			file.starred ? 'fm_unstarred' : 'fm_starred',
		);
	}

	/** New folder (A23): in the folder shown, or in the folder whose menu said New folder inside. */
	openNewFolder(inside: MediaFolderRow | null = null): void {
		const popup = this.modals.open(FmNewFolder, {
			centered: true,
			windowClass: 'theme-modal',
			ariaLabelledBy: 'fm_new_folder_title',
		});
		(popup.componentInstance as FmNewFolder).start(
			inside
				? {
						parentId: inside.id,
						place: [this.transloco.translate('fm_my_files'), inside.location, inside.name]
							.filter(Boolean)
							.join(' › '),
					}
				: { parentId: this.nav() === 'folder' ? (this.folderId() ?? null) : null, place: this.herePlace() },
		);
		void popup.result.catch(() => undefined);
	}

	readonly renameTemplate = viewChild<TemplateRef<unknown>>('fmRename');
	readonly renaming = signal<FmRenaming | null>(null);
	readonly renameError = signal<string | null>(null);
	readonly saving = signal(false);

	/** F2 or the menu's Rename (A24): one folder or one file. */
	openRename(): void {
		const { folders, files } = this.chosen();
		const template = this.renameTemplate();
		if (folders.length + files.length !== 1 || !template) return;
		const folder = folders[0];
		const file = files[0];
		if (folder)
			this.renaming.set({ type: 'folder', id: folder.id, base: folder.name, extension: '', before: folder.name });
		else if (file) {
			const dot = file.name.lastIndexOf('.');
			const extension = dot > 0 ? file.name.slice(dot) : '';
			this.renaming.set({
				type: 'file',
				id: file.id,
				base: extension ? file.name.slice(0, dot) : file.name,
				extension,
				before: file.name,
			});
		}
		this.renameError.set(null);
		const popup = this.modals.open(template, {
			centered: true,
			windowClass: 'theme-modal',
			ariaLabelledBy: 'fm_rename_title',
		});
		// F2 then typing replaces the name, as in a desktop file manager.
		popup.shown?.subscribe(() => (document.getElementById('fm_rename_name') as HTMLInputElement | null)?.select());
	}

	/** Saves the name; a taken one becomes “(1)” on the server, and Undo puts the old one back. */
	async saveRename(close: () => void): Promise<void> {
		const renaming = this.renaming();
		const base = renaming?.base.trim() ?? '';
		if (!renaming || !base || this.saving()) return;
		const name = `${base}${renaming.extension}`;
		if (name === renaming.before) return close();
		this.saving.set(true);
		try {
			const result = await lastValueFrom(
				renaming.type === 'folder'
					? this.gateway.renameFolder(renaming.id, name)
					: this.gateway.renameFile(renaming.id, name),
			);
			close();
			this.undoToast(this.transloco.translate('fm_renamed'), result.undoId);
			void this.queries.invalidateQueries({ queryKey: MEDIA_LIBRARY_KEY });
		} catch (error) {
			this.renameError.set(readApiErrorMessage(error) ?? this.transloco.translate('fm_action_failed'));
		} finally {
			this.saving.set(false);
		}
	}

	// --- Move, Trash, Undo (A21, A25, A26, A27, A37) --------------------------------------------

	readonly inUseTemplate = viewChild<TemplateRef<unknown>>('fmInUse');
	readonly inUse = signal<MediaTrashCheck | null>(null);
	/** The last change Undo can take back: ⌘/Ctrl+Z works until the next one. */
	private lastUndo: { ids: string[]; toastId: number } | null = null;

	async moveChosen(to: string | null): Promise<void> {
		this.menu.set(null);
		const { folders, files } = this.chosen();
		await this.moveItems(
			{ folderIds: folders.map((row) => row.id), fileIds: files.map((row) => row.id) },
			to,
			this.whatOf(folders, files),
		);
	}

	private async moveItems(ids: { folderIds: string[]; fileIds: string[] }, to: string | null, what: string) {
		if (!ids.folderIds.length && !ids.fileIds.length) return;
		const folder = this.placeName(to);
		const result = await this.bulk(
			this.transloco.translate('fm_op_moving', { what, folder }),
			'ri-drag-move-2-line',
			ids,
			(part) => this.gateway.move({ ...part, toFolderId: to }),
		);
		if (!result) return;
		this.clearSelection();
		if (!result.done) return;
		this.undoToast(this.transloco.translate('fm_moved', { what, folder }), result.undoIds);
	}

	/**
	 * Move to Trash from the menu, the bulk bar or the Delete key. Images the website uses cannot go
	 * (A26): when any might be chosen, the server is asked first and the popup lists them. A folder,
	 * or the Delete key, asks before anything goes (A25, A39); otherwise Undo is the way back.
	 */
	async trashChosen(viaKey: boolean): Promise<void> {
		const { folders, files } = this.chosen();
		if (!folders.length && !files.length) return;
		const body: MediaSelection = { folderIds: folders.map((row) => row.id), fileIds: files.map((row) => row.id) };
		if (folders.length || files.some((row) => row.usedOn > 0)) {
			const check = await this.change(this.gateway.checkTrash(body), false);
			if (!check) return;
			if (check.inUse.length) {
				const template = this.inUseTemplate();
				if (!template) return;
				this.inUse.set(check);
				const yes = await this.modals
					.open(template, {
						centered: true,
						size: 'lg',
						windowClass: 'theme-modal text-center',
						ariaLabelledBy: 'fm_in_use_title',
					})
					.result.then(
						() => true,
						() => false,
					);
				if (!yes || !check.moving) return;
				return this.trashNow(body, this.translateCount('fm_items', check.moving));
			}
		}
		if (
			(folders.length || viaKey) &&
			!(await this.confirm({
				kind: 'trash',
				folder: folders.length === 1 && !files.length ? (folders[0] ?? null) : null,
				fileName: files.length === 1 && !folders.length ? (files[0]?.name ?? null) : null,
				count: folders.length + files.length,
			}))
		)
			return;
		await this.trashNow(body, this.whatOf(folders, files));
	}

	private async trashNow(body: MediaSelection, what: string): Promise<void> {
		const result = await this.bulk(
			this.transloco.translate('fm_op_trashing', { what }),
			'ri-delete-bin-line',
			body,
			(part) => this.gateway.trash(part),
		);
		if (!result) return;
		this.clearSelection();
		if (result.done) this.undoToast(this.transloco.translate('fm_trashed', { what }), result.undoIds);
		// Someone else put one of them on a page meanwhile: it stayed, and the admin is told.
		if (result.inUse.length)
			this.notifications.showError(this.translateCount('fm_kept_in_use', result.inUse.length));
	}

	/** The theme's toast with Undo for 8 seconds (A37). */
	private undoToast(message: string, undo: string | null | readonly string[]): void {
		const ids = (Array.isArray(undo) ? [...undo] : undo ? [undo] : []) as string[];
		if (!ids.length) {
			this.notifications.showSuccess(message);
			return;
		}
		const toast = this.toastr.success(message, undefined, {
			toastComponent: FmUndoToast,
			timeOut: UNDO_SECONDS * 1000,
			payload: { action: this.transloco.translate('fm_undo') },
		});
		this.lastUndo = { ids, toastId: toast.toastId };
		toast.onAction.subscribe(() => void this.undo());
	}

	async undo(): Promise<void> {
		const last = this.lastUndo;
		if (!last) return;
		this.lastUndo = null;
		this.toastr.remove(last.toastId);
		// A change made in parts is undone part by part, the last part first.
		const ids = [...last.ids].reverse();
		const result = await this.bulk(
			this.transloco.translate('fm_op_undoing'),
			'ri-arrow-go-back-line',
			{ folderIds: [], fileIds: ids },
			(part) => this.gateway.undo(part.fileIds[0] ?? ''),
			1,
		);
		if (result) this.notifications.showSuccess(this.transloco.translate('fm_undone'));
	}

	// --- Drag between folders (A28) -------------------------------------------------------------

	readonly dragging = signal<FmDrag | null>(null);
	readonly dropOn = signal<string | null>(null);
	readonly ghostAt = signal<{ x: number; y: number } | null>(null);
	readonly draggedFiles = computed(() => new Set(this.dragging()?.fileIds ?? []));
	readonly dropName = computed(() => {
		const id = this.dropOn();
		return id ? this.placeName(id) : null;
	});
	private readonly blank = typeof Image === 'undefined' ? null : Object.assign(new Image(), { src: BLANK_PICTURE });

	dragStart(item: FmItemRef, event: DragEvent): void {
		// Dragging something not picked carries just that item and leaves the picks alone: picking it
		// here would bring up the bulk bar and move the page under the pointer mid-drag.
		const data = this.result();
		const { folders, files } = isPicked(this.selection(), item)
			? this.chosen()
			: {
					folders: item.type === 'folder' ? (data?.folders ?? []).filter((row) => row.id === item.id) : [],
					files: item.type === 'file' ? (data?.files ?? []).filter((row) => row.id === item.id) : [],
				};
		event.dataTransfer?.setData(MEDIA_DRAG_TYPE, '1');
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
		if (this.blank) event.dataTransfer?.setDragImage(this.blank, 0, 0);
		this.menu.set(null);
		this.dragging.set({
			folderIds: folders.map((row) => row.id),
			fileIds: files.map((row) => row.id),
			what: this.whatOf(folders, files),
			thumb: files.find((row) => row.thumbnailUrl)?.thumbnailUrl ?? null,
		});
	}

	/** A folder card takes the drop unless it is one of the dragged folders or inside one. */
	dragOver(folder: MediaFolderRow, event: DragEvent): void {
		const drag = this.dragging();
		if (!drag || !event.dataTransfer?.types.includes(MEDIA_DRAG_TYPE)) return;
		if (blockedTargets(this.tree.data()?.folders ?? [], drag.folderIds).has(folder.id)) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
		this.dropOn.set(folder.id);
	}

	dragLeave(folder: MediaFolderRow, event: DragEvent): void {
		const card = event.currentTarget as HTMLElement | null;
		if (card?.contains(event.relatedTarget as Node | null)) return;
		if (this.dropOn() === folder.id) this.dropOn.set(null);
	}

	async drop(folder: MediaFolderRow, event: DragEvent): Promise<void> {
		event.preventDefault();
		const drag = this.dragging();
		const allowed = this.dropOn() === folder.id;
		this.dragEnd();
		if (drag && allowed) await this.moveItems(drag, folder.id, drag.what);
	}

	dragEnd(): void {
		this.dragging.set(null);
		this.dropOn.set(null);
		this.ghostAt.set(null);
	}

	/** The label follows the pointer anywhere on the page while a drag from this page runs. */
	@HostListener('document:dragover', ['$event'])
	trackDrag(event: DragEvent): void {
		const box = this.mainRef()?.nativeElement.getBoundingClientRect();
		if (!this.dragging() || !box) return;
		this.ghostAt.set({ x: event.clientX - box.left + 16, y: event.clientY - box.top + 16 });
	}

	// --- Keys (A39) -----------------------------------------------------------------------------

	readonly keysTemplate = viewChild<TemplateRef<unknown>>('fmKeys');
	/** The list on ? (A39). ⌘/Ctrl+V comes with uploads (step 1.5e). */
	readonly keyRows = FM_KEY_ROWS;
	readonly imageKind = fileKind({ name: '', category: 'images', kind: 'image' });

	@HostListener('document:keydown', ['$event'])
	onKey(event: KeyboardEvent): void {
		if (typing(event.target) || this.modals.hasOpenModals()) return;
		const command = event.metaKey || event.ctrlKey;
		const key = event.key;
		if (key === 'Escape') {
			if (this.menu()) this.menu.set(null);
			else this.clearSelection();
			return;
		}
		if (command && key.toLowerCase() === 'z' && !event.shiftKey) {
			if (!this.lastUndo) return;
			event.preventDefault();
			void this.undo();
			return;
		}
		if (key === '?') {
			this.openKeys();
			return;
		}
		// Trash has its own buttons; the rest act on what this view lists.
		if (this.nav() === 'trash') return;
		if (command && key.toLowerCase() === 'a') {
			event.preventDefault();
			this.selectEverything();
			return;
		}
		// Enter and Delete on a focused button or link belong to that button or link.
		const onPage = !event.target || event.target === document.body;
		switch (key) {
			case 'ArrowDown':
			case 'ArrowRight':
			case 'ArrowUp':
			case 'ArrowLeft':
				if (!onPage) return;
				event.preventDefault();
				this.step(key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1);
				return;
			case 'Enter':
				if (onPage && this.chosenCount() === 1 && this.cursor) void this.activate(this.cursor);
				return;
			case 'F2':
				event.preventDefault();
				this.openRename();
				return;
			case 'Delete':
			case 'Backspace':
				if (!onPage || !this.chosenCount()) return;
				event.preventDefault();
				void this.trashChosen(true);
				return;
		}
	}

	openKeys(): void {
		const template = this.keysTemplate();
		if (template)
			this.modals.open(template, { centered: true, windowClass: 'theme-modal', ariaLabelledBy: 'fm_keys_title' });
	}

	private step(direction: 1 | -1): void {
		const next = stepItem(this.ordered(), this.cursor, direction);
		if (!next) return;
		this.selection.set(pickItem(NO_SELECTION, [], next, 'only', null));
		this.anchor = next;
		this.cursor = next;
		document.querySelector(`[data-${next.type}="${CSS.escape(next.id)}"]`)?.scrollIntoView?.({ block: 'nearest' });
	}

	// --- Words ----------------------------------------------------------------------------------

	private translateCount(key: string, count: number): string {
		return translateCount(this.transloco, key, count);
	}

	/** “2 folders and 3 files”; one item is named: “red-banarasi.jpg”. */
	private whatOf(folders: readonly MediaFolderRow[], files: readonly MediaFileRow[]): string {
		const one = folders.length + files.length === 1 ? (folders[0]?.name ?? files[0]?.name) : null;
		return one ? `“${one}”` : this.what(folders.length, files.length);
	}

	private what(folders: number, files: number): string {
		const someFolders = folders ? this.translateCount('fm_folders_count', folders) : '';
		const someFiles = files ? this.translateCount('fm_files', files) : '';
		return someFolders && someFiles
			? this.transloco.translate('fm_what_both', { folders: someFolders, files: someFiles })
			: someFolders || someFiles;
	}

	/** A folder's name from the tree, or My files. */
	private placeName(id: string | null): string {
		if (!id) return this.transloco.translate('fm_my_files');
		return (
			this.tree.data()?.folders.find((row) => row.id === id)?.name ??
			this.result()?.folders.find((row) => row.id === id)?.name ??
			''
		);
	}

	// --- Uploads (A03, A06, A29, B03, B06, B10, B11, B18, B19) -----------------------------------

	readonly uploads = inject(MediaUploads);
	readonly flow = inject(FmUploadFlow);
	readonly pickFilesInput = viewChild<ElementRef<HTMLInputElement>>('fmPickFiles');
	readonly pickFolderInput = viewChild<ElementRef<HTMLInputElement>>('fmPickFolder');
	/** The upload popups live in FmUploadPopups (shared with the Media picker); the page reads them from there. */
	readonly uploadPopups = viewChild(FmUploadPopups);
	private readonly onDemandTemplate = computed(() => this.uploadPopups()?.onDemandTemplate());
	private readonly refusedTemplate = computed(() => this.uploadPopups()?.refusedTemplate());
	/** Files from the computer are over the page (A29). */
	readonly dropping = signal(false);
	private dropDepth = 0;

	/** Uploads go into the folder shown; from Recent, Favourites or Trash, into My files. */
	readonly uploadTargetId = computed(() => (this.nav() === 'folder' ? (this.folderId() ?? null) : null));
	readonly uploadPlace = computed(
		() => (this.nav() === 'folder' && this.folderName()) || this.transloco.translate('fm_my_files'),
	);

	/** Each folder card's upload progress (B06): files going into it or anything inside it. */
	readonly cardProgress = computed(() => {
		const rows = this.tree.data()?.folders ?? [];
		const parent = new Map(rows.map((row) => [row.id, row.parentId]));
		const totals = new Map<string, { sent: number; bytes: number }>();
		for (const job of this.uploads.active()) {
			for (let at = job.folderId; at; at = parent.get(at) ?? null) {
				const total = totals.get(at) ?? { sent: 0, bytes: 0 };
				totals.set(at, { sent: total.sent + job.sent, bytes: total.bytes + job.bytes });
			}
		}
		return new Map(
			[...totals].map(([id, total]) => [id, total.bytes ? Math.round((total.sent / total.bytes) * 100) : 0]),
		);
	});

	/** B16: the cut-off upload a file is being chosen for, and one whose file did not match. */
	private resuming: CutOffUpload | null = null;
	readonly resumeRefused = signal<string | null>(null);

	chooseResume(entry: CutOffUpload, input: HTMLInputElement): void {
		this.resuming = entry;
		this.resumeRefused.set(null);
		input.click();
	}

	/** Carries on only with the same file: same name, size and date. */
	resumePicked(input: HTMLInputElement): void {
		const file = input.files?.[0];
		input.value = '';
		const entry = this.resuming;
		this.resuming = null;
		if (!file || !entry) return;
		if (!this.uploads.resumeWith(entry, file)) this.resumeRefused.set(entry.assetId);
	}

	uploadChoice(choice: 'files' | 'folder' | 'new_folder'): void {
		if (choice === 'new_folder') return this.openNewFolder();
		(choice === 'files' ? this.pickFilesInput() : this.pickFolderInput())?.nativeElement.click();
	}

	filesPicked(input: HTMLInputElement): void {
		const files = [...(input.files ?? [])];
		input.value = '';
		this.review(planUpload(files.map((file) => ({ file, path: [] }))));
	}

	folderPicked(input: HTMLInputElement): void {
		const files = [...(input.files ?? [])];
		input.value = '';
		this.review(planUpload(readPickedFolder(files)));
	}

	/** Only files from the computer, in a folder view; a drag of Media's own items is a move (A28). */
	private fromComputer(event: DragEvent): boolean {
		const types = [...(event.dataTransfer?.types ?? [])];
		return (
			this.nav() === 'folder' && !this.dragging() && types.includes('Files') && !types.includes(MEDIA_DRAG_TYPE)
		);
	}

	dropEnter(event: DragEvent): void {
		if (!this.fromComputer(event)) return;
		event.preventDefault();
		this.dropDepth += 1;
		this.dropping.set(true);
	}

	dropOver(event: DragEvent): void {
		if (!this.fromComputer(event)) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
	}

	dropLeave(): void {
		if (!this.dropping()) return;
		this.dropDepth = Math.max(0, this.dropDepth - 1);
		if (!this.dropDepth) this.dropping.set(false);
	}

	/** Files and whole folders dropped from the computer (A29). The folders are read at once. */
	async dropFiles(event: DragEvent): Promise<void> {
		if (!this.dropping()) return;
		event.preventDefault();
		this.dropDepth = 0;
		this.dropping.set(false);
		const items = [...(event.dataTransfer?.items ?? [])].filter((item) => item.kind === 'file');
		const files = [...(event.dataTransfer?.files ?? [])];
		const entries =
			items.length && typeof items[0]?.webkitGetAsEntry === 'function' ? await readDropped(items) : [];
		// A browser that gives no folder entries still gives the dropped files.
		const picked = entries.length ? entries : files.map((file) => ({ file, path: [] as string[] }));
		this.review(planUpload(picked));
	}

	private review(plan: ReturnType<typeof planUpload>): void {
		const popups = this.popups();
		if (popups) this.flow.open(plan, this.uploadTargetId(), this.herePlace(), popups);
	}

	popups(): FmUploadPopupRefs | null {
		return this.uploadPopups()?.popups() ?? null;
	}

	/** S12, B17: a picture pasted with ⌘/Ctrl+V uploads here, unless the paste is into a text box. */
	@HostListener('document:paste', ['$event'])
	onPaste(event: ClipboardEvent): void {
		if (typing(event.target) || this.modals.hasOpenModals()) return;
		const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'));
		if (!files.length) return;
		event.preventDefault();
		const named = files.map((file) => ({
			file: new File([file], pastedName(file.type), { type: file.type, lastModified: Date.now() }),
			path: [] as string[],
		}));
		const popups = this.popups();
		if (popups) this.flow.open(planUpload(named), this.uploadTargetId(), this.herePlace(), popups);
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
		const result = await this.bulk(
			this.transloco.translate('fm_op_deleting', {
				what: this.translateCount('fm_items', fileIds.length + folderIds.length),
			}),
			'ri-delete-bin-2-line',
			{ fileIds, folderIds },
			(part) => this.gateway.deleteForever(part),
		);
		if (result) this.notifications.showSuccess(this.transloco.translate('fm_deleted_for_good'));
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

	/**
	 * A bulk change in parts (A48): the tray counts as each part is answered, and shows nothing for a
	 * change done within 0.3 s (A49). Answers the totals and every part's Undo, or null after saying
	 * what went wrong; the lists refresh either way.
	 */
	private async bulk(
		label: string,
		icon: string,
		selection: { folderIds: readonly string[]; fileIds: readonly string[] },
		call: (part: { folderIds: string[]; fileIds: string[] }) => Observable<MediaOperationResult>,
		size = BULK_PART,
	): Promise<{ done: number; inUse: MediaOperationResult['inUse']; undoIds: string[] } | null> {
		const parts = splitSelection(selection, size);
		try {
			const answers = await this.uploads.operation(
				label,
				icon,
				parts.map((part) => part.folderIds.length + part.fileIds.length),
				(index) => lastValueFrom(call(parts[index] ?? { folderIds: [], fileIds: [] })),
			);
			return {
				done: answers.reduce((sum, answer) => sum + answer.done, 0),
				inUse: answers.flatMap((answer) => answer.inUse),
				undoIds: answers.flatMap((answer) => (answer.undoId ? [answer.undoId] : [])),
			};
		} catch (error) {
			this.notifications.showError(readApiErrorMessage(error) ?? this.transloco.translate('fm_action_failed'));
			return null;
		} finally {
			void this.queries.invalidateQueries({ queryKey: MEDIA_LIBRARY_KEY });
		}
	}

	/** A change that answers something: the answer, or null after saying what went wrong. */
	private async change<T>(work: Observable<T>, refresh = true): Promise<T | null> {
		try {
			return await lastValueFrom(work);
		} catch (error) {
			this.notifications.showError(readApiErrorMessage(error) ?? this.transloco.translate('fm_action_failed'));
			return null;
		} finally {
			if (refresh) void this.queries.invalidateQueries({ queryKey: MEDIA_LIBRARY_KEY });
		}
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
