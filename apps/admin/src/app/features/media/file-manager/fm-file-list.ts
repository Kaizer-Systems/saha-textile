import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, input, output } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { FileSizePipe, PluralPipe } from '@shared/pipes/language.pipes';

import { fileKind, fileTypeLabel } from './file-kinds';
import { timeLeft, uploadPercent, uploadSecondsLeft } from './fm-upload-plan';

import type { FmItemRef } from './fm-selection';
import type { MediaFileRow, MediaFolderRow } from '@core/media-library/media-library.gateway';
import type { UploadJob } from '@core/media-library/media-uploads';

/** One item in Trash, as its row actions report it. */
export interface TrashItem {
	type: 'file' | 'folder';
	id: string;
	name: string;
	/** For a file: the folder it was in, to tell whether that folder is in Trash too (A19). */
	folderId: string | null;
}

/** A click, right-click or ⋮ on one file, with the event the page places its menu by. */
export interface FmItemEvent {
	item: FmItemRef;
	event: MouseEvent;
	/** The ⋮ that was clicked: the menu opens under it. Null for a right-click. */
	anchor: HTMLElement | null;
}

/** The files of one view, as the theme table (A01) or as thumbnails (A02). */
@Component({
	selector: 'app-fm-file-list',
	templateUrl: './fm-file-list.html',
	imports: [DatePipe, NgTemplateOutlet, TranslocoModule, FileSizePipe, PluralPipe],
})
export class FmFileList {
	/**
	 * C03: versions are being added to a photo that already has a live copy, or it is being replaced (S7): the website
	 * keeps showing the live copy meanwhile.
	 */
	adding(file: MediaFileRow): boolean {
		const replacing = !!file.replacing && file.replacing !== 'failed';
		return ((file.versionsMaking ?? 0) > 0 || replacing) && !!file.thumbnailUrl;
	}

	/** What a photo's files being made again are for: a new photo, a new focal point, a new web file name, or a profile brought up to date. */
	remakeWords(file: MediaFileRow): string {
		if (file.replacingWhy === 'focal') return 'fm_remaking_crops';
		if (file.replacingWhy === 'rename') return 'fm_renaming_files';
		if (file.replacingWhy === 'refresh') return 'fm_refreshing';
		return 'fm_replacing';
	}

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
	/** A click picks (A39); a double-click opens; right-click and ⋮ open the menu (A21, A22). */
	readonly pick = output<FmItemEvent>();
	readonly activate = output<MediaFileRow>();
	readonly menu = output<FmItemEvent>();
	/** Dragging onto a folder (A28); the page moves what is picked. */
	readonly dragStart = output<{ item: FmItemRef; event: DragEvent }>();
	readonly dragEnd = output<void>();
	/** Files being dragged: their tiles fade (A28). */
	readonly dragging = input<ReadonlySet<string>>(new Set());
	/** Uploads from this tab, by stored file, for the status cell (B06). */
	readonly uploads = input<ReadonlyMap<string, UploadJob>>(new Map());
	readonly retryUpload = output<string>();
	readonly percent = uploadPercent;
	readonly secondsLeft = uploadSecondsLeft;
	readonly timeLeft = timeLeft;

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

	ref(file: MediaFileRow): FmItemRef {
		return { type: 'file', id: file.id };
	}

	/** The ⋮ opens the menu under itself, without picking the row twice. */
	more(file: MediaFileRow, event: MouseEvent): void {
		event.stopPropagation();
		this.menu.emit({ item: this.ref(file), event, anchor: event.currentTarget as HTMLElement });
	}

	/** The row's checkbox, the tile's tick and the star act on their own, not as a click on the row. */
	alone(event: Event): void {
		event.stopPropagation();
	}

	allSelected(): boolean {
		return this.files().length > 0 && this.files().every((file) => this.selected().has(file.id));
	}

	pending(file: MediaFileRow): boolean {
		// A photo getting new versions keeps its live copy: it stays usable, so it isn't greyed (C03).
		return ['awaiting_upload', 'queued', 'processing'].includes(file.state) && !this.adding(file);
	}
}
