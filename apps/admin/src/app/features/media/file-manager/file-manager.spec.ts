import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MediaLibraryGateway } from '@core/media-library/media-library.gateway';

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
