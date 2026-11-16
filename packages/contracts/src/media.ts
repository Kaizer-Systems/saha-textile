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
	'story',
	'feed_square',
	'email_thumb',
	'review_thumb',
	'review_full',
	'banner',
	'blog',
	'store_photo',
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

export const MediaKind = z.enum(['image', 'video', 'file']);
export type MediaKind = z.infer<typeof MediaKind>;

/**
 * What an image is FOR. It decides which roles the worker generates and which ingest rules
 * apply (a product photo has a 1600 px floor; a review photo has none).
 */
export const MediaPurpose = z.enum([
	'product',
	'category',
	'banner',
	'blog',
	'store',
	'review',
	'brand',
	'avatar',
	'icon',
]);
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
export const DerivativeFormat = z.enum(['image/webp', 'image/jpeg', 'image/png']);
export type DerivativeFormat = z.infer<typeof DerivativeFormat>;

/** Master video upload format (H.264/AAC MP4, 1080p or better). Dormant: video is off at launch. */
export const VideoUploadFormat = z.enum(['video/mp4']);
export type VideoUploadFormat = z.infer<typeof VideoUploadFormat>;

/** A plain file's MIME type (Media page, step 1): stored as it is, never processed. */
export const PlainFileFormat = z
	.string()
	.regex(/^[\w.+-]+\/[\w.+-]+$/)
	.max(127);
export type PlainFileFormat = z.infer<typeof PlainFileFormat>;

/**
 * Ingest limits as served to clients (`GET /media/upload-rules`). The numbers are domain
 * policy owned by `core-domain` (`MEDIA_INGEST_POLICY`); clients read them from the API so
 * an admin form and a review form can never disagree with the presign handler.
 */
export const MediaUploadRules = z.object({
	maxBytes: z.number().int().positive(),
	maxLongEdge: z.number().int().positive(),
	maxMegapixels: z.number().positive(),
	minShortEdge: z.partialRecord(MediaPurpose, z.number().int().positive()),
	aspectWarnTolerance: z.number().min(0).max(1),
	targetAspect: z.partialRecord(MediaPurpose, z.object({ width: z.number().int(), height: z.number().int() })),
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
 * - `pad` — fit inside the box and letterbox on white (feed square: catalogues want plain light
 *   backgrounds);
 * - `blur` — fit inside the box over a blurred, darkened enlargement of the same photo (link
 *   previews: richer than white bands in a WhatsApp or social card, and still uncropped).
 */
export const DerivativeFit = z.enum(['inside', 'cover', 'pad', 'blur', 'story']);
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
		/** Link-preview cards: the Brand Kit logo on a white strip along the bottom (share brief J2). */
		brandStrip: z.boolean().default(false),
		/** `pad` only: white margin on every side, as a fraction of the box (a logo card that apps may crop). */
		inset: z.number().min(0).max(0.4).default(0),
		version: z.number().int().positive().default(1),
		updatedAt: IsoDateTime.optional(),
	})
	.superRefine((role, ctx) => {
		if (new Set(role.widths).size !== role.widths.length) {
			ctx.addIssue({ code: 'custom', message: 'role widths must be unique', path: ['widths'] });
		}
		if (role.fit !== 'inside' && !role.aspect) {
			ctx.addIssue({
				code: 'custom',
				message: '`cover`, `pad`, `blur` and `story` roles need an aspect box',
				path: ['aspect'],
			});
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
 * How a photo of a different shape is fitted to a profile's shape (Media brief R4-1, fills table).
 *
 * - `as_is` — the photo already has the profile's shape (within 5%), or the profile keeps the photo's own shape;
 * - `white` — white padding (for icons: a white background, never see-through);
 * - `blur` — a blurred, darkened enlargement of the same photo fills the gaps;
 * - `crop` — fills the box by cutting the edges, guided by the focal point;
 * - `colour` — bars in the photo's own dominant colour;
 * - `brand` — icons only: the Brand Kit colour behind the logo.
 *
 * Stretching is never offered.
 */
export const MediaFill = z.enum(['as_is', 'white', 'blur', 'crop', 'colour', 'brand']);
export type MediaFill = z.infer<typeof MediaFill>;

/** A profile key: lower snake case, like role keys. */
export const MediaProfileKey = z
	.string()
	.regex(/^[a-z][a-z0-9_]{1,39}$/, 'profile keys are lower snake case, 2–40 characters');
export type MediaProfileKey = z.infer<typeof MediaProfileKey>;

/** The smallest photo a profile wants, on its short side or its width, and whether it only warns or refuses. */
export const MediaProfileMinSize = z.object({
	edge: z.enum(['short', 'width']),
	px: z.number().int().positive().max(8192),
	mode: z.enum(['warn', 'refuse']),
});
export type MediaProfileMinSize = z.infer<typeof MediaProfileMinSize>;

/**
 * An image profile (`mediaProfiles`, Settings › Image profiles F01/F02): what the image worker makes for one
 * kind of use. A named bundle of the size families in `mediaRoles` plus its own rules. Edits bump `version` and
 * apply to versions made afterwards only; versions already made never change.
 */
export const MediaProfile = z
	.object({
		key: MediaProfileKey,
		name: z.string().trim().min(1).max(60),
		/** Built-in profiles can be edited and switched off, never deleted. */
		builtIn: z.boolean().default(false),
		/** The box the photo is fitted to; null keeps the photo's own shape (logos, banners). */
		shape: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).nullable(),
		/** The size families it makes, by role key (a profile added in Settings has one family, its own key). */
		roles: z.array(MediaRoleKey).min(1),
		/** The widths each family makes, in px (F02 “Sizes made”); never enlarged. Absent: the family's own widths. */
		widths: z.record(MediaRoleKey, z.array(z.number().int().positive().max(8192)).min(1).max(12)).default({}),
		/** WebP/JPEG quality for this profile's files; null keeps each size family's own (80–86). */
		quality: z.number().int().min(40).max(100).nullable().default(null),
		/** The fills an admin may tick when the photo's shape differs; empty when the shape is kept. */
		fills: z.array(MediaFill.exclude(['as_is'])),
		minSize: MediaProfileMinSize.nullable().default(null),
		maxBytes: z
			.number()
			.int()
			.positive()
			.max(25 * 1024 * 1024),
		accepts: z.array(z.string().regex(/^image\/[\w.+-]+$/)).min(1),
		/** Made by itself for a product's main photo, never chosen (the link preview). */
		mainPhotoOnly: z.boolean().default(false),
		/** Off: hidden from uploads and pickers; versions already made keep working. */
		enabled: z.boolean().default(true),
		version: z.number().int().positive().default(1),
		updatedAt: IsoDateTime.optional(),
	})
	.superRefine((profile, ctx) => {
		if (new Set(profile.roles).size !== profile.roles.length) {
			ctx.addIssue({ code: 'custom', message: 'a profile lists each size family once', path: ['roles'] });
		}
		if (new Set(profile.fills).size !== profile.fills.length) {
			ctx.addIssue({ code: 'custom', message: 'a profile lists each fill once', path: ['fills'] });
		}
		for (const [role, list] of Object.entries(profile.widths)) {
			if (!profile.roles.includes(role)) {
				ctx.addIssue({
					code: 'custom',
					message: 'sizes are given for a family the profile does not make',
					path: ['widths', role],
				});
			}
			if (new Set(list).size !== list.length) {
				ctx.addIssue({ code: 'custom', message: 'each size is listed once', path: ['widths', role] });
			}
		}
		if (!profile.shape && profile.fills.length > 0) {
			ctx.addIssue({
				code: 'custom',
				message: 'a profile that keeps the photo’s own shape has nothing to fill',
				path: ['fills'],
			});
		}
	});
export type MediaProfile = z.infer<typeof MediaProfile>;

/**
 * `POST /admin/media/profiles` and `PUT /admin/media/profiles/:key` (Settings › Image profiles F02). The key is
 * made from the name when a profile is added and never changes; a built-in profile keeps its name.
 */
export const MediaProfileWrite = z.object({
	name: z.string().trim().min(1).max(60),
	shape: z
		.object({ width: z.number().int().positive().max(100), height: z.number().int().positive().max(100) })
		.nullable(),
	widths: z.record(MediaRoleKey, z.array(z.number().int().positive().max(8192)).min(1).max(12)),
	quality: z.number().int().min(40).max(100).nullable(),
	minSize: MediaProfileMinSize.nullable(),
	fills: z.array(MediaFill.exclude(['as_is'])).max(5),
	maxBytes: z
		.number()
		.int()
		.positive()
		.max(25 * 1024 * 1024),
	accepts: z
		.array(z.string().regex(/^image\/[\w.+-]+$/))
		.min(1)
		.max(20),
	enabled: z.boolean(),
});
export type MediaProfileWrite = z.infer<typeof MediaProfileWrite>;

/** `PUT /admin/media/profiles/:key`: any part of a profile; the list's Status switch sends `enabled` alone. */
export const MediaProfileUpdate = MediaProfileWrite.partial();
export type MediaProfileUpdate = z.infer<typeof MediaProfileUpdate>;

/** `GET /admin/media/profiles`: each profile with how many photos hold a version of it (F01's Images column). */
export const MediaProfileListItem = z.object({
	profile: MediaProfile,
	photos: z.number().int().nonnegative(),
});
export type MediaProfileListItem = z.infer<typeof MediaProfileListItem>;

/**
 * A version id is the profile and the fill (`hero_21x9.crop`): one photo has at most one version of each, so two
 * admins adding the same version can never make it twice, and a page that stores it keeps finding it.
 */
/** One Replace in progress (S7, C08): the new original, then its versions being made. */
export const MediaReplacement = z.object({
	key: z.string().min(1),
	contentType: z.string(),
	byteSize: z.number().int().nonnegative(),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	sha256: z.string().nullable().default(null),
	/** uploading → queued (the upload finished) → making (the worker took it) → gone on success, or failed. */
	phase: z.enum(['uploading', 'queued', 'making', 'failed']),
	/**
	 * `replace`: a new original (S7). `focal`: the same original with a new focal point (S10): only Crop versions are
	 * remade, and the original is never deleted. `rename`: the same original under a new web file name (R5-6): every
	 * file is made again with the new name, and the original is never deleted. `refresh`: the same original; one
	 * profile's versions made with its earlier settings are made again with today's (“Bring older versions up to
	 * date”, F02).
	 */
	reason: z.enum(['replace', 'focal', 'rename', 'refresh']).default('replace'),
	/** The profile a `refresh` brings up to date. */
	profileKey: z.string().min(1).optional(),
	/** The new web file name of a `rename`; it becomes the photo's `slug` when the new files are in place. */
	slug: z
		.string()
		.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
		.max(80)
		.optional(),
	/** Sizes made so far and in all, for C08's “5 of 5 sizes”. */
	made: z.number().int().nonnegative().default(0),
	total: z.number().int().nonnegative().default(0),
	error: z.string().nullable().default(null),
	startedAt: IsoDateTime,
	by: z.string().nullable().default(null),
});
export type MediaReplacement = z.infer<typeof MediaReplacement>;

/** Files kept after a Replace until `deleteAfter` (decision 11: 7 days), then deleted by the worker. */
export const MediaKeptFiles = z.object({
	keys: z.array(z.string().min(1)),
	bytes: z.number().int().nonnegative(),
	deleteAfter: IsoDateTime,
	reason: z.enum(['replace', 'focal', 'rename', 'refresh']),
});
export type MediaKeptFiles = z.infer<typeof MediaKeptFiles>;

export const MediaVersionId = z.string().regex(/^[a-z][a-z0-9_]{1,39}\.(as_is|white|blur|crop|colour|brand)$/);
export type MediaVersionId = z.infer<typeof MediaVersionId>;

export const MediaVersionState = z.enum(['making', 'ready', 'failed']);
export type MediaVersionState = z.infer<typeof MediaVersionState>;

/**
 * One branch of a photo's tree (R4-1): a profile plus a fill, written once. Its files are the asset's
 * derivatives that carry its id; derivatives without one are made once per photo (link preview, status card,
 * feed square, email pictures).
 */
export const MediaVersion = z.object({
	id: MediaVersionId,
	profileKey: MediaProfileKey,
	/** The profile's version when this one was made; lower than the profile's current one = made under older settings. */
	profileVersion: z.number().int().positive(),
	fill: MediaFill,
	state: MediaVersionState.default('ready'),
	/** Why a version failed (a refusal code or `render_failed`), shown beside Retry; null otherwise. */
	error: z.string().max(80).nullable().optional(),
	createdAt: IsoDateTime,
});
export type MediaVersion = z.infer<typeof MediaVersion>;

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
	/** The version this file belongs to; absent or null for files made once per photo. */
	versionId: MediaVersionId.nullable().optional(),
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
		/** The upload's type: JPEG or PNG for images, MP4 for videos, any MIME type for a plain file. */
		originalFormat: z.union([ImageUploadFormat, VideoUploadFormat, PlainFileFormat]),
		originalByteSize: z.number().int().nonnegative(),
		width: z.number().int().positive().nullable().default(null),
		height: z.number().int().positive().nullable().default(null),
		/** SEO filename stem used in derivative keys; editing it is a reprocess trigger. */
		slug: z
			.string()
			.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
			.max(80),
		derivatives: z.array(ImageDerivative).default([]),
		/**
		 * The photo's versions (profile × fill, R4-1). Absent or empty for plain files, videos and review photos, and
		 * on an asset written before image profiles (the release migration names those).
		 */
		versions: z.array(MediaVersion).optional(),
		/** The part that must stay in every crop (S10), as fractions of the upright photo; null keeps the middle. */
		focal: z
			.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
			.nullable()
			.optional(),
		/** A new photo on its way in, while Replace runs (media step 3b, S7, C08); null or absent otherwise. */
		replacing: MediaReplacement.nullable().optional(),
		/**
		 * Files a Replace (or, later, a focal point move) left behind: kept 7 days so pages already open keep their
		 * pictures, then deleted (decision 11).
		 */
		keptFiles: z.array(MediaKeptFiles).optional(),
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
		/**
		 * The Media page (step 1): its folder (absent or null is My files), its name there, and Trash.
		 * Optional, so an asset written before step 1 reads as being in My files and not in Trash.
		 */
		folderId: Id.nullable().optional(),
		displayName: z.string().max(255).nullable().optional(),
		/** SHA-256 of the uploaded bytes (hex), for the duplicate check (S6). */
		sha256: z
			.string()
			.regex(/^[0-9a-f]{64}$/)
			.nullable()
			.optional(),
		trashedAt: IsoDateTime.nullable().optional(),
		trashedFrom: Id.nullable().optional(),
		createdAt: IsoDateTime.optional(),
		updatedAt: IsoDateTime.optional(),
	})
	.superRefine((asset, ctx) => {
		const pairs = asset.derivatives.map(
			(derivative) => `${derivative.versionId ?? ''}|${derivative.role}@${derivative.width}`,
		);
		if (new Set(pairs).size !== pairs.length) {
			ctx.addIssue({
				code: 'custom',
				message: 'one version of an asset may not hold two derivatives of the same role and width',
				path: ['derivatives'],
			});
		}
		const versionIds = (asset.versions ?? []).map((version) => version.id);
		if (new Set(versionIds).size !== versionIds.length) {
			ctx.addIssue({ code: 'custom', message: 'an asset holds each version once', path: ['versions'] });
		}
		const known = new Set(versionIds);
		if (asset.derivatives.some((derivative) => derivative.versionId && !known.has(derivative.versionId))) {
			ctx.addIssue({
				code: 'custom',
				message: 'a derivative names a version the asset does not have',
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

		if (asset.kind === 'file' && asset.derivatives.length > 0) {
			ctx.addIssue({
				code: 'custom',
				message: 'a plain file is stored as it is and has no image sizes',
				path: ['derivatives'],
			});
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
	/** From the Media page (step 1): where it goes, its SHA-256, and the storage approval it runs under. */
	folderId: Id.nullable().optional(),
	sha256: z
		.string()
		.regex(/^[0-9a-f]{64}$/)
		.optional(),
	reservationId: Id.optional(),
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

/** `GET /admin/media` query. */
export const MediaLibraryQuery = z.object({
	purpose: MediaPurpose.optional(),
	search: z.string().max(100).optional(),
	page: z.coerce.number().int().positive().default(1),
	pageSize: z.coerce.number().int().positive().max(100).default(24),
});
export type MediaLibraryQuery = z.infer<typeof MediaLibraryQuery>;

export const MediaLibraryResponse = z.object({
	items: z.array(MediaLibraryItem),
	total: z.number().int().nonnegative(),
	page: z.number().int().positive(),
	pageSize: z.number().int().positive(),
});
export type MediaLibraryResponse = z.infer<typeof MediaLibraryResponse>;

/**
 * `POST /storefront/reviews/photos/presign` — a customer's review photo. JPEG or PNG only:
 * HEIC/HEIF from a phone is converted in the browser before this request is made.
 */
export const ReviewPhotoPresignRequest = z.object({
	contentType: ImageUploadFormat,
	byteSize: z.number().int().positive(),
	fileName: z.string().min(1).max(255),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	/** The product being reviewed: names the photo (no personal data) and scopes it. */
	productId: Id,
});
export type ReviewPhotoPresignRequest = z.infer<typeof ReviewPhotoPresignRequest>;

/** Where an upload is, polled by the uploader until `ready` or `failed`. */
export const MediaUploadStatus = z.object({
	assetId: Id,
	state: MediaProcessingState,
	error: z.string().nullable(),
	warnings: z.array(MediaWarning),
	/** A short-lived preview (signed for private review photos), once ready. */
	previewUrl: z.string().nullable(),
});
export type MediaUploadStatus = z.infer<typeof MediaUploadStatus>;
