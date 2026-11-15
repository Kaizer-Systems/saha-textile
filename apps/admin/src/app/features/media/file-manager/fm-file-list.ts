import { DatePipe } from '@angular/common';
import { Component, input, output } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { FileSizePipe, PluralPipe } from '@shared/pipes/language.pipes';

import { fileKind, fileTypeLabel } from './file-kinds';

import type { MediaFileRow, MediaFolderRow } from '@core/media-library/media-library.gateway';

/** One item in Trash, as its row actions report it. */
export interface TrashItem {
	type: 'file' | 'folder';
	id: string;
	name: string;
	/** For a file: the folder it was in, to tell whether that folder is in Trash too (A19). */
	folderId: string | null;
}

/** The files of one view, as the theme table (A01) or as thumbnails (A02). */
@Component({
	selector: 'app-fm-file-list',
	templateUrl: './fm-file-list.html',
	imports: [DatePipe, TranslocoModule, FileSizePipe, PluralPipe],
})
export class FmFileList {
	readonly files = input.required<readonly MediaFileRow[]>();
	readonly display = input<'list' | 'grid'>('list');
	/** Trash lists where each item came from and how long it stays (A18). */
	readonly trash = input(false);
	/** Search, Recent and Favourites show where each file is (A08). */
	readonly showLocation = input(false);
	/** Trash lists folders as rows too, above the files (A18). */
	readonly folders = input<readonly MediaFolderRow[]>([]);

	/** Ticked files (A27); the page keeps the set. */
	readonly selected = input<ReadonlySet<string>>(new Set());
	readonly toggleSelect = output<string>();
	readonly toggleAll = output<boolean>();
	/** A row's star (A17): this admin's favourite. */
	readonly star = output<MediaFileRow>();

	/** Trash's row actions (A18): put an item back, or delete it for good. */
	readonly restore = output<TrashItem>();
	readonly deleteForever = output<TrashItem>();

	readonly kind = fileKind;
	readonly typeLabel = fileTypeLabel;

	fileItem(file: MediaFileRow): TrashItem {
		return { type: 'file', id: file.id, name: file.name, folderId: file.folderId };
	}

	folderItem(folder: MediaFolderRow): TrashItem {
		return { type: 'folder', id: folder.id, name: folder.name, folderId: folder.parentId };
	}

	allSelected(): boolean {
		return this.files().length > 0 && this.files().every((file) => this.selected().has(file.id));
	}

	pending(file: MediaFileRow): boolean {
		return ['awaiting_upload', 'queued', 'processing'].includes(file.state);
	}
}
