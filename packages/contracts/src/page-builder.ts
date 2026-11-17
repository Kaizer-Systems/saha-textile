import { z } from 'zod';

import { Id, IsoDateTime, LocalizedText } from './common';
import { BannerImageSet, ContentBlockLink, HomeHeroLayout, ResolvedBanner } from './content-block';

/**
 * Page Builder (owner log § "Page Builder revision 2, every recommendation accepted", 17 Nov 2026).
 *
 * Pages are registered, not built: a page type names its address, slots and the section types each slot
 * takes; everything else (layouts, revisions, schedules, checks, screens) is shared. Layouts are data the shop's
 * server draws with section kinds shipped ahead of time, never stored HTML. Every setting is a choice or a
 * bounded number, so the server knows every box's size before it draws (no layout shift, no custom code).
 */

// ── Page types ──────────────────────────────────────────────────────────────────────────────────────────

/** Registered page types. Home is the first; others join by being added here and in core's registry. */
export const PageTypeKey = z.enum(['home']);
export type PageTypeKey = z.infer<typeof PageTypeKey>;

/** What kind of page a type is: every section yours, a list with slots around it, or an item with slots. */
export const PageTypeKind = z.enum(['whole_page', 'listing', 'item']);
export type PageTypeKind = z.infer<typeof PageTypeKind>;

/** The whole page, or (for listing and item pages, later) one category with "all" behind it. */
export const PageTarget = z.string().min(1).max(120).default('page');
export type PageTarget = z.infer<typeof PageTarget>;
export const WHOLE_PAGE_TARGET = 'page';

// ── Section types (defined once: SG-32) ───────────────────────────────────────────────────────────────────

/** The sections the shop already has. Later types (rich text, own video, promo cards…) arrive with their brief. */
export const SectionType = z.enum([
	'banner_arrangement',
	'promo_banners',
	'product_row',
	'recently_viewed',
	'youtube_videos',
	'blog_posts',
	'newsletter',
]);
export type SectionType = z.infer<typeof SectionType>;

/** Section budgets in KB (compressed HTML / first-load code), from the 17 Nov baseline and the brief's FX-13. */
export interface SectionBudget {
	/** Compressed HTML the section may add, before per-item allowances. */
	readonly htmlKb: number;
	readonly perPictureKb?: number;
	readonly perItemKb?: number;
	/** Code it may add at first load (KB, compressed); 0 = none before it is near the screen. */
	readonly firstLoadCodeKb: number;
	/** May its first picture be the page's one early picture? Only when it is the first section. */
	readonly firstPicture: 'when_first' | 'never';
	/** Filled in the browser after paint: only below the first screen, with its height reserved (FX-14). */
	readonly browserFilled?: boolean;
}

export interface SectionDefinition {
	readonly type: SectionType;
	/** Bumped with a tested migration whenever the settings' shape changes (FX-11). */
	readonly schemaVersion: number;
	readonly budget: SectionBudget;
}

export const SECTION_DEFINITIONS: Readonly<Record<SectionType, SectionDefinition>> = {
	banner_arrangement: {
		type: 'banner_arrangement',
		schemaVersion: 1,
		budget: { htmlKb: 3, perPictureKb: 1, firstLoadCodeKb: 0, firstPicture: 'when_first' },
	},
	promo_banners: {
		type: 'promo_banners',
		schemaVersion: 1,
		budget: { htmlKb: 2, perPictureKb: 1, firstLoadCodeKb: 0, firstPicture: 'when_first' },
	},
	product_row: {
		type: 'product_row',
		schemaVersion: 1,
		budget: { htmlKb: 1, perItemKb: 1.2, firstLoadCodeKb: 0, firstPicture: 'never' },
	},
	recently_viewed: {
		type: 'recently_viewed',
		schemaVersion: 1,
		budget: { htmlKb: 0.5, firstLoadCodeKb: 0, firstPicture: 'never', browserFilled: true },
	},
	youtube_videos: {
		type: 'youtube_videos',
		schemaVersion: 1,
		budget: { htmlKb: 1, perItemKb: 1, firstLoadCodeKb: 0, firstPicture: 'never' },
	},
	blog_posts: {
		type: 'blog_posts',
		schemaVersion: 1,
		budget: { htmlKb: 1, perItemKb: 1, firstLoadCodeKb: 0, firstPicture: 'never' },
	},
	newsletter: {
		type: 'newsletter',
		schemaVersion: 1,
		budget: { htmlKb: 1.5, firstLoadCodeKb: 0, firstPicture: 'never' },
	},
};

// ── Look (SG-3): a few fixed steps, never free values ────────────────────────────────────────────────────

export const SectionSpace = z.enum(['none', 's', 'm', 'l', 'xl']);
export const SectionWidth = z.enum(['page', 'full', 'narrow']);
export const SectionAlign = z.enum(['start', 'center', 'end']);
export const SectionBackground = z.enum(['none', 'soft', 'brand_tint', 'dark']);

export const SectionLook = z.object({
	spaceAbove: SectionSpace.default('none'),
	spaceBelow: SectionSpace.default('m'),
	width: SectionWidth.default('page'),
	align: SectionAlign.default('start'),
	background: SectionBackground.default('none'),
});
export type SectionLook = z.infer<typeof SectionLook>;

/** Which screen bands draw a section: phone below 768 px, tablet 768–1199 px, computer from 1200 px. */
export const SectionScreens = z.object({
	phone: z.boolean().default(true),
	tablet: z.boolean().default(true),
	computer: z.boolean().default(true),
});
export type SectionScreens = z.infer<typeof SectionScreens>;

// ── Pictures and pieces ─────────────────────────────────────────────────────────────────────────────────

/** Where words sit on a picture: one of 9 spots. */
export const WordSpot = z.enum([
	'top_start',
	'top_center',
	'top_end',
	'middle_start',
	'middle_center',
	'middle_end',
	'bottom_start',
	'bottom_center',
	'bottom_end',
]);
export type WordSpot = z.infer<typeof WordSpot>;

/** Named word colours over pictures (fixed in dark mode, as the pictures are) and their backings. */
export const WordInk = z.enum(['brand', 'brand_dark', 'ink', 'white']);
export const WordBacking = z.enum(['none', 'soft_light', 'soft_dark']);

/** Most pictures one piece may hold (Q6 B). More than one makes the piece its own slider. */
export const PIECE_MAX_PICTURES = 10;
/** Slide timing in seconds (Q7 A). */
export const SLIDE_SECONDS = { min: 3, max: 15, default: 6 } as const;

/**
 * A link a shopper can follow: a shop path ("/collections/…") or an https address (FX-22). Words and links
 * are always drawn as text; a `javascript:` or other scheme never passes.
 */
export const PageLink = ContentBlockLink.extend({
	href: z
		.string()
		.min(1)
		.max(500)
		.refine((href) => /^\/(?!\/)/.test(href) || /^https:\/\/[^\s/]+/.test(href), {
			message: 'a link is a shop path starting with / or an https address',
		}),
});
export type PageLink = z.infer<typeof PageLink>;

export const PiecePicture = z
	.object({
		/** Picture per screen band, as banners have today (phone upright < 768 px, tablet, computer). */
		images: BannerImageSet,
		/** Art per language (empty falls back to `images`), as banners have today. */
		localeImages: z.record(z.string(), BannerImageSet).default({}),
		/** The version each photo shows, by photo id (R4-1). */
		versions: z.record(z.string(), z.string()).default({}),
		/** On: the art carries its own words; the live words below are not drawn and alt repeats them. */
		containsText: z.boolean().default(false),
		heading: LocalizedText.default({}),
		subheading: LocalizedText.default({}),
		ctaLabel: LocalizedText.default({}),
		spot: WordSpot.default('middle_start'),
		ink: WordInk.default('brand_dark'),
		backing: WordBacking.default('none'),
		link: PageLink.nullable().default(null),
		alt: LocalizedText.default({}),
		/** Patterns and dividers only; never for a picture that links somewhere (R4-6). */
		decorative: z.boolean().default(false),
		from: IsoDateTime.nullable().default(null),
		until: IsoDateTime.nullable().default(null),
	})
	.superRefine((picture, ctx) => {
		if (picture.decorative && picture.link) {
			ctx.addIssue({
				code: 'custom',
				message: 'a picture that links somewhere cannot be decorative',
				path: ['decorative'],
			});
		}
		if (picture.from && picture.until && picture.from >= picture.until) {
			ctx.addIssue({ code: 'custom', message: 'a picture must stop showing after it starts', path: ['until'] });
		}
	});
export type PiecePicture = z.infer<typeof PiecePicture>;

export const SliderControls = z.enum(['bottom_center', 'bottom_start', 'bottom_end']);
export const SliderAfterLast = z.enum(['loop', 'stop']);

export const PieceSlider = z.object({
	seconds: z.number().int().min(SLIDE_SECONDS.min).max(SLIDE_SECONDS.max).default(SLIDE_SECONDS.default),
	controls: SliderControls.default('bottom_center'),
	after: SliderAfterLast.default('loop'),
});
export type PieceSlider = z.infer<typeof PieceSlider>;

/** One picture place inside a banner section. One picture shows plainly; two or more make it a slider. */
export const Piece = z.object({
	name: z.string().min(1).max(40),
	pictures: z.array(PiecePicture).max(PIECE_MAX_PICTURES).default([]),
	slider: PieceSlider.default({ seconds: SLIDE_SECONDS.default, controls: 'bottom_center', after: 'loop' }),
});
export type Piece = z.infer<typeof Piece>;

// ── Section settings, by type ───────────────────────────────────────────────────────────────────────────

/** Today's hero arrangements become the banner section's arrangements (Q9 A). */
export const BannerArrangement = HomeHeroLayout;
export type BannerArrangement = z.infer<typeof BannerArrangement>;

/** Pieces each arrangement draws, in reading (= source) order on every size (FX-4). */
export const ARRANGEMENT_PIECES: Readonly<Record<BannerArrangement, readonly string[]>> = {
	hero_full: ['main'],
	hero_main_side: ['main', 'side'],
	hero_main_stack: ['main', 'side_top', 'side_bottom'],
	hero_center_sides: ['main', 'left', 'right'],
};

/** What phones held upright do with the side pieces (Q5 A: next to each other, below Main). */
export const PhoneSides = z.enum(['below_side_by_side', 'main_only', 'swipe_row']);

export const ProductRowSource = z.enum([
	'new_arrivals',
	'bestsellers',
	'on_sale',
	'featured',
	'category',
	'tag',
	'picked',
]);
export type ProductRowSource = z.infer<typeof ProductRowSource>;
export const PRODUCT_ROW_CARDS = { min: 4, max: 12, default: 8 } as const;

const SectionCommon = {
	/** Stable within a layout: the outline, undo and saved blocks name sections by it. */
	id: z.string().min(1).max(40),
	schemaVersion: z.number().int().positive().default(1),
	/** Hidden sections are not in the shop's HTML at all (FX-12). */
	hidden: z.boolean().default(false),
	screens: SectionScreens.default({ phone: true, tablet: true, computer: true }),
	/** Every shop language, or only some (SG-21). */
	languages: z.union([z.literal('all'), z.array(z.string().min(2).max(12)).min(1)]).default('all'),
	from: IsoDateTime.nullable().default(null),
	until: IsoDateTime.nullable().default(null),
	look: SectionLook.default({
		spaceAbove: 'none',
		spaceBelow: 'm',
		width: 'page',
		align: 'start',
		background: 'none',
	}),
	/** A section reused from a saved block: copied (default, Q18 A) or linked. */
	block: z.object({ id: Id, linked: z.boolean() }).nullable().default(null),
};

export const BannerArrangementSection = z.object({
	...SectionCommon,
	type: z.literal('banner_arrangement'),
	arrangement: BannerArrangement.default('hero_full'),
	phoneSides: PhoneSides.default('below_side_by_side'),
	pieces: z.array(Piece).default([]),
});

export const PromoBannersSection = z.object({
	...SectionCommon,
	type: z.literal('promo_banners'),
	pieces: z.array(Piece).max(2).default([]),
});

export const ProductRowSection = z.object({
	...SectionCommon,
	type: z.literal('product_row'),
	title: LocalizedText.default({}),
	source: ProductRowSource.default('new_arrivals'),
	/** The category or tag id for those sources; the product ids for "picked". */
	sourceIds: z.array(Id).max(PRODUCT_ROW_CARDS.max).default([]),
	cards: z.number().int().min(PRODUCT_ROW_CARDS.min).max(PRODUCT_ROW_CARDS.max).default(PRODUCT_ROW_CARDS.default),
	leaveOutSoldOut: z.boolean().default(true),
});

export const RecentlyViewedSection = z.object({
	...SectionCommon,
	type: z.literal('recently_viewed'),
	title: LocalizedText.default({}),
});

export const YoutubeVideosSection = z.object({
	...SectionCommon,
	type: z.literal('youtube_videos'),
	title: LocalizedText.default({}),
	description: LocalizedText.default({}),
});

export const BlogPostsSection = z.object({
	...SectionCommon,
	type: z.literal('blog_posts'),
	title: LocalizedText.default({}),
	description: LocalizedText.default({}),
	/** Empty: the newest live posts, sticky ones first. */
	postIds: z.array(Id).max(12).default([]),
});

export const NewsletterSection = z.object({
	...SectionCommon,
	type: z.literal('newsletter'),
	title: LocalizedText.default({}),
	subtitle: LocalizedText.default({}),
});

export const PageSection = z.discriminatedUnion('type', [
	BannerArrangementSection,
	PromoBannersSection,
	ProductRowSection,
	RecentlyViewedSection,
	YoutubeVideosSection,
	BlogPostsSection,
	NewsletterSection,
]);
export type PageSection = z.infer<typeof PageSection>;

// ── Layouts, revisions, schedules ───────────────────────────────────────────────────────────────────────

/** Most sections one layout holds; design notes warn from 15 (SG-35), the budget decides before that. */
export const LAYOUT_MAX_SECTIONS = 40;

/** A saved state of a layout that never changes once written (FX-11). Drafts, live and scheduled are pointers. */
export const LayoutRevision = z.object({
	id: Id,
	layoutId: Id,
	/** 1, 2, 3… within its layout. */
	number: z.number().int().positive(),
	sections: z.array(PageSection).max(LAYOUT_MAX_SECTIONS),
	createdAt: IsoDateTime,
	createdBy: Id.nullable(),
	/** Set when this revision went live or was scheduled; Go Live revisions are kept (Q12: the last 20). */
	wentLiveAt: IsoDateTime.nullable().default(null),
});
export type LayoutRevision = z.infer<typeof LayoutRevision>;

export const PageLayout = z.object({
	id: Id,
	pageType: PageTypeKey,
	target: PageTarget,
	/** Seen by admins only. */
	name: z.string().min(1).max(80),
	/** Made from a template: its sections stay in place until "Make a custom copy" (Q8 A). */
	template: z.string().min(1).max(60).nullable().default(null),
	draftRevisionId: Id.nullable().default(null),
	lastLiveRevisionId: Id.nullable().default(null),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	updatedBy: Id.nullable().default(null),
});
export type PageLayout = z.infer<typeof PageLayout>;

/** One switch: from this time, this revision shows; with `until`, it hands back to what showed before. */
export const ScheduleEntry = z
	.object({
		revisionId: Id,
		layoutId: Id,
		from: IsoDateTime,
		until: IsoDateTime.nullable().default(null),
		by: Id.nullable().default(null),
	})
	.superRefine((entry, ctx) => {
		if (entry.until && entry.until <= entry.from) {
			ctx.addIssue({ code: 'custom', message: 'a switch must end after it starts', path: ['until'] });
		}
	});
export type ScheduleEntry = z.infer<typeof ScheduleEntry>;

// ── Page settings (P3, SG-6, Q17 A): the page's own, the same whichever layout shows ──────────────────────

/** Longest values a field takes. A search result shows about 60 characters of a title and 160 of a description. */
export const PAGE_SETTINGS_LIMITS = { title: 120, description: 320, heading: 160 } as const;
/** Shown in full in a search result (SG-7's preview marks what is cut). */
export const SEARCH_RESULT_LENGTHS = { title: 60, description: 160 } as const;

/** The fields every shop language must fill before Page settings save (as the legal pages do). */
export const PAGE_SETTINGS_FIELDS = ['title', 'description', 'heading'] as const;
export type PageSettingsField = (typeof PAGE_SETTINGS_FIELDS)[number];

const limited = (max: number) => z.record(z.string(), z.string().max(max));

export const PageShareImage = z.object({ assetId: Id, versionId: Id.nullable().default(null) });
export type PageShareImage = z.infer<typeof PageShareImage>;

export const PageSettings = z.object({
	/** The title in search results and the browser tab, per language. */
	title: limited(PAGE_SETTINGS_LIMITS.title).default({}),
	description: limited(PAGE_SETTINGS_LIMITS.description).default({}),
	/** The page's one H1 (FX-12), per language. */
	heading: limited(PAGE_SETTINGS_LIMITS.heading).default({}),
	/** Home's H1 is for search engines and screen readers today (visually hidden); on: drawn above the sections. */
	headingShown: z.boolean().default(false),
	/** The link preview picture (Link preview 1.91:1); none: the site's default. */
	shareImage: PageShareImage.nullable().default(null),
});
export type PageSettings = z.infer<typeof PageSettings>;

export const EMPTY_PAGE_SETTINGS: PageSettings = {
	title: {},
	description: {},
	heading: {},
	headingShown: false,
	shareImage: null,
};

/** A page (type + target), its schedule and its own settings. The schedule is data, read on every request (FX-6). */
export const BuilderPage = z.object({
	pageType: PageTypeKey,
	target: PageTarget,
	schedule: z.array(ScheduleEntry).default([]),
	settings: PageSettings.default(EMPTY_PAGE_SETTINGS),
	updatedAt: IsoDateTime,
});
export type BuilderPage = z.infer<typeof BuilderPage>;

/** A section kept on its own, copied or linked into layouts (SG-5). */
export const SavedBlock = z.object({
	id: Id,
	name: z.string().min(1).max(80),
	section: PageSection,
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	updatedBy: Id.nullable().default(null),
});
export type SavedBlock = z.infer<typeof SavedBlock>;

/** History kept (Q12 A): the last 20 Go Live revisions of each layout, and autosaved drafts for 30 days. */
export const LAYOUT_HISTORY = { goLiveRevisions: 20, draftDays: 30 } as const;

// ── Admin API shapes (Page Builder build steps 2 and 4) ─────────────────────────────────────────────────

/** Where a layout stands at a moment, from the page's schedule: what Home's layout cards show (A1). */
export const LayoutStatus = z.enum(['live', 'scheduled', 'draft', 'ended']);
export type LayoutStatus = z.infer<typeof LayoutStatus>;

/** A problem that holds Go Live, as the builder lists it with "Go to it" (core `LayoutProblem`). */
export const LayoutProblemView = z.object({
	kind: z.string(),
	sectionId: z.string().optional(),
	type: z.string().optional(),
	locale: z.string().optional(),
	field: z.string().optional(),
	piece: z.string().optional(),
	picture: z.number().int().optional(),
	assetId: z.string().optional(),
	band: z.string().optional(),
});
export type LayoutProblemView = z.infer<typeof LayoutProblemView>;

/** `GET /admin/page-builder/pages` — a row of the Page Builder list (P1). */
export const AdminBuilderPageRow = z.object({
	pageType: PageTypeKey,
	kind: PageTypeKind,
	target: PageTarget,
	liveLayoutName: z.string().nullable(),
	nextSwitchAt: IsoDateTime.nullable(),
	layoutCount: z.number().int().nonnegative(),
});
export type AdminBuilderPageRow = z.infer<typeof AdminBuilderPageRow>;

export const AdminLayoutRow = z.object({
	layout: PageLayout,
	status: LayoutStatus,
	/** When it shows (live or scheduled), and when it hands back. */
	from: IsoDateTime.nullable(),
	until: IsoDateTime.nullable(),
	updatedByName: z.string().nullable(),
	/** The draft's sections in order, for the card's outline picture (A1). */
	outline: z.array(z.object({ type: SectionType, arrangement: BannerArrangement.nullable() })),
});
export type AdminLayoutRow = z.infer<typeof AdminLayoutRow>;

/** `GET /admin/page-builder/pages/:type` — one page: what shows when, and its layouts (A1). */
export const AdminBuilderPage = z.object({
	pageType: PageTypeKey,
	target: PageTarget,
	schedule: z.array(ScheduleEntry),
	liveRevisionId: Id.nullable(),
	nextSwitchAt: IsoDateTime.nullable(),
	layouts: z.array(AdminLayoutRow),
	/** The page's own settings (P3), what each shop language still lacks, and the share picture's address. */
	settings: PageSettings,
	settingsGaps: z.record(z.string(), z.array(z.enum(PAGE_SETTINGS_FIELDS))),
	shareImageUrl: z.string().nullable(),
	/** The page type's templates, with an outline for their cards (A1, Q9 A). */
	templates: z.array(
		z.object({
			key: z.string(),
			outline: z.array(z.object({ type: SectionType, arrangement: BannerArrangement.nullable() })),
		}),
	),
});
export type AdminBuilderPage = z.infer<typeof AdminBuilderPage>;

/** One scheduled switch on any page, for "Coming up, across every page" (P1, SG-17). */
export const ComingUpRow = z.object({
	pageType: PageTypeKey,
	target: PageTarget,
	layoutId: Id,
	layoutName: z.string(),
	from: IsoDateTime,
	until: IsoDateTime.nullable(),
	/** Showing now (with an end still to come), or still to start. */
	state: z.enum(['showing', 'coming']),
});
export type ComingUpRow = z.infer<typeof ComingUpRow>;

/** `GET /admin/page-builder/coming-up` — every switch still ahead, soonest first. */
export const ComingUpResponse = z.object({ rows: z.array(ComingUpRow) });
export type ComingUpResponse = z.infer<typeof ComingUpResponse>;

/** `POST /admin/page-builder/pages/:type/layouts` — New layout (A2): blank, or a copy of a layout. */
export const CreateLayoutRequest = z
	.object({
		name: z.string().trim().min(1).max(80),
		start: z.enum(['blank', 'copy', 'template']).default('blank'),
		copyOf: Id.nullable().default(null),
		/** A template of the page's type (Q9 A); its sections then stay in place (Q8 A). */
		template: z.string().min(1).max(60).nullable().default(null),
		/** A2's switch: today's live banners fill the template's pieces with the same name. */
		bringPictures: z.boolean().default(true),
	})
	.superRefine((request, ctx) => {
		if (request.start === 'copy' && !request.copyOf) {
			ctx.addIssue({ code: 'custom', message: 'a copy names the layout it copies', path: ['copyOf'] });
		}
		if (request.start === 'template' && !request.template) {
			ctx.addIssue({ code: 'custom', message: 'a template start names the template', path: ['template'] });
		}
	});
export type CreateLayoutRequest = z.infer<typeof CreateLayoutRequest>;

/** How long an editing lock lasts without a heartbeat (FX-11): a closed laptop frees it within 2 minutes. */
export const LAYOUT_LOCK_SECONDS = 120;

/** Who is editing a layout (E4): the second admin can look and preview; editing waits until the lock is free. */
export const LayoutLock = z.object({
	holderId: Id,
	holderName: z.string().nullable(),
	since: IsoDateTime,
	heartbeatAt: IsoDateTime,
	/** The lock is the asking admin's own. */
	mine: z.boolean(),
});
export type LayoutLock = z.infer<typeof LayoutLock>;

/** `GET /admin/page-builder/layouts/:id` — a layout open in the builder, with what holds its Go Live. */
export const AdminLayoutView = z.object({
	layout: PageLayout,
	draft: LayoutRevision.nullable(),
	problems: z.array(LayoutProblemView),
	updatedByName: z.string().nullable(),
	/** The section types the page's slot takes, in the order Add section lists them (B2). */
	allowedSections: z.array(SectionType).default([]),
	/** Who is editing it now, if anyone (E4). */
	lock: LayoutLock.nullable().default(null),
});
export type AdminLayoutView = z.infer<typeof AdminLayoutView>;

/** `PUT /admin/page-builder/layouts/:id/draft` — save the draft over the one the editor started from. */
export const SaveLayoutDraft = z.object({
	sections: z.array(PageSection).max(LAYOUT_MAX_SECTIONS),
	expectedDraftId: Id.nullable(),
});
export type SaveLayoutDraft = z.infer<typeof SaveLayoutDraft>;

/** `POST /admin/page-builder/layouts/:id/lock` — take or keep the editing lock (a heartbeat every 30 s). */
export const LayoutLockResponse = z.object({ granted: z.boolean(), lock: LayoutLock });
export type LayoutLockResponse = z.infer<typeof LayoutLockResponse>;

// ── Preview (step 6, FX-5): a one-time code swapped for a cookie limited to /__preview ─────────────────────

/** How long a preview code may be swapped (seconds) and how long the preview it opens lasts. */
export const PREVIEW_CODE_SECONDS = 60;
export const PREVIEW_SESSION_SECONDS = 3600;

/** `POST /admin/page-builder/layouts/:id/preview-code` — a code for the shop's /__preview address, used once. */
export const PreviewCodeResponse = z.object({ code: z.string().min(32), expiresAt: IsoDateTime });
export type PreviewCodeResponse = z.infer<typeof PreviewCodeResponse>;

/** `POST /storefront/preview/exchange` (the shop's server only) — the code swapped for a preview session. */
export const PreviewExchangeRequest = z.object({ code: z.string().min(32).max(128) });
export type PreviewExchangeRequest = z.infer<typeof PreviewExchangeRequest>;
export const PreviewExchangeResponse = z.object({
	token: z.string().min(32),
	pageType: PageTypeKey,
	expiresAt: IsoDateTime,
});
export type PreviewExchangeResponse = z.infer<typeof PreviewExchangeResponse>;

/** `GET /storefront/preview/layout?token=&locale=` — the draft as the shop draws it, never cached. */
export const PreviewLayoutQuery = z.object({
	token: z.string().min(32).max(128),
	locale: z.string().min(2).max(12).default('en'),
});
export type PreviewLayoutQuery = z.infer<typeof PreviewLayoutQuery>;

/** A saved block in the builder's list (P7): how many layouts use it, and whether linked copies follow it. */
export const AdminSavedBlockRow = z.object({
	block: SavedBlock,
	/** Layouts whose draft or live revision holds a linked copy. */
	linkedUses: z.number().int().nonnegative(),
	updatedByName: z.string().nullable(),
});
export type AdminSavedBlockRow = z.infer<typeof AdminSavedBlockRow>;

/** `POST /admin/page-builder/blocks` — save a section as a block (P7). */
export const SaveBlockRequest = z.object({
	name: z.string().trim().min(1).max(80),
	section: PageSection,
});
export type SaveBlockRequest = z.infer<typeof SaveBlockRequest>;

/** `PATCH /admin/page-builder/layouts/:id` — rename (the name is seen by admins only). */
export const RenameLayoutRequest = z.object({ name: z.string().trim().min(1).max(80) });
export type RenameLayoutRequest = z.infer<typeof RenameLayoutRequest>;

// ── What the shop draws (Page Builder build step 3) ─────────────────────────────────────────────────────

/**
 * One picture of a piece, ready for the shop: the banner shape the shop's picture link already draws, plus where
 * its words sit and in which colours. `slot` is `{piece}_{index}`, never `main`: the renderer alone decides the one
 * picture per screen band asked for early.
 */
export const ResolvedPiecePicture = ResolvedBanner.extend({
	spot: WordSpot,
	ink: WordInk,
	backing: WordBacking,
	decorative: z.boolean(),
});
export type ResolvedPiecePicture = z.infer<typeof ResolvedPiecePicture>;

export const ResolvedPiece = z.object({
	name: z.string(),
	pictures: z.array(ResolvedPiecePicture),
	slider: PieceSlider,
});
export type ResolvedPiece = z.infer<typeof ResolvedPiece>;

/** A section as the shop draws it: only what shows now, in the page's language. */
export const ResolvedPageSection = z.object({
	id: z.string(),
	type: SectionType,
	look: SectionLook,
	screens: SectionScreens,
	arrangement: BannerArrangement.nullable(),
	phoneSides: PhoneSides.nullable(),
	pieces: z.array(ResolvedPiece),
	title: z.string().nullable(),
	description: z.string().nullable(),
	subtitle: z.string().nullable(),
	source: ProductRowSource.nullable(),
	/** Category, tag or product ids for product rows; post ids for blog posts. */
	sourceIds: z.array(Id),
	cards: z.number().int().nullable(),
	leaveOutSoldOut: z.boolean().nullable(),
});
export type ResolvedPageSection = z.infer<typeof ResolvedPageSection>;

/** `GET /storefront/pages/:type/layout?locale=` query. */
export const StorefrontPageLayoutQuery = z.object({
	locale: z.string().min(2).max(12).default('en'),
});
export type StorefrontPageLayoutQuery = z.infer<typeof StorefrontPageLayoutQuery>;

/** The page's own settings in one language (P3); null fields fall back to the shop's own words for the page. */
export const ResolvedPageSettings = z.object({
	title: z.string().nullable(),
	description: z.string().nullable(),
	heading: z.string().nullable(),
	headingShown: z.boolean(),
	shareImageUrl: z.string().nullable(),
});
export type ResolvedPageSettings = z.infer<typeof ResolvedPageSettings>;

/**
 * The page's live layout, drawn by the shop's server. `revisionId` null: nothing is live, the shop draws its fixed
 * page. `refreshAt`: the next moment this answer may change by itself (a switch, a section or picture starting or
 * ending); the answer is cached no longer than that, and never longer than a minute. `settings` apply whichever
 * page is drawn, the fixed one included.
 */
export const StorefrontPageLayout = z.object({
	pageType: PageTypeKey,
	revisionId: Id.nullable(),
	sections: z.array(ResolvedPageSection),
	refreshAt: IsoDateTime.nullable(),
	settings: ResolvedPageSettings.nullable().default(null),
});
export type StorefrontPageLayout = z.infer<typeof StorefrontPageLayout>;
