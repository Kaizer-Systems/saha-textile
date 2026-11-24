import type {
	DesignNote,
	GoLiveBudgetLine,
	LayoutChange,
	LayoutChanges,
	PageSection,
	PageSettingsField,
	ScheduleEntry,
	SectionType,
} from '@saha-textile/contracts';

import type { LayoutProblem } from './checks';
import type { PageTypeRules } from './registry';

/**
 * Go Live (Page Builder build step 7): the checks that join the builder's own list at Go Live (links SG-13, the
 * page's one main heading, the speed budget SG-9), "What will change on the shop" (SG-16), design notes that warn
 * and never block (SG-35) and the schedule moves behind Go Live, Put back (SG-15) and Cancel.
 */

// ── Links (SG-13): every shop path a picture links to must open a live page ─────────────────────────────

/**
 * Shop addresses that are always there, without the language prefix ('' is the home page). The storefront's
 * `go-live-paths.spec.ts` checks each one against its page files, so the two lists cannot drift.
 */
export const SHOP_FIXED_PATHS: readonly string[] = [
	'',
	'about-us',
	'account',
	'blogs',
	'cart',
	'collections',
	'compare',
	'contact-us',
	'faq',
	'offer',
	'privacy-policy',
	'refund-returns',
	'search',
	'shipping-policy',
	'terms-conditions',
	'videos',
	'wishlist',
];

/** What a shop path points at: a fixed page, a product, a collection or a blog post. */
export type ShopPathTarget =
	| { kind: 'fixed'; path: string }
	| { kind: 'product'; slug: string }
	| { kind: 'collection'; path: string }
	| { kind: 'blog_post'; slug: string }
	| { kind: 'unknown'; path: string };

/**
 * A link's shop path without language prefix, query, hash or end slash; null for an https address (those are not
 * checked: the API never fetches outside addresses for an admin).
 */
export function shopPath(href: string, locales: readonly string[]): string | null {
	if (!href.startsWith('/') || href.startsWith('//')) return null;
	// split always gives a first part.
	let path = href.split(/[?#]/)[0] as string;
	path = path.replace(/\/+$/, '');
	const first = path.split('/')[1] ?? '';
	if (locales.includes(first)) path = path.slice(first.length + 1);
	return path.replace(/^\/+/, '');
}

export function shopPathTarget(path: string): ShopPathTarget {
	if (SHOP_FIXED_PATHS.includes(path)) return { kind: 'fixed', path };
	const [head, ...rest] = path.split('/');
	const tail = rest.join('/');
	if (head === 'product' && rest.length === 1 && tail) return { kind: 'product', slug: tail };
	if (head === 'collections' && tail) return { kind: 'collection', path: tail };
	if (head === 'blog' && rest.length === 1 && tail) return { kind: 'blog_post', slug: tail };
	return { kind: 'unknown', path };
}

/** One link a layout draws, and where it sits. */
export interface LayoutLink {
	readonly sectionId: string;
	readonly piece: string;
	readonly picture: number;
	readonly href: string;
}

/** Every picture link in the sections the shop draws (hidden sections are not drawn, so not checked). */
export function layoutLinks(sections: readonly PageSection[]): LayoutLink[] {
	const links: LayoutLink[] = [];
	for (const section of sections) {
		if (section.hidden || !('pieces' in section)) continue;
		for (const piece of section.pieces) {
			piece.pictures.forEach((picture, index) => {
				if (picture.link?.href)
					links.push({ sectionId: section.id, piece: piece.name, picture: index, href: picture.link.href });
			});
		}
	}
	return links;
}

/** A problem for each link whose shop page is not live (`live` answers for a path without its prefix). */
export function linkProblems(
	links: readonly LayoutLink[],
	locales: readonly string[],
	live: (path: string) => boolean,
): LayoutProblem[] {
	return links.flatMap((link) => {
		const path = shopPath(link.href, locales);
		if (path === null || live(path)) return [];
		return [
			{ kind: 'link_gone', sectionId: link.sectionId, piece: link.piece, picture: link.picture, href: link.href },
		];
	});
}

// ── The page's one main heading (FX-12): its H1 comes from Page settings, in every shop language ────────

/** Page settings each shop language still lacks, as Go Live problems ("Go to it" opens Page settings). */
export function pageSettingsProblems(gaps: Readonly<Record<string, readonly PageSettingsField[]>>): LayoutProblem[] {
	return Object.entries(gaps).flatMap(([locale, fields]) =>
		fields.map((field): LayoutProblem => ({ kind: 'page_settings', locale, field })),
	);
}

// ── The speed budget (SG-9, FX-13) ─────────────────────────────────────────────────────────────────────

/**
 * Section budgets in KB of compressed HTML and first-load code: the contract's `SECTION_DEFINITIONS` (core reads
 * contracts as types only; an API test keeps the two equal).
 */
export const SECTION_BUDGETS: Readonly<
	Record<
		SectionType,
		{
			readonly htmlKb: number;
			readonly perPictureKb?: number;
			readonly perItemKb?: number;
			readonly firstLoadCodeKb: number;
			readonly firstPicture: 'when_first' | 'never';
		}
	>
> = {
	banner_arrangement: { htmlKb: 3, perPictureKb: 1, firstLoadCodeKb: 0, firstPicture: 'when_first' },
	promo_banners: { htmlKb: 2, perPictureKb: 1, firstLoadCodeKb: 0, firstPicture: 'when_first' },
	product_row: { htmlKb: 1, perItemKb: 1.2, firstLoadCodeKb: 0, firstPicture: 'never' },
	recently_viewed: { htmlKb: 0.5, firstLoadCodeKb: 0, firstPicture: 'never' },
	youtube_videos: { htmlKb: 1, perItemKb: 1, firstLoadCodeKb: 0, firstPicture: 'never' },
	blog_posts: { htmlKb: 1, perItemKb: 1, firstLoadCodeKb: 0, firstPicture: 'never' },
	newsletter: { htmlKb: 1.5, firstLoadCodeKb: 0, firstPicture: 'never' },
};

/** The slider's script, sent at first load only when the first section holds a slider (brief: 2 KB). */
export const SLIDER_CODE_KB = 2.1;

/**
 * Code each section type loads when it nears the screen (KB compressed; measured on the 17 Nov production build):
 * shown in Go Live as "later", never counted against the first load.
 */
export const SECTION_LATER_CODE_KB: Readonly<Record<SectionType, number>> = {
	banner_arrangement: 1.5,
	promo_banners: 0.8,
	product_row: 24,
	recently_viewed: 2,
	youtube_videos: 3.2,
	blog_posts: 6,
	newsletter: 2.4,
};

/** Items a section draws when its settings name none: the shop's defaults (YouTube rail, newest blog posts). */
/** Blog posts a section without chosen posts shows (the newest ones). */
const NEWEST_BLOG_POSTS = 3;
const DEFAULT_ITEMS: Partial<Record<SectionType, number>> = { youtube_videos: 8, blog_posts: NEWEST_BLOG_POSTS };

const sectionPictures = (section: PageSection): number =>
	'pieces' in section ? section.pieces.reduce((sum, piece) => sum + piece.pictures.length, 0) : 0;

function sectionItems(section: PageSection): number {
	if (section.type === 'product_row') return section.cards;
	if (section.type === 'blog_posts') return section.postIds.length || NEWEST_BLOG_POSTS;
	return DEFAULT_ITEMS[section.type] ?? 0;
}

const hasSlider = (section: PageSection): boolean =>
	'pieces' in section && section.pieces.some((piece) => piece.pictures.length > 1);

/** The sections the shop draws, in order. */
const drawn = (sections: readonly PageSection[]): PageSection[] => sections.filter((section) => !section.hidden);

/** A section's HTML allowance: its own plus its pictures and items (brief: Section budgets). */
export function sectionHtmlKb(section: PageSection): number {
	const budget = SECTION_BUDGETS[section.type];
	return (
		budget.htmlKb +
		(budget.perPictureKb ?? 0) * sectionPictures(section) +
		(budget.perItemKb ?? 0) * sectionItems(section)
	);
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * The Go Live speed budget (P6): pictures that load with the page (one per screen band), builder code at first load
 * (≤ 10 KB), the page's compressed HTML against its page type's limit, and code that loads later (shown only).
 */
export function budgetLines(sections: readonly PageSection[], rules: PageTypeRules): GoLiveBudgetLine[] {
	const shown = drawn(sections);
	const first = shown[0];
	const early = first && SECTION_BUDGETS[first.type].firstPicture === 'when_first' && sectionPictures(first) ? 1 : 0;
	const firstCode =
		(first ? SECTION_BUDGETS[first.type].firstLoadCodeKb : 0) + (first && hasSlider(first) ? SLIDER_CODE_KB : 0);
	const html = rules.budget.surroundHtmlKb + shown.reduce((sum, section) => sum + sectionHtmlKb(section), 0);
	const types = new Set(shown.slice(1).map((section) => section.type));
	const later = [...types].reduce((sum, type) => sum + SECTION_LATER_CODE_KB[type], 0);
	return [
		{ key: 'early_pictures', value: early, limit: rules.budget.earlyPicturesPerBand },
		{ key: 'first_load_code', value: round1(firstCode), limit: rules.budget.firstLoadCodeKb },
		{ key: 'html', value: round1(html), limit: rules.budget.pageHtmlKb },
		{ key: 'later_code', value: round1(later), limit: null },
	];
}

/** Budget lines over their limit, as Go Live problems (Q15 A: Go Live waits; nobody can override). */
export function budgetProblems(lines: readonly GoLiveBudgetLine[]): LayoutProblem[] {
	return lines
		.filter((line) => line.limit !== null && line.value > line.limit)
		.map((line) => ({ kind: 'budget', measure: line.key, value: line.value, limit: line.limit as number }));
}

/** Sections, sliders, pictures in sliders and early pictures, for the Go Live summary line (E1). */
export function layoutSummary(sections: readonly PageSection[]): {
	sections: number;
	sliders: number;
	sliderPictures: number;
	earlyPictures: number;
} {
	const shown = drawn(sections);
	let sliders = 0;
	let sliderPictures = 0;
	for (const section of shown) {
		if (!('pieces' in section)) continue;
		for (const piece of section.pieces) {
			if (piece.pictures.length > 1) {
				sliders += 1;
				sliderPictures += piece.pictures.length;
			}
		}
	}
	const first = shown[0];
	const earlyPictures =
		first && SECTION_BUDGETS[first.type].firstPicture === 'when_first' && sectionPictures(first) ? 1 : 0;
	return { sections: shown.length, sliders, sliderPictures, earlyPictures };
}

// ── Design notes (SG-35): warn, never block ────────────────────────────────────────────────────────────

export const DESIGN_NOTE_LIMITS = { sections: 15, sliders: 3 } as const;

export function designNotes(sections: readonly PageSection[]): DesignNote[] {
	const shown = drawn(sections);
	const notes: DesignNote[] = [];
	if (shown.length > DESIGN_NOTE_LIMITS.sections) notes.push('many_sections');
	if (layoutSummary(shown).sliders > DESIGN_NOTE_LIMITS.sliders) notes.push('many_sliders');
	if (
		shown.some(
			(section, index) =>
				index > 0 && section.look.background === 'dark' && shown[index - 1]?.look.background === 'dark',
		)
	)
		notes.push('dark_in_a_row');
	return notes;
}

// ── What will change on the shop (SG-16) ──────────────────────────────────────────────────────────────

const pictureIds = (sections: readonly PageSection[]): Set<string> => {
	const ids = new Set<string>();
	for (const section of sections) {
		if (!('pieces' in section)) continue;
		for (const picture of section.pieces.flatMap((piece) => piece.pictures)) {
			for (const set of [picture.images, ...Object.values(picture.localeImages)]) {
				for (const id of [set.desktop, set.tablet, set.phone]) if (id) ids.add(id);
			}
		}
	}
	return ids;
};

/**
 * The sections that moved: the fewest whose moving explains the new order (everything outside the longest run that
 * kept its order), so moving one section up three places names that one, not the three it passed.
 */
function movedIds(before: readonly string[], after: readonly string[]): Set<string> {
	const rank = new Map(before.map((id, index) => [id, index]));
	// `after` holds only ids that `before` has too.
	const seq = after.map((id) => rank.get(id) as number);
	// Longest increasing run, with links back to rebuild it.
	const tails: number[] = [];
	const back: number[] = new Array<number>(seq.length).fill(-1);
	seq.forEach((value, i) => {
		let lo = 0;
		let hi = tails.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if ((seq[tails[mid] as number] as number) < value) lo = mid + 1;
			else hi = mid;
		}
		if (lo > 0) back[i] = tails[lo - 1] as number;
		tails[lo] = i;
	});
	const kept = new Set<string>();
	for (let i = tails.length ? (tails[tails.length - 1] as number) : -1; i >= 0; i = back[i] as number) {
		kept.add(after[i] as string);
	}
	return new Set(after.filter((id) => !kept.has(id)));
}

/** A section's content without hiding, for "changed" (hiding is its own change). */
const content = (section: PageSection): string => JSON.stringify({ ...section, hidden: false });

/**
 * The draft against what shoppers see now, section by section: added, removed, moved (its place among the sections
 * both share), changed, hidden or shown; plus how many pictures are new. Null `live`: the builder draws nothing yet.
 */
export function layoutChanges(live: readonly PageSection[] | null, draft: readonly PageSection[]): LayoutChanges {
	if (live === null) {
		return {
			firstTime: true,
			list: drawn(draft).map((section) => ({ kind: 'added', sectionId: section.id, type: section.type })),
			newPictures: pictureIds(drawn(draft)).size,
		};
	}
	const before = new Map(live.map((section) => [section.id, section]));
	const after = new Map(draft.map((section) => [section.id, section]));
	const list: LayoutChange[] = [];
	const sharedBefore = live.filter((section) => after.has(section.id)).map((section) => section.id);
	const sharedAfter = draft.filter((section) => before.has(section.id)).map((section) => section.id);
	const moved = movedIds(sharedBefore, sharedAfter);
	for (const section of draft) {
		const old = before.get(section.id);
		if (!old) {
			if (!section.hidden) list.push({ kind: 'added', sectionId: section.id, type: section.type });
			continue;
		}
		if (old.hidden !== section.hidden) {
			list.push({ kind: section.hidden ? 'hidden' : 'shown', sectionId: section.id, type: section.type });
		}
		if (moved.has(section.id)) {
			list.push({ kind: 'moved', sectionId: section.id, type: section.type });
		}
		if (content(old) !== content(section))
			list.push({ kind: 'changed', sectionId: section.id, type: section.type });
	}
	for (const section of live) {
		if (!after.has(section.id) && !section.hidden) {
			list.push({ kind: 'removed', sectionId: section.id, type: section.type });
		}
	}
	const was = pictureIds(drawn(live));
	const newPictures = [...pictureIds(drawn(draft))].filter((id) => !was.has(id)).length;
	return { firstTime: false, list, newPictures };
}

// ── The schedule behind Go Live, Put back and Cancel ──────────────────────────────────────────────────

const at = (iso: string): number => Date.parse(iso);

/** A start time this far in the past still counts as "now" (the admin's clock, a slow request). */
export const GO_LIVE_PAST_GRACE_MS = 60_000;

export type ScheduleRefusal = 'starts_in_past' | 'ends_before_start';

/**
 * The page's schedule after a Go Live: the new entry, plus (E2 "then back to") an entry from its end for the layout
 * chosen to show next, when that is not what would show by itself. Refused when it would start in the past or end
 * before it starts.
 */
export function scheduleWithGoLive(input: {
	schedule: readonly ScheduleEntry[];
	entry: ScheduleEntry;
	handBack: { revisionId: string; layoutId: string } | null;
	now: Date;
}): ScheduleEntry[] | ScheduleRefusal {
	const { entry, now } = input;
	if (at(entry.from) < now.getTime() - GO_LIVE_PAST_GRACE_MS) return 'starts_in_past';
	if (entry.until !== null && at(entry.until) <= at(entry.from)) return 'ends_before_start';
	const next: ScheduleEntry[] = [...input.schedule, entry];
	if (entry.until !== null && input.handBack) {
		next.push({
			revisionId: input.handBack.revisionId,
			layoutId: input.handBack.layoutId,
			from: entry.until,
			until: null,
			by: entry.by,
		});
	}
	return next;
}

/**
 * The entry that showed before the one showing now (SG-15 "put back the previous live layout"): the latest one that
 * started earlier and is a different revision. Null when there is none.
 */
export function previousLiveEntry(
	schedule: readonly ScheduleEntry[],
	current: ScheduleEntry | null,
): ScheduleEntry | null {
	if (!current) return null;
	const earlier = schedule
		.filter(
			(entry) =>
				entry !== current && at(entry.from) <= at(current.from) && entry.revisionId !== current.revisionId,
		)
		.sort((a, b) => at(b.from) - at(a.from));
	return earlier[0] ?? null;
}

/** The schedule without a switch still to come (Cancel in A1). Null when there is no such future entry. */
export function scheduleWithout(
	schedule: readonly ScheduleEntry[],
	switchAt: { revisionId: string; from: string },
	now: Date,
): ScheduleEntry[] | null {
	const index = schedule.findIndex(
		(entry) => entry.revisionId === switchAt.revisionId && at(entry.from) === at(switchAt.from),
	);
	const found = schedule[index];
	if (!found || at(found.from) <= now.getTime()) return null;
	return schedule.filter((_, i) => i !== index);
}
