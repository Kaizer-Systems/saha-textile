import { Component, viewChild } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { MediaBox } from '@shared/ui/media-box/media-box';
import { DeleteModal } from '@shared/ui/modal/delete-modal/delete-modal';
import { MediaModal } from '@shared/ui/modal/media-modal/media-modal';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { IAttachment } from '@data-access/interfaces/attachment.interface';

@Component({
	selector: 'app-media',
	templateUrl: './media.html',
	styleUrls: ['./media.scss'],
	imports: [PageWrapper, HasPermissionDirective, MediaBox, MediaModal, DeleteModal, TranslateModule],
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
