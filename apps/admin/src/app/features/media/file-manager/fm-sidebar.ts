import { NgTemplateOutlet } from '@angular/common';
import { Component, HostListener, computed, input, output, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { FileSizePipe } from '@shared/pipes/language.pipes';

import type { MediaCategory, MediaFolderTree, StorageSummary } from '@core/media-library/media-library.gateway';

export type FmNav = 'folder' | 'recent' | 'favourites' | 'trash' | 'clean';
type TreeRow = MediaFolderTree['folders'][number];
export interface TreeNode {
	folder: TreeRow;
	children: TreeNode[];
}

/** The six groups the Media page sorts files into (A13–A16), with the brief's colour dots. */
export const FM_CATEGORIES: ReadonlyArray<{ key: MediaCategory; label: string; dot: string }> = [
	{ key: 'images', label: 'images', dot: 'k-image' },
	{ key: 'videos', label: 'fm_videos', dot: 'k-video' },
	{ key: 'documents', label: 'fm_documents', dot: 'k-doc' },
	{ key: 'archives', label: 'fm_archives', dot: 'k-zip' },
	{ key: 'backups', label: 'fm_backups', dot: 'k-backup' },
	{ key: 'other', label: 'fm_other', dot: 'k-other' },
];

/** Folders under each parent, by name, from the flat list the API sends. */
export function buildTree(rows: readonly TreeRow[]): TreeNode[] {
	const byParent = new Map<string | null, TreeRow[]>();
	for (const row of rows) byParent.set(row.parentId, [...(byParent.get(row.parentId) ?? []), row]);
	const grow = (parentId: string | null): TreeNode[] =>
		(byParent.get(parentId) ?? [])
			.slice()
			.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
			.map((folder) => ({ folder, children: grow(folder.id) }));
	return grow(null);
}

/** A folder's parents, nearest last: the tree opens them so the open folder shows (A36). */
export function parentsOf(rows: readonly TreeRow[], id: string | null): string[] {
	const byId = new Map(rows.map((row) => [row.id, row]));
	const out: string[] = [];
	for (let at = id ? byId.get(id)?.parentId : null; at; at = byId.get(at)?.parentId ?? null) out.unshift(at);
	return out;
}

/**
 * The Media page's left side (A01, A36, A46): where to look (My files, Recent, Favourites, Trash),
 * the folder tree, the categories, and the storage box.
 */
@Component({
	selector: 'app-fm-sidebar',
	templateUrl: './fm-sidebar.html',
	imports: [NgTemplateOutlet, TranslocoModule, FileSizePipe],
})
export class FmSidebar {
	readonly nav = input.required<FmNav>();
	readonly category = input<MediaCategory | null>(null);
	readonly folderId = input<string | null>(null);
	readonly folders = input<readonly TreeRow[]>([]);
	readonly storage = input<StorageSummary | null>(null);

	readonly navigate = output<FmNav>();
	readonly pickCategory = output<MediaCategory>();
	readonly openFolder = output<string>();
	readonly storageDetails = output<void>();
	/** The Upload menu (A03): files, a whole folder, or a new folder. */
	readonly upload = output<'files' | 'folder' | 'new_folder'>();
	readonly uploadMenuOpen = signal(false);

	readonly categories = FM_CATEGORIES;
	readonly tree = computed(() => buildTree(this.folders()));
	/** Opened by hand; the open folder's parents are always open too. */
	private readonly opened = signal<ReadonlySet<string>>(new Set());
	readonly open = computed(() => new Set([...this.opened(), ...parentsOf(this.folders(), this.folderId())]));

	toggleUploadMenu(event: Event): void {
		event.stopPropagation();
		this.uploadMenuOpen.update((open) => !open);
	}

	chooseUpload(choice: 'files' | 'folder' | 'new_folder'): void {
		this.uploadMenuOpen.set(false);
		this.upload.emit(choice);
	}

	@HostListener('document:click')
	closeUploadMenu(): void {
		if (this.uploadMenuOpen()) this.uploadMenuOpen.set(false);
	}

	toggle(id: string, event: Event): void {
		event.stopPropagation();
		const next = new Set(this.opened());
		if (this.open().has(id)) {
			next.delete(id);
			// A parent of the open folder closes only when asked twice: it is kept open by the path.
		} else next.add(id);
		this.opened.set(next);
	}

	/** Green under 60%, yellow from 60%, red from 85% (A46): the theme's own colours. */
	barClass(summary: StorageSummary): string {
		return summary.colour === 'red' ? 'bg-danger' : summary.colour === 'yellow' ? 'bg-warning' : 'bg-success';
	}
}
