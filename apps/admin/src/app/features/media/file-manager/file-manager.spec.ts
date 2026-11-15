import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MediaLibraryGateway } from '@core/media-library/media-library.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { fileExtension, fileKind, fileTypeLabel } from './file-kinds';
import { FileManager, SEARCH_PAUSE_MS } from './file-manager';
import { buildTree, parentsOf } from './fm-sidebar';

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
				{ provide: TranslocoService, useValue: { translate: (key: string) => key, getActiveLang: () => 'en' } },
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
				{ provide: TranslocoService, useValue: { translate: (key: string) => key, getActiveLang: () => 'en' } },
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
