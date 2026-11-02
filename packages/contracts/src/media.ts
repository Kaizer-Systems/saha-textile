import { z } from 'zod';

import { CatalogStatus } from './catalog';
import { Id, IsoDateTime, LocalizedText } from './common';

/**
 * The seeded image ROLE KEYS (owner log § Media, `DEC-IMG-PX` closed 2026-11-02).
 *
 * Roles live in the `mediaRoles` collection: these seeded keys are undeletable and
 * unrenamable, their dimensions are editable, and operators may add custom roles — so a
 * derivative's `role` is any `MediaRoleKey`, and this enum only names the seeds.
 *
 * `swatch_image_v2` is the second swatch renderer ("Image V2"), kept as its own role
 * because it crops differently from `swatch_image`.
 */
export const SeededMediaRole = z.enum([
	'thumb',
	'card',
	'gallery',
	'zoom',
	'swatch_image',
	'swatch_image_v2',
	'share',
	'feed_square',
	'email_thumb',
	'review_thumb',
	'review_full',
	'banner',
	'blog',
	'category_icon',
	'avatar',
]);
export type SeededMediaRole = z.infer<typeof SeededMediaRole>;

/** The six product roles the publish gate and the storefront card/PDP rely on. */
export const MediaRole = z.enum(['thumb', 'card', 'gallery', 'zoom', 'swatch_image', 'swatch_image_v2']);
export type MediaRole = z.infer<typeof MediaRole>;

/** A role key: a seeded role or an operator-defined one. Lower snake case, URL- and key-safe. */
export const MediaRoleKey = z
	.string()
	.regex(/^[a-z][a-z0-9_]{1,39}$/, 'role keys are lower snake case, 2–40 characters');
export type MediaRoleKey = z.infer<typeof MediaRoleKey>;

export const MediaKind = z.enum(['image', 'video']);
export type MediaKind = z.infer<typeof MediaKind>;

/**
 * What an image is FOR. It decides which roles the worker generates and which ingest rules
 * apply (a product photo has a 1600 px floor; a review photo has none).
 */
export const MediaPurpose = z.enum(['product', 'category', 'banner', 'blog', 'review', 'avatar', 'icon']);
export type MediaPurpose = z.infer<typeof MediaPurpose>;

/**
 * Accepted upload formats. Owner lock: JPEG/PNG in, original retained privately, static
 * WebP role derivatives generated at the worker edge (plus a JPEG `email_thumb`). No
 * full-resolution WebP copy (dropped 2026-11-02) and **no AVIF** — each derivative records
 * its format so AVIF can be added later as a role setting, not a contract change.
 *
 * Review photos may be picked as HEIC/HEIF on the customer's phone, but the browser
 * converts them to JPEG before presign, so the API still only ever accepts these two.
 */
export const ImageUploadFormat = z.enum(['image/jpeg', 'image/png']);
export type ImageUploadFormat = z.infer<typeof ImageUploadFormat>;

/** Formats a derivative may be written in. */
export const DerivativeFormat = z.enum(['image/webp', 'image/jpeg']);
export type DerivativeFormat = z.infer<typeof DerivativeFormat>;

/** Master video upload format (H.264/AAC MP4, 1080p or better). Dormant: video is off at launch. */
export const VideoUploadFormat = z.enum(['video/mp4']);
export type VideoUploadFormat = z.infer<typeof VideoUploadFormat>;

/**
 * Ingest limits as served to clients (`GET /media/upload-rules`). The numbers are domain
 * policy owned by `core-domain` (`MEDIA_INGEST_POLICY`); clients read them from the API so
 * an admin form and a review form can never disagree with the presign handler.
 */
export const MediaUploadRules = z.object({
	maxBytes: z.number().int().positive(),
	maxLongEdge: z.number().int().positive(),
	maxMegapixels: z.number().positive(),
	minShortEdge: z.record(MediaPurpose, z.number().int().positive()),
	aspectWarnTolerance: z.number().min(0).max(1),
	targetAspect: z.record(MediaPurpose, z.object({ width: z.number().int(), height: z.number().int() })),
	reviewWarnBelowLongEdge: z.number().int().positive(),
	maxReviewPhotos: z.number().int().positive(),
	acceptedTypes: z.array(ImageUploadFormat),
});
export type MediaUploadRules = z.infer<typeof MediaUploadRules>;

/**
 * How a role fits the source into its box.
 *
 * - `inside` — keep the source shape, scale to the width (product 3:4, banners, review full);
 * - `cover` — fill the box exactly, centre crop (square swatches, review thumbs);
 * - `pad` — fit inside the box and letterbox on white (share and feed images).
 */
export const DerivativeFit = z.enum(['inside', 'cover', 'pad']);
export type DerivativeFit = z.infer<typeof DerivativeFit>;

/**
 * One role's definition (`mediaRoles`). Dimensions are editable; editing them bumps
 * `version`, which marks every derivative of the old version stale until an explicit
 * reprocess replaces it.
 */
export const MediaRoleDefinition = z
	.object({
		key: MediaRoleKey,
		label: z.string().min(1).max(80),
		seeded: z.boolean().default(false),
		purposes: z.array(MediaPurpose).min(1),
		widths: z.array(z.number().int().positive().max(8000)).min(1),
		/** Box shape for `cover`/`pad`; null keeps the source shape. */
		aspect: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).nullable(),
		fit: DerivativeFit,
		format: DerivativeFormat.default('image/webp'),
		quality: z.number().int().min(40).max(100).default(82),
		/** Generated only for the primary image of a product (share, feed, email copies). */
		primaryOnly: z.boolean().default(false),
		/** Banners: skip widths beyond twice the slot's widest display. */
		respectSlotMaxWidth: z.boolean().default(false),
		version: z.number().int().positive().default(1),
		updatedAt: IsoDateTime.optional(),
	})
	.superRefine((role, ctx) => {
		if (new Set(role.widths).size !== role.widths.length) {
			ctx.addIssue({ code: 'custom', message: 'role widths must be unique', path: ['widths'] });
		}
		if (role.fit !== 'inside' && !role.aspect) {
			ctx.addIssue({ code: 'custom', message: '`cover` and `pad` roles need an aspect box', path: ['aspect'] });
		}
	});
export type MediaRoleDefinition = z.infer<typeof MediaRoleDefinition>;

/** `PUT /admin/media/roles/:key` — the editable part of a role. */
export const MediaRoleUpdate = z.object({
	label: z.string().min(1).max(80).optional(),
	widths: z.array(z.number().int().positive().max(8000)).min(1).optional(),
	quality: z.number().int().min(40).max(100).optional(),
});
export type MediaRoleUpdate = z.infer<typeof MediaRoleUpdate>;

/**
 * One generated image derivative. Dimensions are RECORDED here (what the worker actually
 * produced) but never PRESCRIBED — the ladder lives in `mediaRoles`. A derivative is unique
 * by (role, width): a role emits several widths.
 */
export const ImageDerivative = z.object({
	role: MediaRoleKey,
	storageKey: z.string().min(1),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	byteSize: z.number().int().nonnegative(),
	format: DerivativeFormat,
	/** The role version this was rendered from; lower than the role's current version = stale. */
	roleVersion: z.number().int().positive().default(1),
});
export type ImageDerivative = z.infer<typeof ImageDerivative>;

/** Where an asset is in its life between presign and use. */
export const MediaProcessingState = z.enum(['awaiting_upload', 'queued', 'processing', 'ready', 'failed']);
export type MediaProcessingState = z.infer<typeof MediaProcessingState>;

/**
 * Who may read the derivatives. `public` objects are served by the CDN; `private` ones
 * (review photos awaiting moderation) are reachable only through a short-lived signed URL
 * and are never cached, so approval has no stale-cache problem.
 */
export const MediaVisibility = z.enum(['public', 'private']);
export type MediaVisibility = z.infer<typeof MediaVisibility>;

/** Non-fatal findings recorded at processing time and shown to the admin. */
export const MediaWarning = z.enum([
	'aspect_off_target',
	'letterboxed',
	'below_recommended_size',
	'role_width_skipped',
	'stale_derivatives',
]);
export type MediaWarning = z.infer<typeof MediaWarning>;

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
 * Owner locks: assets are reusable and referenced by owners (never embedded copies);
 * uploads go direct to Spaces via a presigned PUT and the API does not proxy browse bytes;
 * the original is kept privately as the regeneration master (review photos excepted: their
 * original is discarded once the two review roles exist); orphans are SOFT-deleted and
 * garbage-collected after a 30-day grace, which is why `deletedAt` exists.
 */
export const MediaAsset = z
	.object({
		id: Id,
		kind: MediaKind,
		purpose: MediaPurpose.default('product'),
		/** Spaces key of the retained original; null once discarded (review photos) or purged. */
		originalStorageKey: z.string().min(1).nullable().default(null),
		originalFormat: z.union([ImageUploadFormat, VideoUploadFormat]),
		originalByteSize: z.number().int().nonnegative(),
		width: z.number().int().positive().nullable().default(null),
		height: z.number().int().positive().nullable().default(null),
		/** SEO filename stem used in derivative keys; editing it is a reprocess trigger. */
		slug: z
			.string()
			.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
			.max(80),
		derivatives: z.array(ImageDerivative).default([]),
		/** Dominant colour as `#rrggbb`, painted in the image box while it loads. */
		dominantColor: z
			.string()
			.regex(/^#[0-9a-f]{6}$/)
			.nullable()
			.default(null),
		/** Base64 ThumbHash (a few dozen bytes) for an instant soft preview. */
		thumbHash: z.string().max(120).nullable().default(null),
		visibility: MediaVisibility.default('public'),
		processing: z
			.object({
				state: MediaProcessingState.default('awaiting_upload'),
				attempts: z.number().int().nonnegative().default(0),
				error: z.string().max(500).nullable().default(null),
				processedAt: IsoDateTime.nullable().default(null),
			})
			.default({ state: 'awaiting_upload', attempts: 0, error: null, processedAt: null }),
		warnings: z.array(MediaWarning).default([]),
		/**
		 * Set when the asset becomes a product's #1 image; it adds the primary-only roles
		 * (link preview, feed square, email thumbnail) on the next reprocess.
		 */
		servesAsPrimary: z.boolean().default(false),
		/** Banners: widest CSS display width of the target slot (see `MediaPresignRequest`). */
		maxDisplayWidth: z.number().int().positive().nullable().default(null),
		/** HLS renditions (videos only, dormant at launch); the playlist is derived from these. */
		renditions: z.array(VideoRendition).default([]),
		hlsPlaylistKey: z.string().min(1).nullable().default(null),
		durationSeconds: z.number().nonnegative().nullable().default(null),
		text: MediaAltText.default({ alt: {}, title: {}, caption: {} }),
		status: CatalogStatus.default('draft'),
		/** Who uploaded it — an admin user id, or a customer id for review photos. */
		uploadedBy: z
			.object({ type: z.enum(['admin', 'customer']), id: Id })
			.nullable()
			.default(null),
		/** Soft delete for orphan GC after grace (`DEC-DELETE-RETENTION`). */
		deletedAt: IsoDateTime.nullable().default(null),
		createdAt: IsoDateTime.optional(),
		updatedAt: IsoDateTime.optional(),
	})
	.superRefine((asset, ctx) => {
		const pairs = asset.derivatives.map((derivative) => `${derivative.role}@${derivative.width}`);
		if (new Set(pairs).size !== pairs.length) {
			ctx.addIssue({
				code: 'custom',
				message: 'an asset may not hold two derivatives of the same role and width',
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
			if (asset.derivatives.length > 0) {
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
	/**
	 * Optional per-placement alt text. Empty inherits the asset's baseline alt; the publish
	 * gate checks the resolved value (override, else asset) for every active locale.
	 */
	altOverride: LocalizedText.default({}),
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
 * `POST /admin/media/presign` (and the customer review-photo equivalent) — the API hands
 * back a direct-to-Spaces upload target and never proxies the bytes. `width`/`height` are
 * what the browser decoded, used to refuse an over-cap or under-floor image before upload;
 * the worker re-checks the real bytes.
 */
export const MediaPresignRequest = z.object({
	kind: MediaKind.default('image'),
	purpose: MediaPurpose,
	contentType: z.union([ImageUploadFormat, VideoUploadFormat]),
	byteSize: z.number().int().positive(),
	fileName: z.string().min(1).max(255),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	/**
	 * Banners only: the widest CSS width the target slot is ever shown at. The worker skips
	 * banner widths beyond twice this, so a small promo card does not get a 2880 px file.
	 */
	maxDisplayWidth: z.number().int().positive().max(4000).optional(),
});
export type MediaPresignRequest = z.infer<typeof MediaPresignRequest>;

export const MediaPresignResponse = z.object({
	assetId: Id,
	uploadUrl: z.string().min(1),
	/** Headers the browser must replay verbatim on the PUT (they are signed). */
	headers: z.record(z.string(), z.string()).default({}),
	expiresAt: IsoDateTime,
	/** Non-blocking findings to show before upload, e.g. an off-3:4 photo. */
	warnings: z.array(MediaWarning).default([]),
});
export type MediaPresignResponse = z.infer<typeof MediaPresignResponse>;

/** `PATCH /admin/media/:id` — SEO identity of an asset. A slug change triggers a reprocess. */
export const MediaAssetTextUpdate = z.object({
	slug: z
		.string()
		.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
		.max(80)
		.optional(),
	alt: LocalizedText.optional(),
	title: LocalizedText.optional(),
	caption: LocalizedText.optional(),
});
export type MediaAssetTextUpdate = z.infer<typeof MediaAssetTextUpdate>;

/** One rendered width of one role, ready for a `srcset` entry. */
export const ResolvedImageSource = z.object({
	url: z.string().min(1),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	format: DerivativeFormat,
});
export type ResolvedImageSource = z.infer<typeof ResolvedImageSource>;

/**
 * What the API hands a client for one image: srcset-ready URLs per role, the intrinsic
 * shape (so the box is sized before a byte arrives), the placeholder, and the alt text
 * already resolved for the request locale. Clients never compose a media URL.
 */
export const ResolvedImage = z.object({
	assetId: Id,
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	alt: z.string(),
	dominantColor: z.string().nullable(),
	thumbHash: z.string().nullable(),
	roles: z.record(MediaRoleKey, z.array(ResolvedImageSource)),
});
export type ResolvedImage = z.infer<typeof ResolvedImage>;

/** Admin library row: the asset plus its preview and usage count. */
export const MediaLibraryItem = z.object({
	asset: MediaAsset,
	preview: ResolvedImage.nullable(),
	usageCount: z.number().int().nonnegative(),
	staleRoles: z.array(MediaRoleKey).default([]),
});
export type MediaLibraryItem = z.infer<typeof MediaLibraryItem>;
