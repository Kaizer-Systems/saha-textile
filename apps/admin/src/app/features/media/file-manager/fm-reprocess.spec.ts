import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { FmReprocess, type FmReprocessPhoto } from './fm-reprocess';

const profileData = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('@data-access/queries/media-profiles.queries', async (original) => ({
	...(await original<object>()),
	injectMediaProfilesQuery: () => ({ data: () => profileData.list }),
}));
vi.mock('@core/brand/brand.gateway', async (original) => ({
	...(await original<object>()),
	injectBrandQuery: () => ({ data: () => ({ themeColor: '#7a1f3d' }) }),
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

const setup = (confirm = true) => {
	profileData.list = [
		profile('product_3x4'),
		profile('hero_21x9', { shape: { width: 21, height: 9 }, fills: ['crop', 'blur', 'colour'] }),
		profile('blog_cover_2x1', { shape: { width: 2, height: 1 }, fills: ['crop', 'blur'] }),
		profile('logo_keep_shape', { shape: null, fills: [] }),
		profile('square_1x1', { shape: { width: 1, height: 1 }, minSize: { edge: 'short', px: 3000, mode: 'refuse' } }),
		profile('link_preview', { mainPhotoOnly: true }),
		profile('hero_16x9', { enabled: false }),
		profile('tiff_only', { accepts: ['image/tiff'] }),
	].map((entry) => ({ profile: entry, photos: 0 }));
	const modal = { close: vi.fn(), dismiss: vi.fn() };
	const modals = {
		open: vi.fn(() => ({ result: confirm ? Promise.resolve('yes') : Promise.reject(new Error('no')) })),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: modal },
			{ provide: NgbModal, useValue: modals },
			{
				provide: TranslocoService,
				useValue: {
					translate: (key: string, params?: Record<string, unknown>) =>
						params?.['pct'] !== undefined ? `${key}:${params['pct']}` : key,
					getActiveLang: () => 'en',
					getTranslation: () => ({}),
				},
			},
		],
	});
	TestBed.overrideComponent(FmReprocess, {
		set: { imports: [], template: '<ng-template #fmReprocessNotes></ng-template>' },
	});
	const fixture = TestBed.createComponent(FmReprocess);
	fixture.detectChanges();
	return { popup: fixture.componentInstance, modal, modals };
};

const line = (popup: FmReprocess, key: string) => popup.lines().find((row) => row.profile.key === key);

describe('Reprocess (media step 3a: C01, C02, C07)', () => {
	it('lists the profiles people choose, with the fills this photo may get and what it already has', () => {
		const { popup } = setup();
		popup.start({
			photos: [WEAVE],
			versions: [
				{ id: 'blog_cover_2x1.as_is', state: 'ready' },
				{ id: 'product_3x4.white', state: 'ready' },
				{ id: 'product_3x4.blur', state: 'making' },
				{ id: 'hero_21x9.crop', state: 'failed' },
			],
		});
		// Made by itself, switched off, or not for PNG: not offered.
		expect(popup.lines().map((row) => row.profile.key)).toEqual([
			'product_3x4',
			'hero_21x9',
			'blog_cover_2x1',
			'logo_keep_shape',
			'square_1x1',
		]);
		expect(line(popup, 'blog_cover_2x1')).toMatchObject({ fits: true, fills: ['as_is'] });
		expect([...(line(popup, 'blog_cover_2x1')?.made ?? [])]).toEqual([['as_is', 'ready']]);
		expect(line(popup, 'product_3x4')?.fills).toEqual(['white', 'blur', 'crop']);
		expect([...(line(popup, 'product_3x4')?.made ?? [])]).toEqual([
			['white', 'ready'],
			['blur', 'making'],
		]);
		// A failed version is not “made”: it can be ticked again.
		expect(line(popup, 'hero_21x9')?.made.size).toBe(0);
		expect(line(popup, 'logo_keep_shape')).toMatchObject({ fits: true, fills: ['as_is'] });
		expect(line(popup, 'square_1x1')?.refusal).toBe('fm_rp_too_small');
		expect(popup.lineNote(line(popup, 'blog_cover_2x1') as never)).toBe('fm_rp_same_shape');
		expect(popup.lineNote(line(popup, 'logo_keep_shape') as never)).toBe('fm_rp_keeps_shape');
		expect(popup.lineNote(line(popup, 'hero_21x9') as never)).toBe('fm_rp_tick_for_fills');
		// A profile the photo already has: ticked and locked; more fills go on its cards. Refused: locked.
		expect(popup.lineChecked(line(popup, 'product_3x4') as never)).toBe(true);
		expect(popup.lineLocked(line(popup, 'product_3x4') as never)).toBe(true);
		expect(popup.lineChecked(line(popup, 'hero_21x9') as never)).toBe(false);
		expect(popup.lineLocked(line(popup, 'hero_21x9') as never)).toBe(false);
		expect(popup.lineLocked(line(popup, 'square_1x1') as never)).toBe(true);
	});

	it('ticking a profile picks its first fill not made yet; fills toggle; made ones stay locked', () => {
		const { popup } = setup();
		popup.start({ photos: [WEAVE], versions: [{ id: 'product_3x4.white', state: 'ready' }] });
		popup.toggleLine(line(popup, 'product_3x4') as never);
		expect([...(line(popup, 'product_3x4')?.ticked ?? [])]).toEqual(['blur']);
		popup.toggleFill(line(popup, 'product_3x4') as never, 'crop');
		popup.toggleFill(line(popup, 'product_3x4') as never, 'white');
		expect([...(line(popup, 'product_3x4')?.ticked ?? [])]).toEqual(['blur', 'crop']);
		popup.toggleFill(line(popup, 'product_3x4') as never, 'blur');
		popup.toggleFill(line(popup, 'product_3x4') as never, 'crop');
		expect(line(popup, 'product_3x4')?.ticked.size).toBe(0);
		expect(popup.count()).toBe(0);
	});

	it('a crop that keeps little is a note; Make asks once (C02), then answers with the versions and a label', async () => {
		const { popup, modal, modals } = setup();
		popup.start({ photos: [WEAVE] });
		popup.toggleLine(line(popup, 'product_3x4') as never);
		popup.toggleFill(line(popup, 'product_3x4') as never, 'crop');
		popup.toggleLine(line(popup, 'hero_21x9') as never);
		// 2:1 into 3:4 keeps the middle 38% of the width; 2:1 into 21:9 keeps 86%, no note.
		expect(line(popup, 'product_3x4')?.notes).toEqual(['fm_rp_crop_width:38']);
		expect(line(popup, 'hero_21x9')?.notes).toEqual([]);
		expect(popup.count()).toBe(3);
		expect(popup.bytes()).toBe(1_050_000);
		await popup.make();
		expect(modals.open).toHaveBeenCalledTimes(1);
		expect(modal.close).toHaveBeenCalledWith({
			versions: [
				{ profileKey: 'product_3x4', fill: 'white' },
				{ profileKey: 'product_3x4', fill: 'crop' },
				{ profileKey: 'hero_21x9', fill: 'crop' },
			],
			label: expect.stringContaining('profile_name_hero_21x9'),
		});
	});

	it('going back from the notes makes nothing', async () => {
		const { popup, modal } = setup(false);
		popup.start({ photos: [WEAVE] });
		popup.toggleLine(line(popup, 'product_3x4') as never);
		popup.toggleFill(line(popup, 'product_3x4') as never, 'crop');
		await popup.make();
		expect(modal.close).not.toHaveBeenCalled();
	});

	it('for many photos: no “done” states, every fill of a profile offered, “As is” for keep-shape profiles', () => {
		const { popup } = setup();
		popup.start({ photos: [WEAVE, { ...WEAVE, id: 'med_2', width: 3000, height: 4000 }] });
		expect(popup.many()).toBe(true);
		expect(line(popup, 'hero_21x9')?.fills).toEqual(['crop', 'blur', 'colour']);
		expect(line(popup, 'logo_keep_shape')?.fills).toEqual(['as_is']);
		expect(line(popup, 'square_1x1')?.refusal).toBeNull();
		popup.toggleLine(line(popup, 'hero_21x9') as never);
		expect(popup.count()).toBe(1);
		expect(popup.bytes()).toBe(700_000);
		expect(popup.lineNote(line(popup, 'hero_21x9') as never)).toBe('fm_rp_many_shapes');
	});
});
