import { Component, DestroyRef, computed, inject, signal } from '@angular/core';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import { MediaUploads, type UploadJob } from '@core/media-library/media-uploads';
import { FileSizePipe, PluralPipe, translateCount } from '@shared/pipes/language.pipes';

import { fileKind } from './file-kinds';
import { timeLeft, uploadPercent, uploadSecondsLeft } from './fm-upload-plan';

/**
 * The upload tray (B08, B20): bottom right on every admin page while files upload, so moving around
 * the admin never stops them. One bar per file (files are stored as they are), Retry on a failure,
 * a head that counts, and a × once nothing is running.
 */
@Component({
	selector: 'app-fm-tray',
	templateUrl: './fm-tray.html',
	imports: [TranslocoModule, FileSizePipe, PluralPipe],
})
export class FmTray {
	readonly uploads = inject(MediaUploads);
	private readonly transloco = inject(TranslocoService);
	private readonly toastr = inject(ToastrService);

	readonly open = signal(true);
	readonly percent = uploadPercent;
	readonly secondsLeft = uploadSecondsLeft;
	readonly timeLeft = timeLeft;

	/** “Uploading 2 · 3 done · 1 failed”, or “Uploaded 5 files” once all are done. */
	readonly head = computed(() => {
		const active = this.uploads.active().length;
		const done = this.uploads.doneCount();
		const failed = this.uploads.failedCount();
		const parts: string[] = [];
		if (active) parts.push(translateCount(this.transloco, 'fm_tray_uploading', active));
		else if (!failed) return translateCount(this.transloco, 'fm_tray_uploaded', done);
		if (failed) parts.push(translateCount(this.transloco, 'fm_tray_failed', failed));
		if (done) parts.push(translateCount(this.transloco, 'fm_tray_done', done));
		return parts.join(' · ');
	});

	constructor() {
		// B14: a file kept beside one of the same name says what it is called now. The theme's toast is
		// used directly: the shared success toast would close any popup the admin has open elsewhere.
		const renamed = this.uploads.renamed.subscribe((job) =>
			this.toastr.success(this.transloco.translate('fm_uploaded_as', { name: job.savedAs })),
		);
		inject(DestroyRef).onDestroy(() => renamed.unsubscribe());
	}

	kind(job: UploadJob) {
		return fileKind({ name: job.name, category: 'other', kind: 'file' });
	}
}
