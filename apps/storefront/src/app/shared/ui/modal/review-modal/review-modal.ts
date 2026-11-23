import { isPlatformBrowser } from '@angular/common';
import { Component, TemplateRef, PLATFORM_ID, inject, output, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { ModalDismissReasons, NgbModal, NgbRating } from '@ng-bootstrap/ng-bootstrap';
import { readApiErrorMessage } from '@saha-textile/http-transport';
import { firstValueFrom } from 'rxjs';

import {
	MAX_REVIEW_PHOTOS,
	type ReviewPhotoResult,
	ReviewPhotoRefusal,
	ReviewPhotoUploadService,
} from '@core/media/review-photo-upload.service';
import { IOwnReview } from '@data-access/interfaces/product-review.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { ReviewService } from '@data-access/services/review.service';

import { Button } from '../../button/button';

@Component({
	selector: 'app-review-modal',
	templateUrl: './review-modal.html',
	styleUrls: ['./review-modal.scss'],
	imports: [Button, ReactiveFormsModule, NgbRating, TranslocoModule],
})
export class ReviewModal {
	private modalService = inject(NgbModal);
	private platformId = inject<Object>(PLATFORM_ID);
	private uploads = inject(ReviewPhotoUploadService);
	private reviews = inject(ReviewService);

	/** Emits after a review is submitted or edited; it then waits for approval. */
	readonly saved = output<void>();
	/** Set when editing: the review being changed. */
	private reviewId: string | null = null;

	readonly maxPhotos = MAX_REVIEW_PHOTOS;
	readonly photos = signal<ReviewPhotoResult[]>([]);
	readonly uploading = signal(false);
	/** A translation key, or the API's own (already client-safe) refusal text. */
	readonly photoNotice = signal<string | null>(null);
	/** The delivered order this review is for, when the caller knows it. */
	public orderId: string | null = null;

	readonly ReviewModal = viewChild<TemplateRef<string>>('reviewModal');

	public closeResult: string;
	public modalOpen: boolean = false;
	public product: IProduct;
	public currentRate: number = 0;
	public review = new FormControl('', [Validators.required]);
	public form: FormGroup;
	public type: string;

	constructor() {
		this.form = new FormGroup({
			rating: new FormControl('', [Validators.required]),
			description: new FormControl(''),
		});
	}

	/** Opens the form on the customer's own review, its text and photos filled in. */
	async openEdit(product: IProduct, review: IOwnReview) {
		await this.openModal(product, 'edit');
		this.reviewId = review.id;
		this.currentRate = review.rating;
		this.form.patchValue({ rating: review.rating, description: review.body });
		this.photos.set(
			review.photos.map((photo) => ({ assetId: photo.assetId, previewUrl: photo.thumbUrl, warning: null })),
		);
	}

	async openModal(product: IProduct, type: string, orderId: string | null = null) {
		if (isPlatformBrowser(this.platformId)) {
			this.modalOpen = true;
			this.orderId = orderId;
			this.reviewId = null;
			this.photos.set([]);
			this.photoNotice.set(null);
			this.type = type;
			this.product = product;
			this.currentRate = 0;
			this.form.reset({ rating: '', description: '' });

			this.modalService
				.open(this.ReviewModal(), {
					ariaLabelledBy: 'profile-Modal',
					centered: true,
					windowClass: 'theme-modal',
				})
				.result.then(
					(result) => {
						`Result ${result}`;
					},
					(reason) => {
						this.closeResult = `Dismissed ${this.getDismissReason(reason)}`;
					},
				);
		}
	}

	private getDismissReason(reason: ModalDismissReasons): string {
		if (reason === ModalDismissReasons.ESC) {
			return 'by pressing ESC';
		} else if (reason === ModalDismissReasons.BACKDROP_CLICK) {
			return 'by clicking on a backdrop';
		} else {
			return `with: ${reason}`;
		}
	}

	async addPhotos(input: HTMLInputElement): Promise<void> {
		const files = [...(input.files ?? [])];
		input.value = '';
		this.photoNotice.set(null);
		const room = this.maxPhotos - this.photos().length;
		if (files.length > room) this.photoNotice.set('review_photos_too_many');
		this.uploading.set(true);
		for (const file of files.slice(0, Math.max(0, room))) {
			try {
				const photo = await this.uploads.upload(file, String(this.product.id));
				this.photos.update((current) => [...current, photo]);
				if (photo.warning) this.photoNotice.set('review_photo_small');
			} catch (error) {
				this.photoNotice.set(
					error instanceof ReviewPhotoRefusal
						? `review_photo_${error.code}`
						: (readApiErrorMessage(error) ?? 'review_photo_processing_failed'),
				);
			}
		}
		this.uploading.set(false);
	}

	removePhoto(assetId: string): void {
		this.photos.update((current) => current.filter((photo) => photo.assetId !== assetId));
	}

	async submit() {
		this.form.markAllAsTouched();
		if (!this.form.valid) return;
		const content = {
			rating: Number(this.form.value.rating),
			title: null,
			body: String(this.form.value.description ?? '').trim() || '—',
			imageAssetIds: this.photos().map((photo) => photo.assetId),
		};
		const { reviewId, orderId } = this;
		try {
			if (reviewId) {
				await firstValueFrom(this.reviews.update(reviewId, content));
			} else if (orderId) {
				await this.uploads.submit({ productId: String(this.product.id), orderId, ...content });
			} else {
				this.photoNotice.set('review_needs_delivered_order');
				return;
			}
			this.modalService.dismissAll();
			this.saved.emit();
		} catch (error) {
			this.photoNotice.set(readApiErrorMessage(error) ?? 'review_photo_processing_failed');
		}
	}
}
