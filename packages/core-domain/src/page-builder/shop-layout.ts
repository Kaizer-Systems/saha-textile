import type { PageSection, PiecePicture, ResolvedImage, ResolvedPageSection } from '@saha-textile/contracts';

const at = (iso: string): number => Date.parse(iso);

/** Showing at `now`: started (or no start) and not ended. */
const showing = (item: { from: string | null; until: string | null }, time: number): boolean =>
	(item.from === null || at(item.from) <= time) && (item.until === null || time < at(item.until));

/** A word in the page's language; English when that language is empty (Go Live makes that rare). */
const word = (text: Record<string, string> | undefined, locale: string): string | null =>
	text?.[locale]?.trim() || text?.en?.trim() || null;

export interface ShopLayoutContext {
	readonly locale: string;
	readonly now: Date;
	/** A picture's file for one band, in the version the picture stores; null when it cannot be shown. */
	readonly image: (assetId: string, versionId: string | null) => ResolvedImage | null;
}

/**
 * What the shop draws from a live revision, for one language at one moment (Page Builder brief, How the shop draws
 * it): hidden sections, sections for other languages and anything outside its from/until are left out of the HTML
 * entirely (FX-12, SG-20, SG-21); words come in the page's language; pictures come resolved per band, art per
 * language first; a picture that cannot be shown is left out, and a banner section left with no picture is too.
 */
export function shopSections(sections: readonly PageSection[], context: ShopLayoutContext): ResolvedPageSection[] {
	const time = context.now.getTime();
	const out: ResolvedPageSection[] = [];
	for (const section of sections) {
		if (section.hidden || !showing(section, time)) continue;
		if (section.languages !== 'all' && !section.languages.includes(context.locale)) continue;
		const pieces =
			'pieces' in section
				? section.pieces
						.map((piece) => ({
							name: piece.name,
							slider: piece.slider,
							pictures: piece.pictures
								// Keyed by its place in the piece, so a picture keeps its key while earlier ones come and go.
								.map((picture, index) =>
									showing(picture, time)
										? shopPicture(section, piece.name, index, picture, context)
										: null,
								)
								.filter((picture): picture is NonNullable<typeof picture> => picture !== null),
						}))
						.filter((piece) => piece.pictures.length > 0)
				: [];
		if ('pieces' in section && pieces.length === 0) continue;
		out.push({
			id: section.id,
			type: section.type,
			look: section.look,
			screens: section.screens,
			arrangement: section.type === 'banner_arrangement' ? section.arrangement : null,
			phoneSides: section.type === 'banner_arrangement' ? section.phoneSides : null,
			pieces,
			title: 'title' in section ? word(section.title, context.locale) : null,
			description: 'description' in section ? word(section.description, context.locale) : null,
			subtitle: 'subtitle' in section ? word(section.subtitle, context.locale) : null,
			source: section.type === 'product_row' ? section.source : null,
			sourceIds:
				section.type === 'product_row'
					? section.sourceIds
					: section.type === 'blog_posts'
						? section.postIds
						: [],
			cards: section.type === 'product_row' ? section.cards : null,
			leaveOutSoldOut: section.type === 'product_row' ? section.leaveOutSoldOut : null,
		});
	}
	return out;
}

function shopPicture(
	section: PageSection,
	piece: string,
	index: number,
	picture: PiecePicture,
	context: ShopLayoutContext,
): ResolvedPageSection['pieces'][number]['pictures'][number] | null {
	const set = (picture.containsText && picture.localeImages[context.locale]) || picture.images;
	const band = (id: string | null) => (id ? context.image(id, picture.versions[id] ?? null) : null);
	const desktop = band(set.desktop);
	if (!desktop) return null;
	const text = (map: Record<string, string>) => (picture.containsText ? null : word(map, context.locale));
	return {
		key: `${section.id}:${piece}:${index}`,
		position: section.type === 'promo_banners' ? 'promo_wide' : 'hero',
		// Never `main`: the shop's picture link would then ask for every slide early; the renderer decides the one
		// early picture per screen band itself (FX-13).
		slot: `${piece}_${index}`,
		containsText: picture.containsText,
		images: { desktop, tablet: band(set.tablet), phone: band(set.phone) },
		heading: text(picture.heading),
		subheading: text(picture.subheading),
		ctaLabel: text(picture.ctaLabel),
		link: picture.link,
		alt: picture.decorative ? '' : (word(picture.alt, context.locale) ?? ''),
		spot: picture.spot,
		ink: picture.ink,
		backing: picture.backing,
		decorative: picture.decorative,
	};
}

/**
 * When what the shop draws may next change on its own (a section or picture starting or ending), so the answer is
 * cached no longer than that (FX-18). Schedule switches come from `nextSwitchAt`.
 */
export function nextContentChangeAt(sections: readonly PageSection[], now: Date): Date | null {
	const time = now.getTime();
	const moments: number[] = [];
	const add = (iso: string | null) => {
		if (iso && at(iso) > time) moments.push(at(iso));
	};
	for (const section of sections) {
		add(section.from);
		add(section.until);
		if ('pieces' in section) {
			for (const piece of section.pieces) {
				for (const picture of piece.pictures) {
					add(picture.from);
					add(picture.until);
				}
			}
		}
	}
	return moments.length ? new Date(Math.min(...moments)) : null;
}
