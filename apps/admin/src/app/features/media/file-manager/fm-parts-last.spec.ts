import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MediaUploads } from '@core/media-library/media-uploads';

import { fileKind, fileTypeLabel } from './file-kinds';
import { FmMenu } from './fm-menu';
import { FmReplaceProgress } from './fm-replace-progress';
import { pickItem, stepItem } from './fm-selection';
import { FmSidebar } from './fm-sidebar';
import { FmTray } from './fm-tray';
import { FmUndoToast } from './fm-undo-toast';
import {
	asPhotoKind,
	pastedName,
	photoNotes,
	planUpload,
	readDropped,
	readPhotoSize,
	readPickedFolder,
	sniffFile,
	uploadSecondsLeft,
} from './fm-upload-plan';

const translate = {
	translate: (key: string, params?: Record<string, unknown>) =>
		params ? `${key}(${Object.values(params).join(',')})` : key,
	getActiveLang: () => 'en',
	getTranslation: () => ({}),
};

afterEach(() => vi.unstubAllGlobals());

describe('media helpers: the last cases', () => {
	it('names the tile and the type of every kind of file', () => {
		expect(fileKind({ name: 'a.mov', category: 'other', kind: 'video' } as never).icon).toBe('ri-film-line');
		expect(fileKind({ name: 'a', category: 'archives', kind: 'file' } as never).icon).toBe('ri-file-zip-line');
		expect(fileKind({ name: 'odd.constructor', category: 'other', kind: 'file' } as never).icon).toBe(
			'ri-file-3-line',
		);
		expect(fileTypeLabel({ name: 'scan', contentType: 'image/svg+xml' } as never)).toBe('SVG');
		expect(fileTypeLabel({ name: 'scan', contentType: 'binary' } as never)).toBe('');
	});

	it('types a file by its own extension, and checks a profile with no shape', () => {
		expect(fileTypeLabel({ name: 'size-chart.pdf', contentType: 'application/pdf' } as never)).toBe('PDF');
		const profile = {
			key: 'p',
			fills: ['as_is'],
			minSize: null,
			enabled: true,
			mainPhotoOnly: false,
			maxBytes: 99,
		};
		const row = { size: { width: 10, height: 10 }, picks: [{ profileKey: 'p', fills: ['as_is'] }], bytes: 1 };
		expect(photoNotes(row as never, [profile] as never)).toEqual([]);
	});

	it('picks a folder with ⌘, keeps the selection when the item is not listed, and steps through the list', () => {
		const folder = { type: 'folder' as const, id: 'f1' };
		const file = { type: 'file' as const, id: 'a' };
		const none = { folders: new Set<string>(), files: new Set<string>() };
		const toggled = pickItem(none, [folder], folder, 'toggle', null);
		expect([...toggled.folders]).toEqual(['f1']);
		expect(pickItem(toggled, [folder], folder, 'toggle', null).folders.size).toBe(0);
		expect(pickItem(toggled, [folder], file, 'range', folder)).toBe(toggled);
		expect(stepItem([folder, file], null, -1)).toBe(file);
		expect(stepItem([folder, file], file, 1)).toBe(file);
	});

	it('plans a folder picked alone, and counts time left only once a send has started', () => {
		const file = (name: string, path: string[]) => ({ file: new File(['x'], name, { type: 'text/plain' }), path });
		expect(planUpload([file('a.txt', ['Wedding']), file('b.txt', ['Wedding'])]).folderName).toBe('Wedding');
		expect(planUpload([file('a.txt', [])]).folderName).toBeNull();
		expect(uploadSecondsLeft({ sent: 1, bytes: 10, startedAt: null })).toBeNull();
		expect(uploadSecondsLeft({ sent: 5, bytes: 10, startedAt: 1000 }, 2000)).toBeGreaterThan(0);
	});

	it('reads dropped files and folders, skipping what is neither, and a picked folder file with no path', async () => {
		const found = new File(['x'], 'a.txt');
		let read = false;
		const folder = {
			isDirectory: true,
			name: 'Wedding',
			createReader: () => ({
				readEntries: (done: (rows: unknown[]) => void) => {
					done(read ? [] : [{ isFile: true, file: (give: (file: File) => void) => give(found) }]);
					read = true;
				},
			}),
		};
		const odd = { isDirectory: true, name: 'odd' };
		const picked = await readDropped([
			{ webkitGetAsEntry: () => folder },
			{ webkitGetAsEntry: () => odd },
			{ webkitGetAsEntry: () => null },
		]);
		expect(picked).toEqual([{ file: found, path: ['Wedding'] }]);
		expect(readPickedFolder([new File(['x'], 'loose.txt')])).toEqual([{ file: expect.any(File), path: [] }]);
	});

	it('treats a HEIC as itself, a kind the worker does not make versions of as a file, and unreadable bytes as nothing', async () => {
		const row = { contentType: 'image/heic', kind: null, photo: false, waits: false, heic: false, name: 'a.heic' };
		expect(asPhotoKind(row, 'heic')).toMatchObject({ contentType: 'image/heic', heic: true, photo: true });
		expect(asPhotoKind({ ...row, contentType: 'image/x-psd', name: 'a.psd' }, 'psd').photo).toBeDefined();
		const broken = {
			slice: () => ({ arrayBuffer: async () => Promise.reject(new Error('gone')) }),
		} as unknown as Blob;
		expect(await sniffFile(broken)).toBeNull();
		vi.stubGlobal('createImageBitmap', undefined);
		expect(await readPhotoSize(new Blob(['x']))).toBeNull();
		vi.stubGlobal('createImageBitmap', async () => Promise.reject(new Error('not a picture')));
		expect(await readPhotoSize(new Blob(['x']))).toBeNull();
	});

	it('notes nothing without a size or a known profile, and refuses a photo over the size limit or of another shape', () => {
		const profile = {
			key: 'p',
			shape: { width: 3, height: 4 },
			fills: ['as_is'],
			minSize: null,
			enabled: true,
			mainPhotoOnly: false,
			maxBytes: 5,
		};
		expect(photoNotes({ size: null, picks: [], bytes: 1 } as never, [profile] as never)).toEqual([]);
		const picks = [
			{ profileKey: 'gone', fills: ['as_is'] },
			{ profileKey: 'p', fills: ['as_is'] },
		];
		expect(
			photoNotes({ size: { width: 100, height: 100 }, picks, bytes: 10 } as never, [profile] as never).map(
				(note) => note.kind,
			),
		).toEqual(['over', 'shape']);
		expect(pastedName('weird', new Date(2026, 10, 15, 10, 32))).toBe('pasted-image-15-nov-2026-10-32.img');
		expect(pastedName('image/webp', new Date(2026, 10, 15, 10, 32))).toBe('pasted-image-15-nov-2026-10-32.webp');
	});
});

describe('media pieces: the last cases', () => {
	it('the right-click menu opens Move, picks a line, walks the folders and moves only where allowed', () => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(FmMenu, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(FmMenu);
		fixture.componentRef.setInput('at', { x: 0, y: 0 });
		fixture.componentRef.setInput('folders', [{ id: 'f1', name: 'Wedding', parentId: null }]);
		fixture.componentRef.setInput('blocked', new Set(['f2']));
		fixture.componentRef.setInput('here', 'f3');
		const menu = fixture.componentInstance;
		const chosen: unknown[] = [];
		const moved: unknown[] = [];
		menu.choose.subscribe((line) => chosen.push(line));
		menu.moveTo.subscribe((id) => moved.push(id));
		expect(menu.tree()).toHaveLength(1);
		menu.enter('move');
		expect(menu.moveOpen()).toBe(true);
		menu.openAt(0, 'f1', true);
		expect(menu.path()).toEqual(['f1']);
		menu.openAt(0, 'f2', true);
		expect(menu.path()).toEqual([]);
		menu.enter('rename' as never);
		expect(menu.moveOpen()).toBe(false);
		menu.pick('move');
		expect(menu.moveOpen()).toBe(true);
		menu.pick('rename' as never);
		expect(chosen).toEqual(['rename']);
		menu.go('f3');
		menu.go('f2');
		menu.go(null);
		menu.go('f1');
		expect(moved).toEqual([null, 'f1']);
	});

	it('the sidebar opens the upload menu, opens folders, and colours the storage bar', () => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(FmSidebar, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(FmSidebar);
		fixture.componentRef.setInput('nav', 'folder');
		fixture.componentRef.setInput('folders', [
			{ id: 'f1', name: 'Wedding', parentId: null },
			{ id: 'f2', name: 'Day 1', parentId: 'f1' },
		]);
		fixture.componentRef.setInput('folderId', 'f2');
		const side = fixture.componentInstance;
		const uploads: unknown[] = [];
		side.upload.subscribe((choice) => uploads.push(choice));
		const event = { stopPropagation: vi.fn() } as unknown as Event;
		side.closeUploadMenu();
		side.toggleUploadMenu(event);
		expect(side.uploadMenuOpen()).toBe(true);
		side.closeUploadMenu();
		expect(side.uploadMenuOpen()).toBe(false);
		side.toggleUploadMenu(event);
		side.chooseUpload('folder');
		expect([side.uploadMenuOpen(), uploads]).toEqual([false, ['folder']]);
		expect(side.tree()[0]?.children?.length ?? 1).toBeGreaterThan(0);
		expect(side.open().has('f1')).toBe(true);
		side.toggle('f9', event);
		expect(side.open().has('f9')).toBe(true);
		side.toggle('f9', event);
		expect(side.open().has('f9')).toBe(false);
		expect(['red', 'yellow', 'green'].map((colour) => side.barClass({ colour } as never))).toEqual([
			'bg-danger',
			'bg-warning',
			'bg-success',
		]);
	});

	it('the Replace progress counts what was sent and made', () => {
		const replaces = signal(new Map<string, unknown>());
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: NgbActiveModal, useValue: { close: vi.fn() } },
				{ provide: MediaUploads, useValue: { replaces } },
			],
		});
		TestBed.overrideComponent(FmReplaceProgress, { set: { imports: [], template: '' } });
		const progress = TestBed.createComponent(FmReplaceProgress).componentInstance;
		progress.start('med_1', 'old.jpg', 'new.jpg');
		expect([progress.run(), progress.sentPercent(), progress.madePercent()]).toEqual([null, 0, 0]);
		replaces.set(new Map([['med_1', { step: 'making', sent: 5, bytes: 10, made: 1, total: 4 }]]));
		expect([progress.sentPercent(), progress.madePercent()]).toEqual([50, 25]);
		replaces.set(new Map([['med_1', { step: 'making', sent: 0, bytes: 0, made: 0, total: 0 }]]));
		expect([progress.sentPercent(), progress.madePercent()]).toEqual([0, 0]);
		replaces.set(new Map([['med_1', { step: 'done', sent: 0, bytes: 0, made: 0, total: 0 }]]));
		expect(progress.madePercent()).toBe(100);
		expect(progress.names()).toEqual({ old: 'old.jpg', next: 'new.jpg' });
	});

	it('the tray heads what is going on, and says what a renamed file is called now', () => {
		const state = {
			active: signal<unknown[]>([]),
			runningOperations: signal<unknown[]>([]),
			doneCount: signal(0),
			failedCount: signal(0),
			operations: signal<unknown[]>([]),
			jobs: signal<unknown[]>([]),
			renamed: new Subject<{ savedAs: string }>(),
		};
		const toastr = { success: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: MediaUploads, useValue: state },
				{ provide: TranslocoService, useValue: translate },
				{ provide: ToastrService, useValue: toastr },
			],
		});
		TestBed.overrideComponent(FmTray, { set: { imports: [], template: '' } });
		const tray = TestBed.createComponent(FmTray).componentInstance;
		expect([tray.busy(), tray.head()]).toEqual([false, 'fm_op_all_done']);
		state.doneCount.set(3);
		expect(tray.head()).toContain('fm_tray_uploaded');
		state.runningOperations.set([{}]);
		state.active.set([{}]);
		state.failedCount.set(1);
		expect(tray.busy()).toBe(true);
		const head = tray.head();
		expect(head).toContain('fm_tray_working');
		expect(head).toContain('fm_tray_failed');
		expect(head).toContain('fm_tray_done');
		state.runningOperations.set([]);
		state.active.set([]);
		state.doneCount.set(0);
		expect(tray.head()).toContain('fm_tray_failed');
		state.active.set([{}]);
		state.failedCount.set(0);
		expect(tray.head()).not.toContain('fm_tray_failed');
		state.renamed.next({ savedAs: 'brief (1).pdf' });
		expect(toastr.success).toHaveBeenCalledWith('fm_uploaded_as(brief (1).pdf)');
		expect(tray.kind({ name: 'a.pdf' } as never).icon).toBe('ri-file-pdf-2-line');
	});

	it('the undo toast’s link runs the action and closes the toast', () => {
		const triggerAction = vi.fn();
		const remove = vi.fn();
		const event = { stopPropagation: vi.fn() } as unknown as Event;
		FmUndoToast.prototype.act.call({ toastPackage: { triggerAction }, remove } as never, event);
		expect([triggerAction, remove].map((call) => call.mock.calls.length)).toEqual([1, 1]);
	});
});
