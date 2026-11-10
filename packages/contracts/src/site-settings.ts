import { z } from 'zod';

import { HomeHeroLayout } from './content-block';
import { IsoDateTime } from './common';
import { StorefrontSearchSettings } from './search-term';

/**
 * Typed site settings (`siteSettings`). One document per key; each key has its own schema,
 * so a setting can never be written in a shape its readers do not understand.
 */

/** `storefront.home` — the admin-selected home hero arrangement. */
export const StorefrontHomeSettings = z.object({
	heroLayout: HomeHeroLayout.default('hero_full'),
});
export type StorefrontHomeSettings = z.infer<typeof StorefrontHomeSettings>;

/** Long videos and Shorts kept by the daily refresh, newest first (owner, 2026-11-10). */
export const YOUTUBE_FEED_VIDEOS = 24;
export const YOUTUBE_FEED_SHORTS = 12;
/** Videos one product may carry, long and Shorts together (owner, 2026-11-10). */
export const PRODUCT_VIDEOS_MAX = 5;

/**
 * `youtube` — the channel feed behind `/videos` and the home rail. The channel handle resolves
 * once to a channel id and uploads playlist; the daily refresh then costs two quota units.
 * `displayCount` (seeded 8) videos show on the rail, on the surfaces in `railPlacements`.
 */
export const YouTubeSettings = z.object({
	channelHandle: z
		.string()
		.regex(/^@[A-Za-z0-9._-]{3,100}$/)
		.default('@SahaTextile'),
	channelId: z.string().min(1).nullable().default(null),
	uploadsPlaylistId: z.string().min(1).nullable().default(null),
	displayCount: z.number().int().min(1).max(YOUTUBE_FEED_VIDEOS).default(8),
	railPlacements: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).default(['home']),
});
export type YouTubeSettings = z.infer<typeof YouTubeSettings>;

/** A Short is vertical and at most three minutes long; everything else is a video. */
export const YouTubeVideoKind = z.enum(['video', 'short']);
export type YouTubeVideoKind = z.infer<typeof YouTubeVideoKind>;

const YouTubeVideoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);

export const YouTubeVideoSummary = z.object({
	videoId: YouTubeVideoId,
	title: z.string(),
	publishedAt: IsoDateTime,
	/** YouTube's own picture of the video. */
	thumbnailUrl: z.string(),
	/** Our CDN copy of that picture, once the refresh has made it; pages prefer it. */
	posterUrl: z.string().min(1).nullable().default(null),
	/** Storage key of that copy (`youtube/<id>-<fingerprint>.webp`), so a replaced one can be deleted. */
	posterKey: z.string().min(1).nullable().default(null),
	kind: YouTubeVideoKind.default('video'),
	durationSeconds: z.number().int().nonnegative().default(0),
});
export type YouTubeVideoSummary = z.infer<typeof YouTubeVideoSummary>;

/** `youtube.feed` — the cached latest uploads, split into videos and Shorts by the 00:00 IST refresh. */
export const YouTubeFeedCache = z.object({
	videos: z.array(YouTubeVideoSummary).max(YOUTUBE_FEED_VIDEOS).default([]),
	shorts: z.array(YouTubeVideoSummary).max(YOUTUBE_FEED_SHORTS).default([]),
	fetchedAt: IsoDateTime.nullable().default(null),
	/** The last refresh tried, and why it failed when it did (the lists keep yesterday's videos). */
	lastAttemptAt: IsoDateTime.nullable().default(null),
	lastError: z.string().max(500).nullable().default(null),
	/** CDN posters of videos that left the list, for the poster step to delete. */
	retiredPosters: z.array(z.object({ key: z.string().min(1), url: z.string().min(1) })).default([]),
});
export type YouTubeFeedCache = z.infer<typeof YouTubeFeedCache>;

/**
 * `brand` — the Brand Kit. Images live in the media library, so a new owner of this codebase
 * uploads their own after deployment and no brand sits in the code.
 */
export const BrandSettings = z.object({
	shopName: z.string().trim().max(80).default(''),
	/** The full logo: seal, name and tagline. */
	logoAssetId: z.string().min(1).nullable().default(null),
	/** The small mark for phones and tight spaces (shown as "Phone logo" in admin). */
	sealAssetId: z.string().min(1).nullable().default(null),
	/** The phone logo also makes the browser and home-screen icons. Off: `faviconAssetId` makes them. */
	sealAsFavicon: z.boolean().default(true),
	/** Its own browser icon, used only while `sealAsFavicon` is off. */
	faviconAssetId: z.string().min(1).nullable().default(null),
});
export type BrandSettings = z.infer<typeof BrandSettings>;

const BrandImage = z.object({
	url: z.string(),
	srcset: z.string(),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
});
export type BrandImage = z.infer<typeof BrandImage>;

/** `GET /storefront/brand`. With nothing uploaded, screens show `shopName` as text. */
export const StorefrontBrand = z.object({
	shopName: z.string(),
	logo: BrandImage.nullable(),
	seal: BrandImage.nullable(),
	/** PNG icon address by pixel size. */
	icons: z.record(z.string(), z.string()),
});
export type StorefrontBrand = z.infer<typeof StorefrontBrand>;

/** Where Contact Us messages go: one connected mailbox, or nowhere (messages wait). */
export const ContactMailboxSettings = z.object({ mailboxId: z.string().min(1).nullable() });
export type ContactMailboxSettings = z.infer<typeof ContactMailboxSettings>;

/** The apps the product share menu can list. Link and More are always there. */
export const SHARE_APPS = [
	'whatsapp',
	'instagram',
	'facebook',
	'telegram',
	'email',
	'x',
	'linkedin',
	'pinterest',
] as const;
export const ShareApp = z.enum(SHARE_APPS);
export type ShareApp = z.infer<typeof ShareApp>;

/**
 * `storefront.share` — Storefront settings › Sharing (share brief D4). The message, previews and
 * pictures come from each product; these are the few shop-wide choices.
 */
export const StorefrontShareSettings = z.object({
	/** The shop's X account, named in X posts as "via @…". Empty for none. */
	xHandle: z
		.string()
		.trim()
		.transform((value) => value.replace(/^@/, ''))
		.pipe(z.string().regex(/^[A-Za-z0-9_]{0,15}$/))
		.default(''),
	/** Hashtags from the product's facts on X posts. */
	hashtags: z.boolean().default(true),
	/** The apps the menu lists, in the menu's own order. */
	apps: z
		.array(ShareApp)
		.max(SHARE_APPS.length)
		.default([...SHARE_APPS]),
});
export type StorefrontShareSettings = z.infer<typeof StorefrontShareSettings>;

/** Every setting key and its schema. */
export const SITE_SETTING_SCHEMAS = {
	brand: BrandSettings,
	'storefront.home': StorefrontHomeSettings,
	youtube: YouTubeSettings,
	'youtube.feed': YouTubeFeedCache,
	'storefront.search': StorefrontSearchSettings,
	'storefront.share': StorefrontShareSettings,
	'mailboxes.contact': ContactMailboxSettings,
} as const;
export type SiteSettingKey = keyof typeof SITE_SETTING_SCHEMAS;
export type SiteSettingValue<K extends SiteSettingKey> = z.infer<(typeof SITE_SETTING_SCHEMAS)[K]>;

/** `POST /admin/youtube/validate` — a pasted URL or bare id, checked against YouTube. */
export const YouTubeValidateRequest = z.object({ input: z.string().min(1).max(500) });
export type YouTubeValidateRequest = z.infer<typeof YouTubeValidateRequest>;

export const YouTubeValidateResponse = z.object({
	videoId: YouTubeVideoId,
	title: z.string(),
	thumbnailUrl: z.string(),
	kind: YouTubeVideoKind,
	durationSeconds: z.number().int().nonnegative(),
	publishedAt: IsoDateTime,
});
export type YouTubeValidateResponse = z.infer<typeof YouTubeValidateResponse>;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
	'youtube.com',
	'www.youtube.com',
	'm.youtube.com',
	'music.youtube.com',
	'youtube-nocookie.com',
	'www.youtube-nocookie.com',
]);

/**
 * Normalises whatever an admin pastes — `watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`,
 * `/live/`, or a bare id — to the 11-character video id, or null when it is none of those.
 */
export const normalizeYouTubeVideoId = (input: string): string | null => {
	const value = input.trim();
	if (YOUTUBE_ID.test(value)) return value;
	let url: URL;
	try {
		url = new URL(value.startsWith('http') ? value : `https://${value}`);
	} catch {
		return null;
	}
	const host = url.hostname.toLowerCase();
	let candidate: string | null = null;
	if (host === 'youtu.be') {
		candidate = url.pathname.replace(/^\/([^/]*).*$/, '$1');
	} else if (YOUTUBE_HOSTS.has(host)) {
		const [, first, second] = url.pathname.split('/');
		if (first === 'watch') candidate = url.searchParams.get('v');
		else if (first && ['shorts', 'embed', 'live', 'v'].includes(first)) candidate = second ?? null;
	}
	return candidate && YOUTUBE_ID.test(candidate) ? candidate : null;
};

/** `PUT /admin/youtube/settings` — the operator-editable part of the rail. */
export const YouTubeSettingsUpdate = z.object({
	channelHandle: z
		.string()
		.regex(/^@[A-Za-z0-9._-]{3,100}$/)
		.optional(),
	displayCount: z.number().int().min(1).max(10).optional(),
	railPlacements: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).optional(),
});
export type YouTubeSettingsUpdate = z.infer<typeof YouTubeSettingsUpdate>;

/** `GET /storefront/youtube/rail?placement=home`. */
export const YouTubeRailQuery = z.object({
	placement: z
		.string()
		.regex(/^[a-z][a-z0-9_]*$/)
		.default('home'),
});
export type YouTubeRailQuery = z.infer<typeof YouTubeRailQuery>;

export const YouTubeRailResponse = z.object({ videos: z.array(YouTubeVideoSummary) });
export type YouTubeRailResponse = z.infer<typeof YouTubeRailResponse>;

/** `GET /storefront/youtube/videos` — everything `/videos` shows: the cached videos and Shorts. */
export const YouTubeVideosResponse = z.object({
	videos: z.array(YouTubeVideoSummary),
	shorts: z.array(YouTubeVideoSummary),
	/** The channel's own page, for "See all on YouTube". */
	channelUrl: z.string().url(),
});
export type YouTubeVideosResponse = z.infer<typeof YouTubeVideosResponse>;

/** `GET /admin/youtube/status` — what admin's YouTube tab shows about the daily refresh. */
export const YouTubeFeedStatus = z.object({
	fetchedAt: IsoDateTime.nullable(),
	lastAttemptAt: IsoDateTime.nullable(),
	lastError: z.string().nullable(),
	videos: z.number().int().nonnegative(),
	shorts: z.number().int().nonnegative(),
});
export type YouTubeFeedStatus = z.infer<typeof YouTubeFeedStatus>;

/** One video on a product, as admin saved it after the check (long video or Short). */
export const ProductVideo = z.object({
	videoId: YouTubeVideoId,
	title: z.string().max(300),
	thumbnailUrl: z.string(),
	kind: YouTubeVideoKind,
	durationSeconds: z.number().int().nonnegative(),
	/** When it went up on YouTube; search engines need it for video results. Older rows lack it. */
	publishedAt: IsoDateTime.optional(),
	/**
	 * Set by the weekly check when YouTube no longer plays it (made private, deleted, embedding
	 * off): the shop hides it and admin shows it as gone. Cleared if it comes back.
	 */
	unavailableSince: IsoDateTime.nullable().optional(),
});
export type ProductVideo = z.infer<typeof ProductVideo>;

/** A product's videos: at most five, each once, in the order admin set. */
export const ProductVideos = z
	.array(ProductVideo)
	.max(PRODUCT_VIDEOS_MAX)
	.refine((rows) => new Set(rows.map((row) => row.videoId)).size === rows.length, {
		message: 'Each video may appear once',
	});
