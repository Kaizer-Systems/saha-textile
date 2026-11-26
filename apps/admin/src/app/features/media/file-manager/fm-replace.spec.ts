import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { FmReplace, type FmReplaceInput } from './fm-replace';

const profileData = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('@data-access/queries/media-profiles.queries', async (original) => ({
	...(await original<object>()),
	injectMediaProfilesQuery: () => ({ data: () => profileData.list }),
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
	minSize: { edge: 'short', px: 1600, mode: 'refuse' },
	maxBytes: 25 * 1024 * 1024,
	accepts: ['image/jpeg', 'image/png'],
	mainPhotoOnly: false,
	enabled: true,
	version: 1,
	...extra,
});
const version = (id: string) => {
	const [profileKey = '', fill = 'as_is'] = id.split('.');
	return { id, profileKey, fill, state: 'ready', error: null, createdAt: '', bytes: 1, families: [] };
};
const input = (next: Partial<FmReplaceInput['next']>, versions = [version('product_3x4.as_is')]): FmReplaceInput => ({
	name: 'red-banarasi-front.jpg',
	folder: 'Product photos › Banarasi',
	bytes: 6_000_000,
	width: 3000,
	height: 4000,
	preview: null,
	versions: versions as never,
	usedOn: ['product · Red Banarasi Silk', 'product · Bridal Red Set'],
	next: {
		name: 'reshoot.jpg',
		bytes: 6_400_000,
		width: 3000,
		height: 4000,
		contentType: 'image/jpeg',
		preview: 'blob:x',
		...next,
	},
});

const setup = () => {
	profileData.list = [
		profile('product_3x4'),
		profile('hero_21x9', { shape: { width: 21, height: 9 }, fills: ['crop', 'blur'], minSize: null }),
	].map((entry) => ({ profile: entry, photos: 0 }));
	const modal = { close: vi.fn(), dismiss: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: modal },
			{
				provide: TranslocoService,
				useValue: {
					translate: (key: string, params?: Record<string, unknown>) =>
						params && Object.keys(params).length ? `${key}:${JSON.stringify(params)}` : key,
					getActiveLang: () => 'en',
				},
			},
		],
	});
	TestBed.overrideComponent(FmReplace, { set: { imports: [], template: '' } });
	return { popup: TestBed.createComponent(FmReplace).componentInstance, modal };
};

describe('Replace photo (C05, step 3b)', () => {
	it('a photo of the same shape, big enough: the green line names the profiles, and Replace answers yes', () => {
		const { popup, modal } = setup();
		popup.start(input({}));
		expect(popup.refused()).toEqual([]);
		expect(popup.good()).toContain('fm_rpl_same_shape');
		expect(popup.usedOn()).toBe('product · Red Banarasi Silk and product · Bridal Red Set');
		popup.replace();
		expect(modal.close).toHaveBeenCalledWith('replace');
	});

	it('another shape that still fits every version says so; one it can’t make is named in red and Replace waits', () => {
		const { popup, modal } = setup();
		popup.start(input({ width: 4000, height: 2000 }, [version('hero_21x9.crop')]));
		expect(popup.refused()).toEqual([]);
		expect(popup.good()).toContain('fm_rpl_fits');
		popup.start(input({ width: 4000, height: 2000 }));
		expect(popup.refused()).toEqual([{ version: 'product_3x4 · profile_fill_as_is', reason: 'fm_rpl_shape' }]);
		expect(popup.good()).toBeNull();
		popup.replace();
		expect(modal.close).not.toHaveBeenCalled();
	});

	it('too small, over a limit, a type the profile doesn’t take, or a profile gone: each is its own reason', () => {
		const { popup } = setup();
		popup.start(input({ width: 900, height: 1200 }));
		expect(popup.refused()[0]?.reason).toBe('fm_rpl_too_small:{"px":1600,"has":900}');
		popup.start(input({ bytes: 30 * 1024 * 1024 }));
		expect(popup.refused()[0]?.reason).toBe('fm_rpl_too_large');
		popup.start(input({ contentType: 'image/webp' }));
		expect(popup.refused()[0]?.reason).toBe('fm_rpl_type');
		popup.start(input({}, [version('gone_1x1.as_is')]));
		expect(popup.refused()[0]?.reason).toBe('fm_rpl_no_profile');
	});
});
