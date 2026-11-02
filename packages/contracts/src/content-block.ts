import { z } from 'zod';

import { Id, IsoDateTime, LocalizedText } from './common';
import { ResolvedImage } from './media';

/**
 * Banners and editorial blocks (`contentBlocks`), owner log § Media → Banners and content
 * blocks (locked 2026-11-02).
 *
 * One record per page position, named by POSITION and SHAPE — never by a Fastkart theme.
 * The storefront keeps one theme and colour scheme; the other themes' hero styles are
 * admin-selectable layouts rendered in our colours.
 */

/** The home hero arrangements an admin can pick (one setting, `storefront.home`). */
export const HomeHeroLayout = z.enum(['hero_full', 'hero_main_side', 'hero_main_stack', 'hero_center_sides']);
export type HomeHeroLayout = z.infer<typeof HomeHeroLayout>;

/** Which slots each hero layout renders, in reading order. */
export const HERO_LAYOUT_SLOTS: Readonly<Record<HomeHeroLayout, readonly string[]>> = {
	hero_full: ['main'],
	hero_main_side: ['main', 'side'],
	hero_main_stack: ['main', 'side_top', 'side_bottom'],
	hero_center_sides: ['left', 'main', 'right'],
};

/** A banner position on a page. Its shape decides the image rules, not its theme of origin. */
export const BannerPosition = z.enum([
	'hero',
	'promo_cards',
	'promo_wide',
	'strip',
	'bar',
	'sidebar_tall',
	'category_banner',
	'product_sidebar',
	'newsletter_popup',
]);
export type BannerPosition = z.infer<typeof BannerPosition>;

/** Slots each position accepts. */
export const BANNER_POSITION_SLOTS: Readonly<Record<BannerPosition, readonly string[]>> = {
	hero: ['main', 'side', 'side_top', 'side_bottom', 'left', 'right'],
	promo_cards: ['card_1', 'card_2', 'card_3', 'card_4'],
	promo_wide: ['item_1', 'item_2'],
	strip: ['main'],
	bar: ['main'],
	sidebar_tall: ['main'],
	category_banner: ['main'],
	product_sidebar: ['main'],
	newsletter_popup: ['main'],
};

/**
 * Wide shapes shrink to a sliver on a phone (a 10:3 hero is ~108 px tall at 360 px), so
 * when their image carries text a separate phone image is mandatory. `hero.main` counts
 * as wide in every layout: even the 1.5:1 variants leave baked-in text unreadable.
 */
export const isWideBannerSlot = (position: BannerPosition, slot: string): boolean =>
	(position === 'hero' && slot === 'main') ||
	position === 'strip' ||
	position === 'bar' ||
	position === 'category_banner';

/**
 * Widest CSS width each position is ever displayed at (measured 2026-11-01 across all
 * seven theme demos). The worker skips banner widths beyond twice this.
 */
export const BANNER_MAX_DISPLAY_WIDTH: Readonly<Record<BannerPosition, number>> = {
	hero: 2560,
	promo_cards: 694,
	promo_wide: 1078,
	strip: 2122,
	bar: 2122,
	sidebar_tall: 518,
	category_banner: 2122,
	product_sidebar: 691,
	newsletter_popup: 400,
};

export const ContentBlockOwnerType = z.enum(['home', 'category', 'product', 'global']);
export type ContentBlockOwnerType = z.infer<typeof ContentBlockOwnerType>;

/**
 * The images a slot shows, chosen by viewport WIDTH (not device type): phone below 768 px
 * (portrait or square art), tablet 768–1199 px (falls back to desktop), desktop from
 * 1200 px. Landscape phones fall into the tablet band. Boxes take the chosen image's shape,
 * so nothing is ever cropped.
 */
export const BannerImageSet = z.object({
	desktop: Id,
	tablet: Id.nullable().default(null),
	phone: Id.nullable().default(null),
});
export type BannerImageSet = z.infer<typeof BannerImageSet>;

export const ContentBlockLink = z.object({
	href: z.string().min(1).max(500),
	external: z.boolean().default(false),
});
export type ContentBlockLink = z.infer<typeof ContentBlockLink>;

export const ContentBlockStatus = z.enum(['draft', 'active', 'archived']);
export type ContentBlockStatus = z.infer<typeof ContentBlockStatus>;

const ContentBlockFields = z.object({
	ownerType: ContentBlockOwnerType,
	/** The category or product id for owner-scoped blocks; null for home/global. */
	ownerId: Id.nullable().default(null),
	position: BannerPosition,
	slot: z.string().min(1).max(40),
	images: BannerImageSet,
	/**
	 * On: the art carries its own words. The phone image becomes mandatory on wide slots,
	 * the live-text fields are ignored, alt must repeat the image's words, and
	 * `localeImages` may override the art per locale (empty falls back to `images`).
	 */
	containsText: z.boolean().default(false),
	localeImages: z.record(z.string(), BannerImageSet).default({}),
	heading: LocalizedText.default({}),
	subheading: LocalizedText.default({}),
	ctaLabel: LocalizedText.default({}),
	link: ContentBlockLink.nullable().default(null),
	alt: LocalizedText.default({}),
	status: ContentBlockStatus.default('draft'),
	startsAt: IsoDateTime.nullable().default(null),
	endsAt: IsoDateTime.nullable().default(null),
});

const refineBlock = (block: z.infer<typeof ContentBlockFields>, ctx: z.RefinementCtx) => {
	if (!BANNER_POSITION_SLOTS[block.position].includes(block.slot)) {
		ctx.addIssue({
			code: 'custom',
			message: `slot \`${block.slot}\` is not valid for position \`${block.position}\``,
			path: ['slot'],
		});
	}
	const ownerNeedsId = block.ownerType === 'category' || block.ownerType === 'product';
	if (ownerNeedsId && !block.ownerId) {
		ctx.addIssue({ code: 'custom', message: `a ${block.ownerType} block needs its ownerId`, path: ['ownerId'] });
	}
	if (!ownerNeedsId && block.ownerId) {
		ctx.addIssue({ code: 'custom', message: `a ${block.ownerType} block has no ownerId`, path: ['ownerId'] });
	}
	if (block.containsText && isWideBannerSlot(block.position, block.slot)) {
		if (!block.images.phone) {
			ctx.addIssue({
				code: 'custom',
				message: 'a wide banner whose image contains text needs a phone image',
				path: ['images', 'phone'],
			});
		}
		for (const [locale, set] of Object.entries(block.localeImages)) {
			if (!set.phone) {
				ctx.addIssue({
					code: 'custom',
					message: `the ${locale} image set needs a phone image too`,
					path: ['localeImages', locale, 'phone'],
				});
			}
		}
	}
	if (block.startsAt && block.endsAt && block.startsAt >= block.endsAt) {
		ctx.addIssue({ code: 'custom', message: 'the schedule must end after it starts', path: ['endsAt'] });
	}
};

/** `PUT /admin/content-blocks/:key` body. */
export const ContentBlockInput = ContentBlockFields.superRefine(refineBlock);
export type ContentBlockInput = z.infer<typeof ContentBlockInput>;

export const ContentBlock = ContentBlockFields.extend({
	id: Id,
	/** `{ownerType}:{ownerId|-}:{position}:{slot}`, e.g. `home:-:hero:main`. Unique. */
	key: z.string().min(1).max(200),
	createdAt: IsoDateTime.optional(),
	updatedAt: IsoDateTime.optional(),
}).superRefine(refineBlock);
export type ContentBlock = z.infer<typeof ContentBlock>;

/** The single source of a block's key. */
export const contentBlockKey = (block: {
	ownerType: ContentBlockOwnerType;
	ownerId: string | null;
	position: BannerPosition;
	slot: string;
}): string => `${block.ownerType}:${block.ownerId ?? '-'}:${block.position}:${block.slot}`;

/** Every asset id a block points at — what the media reference counter registers. */
export const contentBlockAssetIds = (block: Pick<ContentBlock, 'images' | 'localeImages'>): string[] => {
	const sets = [block.images, ...Object.values(block.localeImages)];
	return [...new Set(sets.flatMap((set) => [set.desktop, set.tablet, set.phone]).filter((id): id is string => !!id))];
};

/** A banner image resolved for one viewport band. */
const ResolvedBannerImages = z.object({
	desktop: ResolvedImage,
	tablet: ResolvedImage.nullable(),
	phone: ResolvedImage.nullable(),
});

/**
 * A storefront-ready banner: images resolved for the request locale (locale art override
 * first, then the default set), text resolved to strings, and no admin-only fields.
 */
export const ResolvedBanner = z.object({
	key: z.string(),
	position: BannerPosition,
	slot: z.string(),
	containsText: z.boolean(),
	images: ResolvedBannerImages,
	heading: z.string().nullable(),
	subheading: z.string().nullable(),
	ctaLabel: z.string().nullable(),
	link: ContentBlockLink.nullable(),
	alt: z.string(),
});
export type ResolvedBanner = z.infer<typeof ResolvedBanner>;

/** `GET /storefront/banners?page=home` — the hero layout plus every live banner. */
export const StorefrontBannersResponse = z.object({
	heroLayout: HomeHeroLayout,
	banners: z.array(ResolvedBanner),
});
export type StorefrontBannersResponse = z.infer<typeof StorefrontBannersResponse>;
