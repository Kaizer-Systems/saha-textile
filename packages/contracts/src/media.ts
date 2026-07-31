import { z } from 'zod';

import { CatalogStatus } from './catalog';
import { Id, IsoDateTime, LocalizedText } from './common';

/**
 * Locked image derivative ROLE KEYS. The pixel dimensions behind each role are
 * deliberately NOT here — they are configuration, gated by `DEC-IMG-PX` (gate
 * `G-IMG-PX`). A role is a stable contract; its size is a tunable.
 *
 * `swatch_image_v2` is the second swatch renderer ("Image V2"), kept as its own role
 * because it crops differently from `swatch_image`.
 */
export const MediaRole = z.enum(['thumb', 'card', 'gallery', 'zoom', 'swatch_image', 'swatch_image_v2']);
export type MediaRole = z.infer<typeof MediaRole>;

export const MediaKind = z.enum(['image', 'video']);
export type MediaKind = z.infer<typeof MediaKind>;

/**
 * Accepted upload formats. Owner lock: JPEG/PNG in, original retained, a
 * full-resolution WebP plus static WebP role derivatives generated at the worker edge.
 * **No AVIF** at launch or in the near-term plan — it is absent on purpose.
 */
export const ImageUploadFormat = z.enum(['image/jpeg', 'image/png']);
export type ImageUploadFormat = z.infer<typeof ImageUploadFormat>;

/** Master video upload format (H.264/AAC MP4, 1080p or better). */
export const VideoUploadFormat = z.enum(['video/mp4']);
export type VideoUploadFormat = z.infer<typeof VideoUploadFormat>;

/**
 * One generated image derivative. Dimensions are RECORDED here (what the worker
 * actually produced) but never PRESCRIBED — the ladder itself lives in config.
 */
export const ImageDerivative = z.object({
	role: MediaRole,
	storageKey: z.string().min(1),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	byteSize: z.number().int().nonnegative(),
	format: z.literal('image/webp'),
});
export type ImageDerivative = z.infer<typeof ImageDerivative>;

/**
 * HLS rendition heights. Owner lock: 480/720/1080 are always produced; 1440 is added
 * only for a 1440p source; 2160 is added only for a 2160p source, and 1440 is skipped
 * in that case. `hlsRenditionsFor()` below is the single implementation of that rule.
 */
export const VideoRenditionHeight = z.union([
	z.literal(480),
	z.literal(720),
	z.literal(1080),
	z.literal(1440),
	z.literal(2160),
]);
export type VideoRenditionHeight = z.infer<typeof VideoRenditionHeight>;

/** The locked always-on ladder. */
export const BASE_VIDEO_RENDITIONS: readonly VideoRenditionHeight[] = [480, 720, 1080];

/**
 * Resolves the HLS ladder for a source height, implementing the owner lock exactly:
 * always 480/720/1080; add 1440 only for a 1440p source; for a 2160p source add 2160
 * and SKIP 1440.
 */
export const hlsRenditionsFor = (sourceHeight: number): VideoRenditionHeight[] => {
	if (!Number.isFinite(sourceHeight) || sourceHeight <= 0) {
		throw new RangeError('sourceHeight must be a positive number');
	}
	if (sourceHeight >= 2160) return [...BASE_VIDEO_RENDITIONS, 2160];
	if (sourceHeight >= 1440) return [...BASE_VIDEO_RENDITIONS, 1440];
	return [...BASE_VIDEO_RENDITIONS];
};

export const VideoRendition = z.object({
	height: VideoRenditionHeight,
	storageKey: z.string().min(1),
	bitrateKbps: z.number().int().positive(),
	byteSize: z.number().int().nonnegative(),
});
export type VideoRendition = z.infer<typeof VideoRendition>;

/**
 * Localized accessibility/SEO text. Owner lock: alt/SEO text is required for every
 * ACTIVE locale before an asset may be published — enforced at the publish use case,
 * which knows the configured locale set (`ActiveLocaleConfig`), not here.
 */
export const MediaAltText = z.object({
	alt: LocalizedText.default({}),
	title: LocalizedText.default({}),
	caption: LocalizedText.default({}),
});
export type MediaAltText = z.infer<typeof MediaAltText>;

/**
 * A first-class, reusable media asset (`mediaAssets`).
 *
 * Owner locks: assets are reusable and referenced by products/content (never embedded
 * copies); uploads go direct to Spaces via a presigned operation and the API does not
 * proxy normal browse bytes; the hot video master is deleted after a successful
 * transcode; orphans are SOFT-deleted and garbage-collected after a grace period, which
 * is why `deletedAt` exists and hard deletion is not modelled here.
 */
export const MediaAsset = z
	.object({
		id: Id,
		kind: MediaKind,
		/** Spaces object key of the retained original (or null once a video master is purged). */
		originalStorageKey: z.string().min(1).nullable().default(null),
		originalFormat: z.union([ImageUploadFormat, VideoUploadFormat]),
		originalByteSize: z.number().int().nonnegative(),
		width: z.number().int().positive().nullable().default(null),
		height: z.number().int().positive().nullable().default(null),
		/** Full-resolution WebP companion (images only). */
		fullWebpStorageKey: z.string().min(1).nullable().default(null),
		derivatives: z.array(ImageDerivative).default([]),
		/** HLS renditions (videos only); the playlist is derived from these. */
		renditions: z.array(VideoRendition).default([]),
		hlsPlaylistKey: z.string().min(1).nullable().default(null),
		durationSeconds: z.number().nonnegative().nullable().default(null),
		text: MediaAltText.default({ alt: {}, title: {}, caption: {} }),
		status: CatalogStatus.default('draft'),
		/** Soft delete for orphan GC after grace (`DEC-DELETE-RETENTION`). */
		deletedAt: IsoDateTime.nullable().default(null),
		createdAt: IsoDateTime.optional(),
		updatedAt: IsoDateTime.optional(),
	})
	.superRefine((asset, ctx) => {
		const roles = asset.derivatives.map((derivative) => derivative.role);
		if (new Set(roles).size !== roles.length) {
			ctx.addIssue({
				code: 'custom',
				message: 'an asset may not hold two derivatives of the same role',
				path: ['derivatives'],
			});
		}

		if (asset.kind === 'image') {
			if (asset.renditions.length > 0 || asset.hlsPlaylistKey) {
				ctx.addIssue({
					code: 'custom',
					message: 'an image asset may not carry video renditions',
					path: ['renditions'],
				});
			}
			if (!ImageUploadFormat.safeParse(asset.originalFormat).success) {
				ctx.addIssue({
					code: 'custom',
					message: 'image assets accept JPEG or PNG uploads only',
					path: ['originalFormat'],
				});
			}
		}

		if (asset.kind === 'video') {
			if (asset.derivatives.length > 0 || asset.fullWebpStorageKey) {
				ctx.addIssue({
					code: 'custom',
					message: 'a video asset may not carry image derivatives',
					path: ['derivatives'],
				});
			}
			if (!VideoUploadFormat.safeParse(asset.originalFormat).success) {
				ctx.addIssue({
					code: 'custom',
					message: 'video masters must be MP4 (H.264/AAC)',
					path: ['originalFormat'],
				});
			}
			const heights = asset.renditions.map((rendition) => rendition.height);
			if (new Set(heights).size !== heights.length) {
				ctx.addIssue({ code: 'custom', message: 'duplicate rendition height', path: ['renditions'] });
			}
		}
	});
export type MediaAsset = z.infer<typeof MediaAsset>;

/**
 * How a product's imagery is organised. Owner lock: both modes are supported, compound
 * rows follow the full variation-axis Cartesian matrix, and switching modes PARKS the
 * other mode's data rather than destroying it.
 */
export const ProductImageMode = z.enum(['simple', 'compound']);
export type ProductImageMode = z.infer<typeof ProductImageMode>;

/**
 * A reference from an owner (product, variant, option term, content block) to an asset.
 *
 * Owner lock: ordering is contiguous and attachment-owned, and position `1` is the
 * primary. `MediaAttachmentSet` enforces that; a lone attachment cannot see its siblings.
 */
export const MediaAttachment = z.object({
	assetId: Id,
	/** 1-based; `1` is the primary image. */
	sortOrder: z.number().int().positive(),
	/** Set only for compound mode: the axis selection this row illustrates. */
	optionSelectionHash: z.string().min(1).nullable().default(null),
});
export type MediaAttachment = z.infer<typeof MediaAttachment>;

/** An owner's ordered attachments, with the contiguity/primary invariants. */
export const MediaAttachmentSet = z.array(MediaAttachment).superRefine((attachments, ctx) => {
	if (attachments.length === 0) return;

	const orders = attachments.map((attachment) => attachment.sortOrder).sort((a, b) => a - b);
	if (new Set(orders).size !== orders.length) {
		ctx.addIssue({ code: 'custom', message: 'attachment sort order must be unique' });
	}
	if (orders[0] !== 1) {
		ctx.addIssue({ code: 'custom', message: 'attachment ordering starts at 1 (the primary image)' });
	}
	if (orders.at(-1) !== orders.length) {
		ctx.addIssue({ code: 'custom', message: 'attachment ordering must be contiguous (no gaps)' });
	}

	const assetIds = attachments.map((attachment) => attachment.assetId);
	if (new Set(assetIds).size !== assetIds.length) {
		ctx.addIssue({ code: 'custom', message: 'the same asset may not be attached twice to one owner' });
	}
});
export type MediaAttachmentSet = z.infer<typeof MediaAttachmentSet>;

/**
 * `POST /admin/media/presign` — the API hands back a direct-to-Spaces upload target and
 * never proxies the bytes. Size/duration ceilings are enforced by the handler from
 * config (`DEC-MEDIA-CAPS`), not by this schema.
 */
export const MediaPresignRequest = z.object({
	kind: MediaKind,
	contentType: z.union([ImageUploadFormat, VideoUploadFormat]),
	byteSize: z.number().int().positive(),
	fileName: z.string().min(1).max(255),
});
export type MediaPresignRequest = z.infer<typeof MediaPresignRequest>;

export const MediaPresignResponse = z.object({
	assetId: Id,
	uploadUrl: z.string().min(1),
	storageKey: z.string().min(1),
	fields: z.record(z.string(), z.string()).default({}),
	expiresAt: IsoDateTime,
});
export type MediaPresignResponse = z.infer<typeof MediaPresignResponse>;
