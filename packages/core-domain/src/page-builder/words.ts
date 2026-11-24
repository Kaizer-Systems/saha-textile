import type { PageSection, PiecePicture, SpotLuminance, WordSpot } from '@saha-textile/contracts';

/**
 * Words over pictures (Page Builder SG-1, Q14 A): each line of words, at the size it has on each screen band, against
 * the picture version that band shows. A line passes when 95% of the picture under it reaches the WCAG AA ratio
 * (4.5 : 1, or 3 : 1 for large words). The image worker measures each version once (`SpotLuminance` per spot: a
 * luminance histogram of that ninth of the picture); this file only compares, with the shop's own named colours.
 */

/** The nine spots in the order the worker measures them: row by row, start to end. */
export const WORD_SPOT_ORDER: readonly WordSpot[] = [
	'top_start',
	'top_center',
	'top_end',
	'middle_start',
	'middle_center',
	'middle_end',
	'bottom_start',
	'bottom_center',
	'bottom_end',
];

/** Bins in a spot's histogram; bin i holds luminance in [i/n, (i+1)/n). */
export const SPOT_BINS = 32;

/** The share of the picture under a line that must reach the ratio (Q14 A). */
export const WORDS_PASS_SHARE = 0.95;

type Ink = PiecePicture['ink'];
type Backing = PiecePicture['backing'];
type Band = 'desktop' | 'phone';

const channel = (value: number): number => {
	const c = value / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const gamma = (linear: number): number => (linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055);

/** The three 0–255 channels of `#rrggbb`, or null for anything else. */
function rgbOf(hex: string): [number, number, number] | null {
	const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
	if (!match) return null;
	// The three groups always take part when the pattern matches.
	const [, r, g, b] = match as unknown as [string, string, string, string];
	return [Number.parseInt(r, 16), Number.parseInt(g, 16), Number.parseInt(b, 16)];
}

/** WCAG relative luminance of `#rrggbb`. */
export function luminance(hex: string): number {
	const rgb = rgbOf(hex);
	if (!rgb) return 0;
	const [r, g, b] = rgb;
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export const contrast = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** `color-mix(in srgb, colour 62%, #000)`: the shop's darker brand step. */
function darker(hex: string, keep = 0.62): string {
	const rgb = rgbOf(hex);
	if (!rgb) return '#000000';
	return `#${rgb
		.map((part) =>
			Math.round(part * keep)
				.toString(16)
				.padStart(2, '0'),
		)
		.join('')}`;
}

/**
 * The colours the shop draws words in (`scss/components/_page-builder.scss`): the heading and the line under it, per
 * named ink. Brand follows the Brand Kit colour.
 */
export function inkColours(ink: Ink, brand: string): { heading: string; subheading: string } {
	switch (ink) {
		case 'brand':
			return { heading: brand, subheading: '#4a5568' };
		case 'brand_dark':
			return { heading: darker(brand), subheading: '#2d3748' };
		case 'ink':
			return { heading: '#1f2328', subheading: '#1f2328' };
		case 'white':
			return { heading: '#ffffff', subheading: '#ffffff' };
	}
}

/** The soft backings: white at 86%, near-black at 60% (blended in the browser's sRGB, as here). */
const BACKINGS: Record<Exclude<Backing, 'none'>, { value: number; alpha: number }> = {
	soft_light: { value: 1, alpha: 0.86 },
	soft_dark: { value: 17 / 255, alpha: 0.6 },
};

/** A picture luminance seen through a backing (treating the pixel as a grey of that luminance). */
function through(backing: Backing, pixel: number): number {
	if (backing === 'none') return pixel;
	const { value, alpha } = BACKINGS[backing];
	return channel((alpha * value + (1 - alpha) * gamma(pixel)) * 255);
}

/**
 * How well words of one colour read over one spot: the ratio reached by 95% of the picture under them, the weakest
 * ratio anywhere under them, and whether that passes `needed`. Each histogram bin counts at its worst edge.
 */
export function readability(
	spot: SpotLuminance,
	text: number,
	backing: Backing,
	needed: number,
): { ratio: number; weakest: number; passes: boolean } {
	const bins = spot.hist.map((share, index) => {
		const low = through(backing, index / spot.hist.length);
		const high = through(backing, (index + 1) / spot.hist.length);
		const worst = text >= low && text <= high ? 1 : contrast(text, text < low ? low : high);
		return { share, worst };
	});
	const used = bins.filter((bin) => bin.share > 0).sort((a, b) => a.worst - b.worst);
	let failing = 0;
	let ratio = used.at(-1)?.worst ?? 21;
	for (const bin of used) {
		failing += bin.share;
		if (failing > 1 - WORDS_PASS_SHARE) {
			ratio = bin.worst;
			break;
		}
	}
	const passing = bins.filter((bin) => bin.worst >= needed).reduce((sum, bin) => sum + bin.share, 0);
	const round = (value: number) => Math.round(value * 100) / 100;
	return { ratio: round(ratio), weakest: round(used[0]?.worst ?? 21), passes: passing >= WORDS_PASS_SHARE - 1e-9 };
}

/** AA: 3 : 1 for large words (the heading on computers and tablets, about 24–42 px), 4.5 : 1 otherwise. */
export const neededRatio = (field: 'heading' | 'subheading', band: Band): number =>
	field === 'heading' && band === 'desktop' ? 3 : 4.5;

/**
 * What the check needs about a photo version: its spots; null while the worker has not measured it; false when it
 * can't be measured (a photo stored without a version, from before versions), which is left out.
 */
export type WordSpotsOf = (assetId: string, versionId: string | null) => SpotLuminance[] | null | undefined | false;

export interface WordsFix {
	readonly ink: Ink;
	readonly backing: Backing;
	/** The lowest of the ratios the lines reach with it. */
	readonly ratio: number;
}

export type WordsProblem =
	| {
			kind: 'words_unreadable';
			sectionId: string;
			piece: string;
			picture: number;
			band: Band;
			field: 'heading' | 'subheading';
			ratio: number;
			needed: number;
			fixes: WordsFix[];
	  }
	| {
			kind: 'words_unmeasured';
			sectionId: string;
			piece: string;
			picture: number;
			assetId: string;
			versionId: string | null;
	  };

const INKS: readonly Ink[] = ['brand', 'brand_dark', 'ink', 'white'];
const BACKING_STEPS: readonly Backing[] = ['none', 'soft_light', 'soft_dark'];

const written = (text: Record<string, string> | undefined): boolean =>
	!!text && Object.values(text).some((value) => value.trim().length > 0);

/**
 * Every line of live words over a picture that can't be read, per band, with the fixes that pass on that picture
 * (other colours first, then a backing). A version the worker hasn't measured yet waits (`words_unmeasured`).
 */
export function wordsProblems(sections: readonly PageSection[], brand: string, spotsOf: WordSpotsOf): WordsProblem[] {
	const problems: WordsProblem[] = [];
	for (const section of sections) {
		if (section.hidden || !('pieces' in section)) continue;
		for (const piece of section.pieces) {
			piece.pictures.forEach((picture, index) => {
				if (picture.containsText) return;
				const fields = (['heading', 'subheading'] as const).filter((field) => written(picture[field]));
				if (!fields.length) return;
				const spotIndex = WORD_SPOT_ORDER.indexOf(picture.spot);
				const bands: { band: Band; assetId: string | null }[] = [
					{ band: 'desktop', assetId: picture.images.desktop },
					{ band: 'phone', assetId: picture.images.phone ?? picture.images.desktop },
				];
				const unmeasured = new Set<string>();
				for (const { band, assetId } of bands) {
					if (!assetId) continue;
					const versionId = picture.versions[assetId] ?? null;
					const spots = spotsOf(assetId, versionId);
					if (spots === false) continue;
					if (spots === null || spots === undefined) {
						if (!unmeasured.has(assetId)) {
							unmeasured.add(assetId);
							problems.push({
								kind: 'words_unmeasured',
								sectionId: section.id,
								piece: piece.name,
								picture: index,
								assetId,
								versionId,
							});
						}
						continue;
					}
					const spot = spots[spotIndex];
					if (!spot) continue;
					const check = (ink: Ink, backing: Backing, field: 'heading' | 'subheading') =>
						readability(spot, luminance(inkColours(ink, brand)[field]), backing, neededRatio(field, band));
					for (const field of fields) {
						const now = check(picture.ink, picture.backing, field);
						if (now.passes) continue;
						const fixes: WordsFix[] = [];
						for (const backing of BACKING_STEPS) {
							for (const ink of INKS) {
								if (ink === picture.ink && backing === picture.backing) continue;
								const results = fields.map((each) => check(ink, backing, each));
								if (results.every((result) => result.passes)) {
									fixes.push({
										ink,
										backing,
										ratio: Math.min(...results.map((result) => result.ratio)),
									});
								}
							}
						}
						problems.push({
							kind: 'words_unreadable',
							sectionId: section.id,
							piece: piece.name,
							picture: index,
							band,
							field,
							ratio: now.ratio,
							needed: neededRatio(field, band),
							fixes: fixes.slice(0, 3),
						});
					}
				}
			});
		}
	}
	return problems;
}

/** How both lines read over one spot with one colour choice. */
export interface SpotVerdict {
	readonly heading: { ratio: number; weakest: number; passes: boolean };
	readonly subheading: { ratio: number; weakest: number; passes: boolean };
}

/** The key the map files each colour choice under: `ink|backing`. */
export const wordsChoiceKey = (ink: Ink, backing: Backing): string => `${ink}|${backing}`;

/**
 * The builder's picture map (P5): for one measured version shown at one band, how each line reads over each of the
 * nine spots with every colour choice, so the builder redraws the map and its fixes at once as the colours or the spot
 * change. Keys are `ink|backing`; each holds the nine spots in `WORD_SPOT_ORDER`.
 */
export function wordsMap(spots: readonly SpotLuminance[], brand: string, band: Band): Record<string, SpotVerdict[]> {
	const map: Record<string, SpotVerdict[]> = {};
	for (const backing of BACKING_STEPS) {
		for (const ink of INKS) {
			const colours = inkColours(ink, brand);
			map[wordsChoiceKey(ink, backing)] = spots.map((spot) => ({
				heading: readability(spot, luminance(colours.heading), backing, neededRatio('heading', band)),
				subheading: readability(spot, luminance(colours.subheading), backing, neededRatio('subheading', band)),
			}));
		}
	}
	return map;
}
