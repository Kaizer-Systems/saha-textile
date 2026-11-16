import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import type { MediaFileRow } from '@core/media-library/media-library.gateway';

import { FmFileList } from './fm-file-list';

const list = () => {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(FmFileList, { set: { imports: [], template: '' } });
	return TestBed.createComponent(FmFileList).componentInstance;
};
const row = (extra: Partial<MediaFileRow>) => ({ thumbnailUrl: 'https://cdn.test/t.webp', ...extra }) as MediaFileRow;

describe('FmFileList', () => {
	it('a photo whose files are being made again keeps its live copy, and the row says why (steps 3b–3d)', () => {
		const view = list();
		expect(view.adding(row({ replacing: 'making' }))).toBe(true);
		expect(view.adding(row({ replacing: 'failed' }))).toBe(false);
		expect(view.remakeWords(row({ replacing: 'making' }))).toBe('fm_replacing');
		expect(view.remakeWords(row({ replacing: 'making', replacingWhy: 'replace' }))).toBe('fm_replacing');
		expect(view.remakeWords(row({ replacing: 'queued', replacingWhy: 'focal' }))).toBe('fm_remaking_crops');
		expect(view.remakeWords(row({ replacing: 'queued', replacingWhy: 'rename' }))).toBe('fm_renaming_files');
		expect(view.remakeWords(row({ replacing: 'making', replacingWhy: 'refresh' }))).toBe('fm_refreshing');
	});
});
