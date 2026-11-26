import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageBuilderGateway, type WordsMapBand } from '@core/page-builder/page-builder.gateway';

import { pictureFor } from './builder-state';
import { BACKINGS, INKS, PbPicture } from './pb-picture';

type Reads = (choice: string, spot: number) => boolean;

/** Every colour choice over the nine spots; `reads` says where the words pass. */
const choices = (reads: Reads): WordsMapBand['choices'] =>
	Object.fromEntries(
		BACKINGS.flatMap((backing) =>
			INKS.map((ink) => {
				const key = `${ink}|${backing}`;
				const spots = Array.from({ length: 9 }, (_, index) => {
					const passes = reads(key, index);
					const reading = { ratio: passes ? 5.2 : 2.1, weakest: passes ? 4.8 : 1.6, passes };
					return { heading: reading, subheading: reading };
				});
				return [key, spots];
			}),
		),
	);

const band = (name: 'desktop' | 'phone', reads: Reads, state: WordsMapBand['state'] = 'ready'): WordsMapBand => ({
	band: name,
	assetId: 'med_hero',
	versionId: 'banner_keep_shape.as_is',
	url: `https://cdn/${name}.webp`,
	ratio: 2.4,
	state,
	choices: state === 'ready' ? choices(reads) : {},
});

// The words sit middle left (spot 3) in darker brand; they read there only in white on a soft dark backing, and in
// darker brand anywhere on the right.
const reads: Reads = (choice, spot) => choice === 'white|soft_dark' || (choice === 'brand_dark|none' && spot % 3 === 2);

const setup = (bands: WordsMapBand[][] | (() => never)) => {
	const close = vi.fn();
	TestBed.resetTestingModule();
	const answers = Array.isArray(bands) ? [...bands] : [];
	const gateway = {
		wordsMap: vi.fn(() => (Array.isArray(bands) ? of({ bands: answers.shift() ?? [] }) : throwError(bands))),
	};
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: { close, dismiss: vi.fn() } },
			{ provide: PageBuilderGateway, useValue: gateway },
			{
				provide: TranslocoService,
				useValue: {
					translate: (key: string, params?: Record<string, unknown>) =>
						params ? `${key}(${Object.values(params).join(',')})` : key,
				},
			},
		],
	});
	TestBed.overrideComponent(PbPicture, { set: { imports: [], template: '' } });
	const popup = TestBed.createComponent(PbPicture).componentInstance;
	return { popup, gateway, close };
};

const withWords = () => ({
	...pictureFor('med_hero', 'banner_keep_shape.as_is'),
	heading: { en: 'Made for evenings', bn: '' },
	images: { desktop: 'med_hero', tablet: null, phone: 'med_phone' },
	versions: { med_hero: 'banner_keep_shape.as_is', med_phone: 'phone_banner.crop' },
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.useRealTimers());

describe('the picture popup: the last cases', () => {
	it('asks for no map without a computer picture, and for no phone version the picture lacks', async () => {
		const none = setup([[band('desktop', reads)]]);
		none.popup.start(
			{ ...withWords(), images: { desktop: null, tablet: null, phone: null } } as never,
			'en',
			false,
		);
		await settle();
		expect(none.gateway.wordsMap).not.toHaveBeenCalled();
		const phone = setup([[band('desktop', reads)]]);
		phone.popup.start({ ...withWords(), versions: { med_hero: 'banner_keep_shape.as_is' } }, 'en', false);
		await settle();
		expect(phone.gateway.wordsMap).toHaveBeenCalledWith(
			expect.objectContaining({ phone: 'med_phone', phoneVersion: null }),
		);
	});

	it('reads the middle when no spot is chosen, and nothing for a spot it does not know', async () => {
		const middle = setup([[band('desktop', reads)]]);
		middle.popup.start({ ...withWords(), spot: undefined } as never, 'en', false);
		await settle();
		expect(middle.popup.mapViews()[0]?.cells.find((cell) => cell.here)?.spot).toBe('middle_center');
		const odd = setup([[band('desktop', reads)]]);
		odd.popup.start({ ...withWords(), spot: 'nowhere' } as never, 'en', false);
		await settle();
		const [view] = odd.popup.mapViews();
		expect(view?.reads).toBe(false);
		expect(view?.ratios).toEqual([{ field: 'heading', ratio: 0 }]);
	});

	it('words a band where the words read', async () => {
		const { popup } = setup([[band('desktop', () => true)]]);
		popup.start(withWords(), 'en', false);
		await settle();
		const [view] = popup.mapViews();
		expect(popup.bandLine(view!)).toBe('pb_words_band_reads(pb_band_desktop)');
	});

	it('edits the words, the link and the times in the language shown, then closes with the picture', async () => {
		const { popup, close } = setup([[]]);
		expect(popup.text('heading')).toBe('');
		popup.setText('heading', 'ignored');
		expect(popup.picture()).toBeNull();
		popup.start(withWords(), 'bn', false);
		await settle();
		expect(popup.text('heading')).toBe('');
		popup.setText('heading', 'সন্ধ্যার জন্য');
		expect(popup.picture()?.heading).toEqual({ en: 'Made for evenings', bn: 'সন্ধ্যার জন্য' });
		popup.set('ink', 'white');
		expect(popup.picture()?.ink).toBe('white');
		popup.setLink('javascript:alert(1)');
		expect(popup.linkError()).toBe(true);
		popup.done();
		expect(close).not.toHaveBeenCalled();
		popup.setLink(' https://shop.test/sarees ');
		expect(popup.picture()?.link).toEqual({ href: 'https://shop.test/sarees', external: true });
		popup.setLink('/sarees');
		expect(popup.picture()?.link).toEqual({ href: '/sarees', external: false });
		popup.setLink(`/${'a'.repeat(500)}`);
		expect(popup.linkError()).toBe(true);
		popup.setLink('   ');
		expect(popup.linkError()).toBe(false);
		expect(popup.picture()?.link).toBeNull();
		expect(popup.when('from')).toBe('');
		popup.setWhen('from', '2026-12-01T10:00');
		expect(popup.picture()?.from).toBe('2026-12-01T04:30:00.000Z');
		expect(popup.when('from')).toBe('2026-12-01T10:00');
		popup.setWhen('from', '');
		expect(popup.picture()?.from).toBeNull();
		popup.done();
		expect(close).toHaveBeenCalledWith(popup.picture());
	});
});
