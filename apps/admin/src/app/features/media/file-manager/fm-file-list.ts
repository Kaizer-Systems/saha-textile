import { DatePipe } from '@angular/common';
import { Component, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { FileSizePipe, PluralPipe } from '@shared/pipes/language.pipes';

import { fileKind, fileTypeLabel } from './file-kinds';

import type { MediaFileRow } from '@core/media-library/media-library.gateway';

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

	readonly kind = fileKind;
	readonly typeLabel = fileTypeLabel;

	pending(file: MediaFileRow): boolean {
		return ['awaiting_upload', 'queued', 'processing'].includes(file.state);
	}
}
