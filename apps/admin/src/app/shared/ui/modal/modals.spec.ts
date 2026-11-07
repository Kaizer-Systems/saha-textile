import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { describe, expect, it, vi } from 'vitest';

import { MediaUploadService } from '@core/media/media-upload.service';
import { SettingStore } from '@core/state/setting.store';
import { NotificationService } from '@data-access/services/notification.service';

import { ConfirmationModal } from './confirmation-modal/confirmation-modal';
import { DeleteModal } from './delete-modal/delete-modal';
import { ImportCsvModal } from './import-csv-modal/import-csv-modal';
import { MediaModal } from './media-modal/media-modal';
import { PayoutModal } from './payout-modal/payout-modal';

const render = <T>(type: new () => T, result: Promise<unknown> = Promise.resolve('closed')) => {
	const open = vi.fn(() => ({ result }));
	const dismissAll = vi.fn();
	const notification = { showSuccess: vi.fn(), showError: vi.fn() };
	const uploads = { upload: vi.fn() };
	const client = { invalidateQueries: vi.fn(async () => undefined) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbModal, useValue: { open, dismissAll } },
			{ provide: NotificationService, useValue: notification },
			{ provide: MediaUploadService, useValue: uploads },
			{ provide: QueryClient, useValue: client },
			{ provide: SettingStore, useValue: { setting: signal(null) } },
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	return { fixture, modal: fixture.componentInstance, open, dismissAll, notification, uploads, client };
};
const settle = async () => {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
};
const reasons: [unknown, string][] = [
	[ModalDismissReasons.ESC, 'Dismissed by pressing ESC'],
	[ModalDismissReasons.BACKDROP_CLICK, 'Dismissed by clicking on a backdrop'],
	['cross', 'Dismissed with: cross'],
];

const cases = [
	{ name: 'DeleteModal', type: DeleteModal, open: (modal: DeleteModal) => modal.openModal('delete', {}) },
	{
		name: 'ConfirmationModal',
		type: ConfirmationModal,
		open: (modal: ConfirmationModal) => modal.openModal('status', {}, 1),
	},
	{ name: 'ImportCsvModal', type: ImportCsvModal, open: (modal: ImportCsvModal) => modal.openModal() },
	{ name: 'PayoutModal', type: PayoutModal, open: (modal: PayoutModal) => modal.openModal({ id: 1 } as never) },
	{ name: 'MediaModal', type: MediaModal, open: (modal: MediaModal) => modal.openModal() },
] as const;

describe.each(cases)('$name', ({ type, open }) => {
	const show = (modal: unknown) => (open as (value: unknown) => Promise<void>)(modal);

	it('opens', async () => {
		const parts = render(type as new () => unknown);
		await show(parts.modal);
		await settle();
		expect(parts.open).toHaveBeenCalledOnce();
	});

	it.each(reasons)('records how it was dismissed (%s)', async (reason, text) => {
		const parts = render(type as new () => unknown, Promise.reject(reason));
		await show(parts.modal);
		await settle();
		expect((parts.modal as { closeResult: string }).closeResult).toBe(text);
	});

	it('closes an open dialog when destroyed, and leaves others alone', async () => {
		const closed = render(type as new () => unknown);
		closed.fixture.destroy();
		expect(closed.dismissAll).not.toHaveBeenCalled();
		const opened = render(type as new () => unknown);
		await show(opened.modal);
		opened.fixture.destroy();
		expect(opened.dismissAll).toHaveBeenCalledOnce();
	});
});

describe('DeleteModal.delete', () => {
	it('closes and hands the action back', async () => {
		const { modal } = render(DeleteModal);
		const seen: unknown[] = [];
		modal.deleteItem.subscribe((value) => seen.push(value));
		await modal.openModal('delete', { id: 1 });
		const ref = { close: vi.fn() };
		modal.delete(ref as never);
		expect(ref.close).toHaveBeenCalledWith('delete');
		expect(modal.modalOpen).toBe(false);
		expect(seen).toEqual([{ actionToPerform: 'delete', data: { id: 1 } }]);
	});
});

describe('ConfirmationModal.confirm', () => {
	it('closes and hands the action back', async () => {
		const { modal } = render(ConfirmationModal);
		const seen: unknown[] = [];
		modal.confirmed.subscribe((value) => seen.push(value));
		await modal.openModal('status', { id: 1 }, 1);
		modal.confirm({ close: vi.fn() } as never);
		expect(seen).toEqual([{ actionToPerform: 'status', data: { id: 1 }, value: 1 }]);
	});
});

describe('ImportCsvModal files', () => {
	const file = new File(['x'], 'a.csv');

	it('adds and removes a file', () => {
		const { modal } = render(ImportCsvModal);
		modal.onSelect({ addedFiles: [file] } as never);
		expect(modal.files).toEqual([file]);
		modal.onRemove(file);
		expect(modal.files).toEqual([]);
	});

	it('uploads only user imports, and only with a file', () => {
		const { fixture, modal, dismissAll } = render(ImportCsvModal);
		modal.upload();
		fixture.componentRef.setInput('module', 'product');
		modal.files = [file];
		modal.upload();
		expect(dismissAll).not.toHaveBeenCalled();
		fixture.componentRef.setInput('module', 'user');
		modal.upload();
		expect(dismissAll).toHaveBeenCalledOnce();
		expect(modal.files).toEqual([]);
	});

	it('uses no file without a module', () => {
		const { modal, dismissAll } = render(ImportCsvModal);
		modal.files = [file];
		modal.upload();
		expect(dismissAll).not.toHaveBeenCalled();
	});
});

describe('PayoutModal', () => {
	it('reports the decision', async () => {
		const { modal } = render(PayoutModal);
		const seen: unknown[] = [];
		modal.payout.subscribe((value) => seen.push(value));
		await modal.openModal({ id: 1 } as never);
		modal.actionPerform('approved');
		expect(seen).toEqual([{ data: { id: 1 }, status: 'approved' }]);
	});
});

describe('MediaModal', () => {
	const file = (name: string) => new File(['x'], name);
	const nav = () => ({ select: vi.fn() }) as never;

	it('opens on upload when it cannot select', async () => {
		const { fixture, modal } = render(MediaModal);
		fixture.componentRef.setInput('selectMedia', false);
		await modal.openModal();
		expect(modal.active).toBe('upload');
	});

	it('resets to upload after a dismissal when it cannot select', async () => {
		const { fixture, modal } = render(MediaModal, Promise.reject('cross'));
		fixture.componentRef.setInput('selectMedia', false);
		await modal.openModal();
		await settle();
		expect(modal.active).toBe('upload');
	});

	it('records a normal close', async () => {
		const { modal } = render(MediaModal, Promise.resolve('done'));
		await modal.openModal();
		await settle();
		expect(modal.closeResult).toBe('Closed with: done');
	});

	it('takes five files at most', () => {
		const { modal, notification } = render(MediaModal);
		modal.onSelect({ addedFiles: [file('1'), file('2'), file('3'), file('4'), file('5')] } as never);
		expect(modal.files).toHaveLength(5);
		modal.onSelect({ addedFiles: [file('6')] } as never);
		expect(notification.showError).toHaveBeenCalledOnce();
		modal.onRemove(modal.files[0]!);
		expect(modal.files).toHaveLength(4);
	});

	it('uploads nothing without files, off the upload tab, or while busy', async () => {
		const { modal, uploads } = render(MediaModal);
		await modal.addMedia(nav());
		modal.files = [file('a')];
		await modal.addMedia(nav());
		modal.active = 'upload';
		modal.uploading = true;
		await modal.addMedia(nav());
		expect(uploads.upload).not.toHaveBeenCalled();
	});

	it('reports each outcome and returns to the library', async () => {
		const { modal, uploads, notification, client } = render(MediaModal);
		modal.active = 'upload';
		modal.files = [file('a'), file('b'), file('c'), file('d'), file('e')];
		uploads.upload
			.mockResolvedValueOnce({ state: 'ready', warnings: [] })
			.mockResolvedValueOnce({ state: 'ready', warnings: ['aspect_off_target'] })
			.mockResolvedValueOnce({ state: 'failed', error: 'too small', warnings: [] })
			.mockResolvedValueOnce({ state: 'processing', error: null, warnings: [] })
			.mockRejectedValueOnce({ error: { message: 'refused' } });
		const tabs = nav();
		await modal.addMedia(tabs);
		expect(notification.showSuccess).toHaveBeenCalledWith('2 image(s) ready.');
		expect(notification.showSuccess).toHaveBeenCalledWith('b: not 3:4 — it was letterboxed on white.');
		expect(notification.showError).toHaveBeenCalledWith('c: too small');
		expect(notification.showError).toHaveBeenCalledWith('d: processing did not finish');
		expect(notification.showError).toHaveBeenCalledWith('e: refused');
		expect(client.invalidateQueries).toHaveBeenCalledOnce();
		expect((tabs as unknown as { select: ReturnType<typeof vi.fn> }).select).toHaveBeenCalledWith('select');
		expect(modal.files).toEqual([]);
	});

	it('uses the plain message of a thrown error, and closes when it cannot select', async () => {
		const { fixture, modal, uploads, notification, dismissAll } = render(MediaModal);
		fixture.componentRef.setInput('selectMedia', false);
		modal.active = 'upload';
		modal.files = [file('a')];
		uploads.upload.mockRejectedValueOnce(new Error('offline'));
		await modal.addMedia(nav());
		expect(notification.showError).toHaveBeenCalledWith('a: offline');
		expect(notification.showSuccess).not.toHaveBeenCalled();
		expect(dismissAll).toHaveBeenCalledOnce();
	});

	it('hands back the chosen image', () => {
		const { modal } = render(MediaModal);
		const seen: unknown[] = [];
		modal.selectImage.subscribe((value) => seen.push(value));
		modal.setImage({ id: 1 } as never);
		const ref = { dismiss: vi.fn() };
		modal.selectedMedia(ref as never);
		expect(seen).toEqual([{ id: 1 }]);
		expect(ref.dismiss).toHaveBeenCalledWith('close');
	});
});
