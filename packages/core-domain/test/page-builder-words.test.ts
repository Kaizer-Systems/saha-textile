import type { PageSection, SpotLuminance } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	SECTION_COMMON_DEFAULTS,
	SPOT_BINS,
	WORD_SPOT_ORDER,
	contrast,
	inkColours,
	measureWordSpots,
	luminance,
	neededRatio,
	readability,
	wordsProblems,
} from '../src/page-builder/index';

const BRAND = '#417394';
/** A spot whose every pixel has this luminance. */
const flat = (value: number): SpotLuminance => {
	const hist = new Array<number>(SPOT_BINS).fill(0);
	hist[Math.min(SPOT_BINS - 1, Math.floor(value * SPOT_BINS))] = 1;
	return { hist };
};
/** A spot with `share` of its pixels at `odd` and the rest at `base`. */
const mixed = (base: number, odd: number, share: number): SpotLuminance => {
	const hist = new Array<number>(SPOT_BINS).fill(0);
	hist[Math.floor(base * SPOT_BINS)] = 1 - share;
	hist[Math.min(SPOT_BINS - 1, Math.floor(odd * SPOT_BINS))] =
		(hist[Math.min(SPOT_BINS - 1, Math.floor(odd * SPOT_BINS))] ?? 0) + share;
	return { hist };
};

const picture = (extra: object = {}) => ({
	images: { desktop: 'med_hero', tablet: null, phone: null },
	localeImages: {},
	versions: {},
	containsText: false,
	heading: { en: 'Made for evenings' },
	subheading: {},
	ctaLabel: {},
	spot: 'middle_start',
	ink: 'brand',
	backing: 'none',
	link: null,
	alt: { en: 'a' },
	decorative: false,
	from: null,
	until: null,
	...extra,
});
const hero = (pictures: object[]): PageSection =>
	({
		...SECTION_COMMON_DEFAULTS,
		id: 'hero',
		type: 'banner_arrangement',
		arrangement: 'hero_full',
		phoneSides: 'below_side_by_side',
		pieces: [{ name: 'main', pictures, slider: { seconds: 6, controls: 'bottom_center', after: 'loop' } }],
	}) as unknown as PageSection;

describe('words over pictures (SG-1, Q14 A)', () => {
	it('uses WCAG luminance and ratios, and AA sizes per band', () => {
		expect(luminance('#ffffff')).toBeCloseTo(1);
		expect(luminance('#000000')).toBe(0);
		expect(contrast(1, 0)).toBe(21);
		expect(neededRatio('heading', 'desktop')).toBe(3);
		expect(neededRatio('heading', 'phone')).toBe(4.5);
		expect(neededRatio('subheading', 'desktop')).toBe(4.5);
		expect(inkColours('brand_dark', '#ffffff').heading).toBe('#9e9e9e');
		expect(WORD_SPOT_ORDER).toHaveLength(9);
	});

	it('passes when 95% of the picture under the words reaches the ratio, and names the weakest spot', () => {
		const white = luminance('#ffffff');
		// 3% of a dark picture is a bright thread: it still passes, and the weakest is shown.
		const thread = readability(mixed(0.02, 0.97, 0.03), white, 'none', 4.5);
		expect(thread.passes).toBe(true);
		expect(thread.weakest).toBeLessThan(1.1);
		// 10% bright: it fails.
		expect(readability(mixed(0.02, 0.97, 0.1), white, 'none', 4.5).passes).toBe(false);
	});

	it('lets a soft backing carry words over a busy picture', () => {
		const ink = luminance('#1f2328');
		const busy = mixed(0.05, 0.6, 0.5);
		expect(readability(busy, ink, 'none', 4.5).passes).toBe(false);
		expect(readability(busy, ink, 'soft_light', 4.5).passes).toBe(true);
	});

	it('lists each line that fails per band, with the fixes that pass on that picture', () => {
		// A pale picture: brand-blue words fail on phones (17 px needs 4.5 : 1) and darker words pass.
		const pale = Array.from({ length: 9 }, () => flat(0.55));
		const problems = wordsProblems([hero([picture()])], BRAND, () => pale);
		expect(problems.map((problem) => [problem.kind, 'band' in problem ? problem.band : null])).toEqual([
			['words_unreadable', 'desktop'],
			['words_unreadable', 'phone'],
		]);
		const phone = problems[1];
		if (phone?.kind !== 'words_unreadable') throw new Error('phone line');
		expect(phone).toMatchObject({ field: 'heading', needed: 4.5 });
		expect(phone.fixes[0]).toMatchObject({ backing: 'none' });
		expect(phone.fixes.every((fix) => fix.ratio >= 4.5)).toBe(true);
		// The same picture with dark ink reads everywhere.
		expect(wordsProblems([hero([picture({ ink: 'ink' })])], BRAND, () => pale)).toEqual([]);
	});

	it('waits for a version the worker has not measured, and skips art with words in it and hidden sections', () => {
		// Once per photo, though the phone shows the same one.
		expect(wordsProblems([hero([picture()])], BRAND, () => null)).toEqual([
			{
				kind: 'words_unmeasured',
				sectionId: 'hero',
				piece: 'main',
				picture: 0,
				assetId: 'med_hero',
				versionId: null,
			},
		]);
		// A photo stored without a version can't be measured, so it is left out.
		expect(wordsProblems([hero([picture()])], BRAND, () => false)).toEqual([]);
		expect(wordsProblems([hero([picture({ containsText: true })])], BRAND, () => null)).toEqual([]);
		expect(wordsProblems([hero([picture({ heading: {} })])], BRAND, () => null)).toEqual([]);
		const hidden = { ...hero([picture()]), hidden: true } as PageSection;
		expect(wordsProblems([hidden], BRAND, () => null)).toEqual([]);
	});
});

describe('measuring a version for the words check (SG-1 worker job)', () => {
	const asset = (version: object) =>
		({
			id: 'med_1',
			deletedAt: null,
			versions: [{ id: 'ver_1', state: 'ready', ...version }],
			derivatives: [
				{ storageKey: 'small', width: 480, versionId: 'ver_1' },
				{ storageKey: 'wide', width: 1920, versionId: 'ver_1' },
				{ storageKey: 'other', width: 2880, versionId: 'ver_2' },
			],
		}) as never;
	const run = async (found: unknown) => {
		const saved: unknown[] = [];
		const download = async (key: string) => new TextEncoder().encode(key);
		const outcome = await measureWordSpots(
			{
				assets: { findById: async () => found as never },
				storage: { download },
				analysis: { wordSpots: async (bytes) => [{ hist: [bytes.length] }] as never },
				spots: { setWordSpots: async (...args) => void saved.push(args) },
			},
			{ assetId: 'med_1', versionId: 'ver_1' },
		);
		return { outcome, saved };
	};

	it("measures the version's widest file and keeps the result on the version", async () => {
		const { outcome, saved } = await run(asset({}));
		expect(outcome).toBe('measured');
		expect(saved).toEqual([['med_1', 'ver_1', [{ hist: [4] }]]]);
	});

	it('leaves a version already measured, not ready, or gone alone', async () => {
		expect((await run(asset({ wordSpots: [] }))).outcome).toBe('skipped');
		expect((await run(asset({ state: 'making' }))).outcome).toBe('skipped');
		expect((await run(null)).outcome).toBe('skipped');
	});
});
