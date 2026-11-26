import { TestBed } from '@angular/core/testing';

import { describe, expect, it, vi } from 'vitest';

import { FmFileList } from './fm-file-list';

import type { MediaFileRow, MediaFolderRow } from '@core/media-library/media-library.gateway';

const row = (id: string, extra: Partial<MediaFileRow> = {}) =>
	({ id, name: `${id}.jpg`, folderId: 'fld_1', state: 'ready', replacing: null, ...extra }) as MediaFileRow;

function list(files: MediaFileRow[], selected: string[] = []) {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(FmFileList, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(FmFileList);
	fixture.componentRef.setInput('files', files);
	fixture.componentRef.setInput('selected', new Set(selected));
	return fixture.componentInstance;
}

describe('FmFileList: the last cases', () => {
	it('hands over a file or a folder for the bin, a row’s own reference, and its menu', () => {
		const view = list([row('a')]);
		expect(view.fileItem(row('a'))).toEqual({ type: 'file', id: 'a', name: 'a.jpg', folderId: 'fld_1' });
		expect(view.folderItem({ id: 'f1', name: 'Wedding', parentId: null } as MediaFolderRow)).toEqual({
			type: 'folder',
			id: 'f1',
			name: 'Wedding',
			folderId: null,
		});
		expect(view.ref(row('a'))).toEqual({ type: 'file', id: 'a' });
		const menus: unknown[] = [];
		view.menu.subscribe((menu) => menus.push(menu));
		const anchor = document.createElement('button');
		const event = { stopPropagation: vi.fn(), currentTarget: anchor } as unknown as MouseEvent;
		view.more(row('a'), event);
		expect(menus).toEqual([{ item: { type: 'file', id: 'a' }, event, anchor }]);
		view.alone(event);
		expect((event.stopPropagation as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
	});

	it('knows when every file is picked, and which files are still being made', () => {
		expect(list([]).allSelected()).toBe(false);
		expect(list([row('a'), row('b')], ['a']).allSelected()).toBe(false);
		const view = list([row('a'), row('b')], ['a', 'b']);
		expect(view.allSelected()).toBe(true);
		expect(view.pending(row('a', { state: 'processing' }))).toBe(true);
		expect(view.pending(row('a', { state: 'processing', replacing: 'making', thumbnailUrl: 'u' } as never))).toBe(
			false,
		);
		expect(view.pending(row('a'))).toBe(false);
	});
});
