import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import { MediaUploads } from '@core/media-library/media-uploads';
import { FileSizePipe, PluralPipe } from '@shared/pipes/language.pipes';

/**
 * Replace photo, under way (media step 3b; brief C08): its three steps with their real counts: the upload's bytes,
 * the sizes the image worker has made, and the pages that switch together once it is in place. It can be closed:
 * the Replace carries on in the tray.
 */
@Component({
	selector: 'app-fm-replace-progress',
	templateUrl: './fm-replace-progress.html',
	imports: [TranslocoModule, FileSizePipe, PluralPipe],
})
export class FmReplaceProgress {
	readonly modal = inject(NgbActiveModal);
	private readonly uploads = inject(MediaUploads);

	readonly fileId = signal('');
	readonly names = signal({ old: '', next: '' });
	readonly run = computed(() => this.uploads.replaces().get(this.fileId()) ?? null);
	readonly sentPercent = computed(() => {
		const run = this.run();
		return run && run.bytes ? Math.min(100, Math.round((run.sent / run.bytes) * 100)) : 0;
	});
	readonly madePercent = computed(() => {
		const run = this.run();
		if (!run) return 0;
		if (run.step === 'done') return 100;
		return run.total ? Math.round((run.made / run.total) * 100) : 0;
	});

	start(fileId: string, oldName: string, nextName: string): void {
		this.fileId.set(fileId);
		this.names.set({ old: oldName, next: nextName });
	}
}
