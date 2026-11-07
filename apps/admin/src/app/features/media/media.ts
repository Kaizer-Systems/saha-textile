import { Component, inject, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { MediaGateway } from '@core/media/media.gateway';
import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { MediaBox } from '@shared/ui/media-box/media-box';
import { DeleteModal } from '@shared/ui/modal/delete-modal/delete-modal';
import { MediaModal } from '@shared/ui/modal/media-modal/media-modal';

@Component({
	selector: 'app-media',
	templateUrl: './media.html',
	styleUrls: ['./media.scss'],
	imports: [PageWrapper, HasPermissionDirective, MediaBox, MediaModal, DeleteModal, TranslocoModule],
})
export class Media {
	private readonly media = inject(MediaGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifications = inject(NotificationService);

	public images: IAttachment[] = [];

	readonly MediaModal = viewChild<MediaModal>('mediaModal');
	readonly DeleteModal = viewChild<DeleteModal>('deleteModal');

	selectImage(data: IAttachment[]) {
		this.images = data;
	}

	onActionClicked(action: string) {
		if (action == 'deleteAll') {
			// Bulk delete has no backend yet — just clear the local selection.
			this.images = [];
		}
	}

	/** Soft delete via the API; refused while the image is still used somewhere. */
	async deleteImage(id: number | string) {
		try {
			await firstValueFrom(this.media.remove(String(id)));
			this.images = this.images.filter((image) => image.id !== id);
			await this.queryClient.invalidateQueries({ queryKey: ['attachments'] });
		} catch (error) {
			this.notifications.showError((error as { error?: { message?: string } }).error?.message ?? 'Delete failed');
		}
	}
}
