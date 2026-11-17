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
	TestBed.resetTestingModule();
	const answers = Array.isArray(bands) ? [...bands] : [];
	const gateway = {
		wordsMap: vi.fn(() => (Array.isArray(bands) ? of({ bands: answers.shift() ?? [] }) : throwError(bands))),
	};
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: { close: vi.fn(), dismiss: vi.fn() } },
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
	return { popup, gateway };
};

const withWords = () => ({
	...pictureFor('med_hero', 'banner_keep_shape.as_is'),
	heading: { en: 'Made for evenings', bn: '' },
	images: { desktop: 'med_hero', tablet: null, phone: 'med_phone' },
	versions: { med_hero: 'banner_keep_shape.as_is', med_phone: 'phone_banner.crop' },
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.useRealTimers());

describe('the words map in the picture popup (P5)', () => {
	it('asks for the computer and phone versions the picture shows', async () => {
		const { popup, gateway } = setup([[band('desktop', reads), band('phone', reads)]]);
		popup.start(withWords(), 'en', false);
		await settle();
		expect(gateway.wordsMap).toHaveBeenCalledWith({
			desktop: 'med_hero',
			desktopVersion: 'banner_keep_shape.as_is',
			phone: 'med_phone',
			phoneVersion: 'phone_banner.crop',
		});
	});

	it('draws each band with the hard boxes shaded and the words’ box ringed, and says it is hard to read', async () => {
		const { popup } = setup([[band('desktop', reads), band('phone', reads)]]);
		popup.start(withWords(), 'en', false);
		await settle();
		const [desktop] = popup.mapViews();
		expect(desktop?.cells.map((cell) => cell.reads)).toEqual([
			false,
			false,
			true,
			false,
			false,
			true,
			false,
			false,
			true,
		]);
		expect(desktop?.cells.filter((cell) => cell.here).map((cell) => cell.spot)).toEqual(['middle_start']);
		expect(desktop?.reads).toBe(false);
		// Only the heading is written, in one language; the check still counts it.
		expect(desktop?.ratios).toEqual([{ field: 'heading', ratio: 2.1 }]);
		expect(popup.failing()).toBe(true);
		expect(popup.bandLine(desktop as never)).toBe('pb_words_band_hard(pb_band_desktop)');
		expect(popup.ratioLine({ field: 'heading', ratio: 2.1 })).toBe('pb_words_ratio(banner_heading,2.1)');
	});

	it('offers only the fixes that read on every band, and the spots that would, and applies them', async () => {
		const { popup } = setup([[band('desktop', reads), band('phone', reads)]]);
		popup.start(withWords(), 'en', false);
		await settle();
		expect(popup.fixes()).toEqual([{ ink: 'white', backing: 'soft_dark', ratio: 5.2 }]);
		expect(popup.fixLine({ ink: 'white', backing: 'soft_dark', ratio: 5.2 })).toBe(
			'pb_fix_item(pb_ink_white,pb_backing_soft_dark,5.2)',
		);
		expect(popup.otherSpots()).toEqual(['top_end', 'middle_end', 'bottom_end']);
		popup.useFix({ ink: 'white', backing: 'soft_dark' });
		expect(popup.picture()).toMatchObject({ ink: 'white', backing: 'soft_dark' });
		expect(popup.failing()).toBe(false);
		expect(popup.fixes()).toEqual([]);
		expect(popup.otherSpots()).toEqual([]);
	});

	it('changes nothing in a read-only popup', async () => {
		const { popup } = setup([[band('desktop', reads)]]);
		popup.start(withWords(), 'en', true);
		await settle();
		popup.useFix({ ink: 'white', backing: 'soft_dark' });
		expect(popup.picture()).toMatchObject({ ink: 'brand_dark', backing: 'none' });
	});

	it('asks again while the worker measures, then draws', async () => {
		vi.useFakeTimers();
		const { popup, gateway } = setup([[band('desktop', reads, 'measuring')], [band('desktop', reads)]]);
		popup.start(withWords(), 'en', false);
		await vi.advanceTimersByTimeAsync(0);
		expect(popup.measuring()).toBe(true);
		expect(popup.mapViews()).toEqual([]);
		await vi.advanceTimersByTimeAsync(4000);
		expect(gateway.wordsMap).toHaveBeenCalledTimes(2);
		expect(popup.measuring()).toBe(false);
		expect(popup.mapViews()).toHaveLength(1);
	});

	it('says when a photo has no version to measure, and draws nothing for words in the art or no words', async () => {
		const old = setup([[band('desktop', reads, 'unmeasurable')]]);
		old.popup.start(withWords(), 'en', false);
		await settle();
		expect(old.popup.unmeasurable()).toBe(true);
		expect(old.popup.mapViews()).toEqual([]);

		const art = setup([[band('desktop', reads)]]);
		art.popup.start({ ...withWords(), containsText: true }, 'en', false);
		await settle();
		expect(art.popup.fields()).toEqual([]);
		expect(art.popup.mapViews()).toEqual([]);

		const blank = setup([[band('desktop', reads)]]);
		blank.popup.start(pictureFor('med_hero', null), 'en', false);
		await settle();
		expect(blank.popup.mapViews()).toEqual([]);
	});

	it('keeps working without the map when the API cannot answer', async () => {
		const { popup } = setup(() => {
			throw new Error('down');
		});
		popup.start(withWords(), 'en', false);
		await settle();
		expect(popup.mapBands()).toEqual([]);
		expect(popup.failing()).toBe(false);
	});
});
