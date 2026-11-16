import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MediaLibraryGateway, type MediaFileRow } from '@core/media-library/media-library.gateway';
import { MediaUploads } from '@core/media-library/media-uploads';

import { FmNewFolder } from './fm-new-folder';
import { FmPicker, isRawFile } from './fm-picker';
import { FmUploadFlow } from './fm-upload-flow';
import { FmUploadPopups } from './fm-upload-popups';

vi.mock('@data-access/queries/media-library.queries', async (original) => ({
	...(await original<object>()),
	injectMediaBrowseQuery: () => ({ data: () => undefined }),
	injectMediaTreeQuery: () => ({ data: () => undefined }),
	injectMediaStorageQuery: () => ({ data: () => undefined }),
}));

/** The upload popups' templates, as FmUploadPopups reads them. */
const POPUP_TEMPLATES = ['fmUploadReview', 'fmDuplicate', 'fmOnDemand', 'fmStorageRefused', 'fmOverLimit', 'fmNotes']
	.map((name) => `<ng-template #${name}></ng-template>`)
	.join('');

const row = (id: string, extra: Partial<MediaFileRow> = {}): MediaFileRow =>
	({
		id,
		kind: 'image',
		name: `${id}.jpg`,
		contentType: 'image/jpeg',
		category: 'images',
		bytes: 1000,
		width: 3000,
		height: 4000,
		state: 'ready',
		thumbnailUrl: `https://cdn.test/${id}.webp`,
		fitting: [
			{ versionId: 'product_3x4.white', fill: 'white' },
			{ versionId: 'product_3x4.blur', fill: 'blur' },
		],
		...extra,
	}) as MediaFileRow;

const setup = (max = 6, already = 2, withPopups = false) => {
	const modal = { close: vi.fn(), dismiss: vi.fn() };
	const gateway = { details: vi.fn(() => of({ versions: [] })), addVersions: vi.fn(() => of({ added: 1 })) };
	const uploads = { watchVersions: vi.fn() };
	const flow = { open: vi.fn() };
	const folderPopup = { start: vi.fn() };
	const modals = {
		open: vi.fn((content: unknown) => ({
			componentInstance: content === FmNewFolder ? folderPopup : { start: vi.fn() },
			result: Promise.resolve({
				versions: [{ profileKey: 'product_3x4', fill: 'white' }],
				label: 'Product 3:4 · White padding',
			}),
		})),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: modal },
			{ provide: NgbModal, useValue: modals },
			{ provide: MediaLibraryGateway, useValue: gateway },
			{ provide: MediaUploads, useValue: uploads },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(FmUploadPopups, { set: { imports: [], template: POPUP_TEMPLATES } });
	TestBed.overrideComponent(FmPicker, {
		set: {
			imports: withPopups ? [FmUploadPopups] : [],
			template: withPopups ? '<app-fm-upload-popups />' : '',
			providers: [{ provide: FmUploadFlow, useValue: flow }],
		},
	});
	const fixture = TestBed.createComponent(FmPicker);
	fixture.detectChanges();
	const picker = fixture.componentInstance;
	picker.start({
		title: 'fm_pick_title',
		accept: 'image',
		max,
		already,
		profile: { key: 'product_3x4', name: 'Product 3:4', icon: false },
	});
	return { picker, modal, modals, gateway, uploads, flow, folderPopup };
};

describe('the Media picker (R4-2, D01–D17; media step 4a)', () => {
	it('a tile takes its first version; a chip takes that version; a second click on it lets go', () => {
		const { picker, modal } = setup();
		picker.toggle(row('med_a'));
		expect(picker.chosen().get('med_a')?.versionId).toBe('product_3x4.white');
		picker.toggle(row('med_a'), 'product_3x4.blur');
		expect(picker.chosen().get('med_a')?.versionId).toBe('product_3x4.blur');
		expect(picker.isChosen(row('med_a'), 'product_3x4.blur')).toBe(true);
		expect(picker.note().text).toBe('fm_pick_one_version');
		picker.choose();
		expect(modal.close).toHaveBeenCalledWith([
			{
				assetId: 'med_a',
				versionId: 'product_3x4.blur',
				name: 'med_a.jpg',
				thumbnailUrl: 'https://cdn.test/med_a.webp',
			},
		]);
		picker.toggle(row('med_a'), 'product_3x4.blur');
		expect(picker.chosen().size).toBe(0);
	});

	it('stops at the room left (D05); a one-image place swaps the choice instead (D06)', () => {
		const { picker } = setup(4, 2);
		picker.toggle(row('med_a'));
		picker.toggle(row('med_b'));
		expect(picker.note()).toEqual({ text: 'fm_pick_full', warn: true });
		picker.toggle(row('med_c'));
		expect(picker.chosen().size).toBe(2);
		expect(picker.note()).toEqual({ text: 'fm_pick_limit', warn: true });

		const single = setup(1, 0).picker;
		single.toggle(row('med_a'));
		single.toggle(row('med_b'));
		expect([...single.chosen().keys()]).toEqual(['med_b']);
	});

	it('refuses what the place can’t use, and says why (D03, D07, D11, D16)', () => {
		const { picker } = setup();
		const refused = (one: MediaFileRow) => {
			picker.toggle(one);
			return picker.note();
		};
		expect(refused(row('med_pdf', { kind: 'file', name: 'catalogue.pdf' }))).toEqual({
			text: 'fm_pick_not_image',
			warn: true,
		});
		expect(refused(row('med_raw', { kind: 'file', name: 'shoot.CR3' }))).toEqual({
			text: 'fm_pick_raw',
			warn: true,
		});
		expect(refused(row('med_new', { state: 'processing' }))).toEqual({ text: 'fm_pick_not_ready', warn: true });
		expect(refused(row('med_bare', { fitting: [] }))).toEqual({ text: 'fm_pick_no_version', warn: true });
		expect(picker.chosen().size).toBe(0);
		expect(isRawFile({ name: 'a.dng' })).toBe(true);
		expect(isRawFile({ name: 'a.jpg' })).toBe(false);
	});

	it('names each version for its chip', () => {
		const { picker } = setup();
		expect(picker.chips(row('med_a'))).toEqual([
			{ versionId: 'product_3x4.white', label: 'profile_fill_white' },
			{ versionId: 'product_3x4.blur', label: 'profile_fill_blur' },
		]);
	});

	it('Make one opens the photo’s Reprocess popup, then the new version is made and followed in the tray (D16)', async () => {
		const { picker, gateway, uploads } = setup();
		await picker.makeOne(row('med_bare', { fitting: [] }));
		expect(gateway.addVersions).toHaveBeenCalledWith('med_bare', {
			versions: [{ profileKey: 'product_3x4', fill: 'white' }],
		});
		expect(uploads.watchVersions).toHaveBeenCalledWith('Product 3:4 · White padding', ['med_bare']);
		expect(picker.note()).toEqual({ text: 'fm_pick_making', warn: true });
	});

	it('Upload inside the picker opens the upload popups over it, into the folder shown, asking for its profile (D10)', () => {
		const { picker, flow } = setup(6, 2, true);
		picker.openFolder('fld_banarasi');
		const input = { files: [new File(['x'], 'front.jpg', { type: 'image/jpeg' })], value: 'C:/front.jpg' };
		picker.filesPicked(input as unknown as HTMLInputElement);
		expect(input.value).toBe('');
		expect(flow.open).toHaveBeenCalledTimes(1);
		const [plan, targetId, place, popups, asked] = flow.open.mock.calls[0] as unknown[];
		expect((plan as { rows: { name: string }[] }).rows.map((row) => row.name)).toEqual(['front.jpg']);
		expect(targetId).toBe('fld_banarasi');
		expect(place).toBe('fm_my_files');
		expect(Object.keys(popups as object)).toEqual(
			expect.arrayContaining(['review', 'duplicate', 'onDemand', 'refused', 'overLimit', 'notes']),
		);
		expect(asked).toBe('product_3x4');

		// From Recent the files go into My files; nothing picked, nothing opens.
		picker.openNav('recent');
		picker.filesPicked({ files: [new File(['x'], 'a.jpg')], value: '' } as unknown as HTMLInputElement);
		expect(flow.open.mock.calls[1]?.[1]).toBeNull();
		picker.filesPicked({ files: [], value: '' } as unknown as HTMLInputElement);
		expect(flow.open).toHaveBeenCalledTimes(2);
	});

	it('New folder in the picker opens the shared popup for the folder shown (D10, A23)', () => {
		const { picker, modals, folderPopup } = setup();
		picker.openFolder('fld_banarasi');
		picker.sidebarUpload('new_folder');
		expect(modals.open).toHaveBeenCalledWith(FmNewFolder, expect.objectContaining({ windowClass: 'theme-modal' }));
		expect(folderPopup.start).toHaveBeenCalledWith({ parentId: 'fld_banarasi', place: 'fm_my_files' });
	});
});
