import { Component, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { IAttachment } from '@data-access/interfaces/attachment.interface';
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

	deleteImage(id: number) {
		this.images = this.images.filter((image) => {
			return image.id !== id;
		});
	}
}
