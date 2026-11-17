import type {
	BannerArrangement,
	ContentBlock,
	HomeHeroLayout,
	PageSection,
	Piece,
	PiecePicture,
} from '@saha-textile/contracts';

/** Words the shop's fixed home page takes from its language files, per language, for the section titles. */
export interface TodaysHomeTitles {
	readonly newArrivals: Record<string, string>;
	readonly recentlyViewed: Record<string, string>;
	readonly bestsellers: Record<string, string>;
	readonly featured: Record<string, string>;
	readonly onSale: Record<string, string>;
	readonly videos: Record<string, string>;
	readonly videosDescription: Record<string, string>;
	readonly blog: Record<string, string>;
	readonly blogDescription: Record<string, string>;
	readonly newsletter: Record<string, string>;
	readonly newsletterSubtitle: Record<string, string>;
}

/**
 * The settings every section starts with (the contract's defaults; core reads contracts as types only, so they are
 * written out here and checked against the contract by the API's tests).
 */
export const SECTION_COMMON_DEFAULTS = {
	schemaVersion: 1,
	hidden: false,
	screens: { phone: true, tablet: true, computer: true },
	languages: 'all',
	from: null,
	until: null,
	look: { spaceAbove: 'none', spaceBelow: 'm', width: 'page', align: 'start', background: 'none' },
	block: null,
} as const satisfies Partial<PageSection>;

/** Pieces each arrangement draws, Main first (the contract's ARRANGEMENT_PIECES, as data here). */
export const ARRANGEMENT_PIECE_NAMES: Readonly<Record<BannerArrangement, readonly string[]>> = {
	hero_full: ['main'],
	hero_main_side: ['main', 'side'],
	hero_main_stack: ['main', 'side_top', 'side_bottom'],
	hero_center_sides: ['main', 'left', 'right'],
};

/** The full-width hero's slides today, in the order they play. */
const HERO_FULL_SLIDES = ['main', 'slide_2', 'slide_3'];

/**
 * A banner as one picture of a piece. Q19 A: darker brand words on the hero, darker words on a soft light backing
 * on the promos (both measured to pass AA on computer and phone).
 */
function pictureOf(block: ContentBlock, where: 'hero' | 'promo'): PiecePicture {
	return {
		images: block.images,
		localeImages: block.localeImages,
		versions: block.imageVersions,
		containsText: block.containsText,
		heading: block.heading,
		subheading: block.subheading,
		ctaLabel: block.ctaLabel,
		spot: 'middle_start',
		ink: where === 'hero' ? 'brand_dark' : 'ink',
		backing: where === 'hero' ? 'none' : 'soft_light',
		link: block.link,
		alt: block.alt,
		decorative: false,
		from: block.startsAt,
		until: block.endsAt,
	};
}

const piece = (name: string, pictures: PiecePicture[]): Piece => ({
	name,
	pictures,
	slider: { seconds: 6, controls: 'bottom_center', after: 'loop' },
});

const text = (id: string, type: 'recently_viewed', title: Record<string, string>): PageSection => ({
	...SECTION_COMMON_DEFAULTS,
	id,
	type,
	title,
});

const row = (
	id: string,
	source: 'new_arrivals' | 'bestsellers' | 'featured' | 'on_sale',
	title: Record<string, string>,
): PageSection => ({
	...SECTION_COMMON_DEFAULTS,
	id,
	type: 'product_row',
	title,
	source,
	sourceIds: [],
	cards: 8,
	leaveOutSoldOut: true,
});

/**
 * "Today's home page" (brief: How it fits what exists): Home's first layout, made from today's live home banners
 * and fixed sections in today's order, so nothing changes on the shop the day the builder arrives except the
 * word colours Q19 fixes. Draft and archived banners stay out; banner records are left untouched as a fallback.
 */
export function todaysHomePage(
	banners: readonly ContentBlock[],
	heroLayout: HomeHeroLayout,
	titles: TodaysHomeTitles,
	options: { keepEmptyBanners?: boolean } = {},
): PageSection[] {
	const live = banners.filter((block) => block.ownerType === 'home' && block.status === 'active');
	const hero = live.filter((block) => block.position === 'hero');
	const promos = live.filter((block) => block.position === 'promo_wide');
	const sections: PageSection[] = [];

	if (hero.length > 0 || options.keepEmptyBanners) {
		const bySlot = (slot: string) => hero.filter((block) => block.slot === slot);
		// hero_full's slides become Main's pictures (a slider); the other arrangements' tiles become their pieces.
		const pieces = ARRANGEMENT_PIECE_NAMES[heroLayout].map((name) =>
			piece(
				name,
				(name === 'main' && heroLayout === 'hero_full' ? HERO_FULL_SLIDES : [name])
					.flatMap(bySlot)
					.map((block) => pictureOf(block, 'hero')),
			),
		);
		sections.push({
			...SECTION_COMMON_DEFAULTS,
			id: 'hero',
			type: 'banner_arrangement',
			arrangement: heroLayout,
			phoneSides: 'below_side_by_side',
			pieces,
		});
	}
	if (promos.length > 0 || options.keepEmptyBanners) {
		const pieces = ['item_1', 'item_2']
			.map((slot) =>
				piece(
					slot,
					promos.filter((block) => block.slot === slot).map((block) => pictureOf(block, 'promo')),
				),
			)
			.filter((item) => item.pictures.length > 0 || options.keepEmptyBanners);
		sections.push({ ...SECTION_COMMON_DEFAULTS, id: 'promos', type: 'promo_banners', pieces });
	}
	sections.push(
		row('new_arrivals', 'new_arrivals', titles.newArrivals),
		text('recently_viewed', 'recently_viewed', titles.recentlyViewed),
		row('bestsellers', 'bestsellers', titles.bestsellers),
		row('featured', 'featured', titles.featured),
		row('on_sale', 'on_sale', titles.onSale),
		{
			...SECTION_COMMON_DEFAULTS,
			id: 'videos',
			type: 'youtube_videos',
			title: titles.videos,
			description: titles.videosDescription,
		},
		{
			...SECTION_COMMON_DEFAULTS,
			id: 'blog',
			type: 'blog_posts',
			title: titles.blog,
			description: titles.blogDescription,
			postIds: [],
		},
		{
			...SECTION_COMMON_DEFAULTS,
			id: 'newsletter',
			type: 'newsletter',
			title: titles.newsletter,
			subtitle: titles.newsletterSubtitle,
		},
	);
	return sections;
}
