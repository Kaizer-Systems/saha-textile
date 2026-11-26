import type { PageSection, PiecePicture, SpotLuminance } from '@saha-textile/contracts';

import { sectionAllowed, type PageTypeRules } from './registry';
import type { WordsProblem } from './words';

/**
 * What stops a layout revision going live (Page Builder brief E1, P6). Save draft always works; Go Live waits until
 * the list is empty. The words-over-pictures check (SG-1), links (SG-13) and the speed budget (SG-9) join this list
 * as their measurements arrive; each problem names the section, piece and picture so the builder can "Go to it".
 */
export type LayoutProblem =
	| { kind: 'empty' }
	| { kind: 'not_allowed'; sectionId: string; type: PageSection['type'] }
	| { kind: 'duplicate_id'; sectionId: string }
	| { kind: 'words'; sectionId: string; locale: string; field: string; piece?: string; picture?: number }
	| { kind: 'picture_missing'; sectionId: string; piece: string; picture: number }
	| { kind: 'picture_not_ready'; sectionId: string; piece: string; picture: number; assetId: string }
	| { kind: 'phone_picture'; sectionId: string; piece: string; picture: number }
	| { kind: 'shape'; sectionId: string; piece: string; picture: number; band: 'desktop' | 'phone' }
	| { kind: 'link_gone'; sectionId: string; piece: string; picture: number; href: string }
	| { kind: 'page_settings'; locale: string; field: string }
	| { kind: 'budget'; measure: string; value: number; limit: number }
	| WordsProblem;

/** What the checks need to know about one photo version: ready to show, and its shape (width ÷ height). */
export interface PictureFacts {
	readonly ready: boolean;
	readonly ratio: number | null;
	/** The version's measured word spots (SG-1): null until measured, false for a photo with no version. */
	readonly wordSpots?: SpotLuminance[] | null | false;
}

export interface LayoutCheckContext {
	readonly rules: PageTypeRules;
	readonly slot: string;
	/** Languages the shop shows: every word written must be there in each of them. */
	readonly shopLocales: readonly string[];
	/** Facts about a photo in the version the picture stores; null when the photo is gone. */
	readonly picture: (assetId: string, versionId: string | null) => PictureFacts | null;
}

/** Pictures in one piece share one shape, within 5% (Q2 A), so the page never jumps between slides. */
export const SAME_SHAPE_TOLERANCE = 0.05;

const filled = (text: Record<string, string> | undefined, locale: string): boolean => !!text?.[locale]?.trim();
const anyFilled = (text: Record<string, string> | undefined): boolean =>
	!!text && Object.values(text).some((value) => value.trim().length > 0);

/** The section's languages: all the shop's, or the ones it is limited to (SG-21). */
const sectionLocales = (section: PageSection, shop: readonly string[]): readonly string[] =>
	section.languages === 'all' ? shop : shop.filter((locale) => (section.languages as string[]).includes(locale));

/** Word fields each section type must have in every language it shows. */
const REQUIRED_TITLE: ReadonlySet<PageSection['type']> = new Set([
	'product_row',
	'recently_viewed',
	'youtube_videos',
	'blog_posts',
	'newsletter',
]);

const sameShape = (a: number, b: number): boolean => Math.abs(a - b) / b <= SAME_SHAPE_TOLERANCE;

function pictureProblems(
	section: PageSection,
	piece: string,
	index: number,
	picture: PiecePicture,
	locales: readonly string[],
	context: LayoutCheckContext,
): LayoutProblem[] {
	const problems: LayoutProblem[] = [];
	const at = { sectionId: section.id, piece, picture: index };
	if (!picture.images.desktop) problems.push({ kind: 'picture_missing', ...at });
	for (const id of [picture.images.desktop, picture.images.tablet, picture.images.phone]) {
		if (!id) continue;
		const facts = context.picture(id, picture.versions[id] ?? null);
		if (!facts || !facts.ready) problems.push({ kind: 'picture_not_ready', ...at, assetId: id });
	}
	// Words in the art on the wide Main piece: a phone picture is needed, or the words shrink to nothing (as
	// isWideBannerSlot rules for today's hero).
	const wide = section.type === 'banner_arrangement' && piece === 'main';
	if (wide && picture.containsText && !picture.images.phone) problems.push({ kind: 'phone_picture', ...at });
	for (const locale of locales) {
		if (!picture.decorative && !filled(picture.alt, locale))
			problems.push({ kind: 'words', ...at, locale, field: 'alt' });
		if (picture.containsText) continue;
		// A word field written in one language is written in all of them.
		for (const field of ['heading', 'subheading', 'ctaLabel'] as const) {
			if (anyFilled(picture[field]) && !filled(picture[field], locale)) {
				problems.push({ kind: 'words', ...at, locale, field });
			}
		}
	}
	return problems;
}

/** Shapes inside one piece: every picture matches the first one's, per band (Q2 A). */
function shapeProblems(
	section: PageSection,
	piece: { name: string; pictures: PiecePicture[] },
	context: LayoutCheckContext,
): LayoutProblem[] {
	const problems: LayoutProblem[] = [];
	for (const band of ['desktop', 'phone'] as const) {
		let first: number | null = null;
		piece.pictures.forEach((picture, index) => {
			const id = picture.images[band];
			if (!id) return;
			const ratio = context.picture(id, picture.versions[id] ?? null)?.ratio ?? null;
			if (ratio === null) return;
			if (first === null) first = ratio;
			else if (!sameShape(ratio, first))
				problems.push({ kind: 'shape', sectionId: section.id, piece: piece.name, picture: index, band });
		});
	}
	return problems;
}

/** Everything that holds a revision's Go Live, in outline order. Hidden sections are not drawn, so not checked. */
export function layoutProblems(sections: readonly PageSection[], context: LayoutCheckContext): LayoutProblem[] {
	const shown = sections.filter((section) => !section.hidden);
	if (shown.length === 0) return [{ kind: 'empty' }];
	const problems: LayoutProblem[] = [];
	const seen = new Set<string>();
	for (const section of sections) {
		if (seen.has(section.id)) problems.push({ kind: 'duplicate_id', sectionId: section.id });
		seen.add(section.id);
	}
	for (const section of shown) {
		if (!sectionAllowed(context.rules, context.slot, section.type)) {
			problems.push({ kind: 'not_allowed', sectionId: section.id, type: section.type });
			continue;
		}
		const locales = sectionLocales(section, context.shopLocales);
		if (REQUIRED_TITLE.has(section.type) && 'title' in section) {
			for (const locale of locales) {
				if (!filled(section.title, locale))
					problems.push({ kind: 'words', sectionId: section.id, locale, field: 'title' });
			}
		}
		if ('pieces' in section) {
			for (const piece of section.pieces) {
				piece.pictures.forEach((picture, index) =>
					problems.push(...pictureProblems(section, piece.name, index, picture, locales, context)),
				);
				problems.push(...shapeProblems(section, piece, context));
			}
		}
	}
	return problems;
}
