import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MediaLibraryGateway } from '@core/media-library/media-library.gateway';
import { MediaUploads } from '@core/media-library/media-uploads';
import { NotificationService } from '@data-access/services/notification.service';

import { FileManager, MEDIA_DRAG_TYPE } from './file-manager';
import { FmUploadFlow } from './fm-upload-flow';

vi.mock('@data-access/queries/media-profiles.queries', async (original) => ({
	...(await original<object>()),
	injectMediaProfilesQuery: () => ({ data: () => [] }),
}));

const folder = (id: string, extra: Record<string, unknown> = {}) => ({
	id,
	parentId: 'fld_b',
	name: `Folder ${id}`,
	files: 1,
	bytes: 1,
	starred: false,
	location: 'Product photos',
	daysLeft: null,
	ancestors: ['fld_b'],
	trashedAt: null,
	trashedFrom: null,
	...extra,
});
const file = (id: string, extra: Record<string, unknown> = {}) => ({
	id,
	name: `${id}.jpg`,
	kind: 'image',
	folderId: 'fld_b',
	usedOn: 0,
	starred: false,
	state: 'ready',
	thumbnailUrl: null,
	...extra,
});

interface Options {
	params?: Record<string, string>;
	folders?: unknown[];
	files?: unknown[];
	storage?: unknown;
	nightly?: unknown;
}

function setup(options: Options = {}) {
	const gateway = {
		zips: vi.fn(() => of({ zips: [] })),
		browse: vi.fn(() =>
			of({
				folder: { id: 'fld_b', name: 'Banarasi' },
				breadcrumb: [
					{ id: 'fld_p', name: 'Product photos' },
					{ id: 'fld_b', name: 'Banarasi' },
				],
				folders: options.folders ?? [folder('fld_w')],
				files: options.files ?? [
					file('med_1'),
					file('med_pdf', { name: 'chart.pdf', kind: 'file' }),
					file('med_up', { state: 'awaiting_upload' }),
				],
				total: 3,
				page: 1,
				pageSize: 200,
			}),
		),
		tree: vi.fn(() =>
			of({
				folders: [
					{ id: 'fld_p', parentId: null, name: 'Product photos', files: 0, bytes: 0 },
					{ id: 'fld_b', parentId: 'fld_p', name: 'Banarasi', files: 3, bytes: 10 },
					{ id: 'fld_w', parentId: 'fld_b', name: 'Wedding', files: 1, bytes: 1 },
				],
			}),
		),
		storage: vi.fn(() => of(options.storage ?? null)),
		nightlyCheck: vi.fn(() => of(options.nightly ?? null)),
		star: vi.fn(() => of({ starred: true })),
		fileAddress: vi.fn(() => of({ url: 'https://spaces.test/original?signed' })),
		move: vi.fn(() => of({ done: 1, inUse: [], undoId: null })),
		trash: vi.fn(() => of({ done: 1, inUse: [], undoId: null })),
		checkTrash: vi.fn(() => of({ inUse: [], total: 1, moving: 1, keptFolders: 0 })),
	};
	const instance = { start: vi.fn(async () => undefined) };
	let modalAnswer: unknown = undefined;
	const modals = {
		open: vi.fn(() => {
			const result = modalAnswer instanceof Error ? Promise.reject(modalAnswer) : Promise.resolve(modalAnswer);
			result.catch(() => undefined);
			return { componentInstance: instance, result };
		}),
		hasOpenModals: vi.fn(() => false),
		dismissAll: vi.fn(),
	};
	const uploads = {
		active: signal<Array<{ folderId: string | null; sent: number; bytes: number }>>([]),
		resumeZips: vi.fn(async () => undefined),
		resumeWith: vi.fn(() => true),
	};
	const flow = { open: vi.fn() };
	const router = { navigate: vi.fn() };
	const notifications = { showSuccess: vi.fn(), showError: vi.fn() };
	const params = new BehaviorSubject(convertToParamMap(options.params ?? { folder: 'fld_b' }));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient()),
			{ provide: MediaLibraryGateway, useValue: gateway },
			{ provide: MediaUploads, useValue: uploads },
			{ provide: NgbModal, useValue: modals },
			{ provide: NotificationService, useValue: notifications },
			{ provide: Router, useValue: router },
			{ provide: ActivatedRoute, useValue: { queryParamMap: params, snapshot: { queryParamMap: params.value } } },
			{
				provide: TranslocoService,
				useValue: {
					translate: (key: string, values?: Record<string, unknown>) =>
						values ? `${key} ${JSON.stringify(values)}` : key,
					getActiveLang: () => 'en',
					getTranslation: () => ({}),
				},
			},
			{
				provide: ToastrService,
				useValue: { success: vi.fn(() => ({ toastId: 1, onAction: of(undefined) })), remove: vi.fn() },
			},
		],
	});
	TestBed.overrideComponent(FileManager, {
		set: {
			imports: [],
			providers: [{ provide: FmUploadFlow, useValue: flow }],
			template:
				'<section #fmMain></section><ng-template #fmConfirm></ng-template><ng-template #fmInUse></ng-template><ng-template #fmRename></ng-template><ng-template #fmKeys></ng-template><ng-template #fmNewFolder></ng-template>',
		},
	});
	const fixture = TestBed.createComponent(FileManager);
	fixture.detectChanges();
	return {
		page: fixture.componentInstance,
		fixture,
		gateway,
		modals,
		instance,
		uploads,
		flow,
		router,
		notifications,
		params,
		answer: (value: unknown) => (modalAnswer = value),
	};
}

async function ready(page: FileManager) {
	for (let i = 0; i < 40 && (!page.result() || !page.tree.data()); i += 1)
		await new Promise((resolve) => setTimeout(resolve, 5));
}
const flush = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe('the Media page: what it shows (A08, A09, A45, R5-5)', () => {
	it('reads the folder, its place, the storage banner and the nightly check', async () => {
		const { page } = setup({ storage: { percent: 92, usedBytes: 1, planBytes: 2 }, nightly: { missingCount: 3 } });
		await ready(page);
		for (let i = 0; i < 20 && (!page.storage.data() || !page.missingPictures()); i += 1)
			await new Promise((resolve) => setTimeout(resolve, 5));
		expect(page.folderName()).toBe('Banarasi');
		expect(page.searchScope()).toBe('Banarasi');
		expect(page.empty()).toBe(false);
		expect(page.storageAlert()).toMatchObject({ percent: 92 });
		expect(page.missingPictures()).toMatchObject({ missingCount: 3 });
		expect(page.herePlace()).toBe('fm_my_files › Product photos › Banarasi');
		expect(page.uploadTargetId()).toBe('fld_b');
		expect(page.uploadPlace()).toBe('Banarasi');
		expect(page.selectedFolders().size).toBe(0);
	});

	it('shows no banner below the line, an empty folder, and My files in the other views', async () => {
		const { page } = setup({
			storage: { percent: 40 },
			nightly: { missingCount: 0 },
			folders: [],
			files: [],
			params: { view: 'recent' },
		});
		await ready(page);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(page.storageAlert()).toBeNull();
		expect(page.missingPictures()).toBeNull();
		expect(page.empty()).toBe(true);
		expect(page.searchScope()).toBeNull();
		expect(page.uploadTargetId()).toBeNull();
		expect(page.uploadPlace()).toBe('fm_my_files');
		expect(page.herePlace()).toBe('fm_my_files');
		page.openStorageDetails();
	});

	it('moves between folders, categories and whose favourites, through the address', () => {
		const { page, router } = setup();
		page.openFolder('fld_w');
		expect(router.navigate).toHaveBeenLastCalledWith(
			[],
			expect.objectContaining({ queryParams: { view: null, folder: 'fld_w', category: null, q: null } }),
		);
		page.openCategory('images' as never);
		expect(router.navigate).toHaveBeenLastCalledWith(
			[],
			expect.objectContaining({ queryParams: { view: null, folder: null, category: 'images', q: null } }),
		);
		page.setWho('everyone');
		expect(router.navigate).toHaveBeenLastCalledWith(
			[],
			expect.objectContaining({ queryParams: { who: 'everyone' } }),
		);
		page.setWho('mine');
		expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { who: null } }));
	});

	it('works out each folder card’s upload progress, through its parents', () => {
		const { page, uploads } = setup();
		expect(page.cardProgress().size).toBe(0);
		uploads.active.set([
			{ folderId: 'fld_w', sent: 50, bytes: 100 },
			{ folderId: 'fld_b', sent: 0, bytes: 0 },
			{ folderId: null, sent: 1, bytes: 2 },
		]);
		return ready(page).then(() => {
			const progress = page.cardProgress();
			expect(progress.get('fld_w')).toBe(50);
			expect(progress.get('fld_p')).toBe(50);
			uploads.active.set([{ folderId: 'fld_x', sent: 0, bytes: 0 }]);
			expect(page.cardProgress().get('fld_x')).toBe(0);
		});
	});
});

describe('the Media page: menus and opening items (A20–A22, A31, A35, A47)', () => {
	it('chooses each menu line for the picked folder or file', async () => {
		const { page, modals, gateway, router } = setup();
		await ready(page);
		const open = vi
			.spyOn(window, 'open')
			.mockReturnValue({ opener: {}, location: { href: '' }, close: vi.fn() } as never);
		for (const key of [
			'open',
			'new_inside',
			'preview',
			'download',
			'share',
			'details',
			'reprocess',
			'replace',
			'star',
			'move',
		])
			await page.menuChoose(key as never);
		expect(modals.open).not.toHaveBeenCalled();
		page.selection.set({ folders: new Set(['fld_w']), files: new Set() } as never);
		await page.menuChoose('open');
		expect(router.navigate).toHaveBeenLastCalledWith(
			[],
			expect.objectContaining({ queryParams: expect.objectContaining({ folder: 'fld_w' }) }),
		);
		await page.menuChoose('new_inside');
		expect(modals.open).toHaveBeenCalledTimes(1);
		await page.menuChoose('star');
		await page.menuChoose('unstar');
		expect(gateway.star).toHaveBeenCalledWith({ targetType: 'folder', targetId: 'fld_w', starred: false });
		page.selection.set({ folders: new Set(), files: new Set(['med_1']) } as never);
		await page.menuChoose('preview');
		await page.menuChoose('download_original');
		expect(gateway.fileAddress).toHaveBeenCalled();
		expect(open).toHaveBeenCalled();
		await page.menuChoose('share');
		await page.menuChoose('details');
		await page.menuChoose('star');
		expect(gateway.star).toHaveBeenLastCalledWith({ targetType: 'file', targetId: 'med_1', starred: true });
		const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
		await page.menuChoose('replace');
		expect(click).toHaveBeenCalled();
		expect(page.menu()).toBeNull();
	});

	it('opens a folder, a photo’s details or another file on a double-click', async () => {
		const { page, modals, gateway, router } = setup();
		await ready(page);
		vi.spyOn(window, 'open').mockReturnValue({ opener: {}, location: { href: '' }, close: vi.fn() } as never);
		await page.activate({ type: 'folder', id: 'fld_w' } as never);
		expect(router.navigate).toHaveBeenCalled();
		await page.activate({ type: 'file', id: 'med_up' } as never);
		await page.activate({ type: 'file', id: 'gone' } as never);
		expect(modals.open).not.toHaveBeenCalled();
		await page.activate({ type: 'file', id: 'med_1' } as never);
		expect(modals.open).toHaveBeenCalledTimes(1);
		await page.activate({ type: 'file', id: 'med_pdf' } as never);
		expect(gateway.fileAddress).toHaveBeenCalled();
	});

	it('follows what the details popup asks for when it closes', async () => {
		const { page, answer, gateway } = setup();
		await ready(page);
		vi.spyOn(window, 'open').mockReturnValue({ opener: {}, location: { href: '' }, close: vi.fn() } as never);
		const row = file('med_1') as never;
		answer(undefined);
		page.openDetails(row);
		answer({ kind: 'download' });
		page.openDetails(row);
		answer({ kind: 'share' });
		page.openDetails(row);
		answer(new Error('closed'));
		page.openDetails(row);
		await flush();
		expect(gateway.fileAddress).toHaveBeenCalled();
	});

	it('picks a replacement photo only when one is chosen', async () => {
		const { page } = setup();
		let made: HTMLInputElement | null = null;
		vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
			made = this;
		});
		const replace = vi.spyOn(page, 'openReplace').mockResolvedValue(undefined);
		page.pickReplacement(file('med_1') as never);
		(made as unknown as HTMLInputElement).dispatchEvent(new Event('change'));
		expect(replace).not.toHaveBeenCalled();
		const chosen = new File(['x'], 'new.jpg', { type: 'image/jpeg' });
		Object.defineProperty(made as unknown as HTMLInputElement, 'files', { value: [chosen] });
		(made as unknown as HTMLInputElement).dispatchEvent(new Event('change'));
		expect(replace).toHaveBeenCalledWith(expect.objectContaining({ id: 'med_1' }), chosen);
	});

	it('opens Share and refreshes when it closes, and Storage details only with a summary', async () => {
		const { page, modals, answer } = setup({ storage: { percent: 10 } });
		await ready(page);
		answer(new Error('closed'));
		page.openShare(file('med_1') as never);
		answer('done');
		page.openShare(file('med_1') as never);
		for (let i = 0; i < 20 && !page.storage.data(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
		page.openStorageDetails();
		expect(modals.open).toHaveBeenCalledTimes(3);
	});

	it('opens Move to under its button', async () => {
		const { page, fixture } = setup();
		await ready(page);
		fixture.detectChanges();
		const button = document.createElement('button');
		page.openMoveMenu({ clientX: 5, clientY: 5, stopPropagation: vi.fn(), currentTarget: button } as never);
		expect(page.menu()).toMatchObject({ moveOnly: true, lines: [] });
	});
});

describe('the Media page: drags and uploads (A28, A29, B16, S12)', () => {
	const dataTransfer = (types: string[], extra: Record<string, unknown> = {}) => ({
		types,
		dropEffect: 'none',
		...extra,
	});
	const dragEvent = (types: string[], extra: Record<string, unknown> = {}) =>
		({ dataTransfer: dataTransfer(types, extra), preventDefault: vi.fn() }) as unknown as DragEvent;

	it('leaves a folder card only when the pointer really left it', () => {
		const { page } = setup();
		const card = document.createElement('div');
		const inner = document.createElement('span');
		card.append(inner);
		page.dropOn.set('fld_w');
		page.dragLeave(folder('fld_w') as never, { currentTarget: card, relatedTarget: inner } as never);
		expect(page.dropOn()).toBe('fld_w');
		page.dragLeave(folder('fld_x') as never, { currentTarget: card, relatedTarget: null } as never);
		expect(page.dropOn()).toBe('fld_w');
		page.dragLeave(folder('fld_w') as never, { currentTarget: null, relatedTarget: null } as never);
		expect(page.dropOn()).toBeNull();
		page.dropOn.set('fld_w');
		expect(page.dropName()).toBeTypeOf('string');
	});

	it('takes files from the computer in a folder view, and never Media’s own items', async () => {
		const { page, flow } = setup();
		await ready(page);
		page.dropEnter(dragEvent([MEDIA_DRAG_TYPE, 'Files']));
		expect(page.dropping()).toBe(false);
		page.dropOver(dragEvent(['text/plain']));
		page.dropEnter(dragEvent(['Files']));
		page.dropEnter(dragEvent(['Files']));
		const over = dragEvent(['Files']);
		page.dropOver(over);
		expect((over as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('copy');
		page.dropOver({ dataTransfer: null, preventDefault: vi.fn() } as never);
		page.dropLeave();
		expect(page.dropping()).toBe(true);
		page.dropLeave();
		expect(page.dropping()).toBe(false);
		page.dropLeave();
		await page.dropFiles(dragEvent(['Files']));
		page.dropEnter(dragEvent(['Files']));
		const one = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
		await page.dropFiles(dragEvent(['Files'], { items: [{ kind: 'file' }, { kind: 'string' }], files: [one] }));
		expect(page.dropping()).toBe(false);
		page.dropEnter(dragEvent(['Files']));
		await page.dropFiles({ dataTransfer: null, preventDefault: vi.fn() } as never);
		expect(flow.open).not.toHaveBeenCalled();
	});

	it('picks files, a folder or a cut-off upload’s file, and opens the upload review once its popups are there', async () => {
		const { page, flow, uploads, modals } = setup();
		await ready(page);
		const input = (files: File[]) => ({ files, value: 'x', click: vi.fn() }) as unknown as HTMLInputElement;
		page.filesPicked(input([new File(['x'], 'a.jpg')]));
		page.folderPicked(input([]));
		expect(flow.open).not.toHaveBeenCalled();
		const popups = { a: 1 };
		Object.defineProperty(page, 'uploadPopups', {
			value: () => ({ popups: () => popups, onDemandTemplate: () => null, refusedTemplate: () => null }),
		});
		page.filesPicked(input([new File(['x'], 'a.jpg')]));
		expect(flow.open).toHaveBeenCalledWith(expect.anything(), 'fld_b', expect.any(String), popups);
		page.filesPicked({ files: null, value: '' } as never);
		const filesBox = { nativeElement: { click: vi.fn() } };
		const folderBox = { nativeElement: { click: vi.fn() } };
		Object.defineProperty(page, 'pickFilesInput', { value: () => filesBox });
		Object.defineProperty(page, 'pickFolderInput', { value: () => folderBox });
		page.uploadChoice('files');
		page.uploadChoice('folder');
		expect(filesBox.nativeElement.click).toHaveBeenCalled();
		expect(folderBox.nativeElement.click).toHaveBeenCalled();
		page.uploadChoice('new_folder');
		expect(modals.open).toHaveBeenCalled();
		Object.defineProperty(page, 'pickFolderInput', { value: () => undefined });
		page.uploadChoice('folder');
		const entry = { assetId: 'med_cut', name: 'big.jpg' } as never;
		const picker = input([]);
		page.chooseResume(entry, picker);
		expect(picker.click).toHaveBeenCalled();
		page.resumePicked(input([]));
		page.resumePicked(input([new File(['x'], 'big.jpg')]));
		page.chooseResume(entry, picker);
		page.resumePicked(input([new File(['x'], 'big.jpg')]));
		expect(uploads.resumeWith).toHaveBeenCalledTimes(1);
		uploads.resumeWith.mockReturnValueOnce(false);
		page.chooseResume(entry, picker);
		page.resumePicked(input([new File(['x'], 'other.jpg')]));
		expect(page.resumeRefused()).toBe('med_cut');
	});

	it('uploads a pasted picture here, but not while typing or with a popup open', async () => {
		const { page, flow, modals } = setup();
		await ready(page);
		const picture = new File(['x'], 'image.png', { type: 'image/png' });
		const paste = (files: File[], target: EventTarget = document.body) =>
			({ target, clipboardData: { files }, preventDefault: vi.fn() }) as unknown as ClipboardEvent;
		page.onPaste(paste([picture], document.createElement('input')));
		modals.hasOpenModals.mockReturnValueOnce(true);
		page.onPaste(paste([picture]));
		page.onPaste(paste([new File(['x'], 'notes.txt', { type: 'text/plain' })]));
		page.onPaste({ target: document.body, clipboardData: null, preventDefault: vi.fn() } as never);
		page.onPaste(paste([picture]));
		expect(flow.open).not.toHaveBeenCalled();
		Object.defineProperty(page, 'uploadPopups', { value: () => ({ popups: () => ({}) }) });
		page.onPaste(paste([picture]));
		expect(flow.open).toHaveBeenCalledTimes(1);
	});
});
