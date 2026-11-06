import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { ReviewPhotoRefusal, ReviewPhotoUploadService } from '@core/media/review-photo-upload.service';

import { ReviewModal } from './review-modal';

const render = (platform = 'browser', result: Promise<unknown> = Promise.resolve('closed')) => {
	const open = vi.fn(() => ({ result }));
	const dismissAll = vi.fn();
	const upload = vi.fn();
	const submit = vi.fn();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbModal, useValue: { open, dismissAll } },
			{ provide: ReviewPhotoUploadService, useValue: { upload, submit } },
			{ provide: PLATFORM_ID, useValue: platform },
		],
	});
	TestBed.overrideComponent(ReviewModal, { set: { imports: [], template: '' } });
	const modal = TestBed.createComponent(ReviewModal).componentInstance;
	return { modal, open, dismissAll, upload, submit };
};

const picker = (count: number) =>
	({ files: Array.from({ length: count }, (_, i) => new File(['x'], `${i}.jpg`)), value: 'C:\\x.jpg' }) as never;
const product = { id: 7, user_review: { rating: 4, description: 'Lovely' } } as never;
const photo = (assetId: string, warning: string | null = null) => ({ assetId, previewUrl: null, warning });

describe('ReviewModal.openModal', () => {
	it('opens nothing on the server', async () => {
		const { modal, open } = render('server');
		await modal.openModal(product, 'add');
		expect(open).not.toHaveBeenCalled();
		expect(modal.modalOpen).toBe(false);
	});

	it('opens for a new review without touching the form', async () => {
		const { modal, open } = render();
		await modal.openModal(product, 'add', 'order-1');
		expect(open).toHaveBeenCalledOnce();
		expect(modal.orderId).toBe('order-1');
		expect(modal.form.value.rating).toBe('');
	});

	it('fills the form when editing, and defaults to no order', async () => {
		const { modal } = render();
		await modal.openModal(product, 'edit');
		expect(modal.form.value).toEqual({ rating: 4, description: 'Lovely' });
		expect(modal.orderId).toBeNull();
	});

	it.each([
		[ModalDismissReasons.ESC, 'Dismissed by pressing ESC'],
		[ModalDismissReasons.BACKDROP_CLICK, 'Dismissed by clicking on a backdrop'],
		['cross', 'Dismissed with: cross'],
	])('records how it was dismissed (%s)', async (reason, text) => {
		const { modal } = render('browser', Promise.reject(reason));
		await modal.openModal(product, '');
		await Promise.resolve();
		await Promise.resolve();
		expect(modal.closeResult).toBe(text);
	});
});

describe('ReviewModal.addPhotos', () => {
	const ready = async () => {
		const parts = render();
		await parts.modal.openModal(product, 'add', 'order-1');
		return parts;
	};

	it('uploads each file, clears the picker and flags a small photo', async () => {
		const { modal, upload } = await ready();
		upload.mockResolvedValueOnce(photo('a')).mockResolvedValueOnce(photo('b', 'below_recommended_size'));
		const input = picker(2) as unknown as HTMLInputElement;
		await modal.addPhotos(input);
		expect(upload).toHaveBeenCalledTimes(2);
		expect(upload.mock.calls[0]?.[1]).toBe('7');
		expect(input.value).toBe('');
		expect(modal.photos().map((p) => p.assetId)).toEqual(['a', 'b']);
		expect(modal.photoNotice()).toBe('review_photo_small');
		expect(modal.uploading()).toBe(false);
	});

	it('takes only what fits within five and says so', async () => {
		const { modal, upload } = await ready();
		upload.mockImplementation(async (file: File) => photo(file.name));
		await modal.addPhotos(picker(6));
		expect(upload).toHaveBeenCalledTimes(5);
		expect(modal.photoNotice()).toBe('review_photos_too_many');
	});

	it('copes with a picker that has no file list', async () => {
		const { modal, upload } = await ready();
		await modal.addPhotos({ files: null, value: '' } as never);
		expect(upload).not.toHaveBeenCalled();
		expect(modal.photoNotice()).toBeNull();
	});

	it('shows the refusal key, the API text, or the generic failure', async () => {
		const { modal, upload } = await ready();
		upload.mockRejectedValueOnce(new ReviewPhotoRefusal('too_large'));
		await modal.addPhotos(picker(1));
		expect(modal.photoNotice()).toBe('review_photo_too_large');
		upload.mockRejectedValueOnce({ error: { code: 'NOT_BOUGHT', message: 'Buy it first' } });
		await modal.addPhotos(picker(1));
		expect(modal.photoNotice()).toBe('Buy it first');
		upload.mockRejectedValueOnce(new Error('offline'));
		await modal.addPhotos(picker(1));
		expect(modal.photoNotice()).toBe('review_photo_processing_failed');
	});

	it('removes one photo', async () => {
		const { modal } = await ready();
		modal.photos.set([photo('a'), photo('b')] as never);
		modal.removePhoto('a');
		expect(modal.photos().map((p) => p.assetId)).toEqual(['b']);
	});
});

describe('ReviewModal.submit', () => {
	it('stops on an invalid form', async () => {
		const { modal, submit } = render();
		await modal.submit();
		expect(submit).not.toHaveBeenCalled();
		expect(modal.form.controls['rating']?.touched).toBe(true);
	});

	it('needs a delivered order', async () => {
		const { modal, submit } = render();
		modal.form.patchValue({ rating: 5 });
		await modal.submit();
		expect(submit).not.toHaveBeenCalled();
		expect(modal.photoNotice()).toBe('review_needs_delivered_order');
	});

	it('sends the review and closes', async () => {
		const { modal, submit, dismissAll } = render();
		await modal.openModal(product, 'add', 'order-1');
		modal.form.patchValue({ rating: '5', description: '  Beautiful  ' });
		modal.photos.set([photo('a')] as never);
		submit.mockResolvedValue({});
		await modal.submit();
		expect(submit).toHaveBeenCalledWith({
			productId: '7',
			orderId: 'order-1',
			rating: 5,
			title: null,
			body: 'Beautiful',
			imageAssetIds: ['a'],
		});
		expect(dismissAll).toHaveBeenCalledOnce();
	});

	it('sends a dash for an empty or missing body', async () => {
		const { modal, submit } = render();
		await modal.openModal(product, 'add', 'order-1');
		submit.mockResolvedValue({});
		modal.form.patchValue({ rating: 3, description: '   ' });
		await modal.submit();
		expect(submit.mock.calls[0]?.[0]).toMatchObject({ body: '—' });
		modal.form.patchValue({ description: null });
		await modal.submit();
		expect(submit.mock.calls[1]?.[0]).toMatchObject({ body: '—' });
	});

	it('shows the API refusal, or the generic text, and stays open', async () => {
		const { modal, submit, dismissAll } = render();
		await modal.openModal(product, 'add', 'order-1');
		modal.form.patchValue({ rating: 3 });
		submit.mockRejectedValueOnce({ error: { code: 'DUPLICATE', message: 'Already reviewed' } });
		await modal.submit();
		expect(modal.photoNotice()).toBe('Already reviewed');
		submit.mockRejectedValueOnce(new Error('offline'));
		await modal.submit();
		expect(modal.photoNotice()).toBe('review_photo_processing_failed');
		expect(dismissAll).not.toHaveBeenCalled();
	});
});
