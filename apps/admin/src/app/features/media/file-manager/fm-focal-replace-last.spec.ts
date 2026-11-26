import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FmFocal } from './fm-focal';
import { FmReplace } from './fm-replace';

const profiles = vi.hoisted(() => ({ list: undefined as unknown }));
vi.mock('@data-access/queries/media-profiles.queries', async (original) => ({
	...(await original<object>()),
	injectMediaProfilesQuery: () => ({ data: () => profiles.list }),
}));

/** Names one built-in profile in words; every other key comes back as it went in. */
const translate = {
	translate: (key: string) => (key === 'profile_name_hero_21x9' ? 'Hero 21:9' : key),
	getActiveLang: () => 'en',
};

function make<T>(type: new (...args: never[]) => T) {
	const modal = { close: vi.fn(), dismiss: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: modal },
			{ provide: TranslocoService, useValue: translate },
		],
	});
	TestBed.overrideComponent(type as never, { set: { imports: [], template: '' } });
	return { c: TestBed.createComponent(type).componentInstance, modal };
}

afterEach(() => {
	profiles.list = undefined;
});

describe('Focal point: the last cases', () => {
	it('shows nothing before it starts or before the profiles load, skips a profile it does not know, and names the crops', () => {
		const { c } = make(FmFocal);
		expect(c.previews()).toEqual([]);
		const start = { name: 'a.jpg', picture: 'blob:x', width: 4000, height: 2000, focal: { x: 0.2, y: 0.3 } };
		c.start({ ...start, crops: ['hero_21x9'] });
		expect(c.previews()).toEqual([]);
		profiles.list = [{ profile: { key: 'hero_21x9', shape: { width: 21, height: 9 } }, photos: 0 }];
		c.start({ ...start, crops: ['hero_21x9', 'gone'] });
		expect(c.previews().map((row) => row.name)).toEqual(['Hero 21:9']);
		expect(c.cropNames()).toBe('Hero 21:9');
		const point = c.point();
		c.pick({
			currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 10 }) },
		} as never);
		c.pick({ currentTarget: null } as never);
		expect(c.point()).toBe(point);
	});
});

const full = (key: string, extra: Record<string, unknown>) => ({
	key,
	name: key,
	builtIn: true,
	shape: null,
	roles: ['card'],
	widths: { card: [400] },
	quality: null,
	fills: ['as_is', 'white'],
	minSize: null,
	maxBytes: 25 * 1024 * 1024,
	accepts: ['image/jpeg', 'image/png'],
	mainPhotoOnly: false,
	enabled: true,
	version: 1,
	...extra,
});

describe('Replace: the last cases', () => {
	const next = { name: 'b.jpg', bytes: 10, width: 3000, height: 4000, contentType: 'image/jpeg' };
	const version = (profileKey: string) => ({ id: `${profileKey}.as_is`, profileKey, fill: 'as_is', state: 'ready' });

	it('reads nothing before it starts or before the profiles load, and words a shape', () => {
		const { c } = make(FmReplace);
		expect([c.refused(), c.good(), c.profileList(), c.usedOn()]).toEqual([[], null, '', '']);
		expect(c.shape(3000, 4000)).toBe('3:4');
		expect(c.shape(null, 4000)).toBe('');
		c.start({
			name: 'a.jpg',
			folder: '',
			bytes: 1,
			width: 1,
			height: 1,
			preview: null,
			versions: [version('gone')],
			usedOn: [],
			next,
		} as never);
		expect(c.refused().map((row) => row.reason)).toEqual(['fm_rpl_no_profile']);
	});

	it('names an own profile by its name and a built-in one in words, and fits a photo with no size on record', () => {
		profiles.list = [
			{ profile: full('own', { name: 'Lookbook', builtIn: false }), photos: 0 },
			{ profile: full('hero_21x9', { name: 'hero' }), photos: 0 },
		];
		const { c } = make(FmReplace);
		c.start({
			name: 'a.jpg',
			folder: '',
			bytes: 10,
			width: null,
			height: null,
			preview: null,
			versions: [version('own'), version('hero_21x9')],
			usedOn: ['product · Silk'],
			next,
		} as never);
		expect(c.refused()).toEqual([]);
		expect(c.profileList()).toBe('Lookbook and Hero 21:9');
		expect(c.good()).toBe('fm_rpl_fits');
		expect(c.usedOn()).toBe('product · Silk');
	});
});
