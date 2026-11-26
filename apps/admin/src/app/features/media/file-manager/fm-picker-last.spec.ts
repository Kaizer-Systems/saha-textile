import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MediaLibraryGateway, type MediaFileRow } from '@core/media-library/media-library.gateway';
import { MediaUploads } from '@core/media-library/media-uploads';

import { FmDetails } from './fm-details';
import { FmPicker } from './fm-picker';
import { FmUploadFlow } from './fm-upload-flow';
import { FmUploadPopups } from './fm-upload-popups';

const q = vi.hoisted(() => ({
	browse: [] as Array<{ params: () => unknown; enabled?: () => unknown }>,
	data: undefined as unknown,
}));
vi.mock('@data-access/queries/media-library.queries', async (original) => ({
	...(await original<object>()),
	injectMediaBrowseQuery: (params: () => unknown, enabled?: () => unknown) => {
		q.browse.push({ params, enabled });
		return { data: () => q.data };
	},
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

interface Options {
	profile?: boolean;
	answer?: unknown;
	details?: unknown;
	popups?: boolean;
}

function setup(options: Options = {}) {
	q.browse = [];
	const modal = { close: vi.fn(), dismiss: vi.fn() };
	const gateway = {
		details: vi.fn(() => throwError(() => new Error('down'))),
		addVersions: vi.fn(() => throwError(() => new Error('down'))),
	};
	const uploads = { watchVersions: vi.fn() };
	const flow = { open: vi.fn() };
	const queries = { invalidateQueries: vi.fn(async () => undefined) };
	const details = { start: vi.fn(async () => undefined), details: vi.fn(() => options.details) };
	const answer = 'answer' in options ? options.answer : new Error('closed');
	const modals = {
		open: vi.fn((content: unknown) => {
			const result = answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
			result.catch(() => undefined);
			return { componentInstance: content === FmDetails ? details : { start: vi.fn() }, result };
		}),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: modal },
			{ provide: NgbModal, useValue: modals },
			{ provide: MediaLibraryGateway, useValue: gateway },
			{ provide: MediaUploads, useValue: uploads },
			{
				provide: TranslocoService,
				useValue: { translate: vi.fn((key: string) => key), getActiveLang: () => 'en' },
			},
			{ provide: QueryClient, useValue: queries },
		],
	});
	TestBed.overrideComponent(FmUploadPopups, { set: { imports: [], template: POPUP_TEMPLATES } });
	TestBed.overrideComponent(FmPicker, {
		set: {
			imports: options.popups ? [FmUploadPopups] : [],
			template: options.popups ? '<app-fm-upload-popups /><input #fmPickFiles type="file" />' : '',
			providers: [{ provide: FmUploadFlow, useValue: flow }],
		},
	});
	const fixture = TestBed.createComponent(FmPicker);
	fixture.detectChanges();
	const picker = fixture.componentInstance;
	picker.start({
		title: 'fm_pick_title',
		accept: 'image',
		max: 6,
		already: 0,
		profile: options.profile === false ? null : { key: 'product_3x4', name: 'Product 3:4', icon: false },
	} as never);
	return { picker, modal, modals, gateway, uploads, flow, details, queries };
}

describe('the Media picker: the last cases', () => {
	it('asks for the folder, the search, the profile and the hidden photos, and the recent list only in My files', () => {
		const { picker } = setup({ profile: false });
		const [browse, recent] = q.browse;
		expect(browse?.params()).toMatchObject({ view: 'folder' });
		expect(browse?.params()).not.toHaveProperty('profile');
		expect(recent?.enabled?.()).toBe(true);
		expect(picker.recentRows()).toEqual([]);
		picker.showWithout.set(true);
		picker.openFolder('fld_1');
		picker.search.set('red');
		expect(browse?.params()).toMatchObject({ folderId: 'fld_1', search: 'red', showWithout: true });
		expect(recent?.params()).toMatchObject({ view: 'recent', pageSize: 6 });
		expect(recent?.enabled?.()).toBe(false);
		expect(picker.recentRows()).toEqual([]);
		picker.openNav('trash');
		expect(picker.nav()).toBe('folder');
		const withProfile = setup();
		expect(q.browse[0]?.params()).toMatchObject({ profile: 'product_3x4' });
		withProfile.picker.openNav('recent');
		expect(withProfile.picker.recentRows()).toEqual([]);
	});

	it('refuses a photo being replaced, chips with no profile or versions, and a tile with no version', () => {
		const { picker } = setup({ profile: false });
		expect(picker.refusal(row('a', { replacing: 'making' } as never))).toBe('fm_pick_not_ready');
		expect(picker.chips(row('a', { fitting: undefined } as never))).toEqual([]);
		expect(picker.chips(row('a'))[0]?.label).toBe('profile_fill_white');
		picker.toggle(row('b', { fitting: undefined } as never));
		expect(picker.chosen().get('b')?.versionId).toBeNull();
		expect(picker.note().text).toBe('fm_pick_one');
		picker.toggle(row('c'));
		expect(picker.note().text).toBe('fm_pick_some');
	});

	it('says nothing is chosen, chooses nothing, and words one photo with no version kept', () => {
		const { picker, modal } = setup();
		expect(picker.note().text).toBe('fm_pick_nothing');
		picker.choose();
		expect(modal.close).not.toHaveBeenCalled();
		picker.toggle(row('a', { fitting: undefined } as never), undefined);
		expect(picker.note().text).toBe('fm_pick_no_version');
	});

	it('Make one: details it cannot read, a closed popup, and a version it could not add', async () => {
		const closed = setup();
		await closed.picker.makeOne(row('a'));
		expect(closed.gateway.addVersions).not.toHaveBeenCalled();
		const { picker, uploads } = setup({ answer: { versions: [{ profileKey: 'p', fill: 'white' }], label: 'P' } });
		await picker.makeOne(row('a'));
		expect(uploads.watchVersions).not.toHaveBeenCalled();
		expect(picker.warning()).toBe('fm_action_failed');
	});

	it('names the folder it is in, opens the file chooser, and uploads with no profile', () => {
		q.data = { breadcrumb: [{ id: 'fld_1', name: 'Wedding' }] };
		const { picker, flow } = setup({ profile: false, popups: true });
		picker.openFolder('fld_1');
		expect(picker.herePlace()).toBe('fm_my_files › Wedding');
		const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
		picker.sidebarUpload('files');
		expect(click).toHaveBeenCalled();
		picker.filesPicked({ files: null, value: 'x' } as unknown as HTMLInputElement);
		expect(flow.open).not.toHaveBeenCalled();
		picker.filesPicked({
			files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })],
			value: 'x',
		} as unknown as HTMLInputElement);
		expect(flow.open).toHaveBeenCalledWith(
			expect.anything(),
			'fld_1',
			'fm_my_files › Wedding',
			expect.anything(),
			null,
		);
		picker.newFolder();
		q.data = undefined;
	});

	it('Add text: closed, no text back, no gap kept, and a gap with languages still empty', async () => {
		const { picker, queries } = setup({ details: undefined });
		await picker.addText('a');
		expect(queries.invalidateQueries).toHaveBeenCalled();
		picker.altGaps.set(new Map([['a', { name: 'a.jpg', locales: ['bn', 'hi'] }]]));
		await picker.addText('a');
		expect(picker.altGaps().get('a')?.locales).toEqual(['bn', 'hi']);
	});
});
