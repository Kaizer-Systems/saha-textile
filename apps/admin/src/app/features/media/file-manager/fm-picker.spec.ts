import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import type { MediaFileRow } from '@core/media-library/media-library.gateway';

import { FmPicker, isRawFile } from './fm-picker';

vi.mock('@data-access/queries/media-library.queries', async (original) => ({
	...(await original<object>()),
	injectMediaBrowseQuery: () => ({ data: () => undefined }),
	injectMediaTreeQuery: () => ({ data: () => undefined }),
}));

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

const setup = (max = 6, already = 2) => {
	const modal = { close: vi.fn(), dismiss: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: modal },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(FmPicker, { set: { imports: [], template: '' } });
	const picker = TestBed.createComponent(FmPicker).componentInstance;
	picker.start({
		title: 'fm_pick_title',
		accept: 'image',
		max,
		already,
		profile: { key: 'product_3x4', name: 'Product 3:4', icon: false },
	});
	return { picker, modal };
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
});
