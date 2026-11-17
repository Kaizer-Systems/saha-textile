import type { BannerArrangement, PageSection, PiecePicture, SectionType } from '@saha-textile/contracts';

/*
 * The admin reads `@saha-textile/contracts` for types only (its CommonJS build does not load in the browser), so the
 * few limits and defaults the builder needs are written out here; `builder-state.spec.ts` checks them against the
 * contract, and the API checks every saved section against it anyway.
 */

/** Pieces each arrangement draws, in reading order (contract `ARRANGEMENT_PIECES`). */
export const ARRANGEMENT_PIECES: Readonly<Record<BannerArrangement, readonly string[]>> = {
	hero_full: ['main'],
	hero_main_side: ['main', 'side'],
	hero_main_stack: ['main', 'side_top', 'side_bottom'],
	hero_center_sides: ['main', 'left', 'right'],
};

/** Contract `PIECE_MAX_PICTURES`, `PRODUCT_ROW_CARDS`, `SLIDE_SECONDS`. */
export const PIECE_MAX_PICTURES = 10;
export const PRODUCT_ROW_CARDS = { min: 4, max: 12, default: 8 } as const;
export const SLIDE_SECONDS = { min: 3, max: 15, default: 6 } as const;
/** Contract `WordSpot` options, in reading order. */
export const WORD_SPOTS = [
	'top_start',
	'top_center',
	'top_end',
	'middle_start',
	'middle_center',
	'middle_end',
	'bottom_start',
	'bottom_center',
	'bottom_end',
] as const;

/** A shop path or an https address (contract `PageLink`, FX-22). */
export const linkAllowed = (href: string): boolean => /^\/(?!\/)/.test(href) || /^https:\/\/[^\s/]+/.test(href);

/** The defaults every section starts with (contract `SectionCommon`). */
const COMMON = () => ({
	schemaVersion: 1,
	hidden: false,
	screens: { phone: true, tablet: true, computer: true },
	languages: 'all' as const,
	from: null,
	until: null,
	look: { spaceAbove: 'none', spaceBelow: 'm', width: 'page', align: 'start', background: 'none' },
	block: null,
});

/** A piece with no pictures yet and its slider's defaults. */
const piece = (name: string) => ({
	name,
	pictures: [],
	slider: { seconds: SLIDE_SECONDS.default, controls: 'bottom_center', after: 'loop' },
});

/**
 * The builder's pure moves on a layout's sections (Page Builder step 5, brief B1–B9): add, move, duplicate, hide and
 * remove, piece and picture edits, and the undo history. Every move returns new arrays, so the screen keeps one
 * signal of sections and undo is a list of earlier ones.
 */

/** A section id not used yet in the layout: its type, then a number. */
export function freshId(type: SectionType, taken: readonly string[]): string {
	const used = new Set(taken);
	for (let n = 1; ; n += 1) {
		const id = n === 1 ? type : `${type}_${n}`;
		if (!used.has(id)) return id;
	}
}

/** The pieces an arrangement draws, keeping the pictures of pieces with the same name (brief: risks table). */
export function piecesFor(arrangement: BannerArrangement, current: readonly { name: string }[] = []) {
	return ARRANGEMENT_PIECES[arrangement].map((name) => {
		const kept = current.find((piece) => piece.name === name);
		return kept ? structuredClone(kept) : piece(name);
	});
}

/** A new section of a type with its defaults; banner sections come with their arrangement's pieces. */
export function newSection(type: SectionType, taken: readonly string[]): PageSection {
	const base = { id: freshId(type, taken), type, ...COMMON() };
	const words = { title: {} };
	const byType: Record<SectionType, Record<string, unknown>> = {
		banner_arrangement: {
			arrangement: 'hero_full',
			phoneSides: 'below_side_by_side',
			pieces: piecesFor('hero_full'),
		},
		promo_banners: { pieces: [piece('item_1'), piece('item_2')] },
		product_row: {
			...words,
			source: 'new_arrivals',
			sourceIds: [],
			cards: PRODUCT_ROW_CARDS.default,
			leaveOutSoldOut: true,
		},
		recently_viewed: words,
		youtube_videos: { ...words, description: {} },
		blog_posts: { ...words, description: {}, postIds: [] },
		newsletter: { ...words, subtitle: {} },
	};
	return { ...base, ...byType[type] } as unknown as PageSection;
}

export function moveSection(sections: readonly PageSection[], from: number, to: number): PageSection[] {
	if (from === to || from < 0 || to < 0 || from >= sections.length || to >= sections.length) return [...sections];
	const next = [...sections];
	const [moved] = next.splice(from, 1);
	if (moved) next.splice(to, 0, moved);
	return next;
}

/** A copy right below the section, with a fresh id; a linked block's copy is linked to the same block. */
export function duplicateSection(
	sections: readonly PageSection[],
	id: string,
): { sections: PageSection[]; id: string } {
	const at = sections.findIndex((section) => section.id === id);
	if (at < 0) return { sections: [...sections], id };
	const source = sections[at] as PageSection;
	const copy = {
		...structuredClone(source),
		id: freshId(
			source.type,
			sections.map((section) => section.id),
		),
	};
	const next = [...sections];
	next.splice(at + 1, 0, copy);
	return { sections: next, id: copy.id };
}

export function insertSection(
	sections: readonly PageSection[],
	section: PageSection,
	afterId: string | null,
): PageSection[] {
	const at = afterId ? sections.findIndex((candidate) => candidate.id === afterId) : -1;
	const next = [...sections];
	next.splice(at < 0 ? next.length : at + 1, 0, section);
	return next;
}

export function removeSection(sections: readonly PageSection[], id: string): PageSection[] {
	return sections.filter((section) => section.id !== id);
}

/** Replaces one section. Every value the forms offer is a choice or a clamped number; the API checks it again. */
export function replaceSection(sections: readonly PageSection[], section: PageSection): PageSection[] {
	return sections.map((candidate) => (candidate.id === section.id ? section : candidate));
}

/** A new picture for a piece: the photo and the version chosen in the picker, everything else at its default. */
export function pictureFor(assetId: string, versionId: string | null): PiecePicture {
	return {
		images: { desktop: assetId, tablet: null, phone: null },
		localeImages: {},
		versions: versionId ? { [assetId]: versionId } : {},
		containsText: false,
		heading: {},
		subheading: {},
		ctaLabel: {},
		spot: 'middle_start',
		ink: 'brand_dark',
		backing: 'none',
		link: null,
		alt: {},
		decorative: false,
		from: null,
		until: null,
	} as PiecePicture;
}

/** A number kept inside its limits (the forms' number fields). */
export const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, Number.isFinite(value) ? Math.round(value) : min));

/** Undo and redo over whole snapshots of the sections (B: E3). At most `limit` steps back. */
export class UndoHistory<T> {
	private past: T[] = [];
	private future: T[] = [];

	constructor(private readonly limit = 50) {}

	/** Before a change: remembers the state it starts from; a new change clears what was undone. */
	record(state: T): void {
		this.past.push(structuredClone(state));
		if (this.past.length > this.limit) this.past.shift();
		this.future = [];
	}

	undo(current: T): T | null {
		const previous = this.past.pop();
		if (previous === undefined) return null;
		this.future.push(structuredClone(current));
		return previous;
	}

	redo(current: T): T | null {
		const next = this.future.pop();
		if (next === undefined) return null;
		this.past.push(structuredClone(current));
		return next;
	}

	get canUndo(): boolean {
		return this.past.length > 0;
	}

	get canRedo(): boolean {
		return this.future.length > 0;
	}
}
