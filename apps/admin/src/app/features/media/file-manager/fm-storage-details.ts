import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { readApiErrorMessage } from '@saha-textile/http-transport';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { MediaLibraryGateway, type StorageSummary } from '@core/media-library/media-library.gateway';
import { MEDIA_LIBRARY_KEY, injectNightlyCheckQuery } from '@data-access/queries/media-library.queries';
import { FileSizePipe } from '@shared/pipes/language.pipes';

/** The storage rows the API counts today (A47), each with what it holds. */
export const STORAGE_ROWS: Readonly<Record<string, { label: string; note: string }>> = {
	originals: { label: 'fm_storage_originals', note: 'fm_storage_originals_note' },
	versions: { label: 'fm_storage_versions', note: 'fm_storage_versions_note' },
	files: { label: 'fm_storage_files', note: 'fm_storage_files_note' },
	trash: { label: 'fm_trash', note: 'fm_storage_trash_note' },
	zips: { label: 'fm_storage_zips', note: 'fm_storage_zips_note' },
};

/**
 * Storage details (A47): what is stored, by kind, against the plan, and the super-admin switch
 * “Other admins may use on-demand storage”. Other admins see the switch, but only a super admin
 * can change it.
 */
@Component({
	selector: 'app-fm-storage-details',
	templateUrl: './fm-storage-details.html',
	imports: [DatePipe, TranslocoModule, FileSizePipe],
})
export class FmStorageDetails {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(MediaLibraryGateway);
	private readonly queries = inject(QueryClient);
	private readonly transloco = inject(TranslocoService);

	/** Set by `start()` right after the popup opens. */
	readonly summary = signal<StorageSummary | null>(null);
	readonly rows = STORAGE_ROWS;
	/** R5-5: files in storage that Media has no record of, from the nightly check. */
	readonly nightly = injectNightlyCheckQuery();
	readonly others = signal<boolean | null>(null);
	readonly error = signal<string | null>(null);
	readonly saving = signal(false);

	start(summary: StorageSummary): void {
		this.summary.set(summary);
	}

	othersAllowed(): boolean {
		return this.others() ?? this.summary()?.othersMayUseOnDemand ?? false;
	}

	barClass(): string {
		const colour = this.summary()?.colour;
		return colour === 'red' ? 'bg-danger' : colour === 'yellow' ? 'bg-warning' : 'bg-success';
	}

	async toggleOthers(): Promise<void> {
		if (!this.summary()?.canChangeOnDemand || this.saving()) return;
		const next = !this.othersAllowed();
		this.saving.set(true);
		this.error.set(null);
		try {
			const saved = await lastValueFrom(this.gateway.saveStorageSettings({ othersMayUseOnDemand: next }));
			this.others.set(saved.othersMayUseOnDemand);
			void this.queries.invalidateQueries({ queryKey: MEDIA_LIBRARY_KEY });
		} catch (error) {
			this.error.set(readApiErrorMessage(error) ?? this.transloco.translate('fm_action_failed'));
		} finally {
			this.saving.set(false);
		}
	}
}
