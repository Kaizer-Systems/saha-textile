import { webcrypto } from 'node:crypto';

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, NEVER, Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaLibraryGateway, type MediaFileRow, type MediaFolderRow } from '@core/media-library/media-library.gateway';
import { MediaUploads } from '@core/media-library/media-uploads';
import { NotificationService } from '@data-access/services/notification.service';

import { FileManager, MEDIA_DRAG_TYPE } from './file-manager';
import { FmUploadFlow } from './fm-upload-flow';

const h = vi.hoisted(() => ({ heic: vi.fn<(file: File) => Promise<File>>() }));
vi.mock('@core/media-library/heic', () => ({ heicToJpeg: (file: File) => h.heic(file) }));
vi.mock('@data-access/queries/media-profiles.queries', async (original) => ({
	...(await original<object>()),
	injectMediaProfilesQuery: () => ({ data: () => [] }),
}));

const folder = (id: string, extra: Record<string, unknown> = {}) =>
	({
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
	}) as unknown as MediaFolderRow;
const file = (id: string, extra: Record<string, unknown> = {}) =>
	({
		id,
		name: `${id}.jpg`,
		kind: 'image',
		contentType: 'image/jpeg',
		bytes: 1000,
		width: 3000,
		height: 4000,
		folderId: 'fld_b',
		usedOn: 0,
		starred: false,
		state: 'ready',
		thumbnailUrl: null,
		...extra,
	}) as unknown as MediaFileRow;

/** An API refusal with its own words. */
const refusal = () => ({ error: { code: 'nope', message: 'Not allowed here.' } });
const TEMPLATE = {} as never;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);

interface Options {
	params?: Record<string, string>;
	browse?: 'never' | Record<string, unknown>;
	tree?: 'never';
	answers?: unknown[];
	bare?: boolean;
	popups?: boolean;
	storageCheck?: unknown[];
	gateway?: Record<string, unknown>;
}

function setup(options: Options = {}) {
	const browse = {
		folder: { id: 'fld_b', name: 'Banarasi' },
		breadcrumb: [{ id: 'fld_b', name: 'Banarasi' }],
		folders: [folder('fld_w')],
		files: [file('med_1'), file('med_pdf', { name: 'chart.pdf', kind: 'file' })],
		total: 2,
		page: 1,
		pageSize: 200,
		...(options.browse === 'never' ? {} : options.browse),
	};
	const gateway = {
		zips: vi.fn(() => of({ zips: [] })),
		browse: vi.fn(() => (options.browse === 'never' ? NEVER : of(browse))),
		tree: vi.fn(() =>
			options.tree === 'never'
				? NEVER
				: of({
						folders: [
							{ id: 'fld_b', parentId: null, name: 'Banarasi', files: 3, bytes: 10 },
							{ id: 'fld_w', parentId: 'fld_b', name: 'Wedding', files: 1, bytes: 1 },
						],
					}),
		),
		storage: vi.fn(() => of(null)),
		nightlyCheck: vi.fn(() => of(null)),
		star: vi.fn(() => of({ starred: true })),
		details: vi.fn(() =>
			of({ folderPath: ['Banarasi'], bytes: 10, width: 3000, height: 4000, versions: [], usedOn: [] }),
		),
		fileAddress: vi.fn(() => of({ url: 'https://spaces.test/original?signed' })),
		zipPlan: vi.fn(() => of({ name: 'Banarasi.zip', files: 2, bytes: 20 })),
		createZip: vi.fn(() => of({ id: 'zip_1' })),
		addVersions: vi.fn(() => of({ added: 1, skipped: [] })),
		addVersionsToMany: vi.fn(() => of({ added: 2, skipped: [] })),
		move: vi.fn(() => of({ done: 1, inUse: [], undoId: 'und_1' })),
		trash: vi.fn(() => of({ done: 1, inUse: [], undoId: 'und_1' })),
		checkTrash: vi.fn(() => of({ inUse: [], total: 1, moving: 1, keptFolders: 0 })),
		renameFolder: vi.fn(() => of({ done: 1, inUse: [], undoId: null })),
		renameFile: vi.fn(() => of({ done: 1, inUse: [], undoId: 'und_r' })),
		undo: vi.fn(() => of({ done: 1, inUse: [], undoId: null })),
		restore: vi.fn(() => of({ done: 1, inUse: [], undoId: null })),
		deleteForever: vi.fn(() => of({ done: 1, inUse: [], undoId: null })),
		...options.gateway,
	};
	const answers = [...(options.answers ?? [])];
	const instance = { start: vi.fn(async () => undefined) };
	const modals = {
		open: vi.fn(() => {
			const next = answers.length ? answers.shift() : undefined;
			const result = next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
			result.catch(() => undefined);
			return { componentInstance: instance, result, shown: of(undefined) };
		}),
		hasOpenModals: vi.fn(() => false),
	};
	const uploads = {
		active: signal([]),
		resumeZips: vi.fn(async () => undefined),
		resumeWith: vi.fn(() => true),
		replacePhoto: vi.fn(async () => undefined),
		refocus: vi.fn(async () => undefined),
		watchZip: vi.fn(),
		watchVersions: vi.fn(),
		operation: vi.fn(
			async (_label: string, _icon: string, parts: number[], run: (index: number) => Promise<unknown>) =>
				Promise.all(parts.map((_, index) => run(index))),
		),
	};
	const checks = [...(options.storageCheck ?? [])];
	const flow = { open: vi.fn(), storageCheck: vi.fn(async () => (checks.length ? checks.shift() : 'res_1')) };
	const router = { navigate: vi.fn() };
	const notifications = { showSuccess: vi.fn(), showError: vi.fn() };
	const toasts: Array<Subject<void>> = [];
	const toastr = {
		success: vi.fn(() => {
			const onAction = new Subject<void>();
			toasts.push(onAction);
			return { toastId: toasts.length, onAction };
		}),
		warning: vi.fn(),
		remove: vi.fn(),
	};
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
			{ provide: ToastrService, useValue: toastr },
		],
	});
	TestBed.overrideComponent(FileManager, {
		set: {
			imports: [],
			providers: [{ provide: FmUploadFlow, useValue: flow }],
			template: options.bare
				? ''
				: '<section #fmMain></section><ng-template #fmConfirm></ng-template><ng-template #fmInUse></ng-template><ng-template #fmRename></ng-template><ng-template #fmKeys></ng-template>',
		},
	});
	const fixture = TestBed.createComponent(FileManager);
	const page = fixture.componentInstance;
	const shown = options.popups ?? true;
	Object.defineProperty(page, 'uploadPopups', {
		value: () => ({
			popups: () => (shown ? {} : null),
			onDemandTemplate: () => (shown ? TEMPLATE : undefined),
			refusedTemplate: () => (shown ? TEMPLATE : undefined),
		}),
	});
	fixture.detectChanges();
	return { page, fixture, gateway, modals, instance, uploads, flow, router, notifications, toastr, toasts };
}

async function ready(page: FileManager) {
	for (let i = 0; i < 40 && (!page.result() || !page.tree.data()); i += 1)
		await new Promise((resolve) => setTimeout(resolve, 5));
}
async function loaded(page: FileManager) {
	for (let i = 0; i < 40 && !page.result(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
}
const settle = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};
const pickOnly = (page: FileManager, folders: string[], files: string[]) =>
	page.selection.set({ folders: new Set(folders), files: new Set(files) });
const key = (extra: Record<string, unknown>) =>
	({
		target: document.body,
		preventDefault: vi.fn(),
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		...extra,
	}) as unknown as KeyboardEvent;

const savedUrl = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
beforeEach(() => {
	h.heic.mockReset();
	vi.stubGlobal('crypto', webcrypto);
	URL.createObjectURL = vi.fn(() => 'blob:next');
	URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
	URL.createObjectURL = savedUrl.create;
	URL.revokeObjectURL = savedUrl.revoke;
});

describe('the Media page: the last cases', () => {
	it('before anything is read: no name, no rows, no picks, no drag, no trash to empty', async () => {
		const { page, modals, router } = setup({ params: {}, browse: 'never', tree: 'never' });
		await settle();
		expect(page.folderName()).toBeNull();
		expect(page.ordered()).toEqual([]);
		pickOnly(page, ['fld_gone'], ['med_gone']);
		expect(page.chosen()).toEqual({ folders: [], files: [] });
		page.toggleAll(true);
		expect(page.selected().size).toBe(0);
		page.toggleAll(false);
		expect([...page.moveBlocked()]).toEqual(['fld_gone']);
		expect(page.uploadTargetId()).toBeNull();
		expect(page.draggedFiles().size).toBe(0);
		expect(page.dropName()).toBeNull();
		page.openStorageDetails();
		await page.emptyTrash();
		expect(modals.open).not.toHaveBeenCalled();

		page.dragStart({ type: 'folder', id: 'fld_x' }, { dataTransfer: null } as unknown as DragEvent);
		page.dragStart({ type: 'file', id: 'med_x' }, { dataTransfer: null } as unknown as DragEvent);
		expect(page.dragging()).toMatchObject({ folderIds: [], fileIds: [] });
		const over = { dataTransfer: { types: [MEDIA_DRAG_TYPE], dropEffect: '' }, preventDefault: vi.fn() };
		page.dragOver(folder('fld_w'), over as unknown as DragEvent);
		expect(page.dropOn()).toBe('fld_w');
		await page.drop(folder('fld_other'), { preventDefault: vi.fn() } as unknown as DragEvent);
		expect(router.navigate).not.toHaveBeenCalled();
		page.dragOver(folder('fld_w'), over as unknown as DragEvent);
		page.trackDrag({ clientX: 1, clientY: 1 } as DragEvent);
		expect(page.ghostAt()).toBeNull();
		page.onKey(key({ key: 'ArrowDown' }));
		expect(page.chosenCount()).toBe(1);
		expect(page.who()).toBe('mine');
	});

	it('reads the address: Clean up lists as a folder, everyone’s favourites, and plain words go back to the defaults', async () => {
		const clean = setup({ params: { view: 'clean' } });
		expect(clean.page.query().view).toBe('folder');
		const everyone = setup({ params: { view: 'favourites', who: 'everyone' } });
		expect(everyone.page.who()).toBe('everyone');
		expect(everyone.page.showLocation()).toBe(true);
		const plain = setup();
		expect(plain.page.showLocation()).toBe(false);
		plain.page.openNav('folder');
		plain.page.setSort('name');
		plain.page.setDisplay('list');
		plain.page.setSort('newest');
		const asked = plain.router.navigate.mock.calls.map((call) => (call as unknown[])[1]);
		expect(asked).toEqual([
			expect.objectContaining({ queryParams: { view: null, folder: null, category: null, q: null, who: null } }),
			expect.objectContaining({ queryParams: { sort: null } }),
			expect.objectContaining({ queryParams: { show: null } }),
			expect.objectContaining({ queryParams: { sort: 'newest' } }),
		]);
		vi.useFakeTimers();
		plain.page.typed('   ');
		vi.advanceTimersByTime(300);
		expect(plain.router.navigate).toHaveBeenLastCalledWith(
			[],
			expect.objectContaining({ queryParams: { q: null } }),
		);
	});

	it('Trash orders nothing for the keys; menus and Move here read what is picked', async () => {
		const trash = setup({ params: { view: 'trash' } });
		await loaded(trash.page);
		expect(trash.page.ordered()).toEqual([]);

		const { page } = setup({
			browse: {
				folders: [folder('fld_top', { parentId: null, starred: true })],
				files: [file('med_s', { starred: true }), file('med_up', { state: 'awaiting_upload' })],
			},
		});
		await ready(page);
		pickOnly(page, ['fld_top'], []);
		expect(page.moveHere()).toBeNull();
		expect(page.menuLines()).toContain('unstar');
		pickOnly(page, [], []);
		expect(page.menuLines()).toEqual([]);
		pickOnly(page, [], ['med_s']);
		expect(page.menuLines()).toContain('unstar');
		pickOnly(page, [], ['med_up']);
		expect(page.menuLines()).toEqual(['rename', 'move', 'star', 'divider', 'trash']);
	});

	it('menus open under their button, never without a page to place them on, and close on a click', async () => {
		const bare = setup({ bare: true });
		const button = document.createElement('button');
		const click = {
			stopPropagation: vi.fn(),
			clientX: 4,
			clientY: 4,
			currentTarget: button,
		} as unknown as MouseEvent;
		bare.page.openMoveMenu(click);
		expect(bare.page.menu()).toBeNull();

		const { page } = setup();
		await ready(page);
		page.openMenu({
			item: { type: 'file', id: 'med_1' },
			event: {
				preventDefault: vi.fn(),
				stopPropagation: vi.fn(),
				clientX: 4,
				clientY: 4,
			} as unknown as MouseEvent,
			anchor: button,
		});
		expect(page.menu()?.lines[0]).toBe('details');
		page.closeMenu();
		expect(page.menu()).toBeNull();
		page.openMoveMenu(click);
		expect(page.menu()?.moveOnly).toBe(true);
	});

	it('the menu’s Rename, Download as .zip, Add a version and Move to Trash', async () => {
		const box = document.createElement('input');
		box.id = 'fm_rename_name';
		document.body.appendChild(box);
		const select = vi.spyOn(box, 'select');
		const { page, modals, gateway, flow, uploads } = setup({
			browse: {
				folders: [folder('fld_w')],
				files: [file('README', { name: 'README' }), file('env', { name: '.env' })],
			},
		});
		await ready(page);
		pickOnly(page, [], ['README']);
		await page.menuChoose('rename');
		expect(page.renaming()).toMatchObject({ type: 'file', base: 'README', extension: '' });
		expect(select).toHaveBeenCalled();
		pickOnly(page, [], ['env']);
		page.openRename();
		expect(page.renaming()).toMatchObject({ base: '.env', extension: '' });
		pickOnly(page, ['fld_w'], []);
		page.openRename();
		expect(page.renaming()).toMatchObject({ type: 'folder', base: 'Folder fld_w', extension: '' });
		pickOnly(page, [], []);
		const opened = modals.open.mock.calls.length;
		page.openRename();
		expect(modals.open).toHaveBeenCalledTimes(opened);
		box.remove();

		pickOnly(page, ['fld_w'], ['README']);
		await page.menuChoose('zip');
		expect(gateway.zipPlan).toHaveBeenCalledWith({ folderIds: ['fld_w'], fileIds: ['README'] });
		expect(gateway.createZip).toHaveBeenCalledWith({
			folderIds: ['fld_w'],
			fileIds: ['README'],
			reservationId: 'res_1',
		});
		expect(uploads.watchZip).toHaveBeenCalledWith({ id: 'zip_1' });

		pickOnly(page, [], ['README']);
		await page.menuChoose('reprocess');
		pickOnly(page, ['fld_w'], []);
		await page.menuChoose('reprocess');
		expect(gateway.details).toHaveBeenCalledTimes(1);

		await page.menuChoose('trash');
		expect(gateway.trash).toHaveBeenCalledWith({ folderIds: ['fld_w'], fileIds: [] });
		expect(flow.storageCheck).toHaveBeenCalledTimes(1);
	});

	it('Rename is not offered without its popup, and the keys list does not open without its own', async () => {
		const { page, modals } = setup({ bare: true });
		await ready(page);
		pickOnly(page, [], ['med_1']);
		page.openRename();
		page.openKeys();
		expect(modals.open).not.toHaveBeenCalled();
	});

	it('the details popup can lead to Add a version or to the focal point', async () => {
		const { page, gateway, instance } = setup({
			answers: [{ kind: 'add_versions', versions: [{ id: 'product_3x4.as_is', state: 'ready' }] }, undefined],
		});
		await ready(page);
		page.openDetails(file('med_1'));
		await settle();
		expect(instance.start).toHaveBeenCalledWith(
			expect.objectContaining({ versions: [{ id: 'product_3x4.as_is', state: 'ready' }] }),
		);
		const focal = setup({ answers: [{ kind: 'focal' }, new Error('closed')] });
		await ready(focal.page);
		focal.page.openDetails(file('med_1'));
		await settle();
		expect(focal.gateway.fileAddress).toHaveBeenCalledWith('med_1', 'view');
		expect(gateway.fileAddress).not.toHaveBeenCalled();
	});

	describe('Replace (C05 → C08)', () => {
		const bitmap = (size: { width: number; height: number } | null) =>
			vi.stubGlobal(
				'createImageBitmap',
				size
					? async () => ({ ...size, close: () => undefined })
					: async () => {
							throw new Error('cannot decode');
						},
			);

		it('a JPEG: checked, stored, sent with its hash and hold, followed, and its preview let go later', async () => {
			bitmap({ width: 3000, height: 4000 });
			const timers = vi.spyOn(globalThis, 'setTimeout');
			const { page, uploads, flow, instance, modals } = setup({ answers: ['replace'] });
			await ready(page);
			const picked = new File([JPEG], 'new-front.jpg', { type: 'image/jpeg' });
			await page.openReplace(file('med_1'), picked);
			expect(instance.start).toHaveBeenCalledWith(
				expect.objectContaining({
					next: expect.objectContaining({
						name: 'new-front.jpg',
						contentType: 'image/jpeg',
						preview: 'blob:next',
					}),
				}),
			);
			expect(flow.storageCheck).toHaveBeenCalledWith('replace', expect.any(Number), 1, expect.any(String), {
				onDemand: TEMPLATE,
				refused: TEMPLATE,
			});
			expect(uploads.replacePhoto).toHaveBeenCalledWith(
				expect.objectContaining({
					fileId: 'med_1',
					request: expect.objectContaining({
						sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
						reservationId: 'res_1',
					}),
				}),
			);
			expect(modals.open).toHaveBeenCalledTimes(2);
			expect(instance.start).toHaveBeenLastCalledWith('med_1', 'med_1.jpg', 'new-front.jpg');
			const later = timers.mock.calls.find((call) => call[1] === 60_000);
			(later?.[0] as () => void)();
			expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:next');
		});

		it('a HEIC, by its name or by its bytes, becomes a JPEG first; a closed popup stops there', async () => {
			bitmap({ width: 3000, height: 4000 });
			h.heic.mockImplementation(
				async (picked) => new File([JPEG], picked.name.replace(/\.heic$/, '.jpg'), { type: 'image/jpeg' }),
			);
			const { page, uploads, instance } = setup({ answers: [undefined, new Error('closed')] });
			await ready(page);
			await page.openReplace(file('med_1'), new File([JPEG], 'named.heic', { type: 'image/heic' }));
			await page.openReplace(file('med_1'), new File([new Uint8Array(16)], 'bytes.heic', { type: 'image/heic' }));
			expect(h.heic).toHaveBeenCalledTimes(2);
			expect(instance.start).toHaveBeenCalledWith(
				expect.objectContaining({
					next: expect.objectContaining({ name: 'bytes.heic', contentType: 'image/jpeg' }),
				}),
			);
			expect(uploads.replacePhoto).not.toHaveBeenCalled();
		});

		it('a photo of no known kind keeps the type it came with, or is taken as a JPEG', async () => {
			bitmap({ width: 3000, height: 4000 });
			const { page, instance } = setup({ answers: [undefined, undefined] });
			await ready(page);
			await page.openReplace(file('med_1'), new File([new Uint8Array(16)], 'scan.odd', { type: 'image/x-odd' }));
			expect(instance.start).toHaveBeenLastCalledWith(
				expect.objectContaining({ next: expect.objectContaining({ contentType: 'image/x-odd' }) }),
			);
			await page.openReplace(file('med_1'), new File([new Uint8Array(16)], 'scan.odd'));
			expect(instance.start).toHaveBeenLastCalledWith(
				expect.objectContaining({ next: expect.objectContaining({ contentType: 'image/jpeg' }) }),
			);
		});

		it('says so when the photo cannot be read, and writes no preview', async () => {
			bitmap(null);
			const { page, notifications, gateway } = setup();
			await ready(page);
			await page.openReplace(file('med_1'), new File([new Uint8Array(16)], 'broken.jpg', { type: 'image/jpeg' }));
			expect(notifications.showError).toHaveBeenCalledWith('fm_unreadable_photo');
			expect(gateway.details).not.toHaveBeenCalled();
			expect(URL.createObjectURL).not.toHaveBeenCalled();
		});

		it('stops without the storage popups, or when storage says no', async () => {
			bitmap({ width: 3000, height: 4000 });
			const none = setup({ answers: ['replace'], popups: false });
			await ready(none.page);
			await none.page.openReplace(file('med_1'), new File([JPEG], 'a.jpg', { type: 'image/jpeg' }));
			expect(none.flow.storageCheck).not.toHaveBeenCalled();
			const refused = setup({ answers: ['replace'], storageCheck: [false] });
			await ready(refused.page);
			await refused.page.openReplace(file('med_1'), new File([JPEG], 'a.jpg', { type: 'image/jpeg' }));
			expect(refused.uploads.replacePhoto).not.toHaveBeenCalled();
		});

		it('sends no hash where the browser cannot count one, and no hold when none was needed', async () => {
			bitmap({ width: 3000, height: 4000 });
			vi.stubGlobal('crypto', {});
			const { page, uploads } = setup({ answers: ['replace'], storageCheck: [null] });
			await ready(page);
			await page.openReplace(file('med_1'), new File([JPEG], 'a.jpg', { type: 'image/jpeg' }));
			const request = (uploads.replacePhoto.mock.calls[0] as unknown as [{ request: object }])[0].request;
			expect(request).not.toHaveProperty('sha256');
			expect(request).not.toHaveProperty('reservationId');
		});

		it('says what went wrong, in the API’s words when it gave some', async () => {
			bitmap({ width: 3000, height: 4000 });
			const { page, notifications } = setup({
				gateway: {
					details: vi
						.fn()
						.mockReturnValueOnce(throwError(refusal))
						.mockReturnValueOnce(throwError(() => new Error('down'))),
				},
			});
			await ready(page);
			await page.openReplace(file('med_1'), new File([JPEG], 'a.jpg', { type: 'image/jpeg' }));
			await page.openReplace(file('med_1'), new File([JPEG], 'a.jpg', { type: 'image/jpeg' }));
			expect(notifications.showError.mock.calls).toEqual([['Not allowed here.'], ['fm_action_failed']]);
		});
	});

	describe('focal point (S10, C06)', () => {
		const details = (extra: Record<string, unknown>) => ({
			details: vi.fn(() => of({ width: 3000, height: 4000, versions: [], ...extra })),
		});

		it('nothing to place on a photo with no size', async () => {
			for (const size of [{ width: null }, { height: null }]) {
				const { page, gateway } = setup({ gateway: details(size) });
				await ready(page);
				await page.openFocal(file('med_1'));
				expect(gateway.fileAddress).not.toHaveBeenCalled();
			}
		});

		it('saves the point and says whether crops are remade; a closed popup saves nothing', async () => {
			const crops = setup({
				answers: [{ focal: { x: 0.4, y: 0.3 } }],
				gateway: details({ focal: { x: 0.5, y: 0.5 }, versions: [{ profileKey: 'hero', fill: 'crop' }] }),
			});
			await ready(crops.page);
			await crops.page.openFocal(file('med_1'));
			expect(crops.instance.start).toHaveBeenCalledWith(
				expect.objectContaining({ focal: { x: 0.5, y: 0.5 }, crops: ['hero'] }),
			);
			expect(crops.uploads.refocus).toHaveBeenCalledWith('med_1', 'med_1.jpg', { x: 0.4, y: 0.3 });
			expect(crops.toastr.success).toHaveBeenCalledWith('fm_focal_saved_remaking');

			const plain = setup({ answers: [{ focal: null }], gateway: details({}) });
			await ready(plain.page);
			await plain.page.openFocal(file('med_1'));
			expect(plain.instance.start).toHaveBeenCalledWith(expect.objectContaining({ focal: null, crops: [] }));
			expect(plain.toastr.success).toHaveBeenCalledWith('fm_focal_saved');

			const closed = setup({ answers: [new Error('closed')], gateway: details({}) });
			await ready(closed.page);
			await closed.page.openFocal(file('med_1'));
			expect(closed.uploads.refocus).not.toHaveBeenCalled();
		});

		it('says what went wrong', async () => {
			const { page, notifications } = setup({
				gateway: { details: vi.fn(() => throwError(() => new Error('down'))) },
			});
			await ready(page);
			await page.openFocal(file('med_1'));
			expect(notifications.showError).toHaveBeenCalledWith('fm_action_failed');
		});
	});

	describe('Add a version (C01, C07)', () => {
		const choice = { versions: [{ profileKey: 'hero', fill: 'crop' }], label: 'Hero · Crop' };

		it('lists the picked photos, and opens with no versions when one photo’s cannot be read', async () => {
			const { page, instance } = setup({
				gateway: { details: vi.fn(() => throwError(() => new Error('down'))) },
			});
			await ready(page);
			pickOnly(page, [], ['med_1', 'med_pdf']);
			expect(page.chosenPhotos().map((row) => row.id)).toEqual(['med_1']);
			await page.openReprocess([file('med_1')]);
			expect(instance.start).toHaveBeenCalledWith(expect.objectContaining({ versions: [] }));
		});

		it('stops without the storage popups, or when storage says no', async () => {
			const none = setup({ answers: [choice], popups: false });
			await ready(none.page);
			await none.page.openReprocess([file('med_1')], []);
			expect(none.flow.storageCheck).not.toHaveBeenCalled();
			const refused = setup({ answers: [choice], storageCheck: [false] });
			await ready(refused.page);
			await refused.page.openReprocess([file('med_1')], []);
			expect(refused.gateway.addVersions).not.toHaveBeenCalled();
		});

		it('with no hold needed, photos that already have them are only told', async () => {
			const { page, gateway, notifications, uploads } = setup({
				answers: [choice],
				storageCheck: [null],
				gateway: { addVersions: vi.fn(() => of({ added: 0, skipped: [{ fileId: 'med_1' }] })) },
			});
			await ready(page);
			await page.openReprocess([file('med_1')], []);
			expect(gateway.addVersions).toHaveBeenCalledWith('med_1', { versions: choice.versions });
			expect(notifications.showError).toHaveBeenCalledWith(expect.stringContaining('fm_rp_skipped'));
			expect(uploads.watchVersions).not.toHaveBeenCalled();
		});

		it('says what went wrong', async () => {
			const { page, notifications } = setup({
				answers: [choice],
				gateway: { addVersionsToMany: vi.fn(() => throwError(() => new Error('down'))) },
			});
			await ready(page);
			await page.openReprocess([file('med_1'), file('med_2')], []);
			expect(notifications.showError).toHaveBeenCalledWith('fm_action_failed');
		});
	});

	describe('Download as .zip (A20, A27)', () => {
		it('needs its popups and something picked', async () => {
			const none = setup({ popups: false });
			await ready(none.page);
			pickOnly(none.page, [], ['med_1']);
			await none.page.downloadZip();
			const empty = setup();
			await ready(empty.page);
			await empty.page.downloadZip();
			expect([none.gateway.zipPlan, empty.gateway.zipPlan].map((call) => call.mock.calls.length)).toEqual([0, 0]);
		});

		it('says when there is nothing to put in it, stops when storage says no, and asks no hold when none is needed', async () => {
			const nothing = setup({ gateway: { zipPlan: vi.fn(() => of({ name: 'x.zip', files: 0, bytes: 0 })) } });
			await ready(nothing.page);
			pickOnly(nothing.page, ['fld_w'], []);
			await nothing.page.downloadZip();
			expect(nothing.notifications.showError).toHaveBeenCalledWith('fm_zip_empty');

			const refused = setup({ storageCheck: [false] });
			await ready(refused.page);
			pickOnly(refused.page, [], ['med_1']);
			await refused.page.downloadZip();
			expect(refused.gateway.createZip).not.toHaveBeenCalled();

			const free = setup({ storageCheck: [null] });
			await ready(free.page);
			pickOnly(free.page, [], ['med_1']);
			await free.page.downloadZip();
			expect(free.gateway.createZip).toHaveBeenCalledWith({ folderIds: [], fileIds: ['med_1'] });
		});

		it('says what went wrong', async () => {
			const { page, notifications } = setup({
				gateway: {
					zipPlan: vi
						.fn()
						.mockReturnValueOnce(throwError(refusal))
						.mockReturnValueOnce(throwError(() => new Error('down'))),
				},
			});
			await ready(page);
			pickOnly(page, [], ['med_1']);
			await page.downloadZip();
			await page.downloadZip();
			expect(notifications.showError.mock.calls).toEqual([['Not allowed here.'], ['fm_action_failed']]);
		});
	});

	it('Preview opens a tab even where the first one was blocked, and a failed address closes the tab', async () => {
		const { page, notifications } = setup({
			gateway: {
				fileAddress: vi
					.fn()
					.mockReturnValueOnce(of({ url: 'https://spaces.test/a' }))
					.mockReturnValueOnce(throwError(() => new Error('down'))),
			},
		});
		await ready(page);
		const open = vi.spyOn(window, 'open').mockReturnValueOnce(null);
		await page.openFile(file('med_pdf'), 'view');
		expect(open).toHaveBeenLastCalledWith('https://spaces.test/a', '_blank', 'noopener');
		const tab = { opener: {}, location: { href: '' }, close: vi.fn() };
		open.mockReturnValueOnce(tab as unknown as Window);
		await page.openFile(file('med_pdf'), 'view');
		expect(tab.close).toHaveBeenCalled();
		expect(notifications.showError).toHaveBeenCalledWith('fm_action_failed');
	});

	it('unstars a starred file, and New folder opens in My files outside a folder', async () => {
		const { page, notifications } = setup();
		await ready(page);
		await page.star(file('med_s', { starred: true }));
		expect(notifications.showSuccess).toHaveBeenCalledWith('fm_unstarred');
		const recent = setup({ params: { view: 'recent' }, answers: [new Error('closed')] });
		recent.page.openNewFolder();
		expect(recent.instance.start).toHaveBeenCalledWith({ parentId: null, place: 'fm_my_files' });
		const top = setup({ params: {} });
		top.page.openNewFolder();
		expect(top.instance.start).toHaveBeenCalledWith(expect.objectContaining({ parentId: null }));
	});

	it('Rename: nothing to save without a name; a folder renamed with nothing to undo is just told', async () => {
		const { page, gateway, notifications } = setup();
		await ready(page);
		const close = vi.fn();
		await page.saveRename(close);
		page.renaming.set({ type: 'folder', id: 'fld_w', base: 'Wedding 2027', extension: '', before: 'Wedding' });
		await page.saveRename(close);
		expect(gateway.renameFolder).toHaveBeenCalledWith('fld_w', 'Wedding 2027');
		expect(close).toHaveBeenCalledTimes(1);
		expect(notifications.showSuccess).toHaveBeenCalledWith('fm_renamed');
	});

	it('Move: folders and files together, to My files, nothing to move, a failure, and nothing moved', async () => {
		const { page, gateway, notifications } = setup({
			gateway: {
				move: vi
					.fn()
					.mockReturnValueOnce(of({ done: 2, inUse: [], undoId: 'und_m' }))
					.mockReturnValueOnce(throwError(refusal))
					.mockReturnValueOnce(of({ done: 0, inUse: [], undoId: null })),
			},
		});
		await ready(page);
		pickOnly(page, ['fld_w'], ['med_1']);
		expect(page.chosenWhat()).toContain('fm_what_both');
		await page.moveChosen(null);
		expect(gateway.move).toHaveBeenCalledWith({ folderIds: ['fld_w'], fileIds: ['med_1'], toFolderId: null });
		await page.moveChosen('fld_w');
		expect(gateway.move).toHaveBeenCalledTimes(1);
		pickOnly(page, [], ['med_1']);
		await page.moveChosen('fld_w');
		expect(notifications.showError).toHaveBeenCalledWith('Not allowed here.');
		pickOnly(page, [], ['med_1']);
		await page.moveChosen('fld_w');
		expect(page.chosenCount()).toBe(0);
		pickOnly(page, ['fld_w', 'fld_b'], []);
		expect(page.chosenWhat()).toContain('fm_folders_count');
	});

	it('names a folder the tree has not read yet from the list', async () => {
		const { page, gateway } = setup({ tree: 'never' });
		await loaded(page);
		pickOnly(page, [], ['med_1']);
		await page.moveChosen('fld_w');
		expect(gateway.move).toHaveBeenCalled();
		expect(page.chosenCount()).toBe(0);
	});

	describe('Move to Trash (A25, A26)', () => {
		it('from Clean up; nothing picked does nothing; a failed check stops', async () => {
			const { page, gateway, notifications } = setup({
				gateway: { checkTrash: vi.fn(() => throwError(() => new Error('down'))) },
			});
			await ready(page);
			await page.trashFromCleanUp([file('med_1')]);
			expect(gateway.trash).toHaveBeenCalledWith({ folderIds: [], fileIds: ['med_1'] });
			await page.trashChosen(false);
			pickOnly(page, ['fld_w'], []);
			await page.trashChosen(false);
			expect(notifications.showError).toHaveBeenCalledWith('fm_action_failed');
			expect(gateway.trash).toHaveBeenCalledTimes(1);
		});

		it('photos in use: no popup to ask with, or the popup closed, stops', async () => {
			const inUse = {
				checkTrash: vi.fn(() => of({ inUse: [{ id: 'med_1' }], total: 1, moving: 0, keptFolders: 0 })),
			};
			const bare = setup({ bare: true, gateway: inUse });
			await ready(bare.page);
			await bare.page.trashFromCleanUp([file('med_1', { usedOn: 2 })]);
			const closed = setup({ answers: [new Error('closed')], gateway: inUse });
			await ready(closed.page);
			await closed.page.trashFromCleanUp([file('med_1', { usedOn: 2 })]);
			expect([bare.gateway.trash, closed.gateway.trash].map((call) => call.mock.calls.length)).toEqual([0, 0]);
		});

		it('a folder asks first; what someone put on a page meanwhile stays, and nothing gone means no Undo', async () => {
			const { page, notifications, toastr } = setup({
				answers: [true],
				gateway: { trash: vi.fn(() => of({ done: 0, inUse: [{ id: 'med_1' }], undoId: null })) },
			});
			await ready(page);
			pickOnly(page, ['fld_w'], []);
			await page.trashChosen(false);
			expect(page.ask()).toMatchObject({
				kind: 'trash',
				folder: expect.objectContaining({ id: 'fld_w' }),
				fileName: null,
			});
			expect(notifications.showError).toHaveBeenCalledWith(expect.stringContaining('fm_kept_in_use'));
			expect(toastr.success).not.toHaveBeenCalled();
		});

		it('a failure moves nothing and clears no picks', async () => {
			const { page } = setup({
				answers: [true],
				gateway: { trash: vi.fn(() => throwError(() => new Error('down'))) },
			});
			await ready(page);
			pickOnly(page, [], ['med_1']);
			await page.trashChosen(true);
			expect(page.ask()).toMatchObject({ fileName: 'med_1.jpg', folder: null });
			expect(page.chosenCount()).toBe(1);
		});
	});

	it('⌘/Ctrl+Z takes back the last change; a failed Undo says nothing good', async () => {
		const { page, gateway, notifications, toastr } = setup({
			gateway: { undo: vi.fn(() => throwError(() => new Error('down'))) },
		});
		await ready(page);
		pickOnly(page, [], ['med_1']);
		await page.trashChosen(false);
		expect(toastr.success).toHaveBeenCalled();
		page.onKey(key({ key: 'z', metaKey: true }));
		await settle();
		expect(gateway.undo).toHaveBeenCalledWith('und_1');
		expect(toastr.remove).toHaveBeenCalledWith(1);
		expect(notifications.showSuccess).not.toHaveBeenCalledWith('fm_undone');
	});

	it('the keys: Trash takes none, arrows only on the page, Enter opens the one picked, Delete needs a pick', async () => {
		const trash = setup({ params: { view: 'trash' } });
		await loaded(trash.page);
		trash.page.onKey(key({ key: 'Delete' }));
		expect(trash.gateway.trash).not.toHaveBeenCalled();

		const { page, modals, gateway } = setup();
		await ready(page);
		const elsewhere = document.createElement('div');
		page.openMoveMenu({ stopPropagation: vi.fn(), clientX: 1, clientY: 1, currentTarget: elsewhere } as never);
		page.onKey(key({ key: 'Escape' }));
		expect(page.menu()).toBeNull();
		page.onKey(key({ key: 'ArrowDown', target: elsewhere }));
		expect(page.chosenCount()).toBe(0);
		page.onKey(key({ key: 'ArrowUp' }));
		expect([...page.selected()]).toEqual(['med_pdf']);
		page.onKey(key({ key: 'ArrowRight' }));
		page.onKey(key({ key: 'ArrowUp' }));
		expect([...page.selected()]).toEqual(['med_1']);
		page.onKey(key({ key: 'Enter' }));
		await settle();
		expect(modals.open).toHaveBeenCalledTimes(1);
		page.onKey(key({ key: 'Enter', target: elsewhere }));
		page.onKey(key({ key: 'Delete', target: elsewhere }));
		page.onKey(key({ key: 'x', target: {} }));
		pickOnly(page, [], []);
		page.onKey(key({ key: 'Enter' }));
		page.onKey(key({ key: 'Delete' }));
		expect(modals.open).toHaveBeenCalledTimes(1);
		expect(gateway.trash).not.toHaveBeenCalled();
	});

	it('picked files with no list, and a dropped folder read entry by entry', async () => {
		const { page, flow } = setup();
		await ready(page);
		page.filesPicked({ files: null, value: 'x' } as unknown as HTMLInputElement);
		page.folderPicked({ files: null, value: 'x' } as unknown as HTMLInputElement);
		const drag = (extra: Record<string, unknown> = {}) =>
			({
				preventDefault: vi.fn(),
				dataTransfer: { types: ['Files'], dropEffect: '', ...extra },
			}) as unknown as DragEvent;
		page.dropEnter(drag());
		const entry = {
			isFile: true,
			isDirectory: false,
			name: 'brief.pdf',
			file: (done: (f: File) => void) => done(new File(['x'], 'brief.pdf', { type: 'application/pdf' })),
		};
		await page.dropFiles(drag({ items: [{ kind: 'file', webkitGetAsEntry: () => entry }], files: [] }));
		const plans = flow.open.mock.calls.map((call) => (call as unknown as [{ rows: { name: string }[] }])[0].rows);
		expect(plans.at(-1)?.map((row) => row.name)).toEqual(['brief.pdf']);
	});

	it('filters: a category ticked and unticked, and one chip taken off', () => {
		const { page, router } = setup({ params: { folder: 'fld_b', state: 'failed', cats: 'images' } });
		page.toggleDraftCategory('videos');
		page.toggleDraftCategory('videos');
		expect(page.draft().cats).toEqual([]);
		page.removeFilter('state');
		expect(router.navigate).toHaveBeenLastCalledWith(
			[],
			expect.objectContaining({ queryParams: expect.objectContaining({ cats: 'images', state: null }) }),
		);
	});

	describe('Trash (A18, A19)', () => {
		it('a file whose top-level folder is in Trash too asks first, and stays when the question is closed', async () => {
			const { page, gateway } = setup({
				params: { view: 'trash' },
				answers: [new Error('closed')],
				browse: { folders: [folder('fld_top', { location: '', name: 'Bridal' })], files: [] },
			});
			await loaded(page);
			await page.restoreItem({ type: 'file', id: 'med_1', folderId: 'fld_top' } as never);
			expect(page.ask()).toMatchObject({ kind: 'restore', folderName: 'Bridal' });
			expect(gateway.restore).not.toHaveBeenCalled();
		});

		it('Empty Trash: nothing there, the question closed, and a failure', async () => {
			const empty = setup({ params: { view: 'trash' }, browse: { folders: [], files: [] } });
			await loaded(empty.page);
			await empty.page.emptyTrash();
			expect(empty.modals.open).not.toHaveBeenCalled();
			const closed = setup({ params: { view: 'trash' }, answers: [new Error('closed')] });
			await loaded(closed.page);
			await closed.page.emptyTrash();
			expect(closed.gateway.deleteForever).not.toHaveBeenCalled();
			const failing = setup({
				params: { view: 'trash' },
				answers: [true],
				gateway: { deleteForever: vi.fn(() => throwError(() => new Error('down'))) },
			});
			await loaded(failing.page);
			await failing.page.emptyTrash();
			expect(failing.notifications.showSuccess).not.toHaveBeenCalled();
			expect(failing.notifications.showError).toHaveBeenCalledWith('fm_action_failed');
		});

		it('asks nothing without its popup, so nothing is deleted', async () => {
			const { page, gateway } = setup({ params: { view: 'trash' }, bare: true });
			await loaded(page);
			await page.deleteItem({ type: 'file', id: 'med_1' } as never);
			expect(gateway.deleteForever).not.toHaveBeenCalled();
		});
	});

	it('dragging a picked item carries everything picked', async () => {
		const { page } = setup();
		await ready(page);
		pickOnly(page, ['fld_w'], ['med_1']);
		const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: '' };
		page.dragStart({ type: 'file', id: 'med_1' }, { dataTransfer } as unknown as DragEvent);
		expect(page.dragging()).toMatchObject({ folderIds: ['fld_w'], fileIds: ['med_1'] });
		expect(dataTransfer.effectAllowed).toBe('move');
	});
});
