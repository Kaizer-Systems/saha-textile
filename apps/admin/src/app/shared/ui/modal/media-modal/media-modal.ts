import { Component, TemplateRef, inject, viewChild, output, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import {
	NgbModal,
	ModalDismissReasons,
	NgbModalRef,
	NgbNav,
	NgbNavItem,
	NgbNavItemRole,
	NgbNavLink,
	NgbNavLinkBase,
	NgbNavContent,
	NgbNavOutlet,
} from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { NgxDropzoneChangeEvent, NgxDropzoneModule } from 'ngx-dropzone';

import { MediaUploadService } from '@core/media/media-upload.service';
import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { NotificationService } from '@data-access/services/notification.service';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import { Button } from '../../button/button';
import { MediaBox } from '../../media-box/media-box';

import type { MediaPurpose } from '@core/media/media.gateway';

@Component({
	selector: 'app-media-modal',
	templateUrl: './media-modal.html',
	styleUrls: ['./media-modal.scss'],
	imports: [
		Button,
		NgbNav,
		NgbNavItem,
		NgbNavItemRole,
		NgbNavLink,
		NgbNavLinkBase,
		NgbNavContent,
		MediaBox,
		HasPermissionDirective,
		NgxDropzoneModule,
		NgbNavOutlet,
		TranslocoModule,
	],
})
export class MediaModal {
	private notificationService = inject(NotificationService);
	private modalService = inject(NgbModal);
	private uploads = inject(MediaUploadService);
	private queryClient = inject(QueryClient);

	/** True while files are uploading and processing; the Insert button waits on it. */
	public uploading = false;

	public active = 'select';
	public closeResult: string;
	public modalOpen: boolean = false;

	public media: IAttachment;
	public files: File[] = [];

	readonly selectMedia = input<boolean>(true);
	readonly multipleImage = input<boolean>(false);
	readonly url = input<boolean>(false);
	/** What the uploads are for; decides size rules and the roles the worker renders. */
	readonly purpose = input<MediaPurpose>('product');

	readonly MediaModal = viewChild<TemplateRef<string>>('mediaModal');

	readonly selectImage = output<IAttachment>();

	async openModal() {
		this.modalOpen = true;
		if (this.selectMedia()) this.active = 'select';
		else this.active = 'upload';
		this.modalService
			.open(this.MediaModal(), {
				ariaLabelledBy: 'Media-Modal',
				centered: true,
				windowClass: 'theme-modal modal-xl media-modal',
			})
			.result.then(
				(result) => {
					`Result ${result}`;
					this.closeResult = `Closed with: ${result}`;
				},
				(reason) => {
					this.closeResult = `Dismissed ${this.getDismissReason(reason)}`;
				},
			);
	}

	private getDismissReason(reason: ModalDismissReasons): string {
		if (this.selectMedia()) this.active = 'select';
		else this.active = 'upload';
		if (reason === ModalDismissReasons.ESC) {
			return 'by pressing ESC';
		} else if (reason === ModalDismissReasons.BACKDROP_CLICK) {
			return 'by clicking on a backdrop';
		} else {
			return `with: ${reason}`;
		}
	}

	onSelect(event: NgxDropzoneChangeEvent) {
		if (this.files.length + event.addedFiles.length <= 5) {
			this.files.push(...event.addedFiles);
		} else this.notificationService.showError(`You've reached 5 file maximum.`);
	}

	onRemove(event: File) {
		this.files.splice(this.files.indexOf(event), 1);
	}

	/**
	 * Uploads each file through presign → direct PUT → finalize → worker, then refreshes the
	 * library. A refused or failed file is reported and the rest carry on.
	 */
	async addMedia(nav: NgbNav) {
		if (!this.files.length || this.active !== 'upload' || this.uploading) return;
		this.uploading = true;
		let ready = 0;
		for (const file of [...this.files]) {
			try {
				const status = await this.uploads.upload(file, this.purpose());
				if (status.state === 'ready') {
					ready += 1;
					if (status.warnings.includes('aspect_off_target')) {
						this.notificationService.showSuccess(`${file.name}: not 3:4 — it was letterboxed on white.`);
					}
				} else {
					this.notificationService.showError(`${file.name}: ${status.error ?? 'processing did not finish'}`);
				}
			} catch (error) {
				const message = (error as { error?: { message?: string } }).error?.message ?? (error as Error).message;
				this.notificationService.showError(`${file.name}: ${message}`);
			}
		}
		this.uploading = false;
		this.files = [];
		if (ready > 0) this.notificationService.showSuccess(`${ready} image(s) ready.`);
		await this.queryClient.invalidateQueries({ queryKey: ['attachments'] });
		if (this.selectMedia()) {
			nav.select('select');
		} else {
			this.modalService.dismissAll();
		}
	}

	setImage(data: IAttachment) {
		this.media = data;
	}

	selectedMedia(modal: NgbModalRef) {
		this.selectImage.emit(this.media);
		modal.dismiss('close');
	}

	ngOnDestroy() {
		if (this.modalOpen) {
			this.modalService.dismissAll();
		}
	}
}
