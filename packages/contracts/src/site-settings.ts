import { z } from 'zod';

import { HomeHeroLayout } from './content-block';
import { IsoDateTime } from './common';

/**
 * Typed site settings (`siteSettings`). One document per key; each key has its own schema,
 * so a setting can never be written in a shape its readers do not understand.
 */

/** `storefront.home` — the admin-selected home hero arrangement. */
export const StorefrontHomeSettings = z.object({
	heroLayout: HomeHeroLayout.default('hero_full'),
});
export type StorefrontHomeSettings = z.infer<typeof StorefrontHomeSettings>;

/**
 * `youtube` — the home rail. The channel handle resolves once to a channel id and uploads
 * playlist; the daily refresh then costs one quota unit. Ten are fetched, `displayCount`
 * (seeded 8) are shown, on the surfaces listed in `railPlacements` (seeded `home`).
 */
export const YouTubeSettings = z.object({
	channelHandle: z
		.string()
		.regex(/^@[A-Za-z0-9._-]{3,100}$/)
		.default('@SahaTextile'),
	channelId: z.string().min(1).nullable().default(null),
	uploadsPlaylistId: z.string().min(1).nullable().default(null),
	displayCount: z.number().int().min(1).max(10).default(8),
	railPlacements: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).default(['home']),
});
export type YouTubeSettings = z.infer<typeof YouTubeSettings>;

export const YouTubeVideoSummary = z.object({
	videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
	title: z.string(),
	publishedAt: IsoDateTime,
	thumbnailUrl: z.string(),
});
export type YouTubeVideoSummary = z.infer<typeof YouTubeVideoSummary>;

/** `youtube.feed` — the cached latest uploads, written by the 00:00 IST refresh. */
export const YouTubeFeedCache = z.object({
	videos: z.array(YouTubeVideoSummary).max(10).default([]),
	fetchedAt: IsoDateTime.nullable().default(null),
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
	/** The small mark for tight spaces and every icon. */
	sealAssetId: z.string().min(1).nullable().default(null),
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

/** Every setting key and its schema. */
export const SITE_SETTING_SCHEMAS = {
	brand: BrandSettings,
	'storefront.home': StorefrontHomeSettings,
	youtube: YouTubeSettings,
	'youtube.feed': YouTubeFeedCache,
} as const;
export type SiteSettingKey = keyof typeof SITE_SETTING_SCHEMAS;
export type SiteSettingValue<K extends SiteSettingKey> = z.infer<(typeof SITE_SETTING_SCHEMAS)[K]>;

/** `POST /admin/youtube/validate` — a pasted URL or bare id, checked against YouTube. */
export const YouTubeValidateRequest = z.object({ input: z.string().min(1).max(500) });
export type YouTubeValidateRequest = z.infer<typeof YouTubeValidateRequest>;

export const YouTubeValidateResponse = z.object({
	videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
	title: z.string(),
	thumbnailUrl: z.string(),
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
