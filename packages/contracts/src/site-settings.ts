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

/** A media library image chosen for one Brand Kit slot, or none. */
const BrandAssetId = z.string().min(1).nullable().default(null);

/**
 * One set of logos: wide and small, each with an optional dark version for dark screens, and
 * the browser icon (the small logo unless `sealAsFavicon` is off). The shop has one; the admin
 * may have its own (`adminOwnLogos`), where every empty slot falls back to the shop's.
 */
export const BrandLogoSet = z.object({
	/** The full logo: seal, name and tagline ("Computer logo" in admin). */
	logoAssetId: BrandAssetId,
	/** The same logo with light lettering, for dark screens. Empty: the logo keeps a white band. */
	logoDarkAssetId: BrandAssetId,
	/** The small mark for phones and tight spaces ("Phone logo" in admin). */
	sealAssetId: BrandAssetId,
	/** The small mark for dark screens. Empty: the light one is used everywhere. */
	sealDarkAssetId: BrandAssetId,
	/** The phone logo also makes the browser and home-screen icons. Off: `faviconAssetId` makes them. */
	sealAsFavicon: z.boolean().default(true),
	/** Its own browser icon, used only while `sealAsFavicon` is off. */
	faviconAssetId: BrandAssetId,
});
export type BrandLogoSet = z.infer<typeof BrandLogoSet>;

/** The profile networks the Brand Kit keeps. YouTube comes from the YouTube settings' channel. */
export const BRAND_SOCIAL_NETWORKS = ['facebook', 'instagram', 'x', 'pinterest', 'linkedin', 'threads'] as const;
export type BrandSocialNetwork = (typeof BRAND_SOCIAL_NETWORKS)[number];

/** A profile address: empty, or an https address. */
const ProfileUrl = z
	.string()
	.trim()
	.max(300)
	.refine((value) => value === '' || /^https:\/\/\S+$/.test(value), 'Use a full https:// address')
	.default('');

export const BrandSocials = z.object({
	facebook: ProfileUrl,
	instagram: ProfileUrl,
	/** Also the account X posts from the share menu name as "via @…" (shown in Sharing too). */
	x: ProfileUrl,
	pinterest: ProfileUrl,
	linkedin: ProfileUrl,
	threads: ProfileUrl,
});
export type BrandSocials = z.infer<typeof BrandSocials>;

/** The X handle in an X (or Twitter) profile address, or '' when there is none. */
export function xHandleFromUrl(url: string): string {
	const match = /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})\/?(?:[?#].*)?$/.exec(url.trim());
	return match?.[1] ?? '';
}

/**
 * The shop's phone apps, as their store pages. These https addresses open the store app on a phone
 * (Google Play on Android, the App Store on iPhone and iPad) and the store's web page elsewhere.
 */
export const ANDROID_APP_URL =
	/^https:\/\/play\.google\.com\/store\/apps\/details\?id=([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+)(?:&\S*)?$/;
export const IOS_APP_URL = /^https:\/\/apps\.apple\.com\/(?:[a-z]{2}\/)?app\/(?:[^/\s?]+\/)?id(\d{5,12})(?:[/?]\S*)?$/;

export const BrandApps = z.object({
	/** e.g. https://play.google.com/store/apps/details?id=com.shop.app */
	android: z
		.string()
		.trim()
		.refine((value) => value === '' || ANDROID_APP_URL.test(value), 'Use the Google Play address of the app')
		.default(''),
	/** e.g. https://apps.apple.com/in/app/shop/id1234567890 */
	ios: z
		.string()
		.trim()
		.refine((value) => value === '' || IOS_APP_URL.test(value), 'Use the App Store address of the app')
		.default(''),
});
export type BrandApps = z.infer<typeof BrandApps>;
export type BrandAppStore = keyof BrandApps;

/** `POST /admin/settings/brand/app-link`: is this the address of a real app in that store? */
export const BrandAppLinkCheck = z.object({
	store: z.enum(['android', 'ios']),
	url: z.string().trim().min(1).max(500),
});
export type BrandAppLinkCheck = z.infer<typeof BrandAppLinkCheck>;
export const BrandAppLinkResult = z.object({ found: z.boolean(), name: z.string().nullable() });
export type BrandAppLinkResult = z.infer<typeof BrandAppLinkResult>;

/**
 * `brand` — the Brand Kit. Images live in the media library, so a new owner of this codebase
 * uploads their own after deployment and no brand sits in the code. Every value is stored once,
 * here; other screens (Sharing's X account) read and write these fields.
 */
export const BrandSettings = z.object({
	shopName: z.string().trim().max(80).default(''),
	...BrandLogoSet.shape,
	/** Off: the admin shows the shop's logos. On: `admin` holds its own, slot by slot. */
	adminOwnLogos: z.boolean().default(false),
	admin: BrandLogoSet.default(() => BrandLogoSet.parse({})),
	/** The picture shared for pages without their own (home, categories, blog). Empty: the logo on white. */
	shareImageAssetId: BrandAssetId,
	socials: BrandSocials.default(() => BrandSocials.parse({})),
	/** Store pages of the shop's apps; the footer shows a store badge only for a saved one. */
	apps: BrandApps.default(() => BrandApps.parse({})),
	/** Shows the light/dark switch in the shop's top bar. Off: every shopper gets the site mode. */
	modeSwitch: z.boolean().default(true),
	/** The browser bar on phones and the installed app's title bar. */
	themeColor: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/)
		.default('#417394'),
	/** The admin's theme colour: every button, tab, link and the side menu read it (`--theme-color`). */
	adminThemeColor: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/)
		.default('#0da487'),
});
export type BrandSettings = z.infer<typeof BrandSettings>;

const BrandImage = z.object({
	url: z.string(),
	srcset: z.string(),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
});
export type BrandImage = z.infer<typeof BrandImage>;

/** One resolved logo set, as screens read it. Dark images and dark icons are null/empty when unset. */
export const ResolvedBrandLogos = z.object({
	logo: BrandImage.nullable(),
	logoDark: BrandImage.nullable(),
	seal: BrandImage.nullable(),
	sealDark: BrandImage.nullable(),
	/** PNG icon address by pixel size. */
	icons: z.record(z.string(), z.string()),
	/** The icon for a dark browser, by size; empty when there is no dark phone logo to make it. */
	iconsDark: z.record(z.string(), z.string()),
});
export type ResolvedBrandLogos = z.infer<typeof ResolvedBrandLogos>;

/** `GET /storefront/brand`. With nothing uploaded, screens show `shopName` as text. */
export const StorefrontBrand = ResolvedBrandLogos.extend({
	shopName: z.string(),
	/** The admin's logos: its own where set, else the shop's. */
	admin: ResolvedBrandLogos,
	/** 1200×630 JPEG for pages shared without their own picture; null with no picture and no logo. */
	shareImage: z.string().nullable(),
	/** Profile addresses by network, YouTube included; '' where unset. */
	socials: z.record(z.string(), z.string()),
	/** Store pages of the shop's apps; '' where there is none. */
	apps: z.object({ android: z.string(), ios: z.string() }),
	/** Whether the shop shows its light/dark switch. */
	modeSwitch: z.boolean(),
	themeColor: z.string(),
	/** The admin's theme colour (`--theme-color`). */
	adminThemeColor: z.string(),
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
/**
 * Storage on the Media page (R4-7, R5-3): whether admins who are not super admins may approve
 * going past the 250 GB plan. Only a super admin changes it.
 */
export const MediaStorageSettings = z.object({ othersMayUseOnDemand: z.boolean().default(false) });
export type MediaStorageSettings = z.infer<typeof MediaStorageSettings>;

export const SITE_SETTING_SCHEMAS = {
	media_storage: MediaStorageSettings,
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
