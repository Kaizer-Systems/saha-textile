import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MediaLibraryGateway } from '@core/media-library/media-library.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { fileExtension, fileKind, fileTypeLabel } from './file-kinds';
import { FileManager, MEDIA_DRAG_TYPE, SEARCH_PAUSE_MS, UNDO_SECONDS } from './file-manager';
import { NO_SELECTION, blockedTargets, commonPlace, pickHow, pickItem, stepItem } from './fm-selection';
import { buildTree, parentsOf } from './fm-sidebar';
import { FmUndoToast } from './fm-undo-toast';

/** The theme's toasts, as the page uses them: Undo reports through `onAction`. */
const toastStub = () => {
	const action = new BehaviorSubject<unknown>(undefined);
	return {
		action,
		success: vi.fn((_message: string, _title?: string, _options?: unknown) => ({
			toastId: 7,
			onAction: action.asObservable(),
		})),
		remove: vi.fn(),
	};
};

const rows = [
	{ id: 'fld_b', parentId: 'fld_p', name: 'Banarasi', files: 3, bytes: 10 },
	{ id: 'fld_p', parentId: null, name: 'Product photos', files: 0, bytes: 0 },
	{ id: 'fld_w', parentId: 'fld_b', name: 'Wedding 2026', files: 36, bytes: 99 },
	{ id: 'fld_a', parentId: null, name: 'banners', files: 1, bytes: 1 },
];

describe('the folder tree', () => {
	it('nests folders by parent, sorted by name without caring about case', () => {
		const tree = buildTree(rows);
		expect(tree.map((node) => node.folder.name)).toEqual(['banners', 'Product photos']);
		expect(tree[1]?.children[0]?.children.map((node) => node.folder.name)).toEqual(['Wedding 2026']);
	});

	it('opens the parents of the folder being shown', () => {
		expect(parentsOf(rows, 'fld_w')).toEqual(['fld_p', 'fld_b']);
		expect(parentsOf(rows, 'fld_p')).toEqual([]);
		expect(parentsOf(rows, null)).toEqual([]);
	});
});

describe('file tiles', () => {
	it('names the type by extension and picks the brief’s tile per kind', () => {
		expect(fileExtension('Bridal catalogue 2027.pdf')).toBe('PDF');
		expect(fileExtension('.env')).toBe('');
		expect(fileTypeLabel({ name: '1-real-banarasi-loupe', contentType: 'image/jpeg' })).toBe('JPG');
		expect(fileTypeLabel({ name: 'front', contentType: 'image/svg+xml' })).toBe('SVG');
		expect(fileKind({ name: 'a.pdf', category: 'documents', kind: 'file' }).icon).toBe('ri-file-pdf-2-line');
		expect(fileKind({ name: 'a.jpg', category: 'images', kind: 'image' }).cls).toBe('k-image');
		expect(fileKind({ name: 'db.dump', category: 'backups', kind: 'file' }).cls).toBe('k-backup');
		expect(fileKind({ name: 'x.CR3', category: 'other', kind: 'file' }).icon).toBe('ri-camera-lens-line');
		expect(fileKind({ name: 'x.unknown', category: 'other', kind: 'file' }).cls).toBe('k-other');
	});
});

describe('the Media page reads its view from the address', () => {
	const render = (query: Record<string, string>) => {
		const params = new BehaviorSubject(convertToParamMap(query));
		const router = { navigate: vi.fn() };
		const gateway = {
			browse: vi.fn(() =>
				of({ folder: null, breadcrumb: [], folders: [], files: [], total: 0, page: 1, pageSize: 200 }),
			),
			tree: vi.fn(() => of({ folders: [] })),
			storage: vi.fn(() => of(null)),
		};
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				provideTanStackQuery(new QueryClient()),
				{ provide: MediaLibraryGateway, useValue: gateway },
				{ provide: NgbModal, useValue: { open: vi.fn() } },
				{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
				{ provide: Router, useValue: router },
				{
					provide: ActivatedRoute,
					useValue: { queryParamMap: params, snapshot: { queryParamMap: params.value } },
				},
				{
					provide: TranslocoService,
					useValue: {
						translate: (key: string) => key,
						getActiveLang: () => 'en',
						getTranslation: () => ({}),
					},
				},
				{ provide: ToastrService, useValue: toastStub() },
			],
		});
		TestBed.overrideComponent(FileManager, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(FileManager).componentInstance;
		return { page, router, params };
	};

	it('asks for a folder, sorted by name, when the address names one', () => {
		const { page } = render({ folder: 'fld_b' });
		expect(page.query()).toMatchObject({ view: 'folder', folderId: 'fld_b', sort: 'name', direction: 'asc' });
		expect(page.display()).toBe('list');
	});

	it('keeps Trash, Favourites › Everyone’s, a category, a search, the sort and thumbnails', () => {
		expect(render({ view: 'trash', folder: 'fld_b' }).page.query()).toMatchObject({
			view: 'trash',
			folderId: undefined,
		});
		expect(render({ view: 'favourites', who: 'everyone' }).page.query()).toMatchObject({ who: 'everyone' });
		const { page } = render({ category: 'documents', q: 'catalogue', sort: 'largest', show: 'grid' });
		expect(page.query()).toMatchObject({
			category: 'documents',
			search: 'catalogue',
			sort: 'size',
			direction: 'desc',
		});
		expect(page.display()).toBe('grid');
		expect(page.showLocation()).toBe(true);
		// Anything the page does not know falls back to the default view.
		expect(render({ view: 'nonsense', category: 'nope', sort: 'odd' }).page.query()).toMatchObject({
			view: 'folder',
			category: undefined,
			sort: 'name',
		});
	});

	it('reads filters from the address, applies the menu, and removes one chip or all', () => {
		const { page, router } = render({
			cats: 'documents,nope,images',
			state: 'failed',
			size: 'over25',
			up: '7d',
			used: 'out',
		});
		expect(page.query()).toMatchObject({
			categories: ['documents', 'images'],
			state: 'failed',
			size: 'over25',
			uploaded: '7d',
			used: 'out',
		});
		expect(page.filterCount()).toBe(6);
		expect(page.showLocation()).toBe(true);
		page.toggleFilters();
		page.toggleDraftCategory('documents');
		page.setDraft('state', '');
		page.applyFilters();
		expect(page.filtersOpen()).toBe(false);
		expect(router.navigate).toHaveBeenLastCalledWith(
			[],
			expect.objectContaining({
				queryParams: { cats: 'images', state: null, size: 'over25', up: '7d', used: 'out' },
			}),
		);
		page.removeFilter('cats', 'images');
		expect(router.navigate).toHaveBeenLastCalledWith(
			[],
			expect.objectContaining({
				queryParams: expect.objectContaining({ cats: 'documents', state: 'failed' }),
			}),
		);
		page.clearFilters();
		expect(router.navigate).toHaveBeenLastCalledWith(
			[],
			expect.objectContaining({
				queryParams: { cats: null, state: null, size: null, up: null, used: null },
			}),
		);
		expect(render({ state: 'odd', size: '', used: 'maybe' }).page.filterCount()).toBe(0);
	});

	it('writes changes into the address, and waits for a pause in typing before searching', () => {
		vi.useFakeTimers();
		const { page, router } = render({ folder: 'fld_b' });
		page.openNav('trash');
		expect(router.navigate).toHaveBeenLastCalledWith(
			[],
			expect.objectContaining({
				queryParams: { view: 'trash', folder: null, category: null, q: null, who: null },
				queryParamsHandling: 'merge',
			}),
		);
		page.typed(' cat');
		page.typed(' catalogue ');
		expect(router.navigate).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(SEARCH_PAUSE_MS);
		expect(router.navigate).toHaveBeenLastCalledWith(
			[],
			expect.objectContaining({ queryParams: { q: 'catalogue' } }),
		);
		page.setDisplay('grid');
		expect(router.navigate).toHaveBeenLastCalledWith(
			[],
			expect.objectContaining({ queryParams: { show: 'grid' } }),
		);
		page.setSort('name');
		expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { sort: null } }));
		vi.useRealTimers();
	});
});

describe('Trash on the Media page (A18, A19)', () => {
	const trash = {
		folder: null,
		breadcrumb: [],
		folders: [
			{
				id: 'fld_tant',
				parentId: 'fld_p',
				name: 'Tant cotton',
				location: 'Product photos',
				files: 2,
				bytes: 9,
				starred: false,
				daysLeft: 20,
				ancestors: [],
				trashedAt: '2026-11-10T00:00:00.000Z',
				trashedFrom: 'fld_p',
			},
		],
		files: [
			{ id: 'med_blue', name: 'blue-tant-draft.jpg', folderId: 'fld_tant' },
			{ id: 'med_pdf', name: 'old.pdf', folderId: null },
		],
		total: 2,
		page: 1,
		pageSize: 200,
	};
	const setup = (answer: 'yes' | 'no' = 'yes', failing = false) => {
		const result = { done: 1, inUse: [], undoId: null };
		const gateway = {
			browse: vi.fn(() => of(trash)),
			tree: vi.fn(() => of({ folders: [] })),
			storage: vi.fn(() => of(null)),
			restore: vi.fn(() => (failing ? throwError(() => new Error('down')) : of(result))),
			deleteForever: vi.fn(() => of(result)),
		};
		const modals = {
			open: vi.fn(() => ({ result: answer === 'yes' ? Promise.resolve('yes') : Promise.reject('cancel') })),
		};
		const notifications = { showSuccess: vi.fn(), showError: vi.fn() };
		const params = new BehaviorSubject(convertToParamMap({ view: 'trash' }));
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				provideTanStackQuery(new QueryClient()),
				{ provide: MediaLibraryGateway, useValue: gateway },
				{ provide: NgbModal, useValue: modals },
				{ provide: NotificationService, useValue: notifications },
				{ provide: Router, useValue: { navigate: vi.fn() } },
				{
					provide: ActivatedRoute,
					useValue: { queryParamMap: params, snapshot: { queryParamMap: params.value } },
				},
				{
					provide: TranslocoService,
					useValue: {
						translate: (key: string) => key,
						getActiveLang: () => 'en',
						getTranslation: () => ({}),
					},
				},
				{ provide: ToastrService, useValue: toastStub() },
			],
		});
		TestBed.overrideComponent(FileManager, {
			set: { imports: [], template: '<ng-template #fmConfirm></ng-template>' },
		});
		const fixture = TestBed.createComponent(FileManager);
		fixture.detectChanges();
		return { page: fixture.componentInstance, gateway, modals, notifications };
	};
	const settled = async (page: FileManager) => {
		for (let i = 0; i < 20 && !page.result(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
	};

	it('asks where a file goes when its old folder is in Trash too, and restores with the choice', async () => {
		const { page, gateway, modals, notifications } = setup();
		await settled(page);
		const restoring = page.restoreItem({
			type: 'file',
			id: 'med_blue',
			name: 'blue-tant-draft.jpg',
			folderId: 'fld_tant',
		});
		page.restoreChoice.set('my_files');
		await restoring;
		expect(modals.open).toHaveBeenCalledTimes(1);
		expect(page.ask()).toMatchObject({ kind: 'restore', folderName: 'Product photos › Tant cotton' });
		expect(gateway.restore).toHaveBeenCalledWith({
			fileIds: ['med_blue'],
			folderIds: [],
			whenFolderGone: 'my_files',
		});
		expect(notifications.showSuccess).toHaveBeenCalledWith('fm_restored');
	});

	it('restores straight away when the old folder is not in Trash', async () => {
		const { page, gateway, modals } = setup();
		await settled(page);
		await page.restoreItem({ type: 'file', id: 'med_pdf', name: 'old.pdf', folderId: null });
		expect(modals.open).not.toHaveBeenCalled();
		expect(gateway.restore).toHaveBeenCalledWith({
			fileIds: ['med_pdf'],
			folderIds: [],
			whenFolderGone: 'restore_folder',
		});
	});

	it('deletes for good only after a yes, and empties Trash of what it shows', async () => {
		const declined = setup('no');
		await settled(declined.page);
		await declined.page.deleteItem({ type: 'folder', id: 'fld_tant', name: 'Tant cotton', folderId: null });
		expect(declined.gateway.deleteForever).not.toHaveBeenCalled();
		const { page, gateway } = setup();
		await settled(page);
		await page.deleteItem({ type: 'folder', id: 'fld_tant', name: 'Tant cotton', folderId: null });
		expect(gateway.deleteForever).toHaveBeenLastCalledWith({ fileIds: [], folderIds: ['fld_tant'] });
		await page.emptyTrash();
		expect(page.ask()).toEqual({ kind: 'empty', count: 3 });
		expect(gateway.deleteForever).toHaveBeenLastCalledWith({
			fileIds: ['med_blue', 'med_pdf'],
			folderIds: ['fld_tant'],
		});
	});

	it('says so when the change fails', async () => {
		const { page, notifications } = setup('yes', true);
		await settled(page);
		await page.restoreItem({ type: 'file', id: 'med_pdf', name: 'old.pdf', folderId: null });
		expect(notifications.showError).toHaveBeenCalledWith('fm_action_failed');
	});
});

describe('selection, stars and New folder (A17, A23, A27)', () => {
	const setup = (createFails = false) => {
		const gateway = {
			browse: vi.fn(() =>
				of({
					folder: null,
					breadcrumb: [{ id: 'fld_b', name: 'Banarasi' }],
					folders: [],
					files: [{ id: 'med_1' }, { id: 'med_2' }],
					total: 2,
					page: 1,
					pageSize: 200,
				}),
			),
			tree: vi.fn(() => of({ folders: [] })),
			storage: vi.fn(() => of(null)),
			star: vi.fn(() => of({ starred: true })),
			createFolder: vi.fn(() => (createFails ? throwError(() => new Error('taken')) : of({ id: 'fld_new' }))),
		};
		const modals = { open: vi.fn() };
		const params = new BehaviorSubject(convertToParamMap({ folder: 'fld_b' }));
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				provideTanStackQuery(new QueryClient()),
				{ provide: MediaLibraryGateway, useValue: gateway },
				{ provide: NgbModal, useValue: modals },
				{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
				{ provide: Router, useValue: { navigate: vi.fn() } },
				{
					provide: ActivatedRoute,
					useValue: { queryParamMap: params, snapshot: { queryParamMap: params.value } },
				},
				{
					provide: TranslocoService,
					useValue: {
						translate: (key: string) => key,
						getActiveLang: () => 'en',
						getTranslation: () => ({}),
					},
				},
				{ provide: ToastrService, useValue: toastStub() },
			],
		});
		TestBed.overrideComponent(FileManager, {
			set: { imports: [], template: '<ng-template #fmNewFolder></ng-template>' },
		});
		const fixture = TestBed.createComponent(FileManager);
		fixture.detectChanges();
		return { page: fixture.componentInstance, gateway, modals };
	};

	it('ticks files one by one or all at once, and forgets the ticks when the view changes', async () => {
		const { page } = setup();
		for (let i = 0; i < 20 && !page.result(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
		page.toggleSelect('med_1');
		expect([...page.selected()]).toEqual(['med_1']);
		page.toggleAll(true);
		expect([...page.selected()].sort()).toEqual(['med_1', 'med_2']);
		page.toggleSelect('med_1');
		expect([...page.selected()]).toEqual(['med_2']);
		page.openNav('recent');
		expect(page.selected().size).toBe(0);
	});

	it('stars and unstars a file for this admin', async () => {
		const { page, gateway } = setup();
		await page.star({ id: 'med_1', starred: false } as never);
		expect(gateway.star).toHaveBeenCalledWith({ targetType: 'file', targetId: 'med_1', starred: true });
	});

	it('creates a folder where the page is, and keeps the popup open with the reason when refused', async () => {
		const { page, gateway, modals } = setup();
		page.openNewFolder();
		expect(modals.open).toHaveBeenCalled();
		const close = vi.fn();
		await page.createFolder(close);
		expect(gateway.createFolder).not.toHaveBeenCalled();
		page.newFolderName.set('  Bridal 2027 ');
		await page.createFolder(close);
		expect(gateway.createFolder).toHaveBeenCalledWith({ name: 'Bridal 2027', parentId: 'fld_b' });
		expect(close).toHaveBeenCalled();
		const refused = setup(true);
		refused.page.newFolderName.set('Bridal 2027');
		const stay = vi.fn();
		await refused.page.createFolder(stay);
		expect(stay).not.toHaveBeenCalled();
		expect(refused.page.newFolderError()).toBe('fm_action_failed');
	});
});

describe('picking items (A39)', () => {
	const ordered = [
		{ type: 'folder' as const, id: 'fld_1' },
		{ type: 'file' as const, id: 'med_1' },
		{ type: 'file' as const, id: 'med_2' },
		{ type: 'file' as const, id: 'med_3' },
	];
	const ids = (selection: { folders: ReadonlySet<string>; files: ReadonlySet<string> }) => [
		...selection.folders,
		...selection.files,
	];

	it('picks one on a click, adds or removes with ⌘/Ctrl, and everything between with Shift', () => {
		expect(pickHow({})).toBe('only');
		expect(pickHow({ metaKey: true })).toBe('toggle');
		expect(pickHow({ ctrlKey: true })).toBe('toggle');
		expect(pickHow({ shiftKey: true, metaKey: true })).toBe('range');
		const one = pickItem(NO_SELECTION, ordered, ordered[1]!, 'only', null);
		expect(ids(one)).toEqual(['med_1']);
		const two = pickItem(one, ordered, ordered[3]!, 'toggle', ordered[1]!);
		expect(ids(two)).toEqual(['med_1', 'med_3']);
		expect(ids(pickItem(two, ordered, ordered[3]!, 'toggle', null))).toEqual(['med_1']);
		// Shift from the folder to the third file picks all four, folder included.
		expect(ids(pickItem(one, ordered, ordered[3]!, 'range', ordered[0]!))).toEqual([
			'fld_1',
			'med_1',
			'med_2',
			'med_3',
		]);
		// Shift with nothing to count from picks just that one.
		expect(ids(pickItem(one, ordered, ordered[2]!, 'range', null))).toEqual(['med_2']);
	});

	it('steps with the arrow keys and stops at either end', () => {
		expect(stepItem(ordered, null, 1)).toEqual(ordered[0]);
		expect(stepItem(ordered, null, -1)).toEqual(ordered[3]);
		expect(stepItem(ordered, ordered[1]!, 1)).toEqual(ordered[2]);
		expect(stepItem(ordered, ordered[3]!, 1)).toEqual(ordered[3]);
		expect(stepItem(ordered, ordered[0]!, -1)).toEqual(ordered[0]);
		expect(stepItem([], null, 1)).toBeNull();
	});

	it('break-it: a folder cannot move into itself or anything inside it; moving to where it is does nothing', () => {
		expect([...blockedTargets(rows, ['fld_p'])].sort()).toEqual(['fld_b', 'fld_p', 'fld_w']);
		expect([...blockedTargets(rows, [])]).toEqual([]);
		expect(commonPlace(['fld_b', 'fld_b'])).toBe('fld_b');
		expect(commonPlace([null, null])).toBeNull();
		expect(commonPlace([null, 'fld_b'])).toBeUndefined();
		expect(commonPlace([])).toBeUndefined();
	});
});

describe('menus, Move, Rename, Trash, Undo, drag and keys (A20–A28, A37, A39)', () => {
	const folder = {
		id: 'fld_w',
		parentId: 'fld_b',
		name: 'Wedding 2026',
		files: 77,
		bytes: 140,
		starred: false,
		location: 'Product photos › Banarasi',
		daysLeft: null,
		ancestors: ['fld_p', 'fld_b'],
		trashedAt: null,
		trashedFrom: null,
	};
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
	const setup = (
		options: {
			files?: Record<string, unknown>[];
			check?: { inUse: unknown[]; total: number; moving: number; keptFolders: number };
			answer?: 'yes' | 'no';
		} = {},
	) => {
		const result = { done: 2, inUse: [], undoId: 'audit_1' };
		const gateway = {
			browse: vi.fn(() =>
				of({
					folder: { id: 'fld_b', name: 'Banarasi' },
					breadcrumb: [{ id: 'fld_b', name: 'Banarasi' }],
					folders: [folder],
					files: options.files ?? [
						file('med_1'),
						file('med_2'),
						file('med_pdf', { name: 'chart.pdf', kind: 'file' }),
					],
					total: 3,
					page: 1,
					pageSize: 200,
				}),
			),
			tree: vi.fn(() => of({ folders: rows })),
			storage: vi.fn(() => of(null)),
			move: vi.fn(() => of(result)),
			trash: vi.fn(() => of(result)),
			checkTrash: vi.fn(() => of(options.check ?? { inUse: [], total: 1, moving: 1, keptFolders: 0 })),
			undo: vi.fn(() => of({ done: 1, inUse: [], undoId: null })),
			renameFile: vi.fn(() => of({ done: 1, inUse: [], undoId: 'audit_2' })),
			renameFolder: vi.fn(() => of({ done: 1, inUse: [], undoId: 'audit_3' })),
			star: vi.fn(() => of({ starred: true })),
			fileAddress: vi.fn(() => of({ url: 'https://spaces.test/original?signed' })),
		};
		const modals = {
			open: vi.fn(() => ({
				result: options.answer === 'no' ? Promise.reject('cancel') : Promise.resolve('yes'),
			})),
			hasOpenModals: vi.fn(() => false),
		};
		const notifications = { showSuccess: vi.fn(), showError: vi.fn() };
		const toasts = toastStub();
		const params = new BehaviorSubject(convertToParamMap({ folder: 'fld_b' }));
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				provideTanStackQuery(new QueryClient()),
				{ provide: MediaLibraryGateway, useValue: gateway },
				{ provide: NgbModal, useValue: modals },
				{ provide: NotificationService, useValue: notifications },
				{ provide: Router, useValue: { navigate: vi.fn() } },
				{
					provide: ActivatedRoute,
					useValue: { queryParamMap: params, snapshot: { queryParamMap: params.value } },
				},
				{
					provide: TranslocoService,
					useValue: {
						translate: (key: string, params?: Record<string, unknown>) =>
							params ? `${key} ${JSON.stringify(params)}` : key,
						getActiveLang: () => 'en',
						getTranslation: () => ({}),
					},
				},
				{ provide: ToastrService, useValue: toasts },
			],
		});
		TestBed.overrideComponent(FileManager, {
			set: {
				imports: [],
				template:
					'<section #fmMain></section><ng-template #fmConfirm></ng-template><ng-template #fmInUse></ng-template><ng-template #fmRename></ng-template><ng-template #fmKeys></ng-template><ng-template #fmNewFolder></ng-template>',
			},
		});
		const fixture = TestBed.createComponent(FileManager);
		fixture.detectChanges();
		return { page: fixture.componentInstance, gateway, modals, notifications, toasts };
	};
	const ready = async (page: FileManager) => {
		for (let i = 0; i < 40 && (!page.result() || !page.tree.data()); i += 1)
			await new Promise((resolve) => setTimeout(resolve, 5));
	};
	const click = (extra: Partial<MouseEvent> = {}) =>
		({ clientX: 10, clientY: 10, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra }) as never;
	const key = (name: string, extra: Partial<KeyboardEvent> = {}) =>
		({ key: name, target: document.body, preventDefault: vi.fn(), ...extra }) as unknown as KeyboardEvent;

	it('offers what fits: a folder, an image, another file, or several (A20–A22)', async () => {
		const { page } = setup();
		await ready(page);
		page.openMenu({ item: { type: 'folder', id: 'fld_w' }, event: click(), anchor: null });
		expect(page.menu()?.lines).toEqual(['open', 'new_inside', 'rename', 'move', 'star', 'divider', 'trash']);
		page.openMenu({ item: { type: 'file', id: 'med_1' }, event: click(), anchor: null });
		expect(page.menu()?.lines).toEqual([
			'rename',
			'download_original',
			'share',
			'move',
			'star',
			'divider',
			'trash',
		]);
		page.openMenu({ item: { type: 'file', id: 'med_pdf' }, event: click(), anchor: null });
		expect(page.menu()?.lines).toEqual([
			'preview',
			'rename',
			'download',
			'share',
			'move',
			'star',
			'divider',
			'trash',
		]);
		page.pick({ type: 'file', id: 'med_1' }, click({ metaKey: true }));
		// A right-click on something already picked keeps the pick: the menu acts on both.
		page.openMenu({ item: { type: 'file', id: 'med_1' }, event: click(), anchor: null });
		expect(page.menu()?.lines).toEqual(['move', 'divider', 'trash']);
		expect(page.chosenWhat()).toBe('fm_files_other {"count":"2"}');
		page.closeMenu();
		expect(page.menu()).toBeNull();
	});

	it('greys where the items are, and a chosen folder with everything inside it', async () => {
		const { page } = setup();
		await ready(page);
		page.pick({ type: 'folder', id: 'fld_w' }, click());
		page.pick({ type: 'file', id: 'med_1' }, click({ metaKey: true }));
		expect([...page.moveBlocked()]).toEqual(['fld_w']);
		expect(page.moveHere()).toBe('fld_b');
	});

	it('moves what is picked, with Undo in the toast for 8 seconds; the link or ⌘/Ctrl+Z undoes it once', async () => {
		const { page, gateway, toasts, notifications } = setup();
		await ready(page);
		page.pick({ type: 'file', id: 'med_1' }, click());
		page.pick({ type: 'file', id: 'med_2' }, click({ shiftKey: true }));
		await page.moveChosen('fld_w');
		expect(gateway.move).toHaveBeenCalledWith({ folderIds: [], fileIds: ['med_1', 'med_2'], toFolderId: 'fld_w' });
		expect(toasts.success).toHaveBeenCalledWith(
			'fm_moved {"what":"fm_files_other {\\"count\\":\\"2\\"}","folder":"Wedding 2026"}',
			undefined,
			expect.objectContaining({ toastComponent: FmUndoToast, timeOut: UNDO_SECONDS * 1000 }),
		);
		expect(page.chosenCount()).toBe(0);
		toasts.action.next('undo');
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(gateway.undo).toHaveBeenCalledWith('audit_1');
		expect(toasts.remove).toHaveBeenCalledWith(7);
		expect(notifications.showSuccess).toHaveBeenCalledWith('fm_undone');
		// Once only: ⌘/Ctrl+Z now has nothing to undo.
		page.onKey(key('z', { metaKey: true }));
		expect(gateway.undo).toHaveBeenCalledTimes(1);
	});

	it('trashes plain files straight away with Undo, and asks first for a folder (A25)', async () => {
		const { page, gateway, modals } = setup();
		await ready(page);
		page.pick({ type: 'file', id: 'med_pdf' }, click());
		await page.trashChosen(false);
		expect(gateway.checkTrash).not.toHaveBeenCalled();
		expect(modals.open).not.toHaveBeenCalled();
		expect(gateway.trash).toHaveBeenCalledWith({ folderIds: [], fileIds: ['med_pdf'] });

		page.pick({ type: 'folder', id: 'fld_w' }, click());
		await page.trashChosen(false);
		expect(gateway.checkTrash).toHaveBeenCalledWith({ folderIds: ['fld_w'], fileIds: [] });
		expect(page.ask()).toMatchObject({ kind: 'trash', folder: { id: 'fld_w' }, count: 1 });
		expect(gateway.trash).toHaveBeenLastCalledWith({ folderIds: ['fld_w'], fileIds: [] });
	});

	it('the Delete key asks first, even for one file; a no keeps it', async () => {
		const { page, gateway, modals } = setup({ answer: 'no' });
		await ready(page);
		page.pick({ type: 'file', id: 'med_pdf' }, click());
		page.onKey(key('Delete'));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(modals.open).toHaveBeenCalledTimes(1);
		expect(page.ask()).toMatchObject({ kind: 'trash', fileName: 'chart.pdf' });
		expect(gateway.trash).not.toHaveBeenCalled();
	});

	it('lists images the website uses and moves only the others after a yes (A26)', async () => {
		const check = {
			inUse: [{ id: 'med_1', name: 'med_1.jpg', usedOn: ['Home › Hero banner 1'], bytes: 6, thumbnailUrl: null }],
			total: 2,
			moving: 1,
			keptFolders: 0,
		};
		const { page, gateway, modals, toasts } = setup({
			files: [file('med_1', { usedOn: 1 }), file('med_2')],
			check,
		});
		await ready(page);
		page.pick({ type: 'file', id: 'med_1' }, click());
		page.pick({ type: 'file', id: 'med_2' }, click({ ctrlKey: true }));
		await page.trashChosen(false);
		expect(gateway.checkTrash).toHaveBeenCalledWith({ folderIds: [], fileIds: ['med_1', 'med_2'] });
		expect(page.inUse()).toEqual(check);
		expect(modals.open).toHaveBeenCalledTimes(1);
		expect(gateway.trash).toHaveBeenCalledWith({ folderIds: [], fileIds: ['med_1', 'med_2'] });
		expect(toasts.success.mock.calls[0]?.[0]).toBe('fm_trashed {"what":"fm_items_other {\\"count\\":\\"1\\"}"}');
	});

	it('stops when every chosen image is used: nothing to move, only Close', async () => {
		const { page, gateway } = setup({
			files: [file('med_1', { usedOn: 2 })],
			check: {
				inUse: [{ id: 'med_1', name: 'med_1.jpg', usedOn: ['a', 'b'] }],
				total: 1,
				moving: 0,
				keptFolders: 0,
			},
		});
		await ready(page);
		page.pick({ type: 'file', id: 'med_1' }, click());
		await page.trashChosen(false);
		expect(gateway.trash).not.toHaveBeenCalled();
	});

	it('renames a file keeping its extension, does nothing when unchanged, and keeps the popup on a refusal (A24)', async () => {
		const { page, gateway, toasts } = setup();
		await ready(page);
		page.pick({ type: 'file', id: 'med_pdf' }, click());
		page.onKey(key('F2'));
		expect(page.renaming()).toMatchObject({ type: 'file', base: 'chart', extension: '.pdf' });
		const close = vi.fn();
		await page.saveRename(close);
		expect(gateway.renameFile).not.toHaveBeenCalled();
		expect(close).toHaveBeenCalledTimes(1);
		page.renaming.update((current) => (current ? { ...current, base: 'size chart 2027' } : current));
		await page.saveRename(close);
		expect(gateway.renameFile).toHaveBeenCalledWith('med_pdf', 'size chart 2027.pdf');
		expect(toasts.success).toHaveBeenCalledWith('fm_renamed', undefined, expect.anything());
		gateway.renameFile.mockReturnValueOnce(throwError(() => new Error('bad')) as never);
		page.renaming.update((current) => (current ? { ...current, base: 'a/b' } : current));
		const stay = vi.fn();
		await page.saveRename(stay);
		expect(stay).not.toHaveBeenCalled();
		expect(page.renameError()).toBe('fm_action_failed');
	});

	it('drags picked files onto a folder card, never a folder into itself (A28)', async () => {
		const { page, gateway } = setup();
		await ready(page);
		const types: string[] = [];
		const dataTransfer = {
			types,
			setData: (type: string) => types.push(type),
			setDragImage: vi.fn(),
			effectAllowed: '',
			dropEffect: '',
		};
		const drag = (extra: Record<string, unknown> = {}) =>
			({ dataTransfer, preventDefault: vi.fn(), clientX: 50, clientY: 60, ...extra }) as unknown as DragEvent;
		page.dragStart({ type: 'file', id: 'med_2' }, drag());
		expect(types).toEqual([MEDIA_DRAG_TYPE]);
		expect([...page.selected()]).toEqual(['med_2']);
		expect([...page.draggedFiles()]).toEqual(['med_2']);
		const over = drag();
		page.dragOver(folder as never, over);
		expect(over.preventDefault).toHaveBeenCalled();
		expect(page.dropOn()).toBe('fld_w');
		page.trackDrag(over);
		expect(page.ghostAt()).toEqual({ x: 66, y: 76 });
		await page.drop(folder as never, drag());
		expect(gateway.move).toHaveBeenCalledWith({ folderIds: [], fileIds: ['med_2'], toFolderId: 'fld_w' });
		expect(page.dragging()).toBeNull();

		page.dragStart({ type: 'folder', id: 'fld_w' }, drag());
		const onItself = drag();
		page.dragOver(folder as never, onItself);
		expect(onItself.preventDefault).not.toHaveBeenCalled();
		expect(page.dropOn()).toBeNull();
	});

	it('keys: Esc clears, ⌘/Ctrl+A picks everything, arrows step, ? lists the keys; typing in a box is left alone', async () => {
		const { page, modals } = setup();
		await ready(page);
		page.onKey(key('a', { ctrlKey: true }));
		expect(page.chosenCount()).toBe(4);
		page.onKey(key('Escape'));
		expect(page.chosenCount()).toBe(0);
		page.onKey(key('ArrowDown'));
		page.onKey(key('ArrowDown'));
		expect([...page.selected()]).toEqual(['med_1']);
		page.onKey(key('?'));
		expect(modals.open).toHaveBeenCalledTimes(1);
		const box = document.createElement('input');
		page.onKey(key('a', { ctrlKey: true, target: box }));
		expect(page.chosenCount()).toBe(1);
	});

	it('previews in a new tab cut off from this page, and downloads without leaving it', async () => {
		const { page, gateway } = setup();
		await ready(page);
		const tab = { opener: {}, location: { href: '' }, close: vi.fn() };
		const open = vi.spyOn(window, 'open').mockReturnValue(tab as never);
		await page.openFile({ id: 'med_pdf' } as never, 'view');
		expect(open).toHaveBeenCalledWith('', '_blank');
		expect(tab.opener).toBeNull();
		expect(tab.location.href).toBe('https://spaces.test/original?signed');
		const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
		await page.openFile({ id: 'med_pdf' } as never, 'save');
		expect(gateway.fileAddress).toHaveBeenLastCalledWith('med_pdf', 'save');
		expect(clicked).toHaveBeenCalledTimes(1);
		open.mockRestore();
		clicked.mockRestore();
	});
});
