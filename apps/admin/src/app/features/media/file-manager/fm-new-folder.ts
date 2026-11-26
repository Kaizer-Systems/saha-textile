import { Component, inject, signal } from '@angular/core';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { readApiErrorMessage } from '@saha-textile/http-transport';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { MediaLibraryGateway, type MediaFolderRow } from '@core/media-library/media-library.gateway';
import { MEDIA_LIBRARY_KEY } from '@data-access/queries/media-library.queries';

/** Where a new folder goes: its parent (null: My files) and that place as the popup names it. */
export interface FmNewFolderInput {
	parentId: string | null;
	place: string;
}

/**
 * New folder (A23), opened from the Media page and from the Media picker (D10). A taken name becomes “(1)” on the
 * server; any other refusal keeps the popup open with the reason. The popup closes with the new folder. Its toast is
 * the toastr's own, so a picker underneath stays open.
 */
@Component({
	selector: 'app-fm-new-folder',
	templateUrl: './fm-new-folder.html',
	imports: [TranslocoModule],
})
export class FmNewFolder {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(MediaLibraryGateway);
	private readonly queries = inject(QueryClient);
	private readonly toastr = inject(ToastrService);
	private readonly transloco = inject(TranslocoService);

	readonly parentId = signal<string | null>(null);
	readonly place = signal('');
	readonly name = signal('');
	readonly error = signal<string | null>(null);
	readonly creating = signal(false);

	start(input: FmNewFolderInput): void {
		this.parentId.set(input.parentId);
		this.place.set(input.place);
	}

	async create(): Promise<void> {
		const name = this.name().trim();
		if (!name || this.creating()) return;
		this.creating.set(true);
		try {
			const folder: MediaFolderRow = await lastValueFrom(
				this.gateway.createFolder({ name, parentId: this.parentId() }),
			);
			this.modal.close(folder);
			this.toastr.success(this.transloco.translate('fm_folder_created'));
			void this.queries.invalidateQueries({ queryKey: MEDIA_LIBRARY_KEY });
		} catch (error) {
			this.error.set(readApiErrorMessage(error) ?? this.transloco.translate('fm_action_failed'));
		} finally {
			this.creating.set(false);
		}
	}
}
