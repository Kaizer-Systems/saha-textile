import { Component, Input, viewChild, output, input } from '@angular/core';

import { TranslocoPipe } from '@jsverse/transloco';

import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { MediaModal, MediaModal as MediaModalComponent_1 } from '@shared/ui/modal/media-modal/media-modal';

import type { MediaPurpose } from '@core/media/media.gateway';

@Component({
	selector: 'app-image-upload',
	templateUrl: './image-upload.html',
	styleUrls: ['./image-upload.scss'],
	imports: [MediaModalComponent_1, TranslocoPipe],
})
export class ImageUpload {
	readonly MediaModal = viewChild<MediaModal>('mediaModal');

	// TODO: Skipped for migration because:
	//  Your application code writes to the input. This prevents migration.
	@Input() images: IAttachment[] = [];
	// TODO: Skipped for migration because:
	//  Your application code writes to the input. This prevents migration.
	@Input() image: IAttachment | null;
	readonly id = input<string>('');
	// TODO: Skipped for migration because:
	//  Your application code writes to the input. This prevents migration.
	@Input() imageUrl: string | null;
	readonly url = input<boolean>(false);
	readonly multipleImage = input<boolean>(false);
	/** What uploads made from this picker are for; passed to the media modal. */
	readonly purpose = input<MediaPurpose>('product');
	/**
	 * One picture only (Brand Kit, owner 2026-11-10): while a picture is set the "+" is hidden, so
	 * changing it means removing it first. Off, the "+" stays and picking again replaces the picture.
	 */
	readonly oneOnly = input<boolean>(false);
	/** `dark`: the preview tile is dark, so a logo made for dark screens can be seen (Brand Kit). */
	readonly tone = input<'light' | 'dark'>('light');
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	@Input() helpText: string;

	readonly selectedFiles = output<any>();

	public showImages: IAttachment[] = [];
	public showImage: IAttachment | null;
	public showImageUrl: String | null;

	/** Whether the "+" tile shows. */
	get canAdd(): boolean {
		return !this.oneOnly() || (!this.showImage && !this.showImageUrl && !this.showImages?.length);
	}

	ngOnChanges() {
		this.showImage = this.image;
		this.showImages = this.images;
		this.showImageUrl = this.imageUrl;
	}

	selectImage(data: IAttachment, url: boolean) {
		if (Array.isArray(data)) {
			this.images = data;
			this.showImages = data;
		} else if (url) {
			this.imageUrl = data.original_url;
			this.showImageUrl = data.original_url;
		} else {
			this.image = data;
			this.showImage = data;
		}
		if (this.imageUrl) {
			this.selectedFiles.emit(this.imageUrl);
		} else {
			this.selectedFiles.emit(this.images.length ? this.images : this.image);
		}
	}

	remove(index: number, type: string) {
		if (type == 'multiple' && Array.isArray(this.images)) {
			this.images.splice(index, 1);
			this.showImages = this.images;
		} else if (type == 'single_image_url') {
			this.imageUrl = null;
			this.showImageUrl = null;
			this.image = null;
		} else {
			this.image = null;
			this.showImage = null;
		}
		this.selectedFiles.emit(this.images.length ? this.images : this.image);
	}
}
