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

	/** Anything still running: uploads, or bulk changes (A48). */
	/**
	 * A .zip alone (owner, 16 Nov): when it is the only thing running or done, it shows as its own floating box (A30
	 * while it is made, A30B when ready). With anything else beside it, the tray lists everything, the .zip as a row (A48).
	 */
	readonly soloZip = computed(() => {
		const ops = this.uploads.operations();
		const only = ops.length === 1 && !this.uploads.jobs().length ? ops[0] : undefined;
		return only?.kind === 'k-zip' ? only : null;
	});
	readonly busy = computed(() => !!this.uploads.active().length || !!this.uploads.runningOperations().length);

	/** “Working on 1 · Uploading 2 · 3 done · 1 failed”, or “Uploaded 5 files” once all are done. */
	readonly head = computed(() => {
		const working = this.uploads.runningOperations().length;
		const active = this.uploads.active().length;
		const done = this.uploads.doneCount();
		const failed = this.uploads.failedCount();
		const parts: string[] = [];
		if (working) parts.push(translateCount(this.transloco, 'fm_tray_working', working));
		if (active) parts.push(translateCount(this.transloco, 'fm_tray_uploading', active));
		else if (!failed && !working && done) return translateCount(this.transloco, 'fm_tray_uploaded', done);
		if (!parts.length && !failed && !done) return this.transloco.translate('fm_op_all_done');
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
