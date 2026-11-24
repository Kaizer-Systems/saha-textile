import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { FmReprocess, type FmReprocessPhoto } from './fm-reprocess';

const profileData = vi.hoisted(() => ({ list: [] as unknown, brand: undefined as unknown }));
vi.mock('@data-access/queries/media-profiles.queries', async (original) => ({
	...(await original<object>()),
	injectMediaProfilesQuery: () => ({ data: () => profileData.list }),
}));
vi.mock('@core/brand/brand.gateway', async (original) => ({
	...(await original<object>()),
	injectBrandQuery: () => ({ data: () => profileData.brand }),
}));

const profile = (key: string, extra: Record<string, unknown> = {}) => ({
	key,
	name: key,
	builtIn: true,
	shape: { width: 3, height: 4 },
	roles: ['card'],
	widths: { card: [400] },
	quality: null,
	fills: ['white', 'blur', 'crop'],
	minSize: { edge: 'short', px: 1200, mode: 'warn' },
	maxBytes: 25 * 1024 * 1024,
	accepts: ['image/jpeg', 'image/png'],
	mainPhotoOnly: false,
	enabled: true,
	version: 1,
	...extra,
});

/** The brief's photo: banarasi-weave-closeup.png, 4800 × 2400 (2:1), C01. */
const WEAVE: FmReprocessPhoto = {
	id: 'med_w',
	name: 'banarasi-weave-closeup.png',
	width: 4800,
	height: 2400,
	bytes: 1_000_000,
	contentType: 'image/png',
	thumbnailUrl: 'https://cdn/weave.webp',
};

function setup(list: unknown, template = '<ng-template #fmReprocessNotes></ng-template>') {
	profileData.list = list;
	const modal = { close: vi.fn(), dismiss: vi.fn() };
	const modals = { open: vi.fn(() => ({ result: Promise.resolve('yes') })) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: modal },
			{ provide: NgbModal, useValue: modals },
			{
				provide: TranslocoService,
				useValue: {
					translate: (key: string, params?: Record<string, unknown>) =>
						params && Object.keys(params).length ? `${key}(${Object.values(params).join(',')})` : key,
					getActiveLang: () => 'en',
					getTranslation: () => ({}),
				},
			},
		],
	});
	TestBed.overrideComponent(FmReprocess, { set: { imports: [], template } });
	const fixture = TestBed.createComponent(FmReprocess);
	fixture.detectChanges();
	return { popup: fixture.componentInstance, modal, modals };
}

const lineOf = (popup: FmReprocess, key: string) => popup.lines().find((row) => row.profile.key === key) as never;

describe('Reprocess: the last cases', () => {
	it('reads nothing before it starts, uses the theme colour and the sample picture, and works out shapes', () => {
		const { popup } = setup(undefined);
		expect([popup.photo(), popup.brandColour(), popup.lines()]).toEqual([null, '#417394', []]);
		expect(popup.picture()).toBe(popup.sample);
		const own = profile('own', { builtIn: false, name: 'Lookbook', shape: null }) as never;
		expect(popup.name(own)).toBe('Lookbook');
		expect(popup.shape(own)).toEqual({ width: 26, height: 9 });
		expect(popup.ratio(own)).toBe('1 / 1');
		expect(popup.photoShape()).toBe('');
		popup.start({ photos: [{ ...WEAVE, thumbnailUrl: null } as never] });
		expect(popup.picture()).toBe(popup.sample);
		expect(popup.ratio(own)).toBe('4800 / 2400');
		expect(popup.photoShape()).toBe('2:1');
		profileData.brand = { themeColor: '#123456' };
		expect(setup([]).popup.brandColour()).toBe('#123456');
		profileData.brand = undefined;
	});

	it('many photos: lines say whether each keeps the shape, and the footer counts photos and notes', () => {
		const { popup } = setup([
			{ profile: profile('keep', { shape: null, fills: [] }), photos: 0 },
			{ profile: profile('product_3x4'), photos: 0 },
		]);
		popup.start({ photos: [WEAVE, { ...WEAVE, id: 'med_2' }] });
		expect(popup.picture()).toBe(popup.sample);
		expect(popup.ratio(profile('product_3x4') as never)).toBe('3 / 4');
		expect(popup.lineNote(lineOf(popup, 'keep'))).toBe('fm_rp_keeps_shape');
		expect(popup.lineNote(lineOf(popup, 'product_3x4'))).toBe('fm_rp_many_shapes');
		popup.toggleLine(lineOf(popup, 'product_3x4'));
		expect(popup.footer()).toContain('fm_rp_footer_many');
	});

	it('one photo: the other-shape line, ticking and unticking lines and fills, and a line with every fill made', () => {
		const { popup } = setup([
			{ profile: profile('product_3x4', { minSize: null }), photos: 0 },
			{ profile: profile('heavy', { maxBytes: 10, minSize: null }), photos: 0 },
		]);
		popup.start({
			photos: [WEAVE],
			versions: [
				{ id: 'product_3x4.white', state: 'ready' },
				{ id: 'product_3x4.blur', state: 'ready' },
				{ id: 'product_3x4.crop', state: 'ready' },
			],
		});
		expect(lineOf(popup, 'heavy')).toMatchObject({ refusal: 'fm_rp_too_large' });
		expect(popup.lineNote(lineOf(popup, 'product_3x4'))).toBe('fm_rp_other_shape(2:1,3:4)');
		popup.toggleLine(lineOf(popup, 'product_3x4'));
		expect(popup.count()).toBe(0);
		popup.toggleFill(lineOf(popup, 'heavy'), 'blur');
		expect(popup.count()).toBe(1);
		popup.toggleLine(lineOf(popup, 'heavy'));
		expect(popup.count()).toBe(0);
	});

	it('notes a deep crop and a smaller photo, and makes without asking when the question is not drawn', async () => {
		const tall = { ...WEAVE, width: 1000, height: 4000 };
		const { popup, modal, modals } = setup(
			[
				{
					profile: profile('wide', {
						shape: { width: 3, height: 1 },
						minSize: { edge: 'short', px: 1200, mode: 'warn' },
					}),
					photos: 0,
				},
			],
			'',
		);
		await popup.make();
		expect(modal.close).not.toHaveBeenCalled();
		popup.start({ photos: [tall] });
		popup.toggleFill(lineOf(popup, 'wide'), 'crop');
		const notes = (lineOf(popup, 'wide') as { notes: string[] }).notes;
		expect(notes.some((note) => note.startsWith('fm_rp_crop_height'))).toBe(true);
		expect(notes.some((note) => note.startsWith('fm_rp_smaller'))).toBe(true);
		expect(popup.footer()).toContain('fm_rp_footer_notes');
		await popup.make();
		expect(modals.open).not.toHaveBeenCalled();
		expect(modal.close).toHaveBeenCalledWith(
			expect.objectContaining({ versions: [{ profileKey: 'wide', fill: 'crop' }] }),
		);
	});
});
