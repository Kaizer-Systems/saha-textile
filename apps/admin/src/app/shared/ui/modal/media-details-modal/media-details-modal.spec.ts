import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MediaGateway } from '@core/media/media.gateway';
import { MediaUploads } from '@core/media-library/media-uploads';
import { NotificationService } from '@data-access/services/notification.service';

import { fileNameOf, MediaDetailsModal } from './media-details-modal';

const details = {
	slug: 'red-saree',
	text: { alt: { en: 'Red saree' }, title: {}, caption: {} },
};

const render = (save = () => of(undefined) as never) => {
	const media = { details: vi.fn(() => of(details)), saveDetails: vi.fn(save) };
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const open = vi.fn(() => ({ result: Promise.resolve('saved') }));
	const uploads = { followRename: vi.fn(async () => true) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbModal, useValue: { open } },
			{ provide: MediaGateway, useValue: media },
			{ provide: NotificationService, useValue: notifier },
			{ provide: MediaUploads, useValue: uploads },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(MediaDetailsModal, { set: { imports: [], template: '' } });
	const modal = TestBed.createComponent(MediaDetailsModal).componentInstance;
	return { modal, media, notifier, open, uploads };
};

describe('fileNameOf', () => {
	it('makes a search-friendly file name from anything typed', () => {
		expect(fileNameOf('Red Banarasi Saree.JPG')).toBe('red-banarasi-saree-jpg');
		expect(fileNameOf('  --Silk__Weave-- ')).toBe('silk-weave');
		expect(fileNameOf(`${'a'.repeat(79)} b`)).toBe('a'.repeat(79));
	});
});

describe('MediaDetailsModal', () => {
	it('opens with the saved file name and text, and warns only on a rename', async () => {
		const { modal, open } = render();
		await modal.openModal('med_1');
		expect(open).toHaveBeenCalled();
		expect(modal.form.controls.slug.value).toBe('red-saree');
		expect(modal.form.controls.alt.value).toBe('Red saree');
		expect(modal.gaps()['bn']).toEqual([{ key: 'alt', label: 'alt' }]);
		expect(modal.renaming()).toBe(false);
		modal.setSlug('Red Silk Saree');
		expect(modal.renaming()).toBe(true);
	});

	it('saves every language and closes', async () => {
		const { modal, media, notifier } = render();
		const saved: string[] = [];
		modal.saved.subscribe((id) => saved.push(id));
		await modal.openModal('med_1');
		modal.switchLanguage('bn');
		modal.form.controls.alt.setValue('লাল শাড়ি');
		const close = vi.fn();
		await modal.save({ close } as never);
		expect(media.saveDetails).toHaveBeenCalledWith('med_1', {
			slug: 'red-saree',
			alt: { en: 'Red saree', bn: 'লাল শাড়ি' },
			title: { en: '', bn: '' },
			caption: { en: '', bn: '' },
		});
		expect(close).toHaveBeenCalledWith('saved');
		expect(saved).toEqual(['med_1']);
		expect(notifier.showSuccess).toHaveBeenCalledWith('media_details_saved');
		expect(modal.saving()).toBe(false);
	});

	it('a new file name is followed in the tray while every size is made again under it (step 3d)', async () => {
		const { modal, uploads } = render();
		await modal.openModal('med_1');
		await modal.save({ close: vi.fn() } as never);
		expect(uploads.followRename).not.toHaveBeenCalled();
		modal.setSlug('Red Silk Saree');
		await modal.save({ close: vi.fn() } as never);
		expect(uploads.followRename).toHaveBeenCalledWith('med_1', 'red-silk-saree');
	});

	it('says so when the photo is busy and the new name has to wait', async () => {
		const busy = new HttpErrorResponse({ status: 400, error: { issues: [{ code: 'rename_waits' }] } });
		const { modal, notifier, uploads } = render(() => throwError(() => busy) as never);
		await modal.openModal('med_1');
		modal.setSlug('Red Silk Saree');
		await modal.save({ close: vi.fn() } as never);
		expect(notifier.showError).toHaveBeenCalledWith('file_name_rename_waits');
		expect(uploads.followRename).not.toHaveBeenCalled();
	});

	it('refuses an empty file name, and reports a refused save', async () => {
		const { modal, media, notifier } = render(() => throwError(() => new Error('no')) as never);
		await modal.save({ close: vi.fn() } as never);
		expect(media.saveDetails).not.toHaveBeenCalled();
		await modal.openModal('med_1');
		modal.setSlug('');
		await modal.save({ close: vi.fn() } as never);
		expect(media.saveDetails).not.toHaveBeenCalled();
		modal.setSlug('red');
		const close = vi.fn();
		await modal.save({ close } as never);
		expect(close).not.toHaveBeenCalled();
		expect(notifier.showError).toHaveBeenCalledWith('media_details_rejected');
	});
});
