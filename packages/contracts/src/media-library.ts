import { z } from 'zod';

import { Id, IsoDateTime, LocalizedText } from './common';
import { MediaFill, MediaProfileKey } from './media';

/**
 * The Media page as a file manager (media build step 1; brief revision 6, accepted 15 Nov 2026):
 * folders, Trash, favourites, recent files, plain files, share links and the storage check.
 * Folders live in our database; a file's address in Spaces never changes when it moves.
 */

/** A folder name: what people type, cleaned (see core `cleanMediaName`). */
export const MediaName = z.string().trim().min(1).max(120);

export const MediaFolder = z.object({
	id: Id,
	parentId: Id.nullable().default(null),
	name: MediaName,
	/** Ids from the top down, this folder excluded: the breadcrumb and "inside" checks. */
	ancestors: z.array(Id).default([]),
	/** Running totals of what sits directly and further inside; recounted in the background. */
	files: z.number().int().nonnegative().default(0),
	bytes: z.number().int().nonnegative().default(0),
	trashedAt: IsoDateTime.nullable().default(null),
	/** Where it was when it went to Trash, so Restore can put it back. */
	trashedFrom: Id.nullable().default(null),
	createdBy: z.string().nullable().default(null),
	createdAt: IsoDateTime.optional(),
	updatedAt: IsoDateTime.optional(),
});
export type MediaFolder = z.infer<typeof MediaFolder>;

/** What the Media page groups files by (A13–A16). */
export const MediaCategory = z.enum(['images', 'videos', 'documents', 'archives', 'backups', 'other']);
export type MediaCategory = z.infer<typeof MediaCategory>;

/** One file as the Media page lists it. */
export const MediaFileRow = z.object({
	id: Id,
	kind: z.enum(['image', 'video', 'file']),
	name: z.string(),
	contentType: z.string(),
	category: MediaCategory,
	bytes: z.number().int().nonnegative(),
	width: z.number().int().positive().nullable(),
	height: z.number().int().positive().nullable(),
	folderId: Id.nullable(),
	/** "Product photos › Banarasi", for search results and favourites. */
	location: z.string(),
	visibility: z.enum(['public', 'private']),
	state: z.enum(['awaiting_upload', 'queued', 'processing', 'ready', 'failed']),
	/** A photo: versions still being made (“Adding 2 versions”, C03); the website keeps showing the live copy. */
	versionsMaking: z.number().int().nonnegative().optional(),
	/** A photo being replaced (S7): where the Replace has got; the website keeps the old photo until it is done. */
	replacing: z.enum(['uploading', 'queued', 'making', 'failed']).optional(),
	/** What that run does: a new photo, a new focal point (only crops remade), or a new web file name. */
	replacingWhy: z.enum(['replace', 'focal', 'rename', 'refresh']).optional(),
	/** In a picker that needs a profile (R4-2): this photo's ready versions of it, for the chips; empty = can't be chosen. */
	fitting: z.array(z.object({ versionId: z.string(), fill: MediaFill })).optional(),
	/** A photo: the shop's languages it has no default alt text in yet (D14: the picker says so, never refuses). */
	altMissing: z.array(z.string()).optional(),
	/** A small picture for the list; null for files the worker does not process. */
	thumbnailUrl: z.string().nullable(),
	/** Pages that use it: an image used on the website cannot go to Trash. */
	usedOn: z.number().int().nonnegative(),
	starred: z.boolean(),
	uploadedBy: z.string().nullable(),
	createdAt: IsoDateTime.nullable(),
	trashedAt: IsoDateTime.nullable(),
	/** Trash only: days until it is removed for good. */
	daysLeft: z.number().int().nonnegative().nullable(),
});
export type MediaFileRow = z.infer<typeof MediaFileRow>;

export const MediaFolderRow = MediaFolder.extend({
	starred: z.boolean(),
	location: z.string(),
	daysLeft: z.number().int().nonnegative().nullable(),
});
export type MediaFolderRow = z.infer<typeof MediaFolderRow>;

/** `GET /admin/media/browse`: a folder, a search, a category, Recent, Favourites or Trash. */
export const MediaBrowseQuery = z.object({
	view: z.enum(['folder', 'recent', 'favourites', 'trash']).default('folder'),
	folderId: Id.optional(),
	/** Words in the name; from the top level everything, inside a folder that folder and below. */
	search: z.string().trim().max(100).optional(),
	category: MediaCategory.optional(),
	/** Favourites: this admin's stars, or everyone's. */
	who: z.enum(['mine', 'everyone']).default('mine'),
	/** Filters (A11, A12). Several categories at once, as `images,documents`. */
	categories: z
		.preprocess(
			(value) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value),
			z.array(MediaCategory).max(6),
		)
		.optional(),
	state: z.enum(['ready', 'processing', 'failed']).optional(),
	/** The uploaded size: under 1 MB, 1 to 25 MB, over 25 MB. */
	size: z.enum(['under1', '1to25', 'over25']).optional(),
	/** Uploaded in the last 7, 30 or 90 days, or the last year. */
	uploaded: z.enum(['7d', '30d', '90d', '365d']).optional(),
	/** Used on the website, or not used anywhere. */
	used: z.enum(['in', 'out']).optional(),
	sort: z.enum(['name', 'created', 'size']).default('name'),
	direction: z.enum(['asc', 'desc']).default('asc'),
	page: z.coerce.number().int().positive().default(1),
	pageSize: z.coerce.number().int().positive().max(200).default(60),
	/** A picker (R4-2, D01–D17): images only, or any file. */
	accept: z.enum(['image', 'any']).optional(),
	/** A picker that needs this profile lists only photos with a ready version of it (D15)… */
	profile: MediaProfileKey.optional(),
	/** …unless the switch shows the rest too, greyed (D16). */
	showWithout: z.preprocess((value) => value === true || value === 'true' || value === '1', z.boolean()).optional(),
});
export type MediaBrowseQuery = z.infer<typeof MediaBrowseQuery>;

export const MediaBrowseResponse = z.object({
	folder: MediaFolderRow.nullable(),
	/** From the top level down to this folder. */
	breadcrumb: z.array(z.object({ id: Id, name: z.string() })),
	folders: z.array(MediaFolderRow),
	files: z.array(MediaFileRow),
	total: z.number().int().nonnegative(),
	page: z.number().int().positive(),
	pageSize: z.number().int().positive(),
	/** Who starred what, for Favourites › Everyone's (A17B). */
	starredBy: z.record(z.string(), z.array(z.string())).default({}),
	/** In a picker: what this folder holds that isn't listed (D15: “2 photos hidden (no Product 3:4) · 2 files hidden”). */
	hidden: z
		.object({ noVersion: z.number().int().nonnegative(), notImage: z.number().int().nonnegative() })
		.optional(),
});
export type MediaBrowseResponse = z.infer<typeof MediaBrowseResponse>;

/** The whole folder tree for the sidebar (A36): small rows, no files. */
export const MediaFolderTree = z.object({
	folders: z.array(MediaFolder.pick({ id: true, parentId: true, name: true, files: true, bytes: true })),
});
export type MediaFolderTree = z.infer<typeof MediaFolderTree>;

export const MediaFolderCreate = z.object({ name: MediaName, parentId: Id.nullable().default(null) });
export type MediaFolderCreate = z.infer<typeof MediaFolderCreate>;

export const MediaRename = z.object({ name: MediaName });
export type MediaRename = z.infer<typeof MediaRename>;

/** Files and folders picked together, for move, Trash, restore and delete forever. */
export const MediaSelection = z
	.object({
		fileIds: z.array(Id).max(5000).default([]),
		folderIds: z.array(Id).max(500).default([]),
	})
	.refine((value) => value.fileIds.length + value.folderIds.length > 0, { message: 'nothing chosen' });
export type MediaSelection = z.infer<typeof MediaSelection>;

export const MediaMoveRequest = z.object({
	fileIds: z.array(Id).max(5000).default([]),
	folderIds: z.array(Id).max(500).default([]),
	/** Null is the top level (My files). */
	toFolderId: Id.nullable(),
});
export type MediaMoveRequest = z.infer<typeof MediaMoveRequest>;

/** Restore: back where it was; when that folder is in Trash too, restore it as well or use My files (A19). */
export const MediaRestoreRequest = z.object({
	fileIds: z.array(Id).max(5000).default([]),
	folderIds: z.array(Id).max(500).default([]),
	whenFolderGone: z.enum(['restore_folder', 'my_files']).default('restore_folder'),
});
export type MediaRestoreRequest = z.infer<typeof MediaRestoreRequest>;

/** An image the website uses, with the pages that use it: it cannot go to Trash (A26). */
export const MediaInUse = z.object({
	id: Id,
	name: z.string(),
	usedOn: z.array(z.string()),
	/** For the popup's list (A26): the same small picture and size the Media page shows. */
	bytes: z.number().int().nonnegative().default(0),
	thumbnailUrl: z.string().nullable().default(null),
});
export type MediaInUse = z.infer<typeof MediaInUse>;

/** What an operation did, with what Undo needs (S1). */
export const MediaOperationResult = z.object({
	done: z.number().int().nonnegative(),
	/** Images used on the website that stayed out of Trash, with where they are used (A26). */
	inUse: z.array(MediaInUse).default([]),
	/** Present when the operation can be undone: the audit entry Undo reverses. */
	undoId: z.string().nullable().default(null),
});
export type MediaOperationResult = z.infer<typeof MediaOperationResult>;

/** Before Trash (A26): which of the chosen items, folders' contents included, the website uses. */
export const MediaTrashCheck = z.object({
	inUse: z.array(MediaInUse),
	/** Every file looked at: the chosen ones and everything inside the chosen folders. */
	total: z.number().int().nonnegative(),
	/** Chosen folders and files that would go to Trash. */
	moving: z.number().int().nonnegative(),
	/** Chosen folders that stay because something inside is used on the website. */
	keptFolders: z.number().int().nonnegative(),
});
export type MediaTrashCheck = z.infer<typeof MediaTrashCheck>;

/** A short-lived address for one file: shown in the browser (Preview) or saved (Download). */
export const MediaFileAddressQuery = z.object({ as: z.enum(['view', 'save']).default('save') });
export type MediaFileAddressQuery = z.infer<typeof MediaFileAddressQuery>;
export const MediaFileAddress = z.object({ url: z.string().url() });

/** One made file in a version's tree (A31B): its size and its public address. */
const MediaDetailFile = z.object({
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	bytes: z.number().int().nonnegative(),
	format: z.string(),
	url: z.string(),
});

/** A size family of a version: its role key and files, smallest first. */
const MediaDetailFamily = z.object({ role: z.string(), files: z.array(MediaDetailFile) });

/**
 * `GET /admin/media/library/files/:id/details` (A31, A31B, A32): what the details popup shows. Versions are the
 * photo's branches with their size families and files; per-photo pictures (link preview, status card, feed
 * square, email picture) are listed apart.
 */
export const MediaFileDetails = z.object({
	id: Id,
	name: z.string(),
	kind: z.enum(['image', 'video', 'file']),
	contentType: z.string(),
	bytes: z.number().int().nonnegative(),
	width: z.number().int().positive().nullable(),
	height: z.number().int().positive().nullable(),
	folderPath: z.array(z.string()),
	uploadedBy: z.string().nullable(),
	uploadedAt: IsoDateTime.nullable(),
	usedOn: z.array(z.string()),
	visibility: z.enum(['public', 'private']),
	versions: z.array(
		z.object({
			id: z.string(),
			profileKey: z.string(),
			fill: z.string(),
			state: z.enum(['making', 'ready', 'failed']),
			error: z.string().nullable(),
			createdAt: IsoDateTime,
			bytes: z.number().int().nonnegative(),
			families: z.array(MediaDetailFamily),
			/** The website draws this version (A31's “On 2 pages” while the photo is used); it can't be removed then. */
			shown: z.boolean().optional(),
		}),
	),
	perPhoto: z.array(MediaDetailFamily),
	/** The point every crop keeps (S10); null or absent: the middle. */
	focal: z.object({ x: z.number(), y: z.number() }).nullable().optional(),
	/** A photo's own text (A42), per language: the default alt text and the caption. Saved with PATCH /admin/media/:id. */
	text: z.object({ alt: LocalizedText, caption: LocalizedText }).optional(),
});
export type MediaFileDetails = z.infer<typeof MediaFileDetails>;
export type MediaFileAddress = z.infer<typeof MediaFileAddress>;

/** S11: a big upload in parts. Every call names the upload the browser started. */
export const MediaMultipartStart = z.object({
	uploadId: z.string().min(1).max(1024),
	partBytes: z.number().int().positive(),
});
export type MediaMultipartStart = z.infer<typeof MediaMultipartStart>;
export const MediaUploadRef = z.object({ uploadId: z.string().min(1).max(1024).optional() });
export type MediaUploadRef = z.infer<typeof MediaUploadRef>;
export const MediaPartsRequest = z.object({
	uploadId: z.string().min(1).max(1024),
	partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(100),
});
export type MediaPartsRequest = z.infer<typeof MediaPartsRequest>;
export const MediaPartUrls = z.object({ urls: z.array(z.object({ partNumber: z.number().int(), url: z.string() })) });
export type MediaPartUrls = z.infer<typeof MediaPartUrls>;
export const MediaUploadedParts = z.object({
	parts: z.array(z.object({ partNumber: z.number().int(), size: z.number().int().nonnegative() })),
});
export type MediaUploadedParts = z.infer<typeof MediaUploadedParts>;
export const MediaPartsQuery = z.object({ uploadId: z.string().min(1).max(1024) });
export type MediaPartsQuery = z.infer<typeof MediaPartsQuery>;

export const MediaFavouriteWrite = z.object({
	targetType: z.enum(['folder', 'file']),
	targetId: Id,
	starred: z.boolean(),
});
export type MediaFavouriteWrite = z.infer<typeof MediaFavouriteWrite>;

/** S6: before an upload, what each picked file matches in Media. */
export const MediaDuplicateQuery = z.object({
	folderId: Id.nullable().default(null),
	files: z
		.array(
			z.object({
				name: z.string().min(1).max(255),
				bytes: z.number().int().nonnegative(),
				/**
				 * SHA-256 of the picked file (hex), counted in the browser. Left out for files too big
				 * to read whole in a browser tab: those get the same-name check only.
				 */
				sha256: z
					.string()
					.regex(/^[0-9a-f]{64}$/)
					.optional(),
			}),
		)
		.min(1)
		.max(500),
});
export type MediaDuplicateQuery = z.infer<typeof MediaDuplicateQuery>;

export const MediaDuplicateAnswer = z.object({
	files: z.array(
		z.object({
			name: z.string(),
			/** Exactly the same bytes already in Media (B10). */
			identical: z.object({ id: Id, name: z.string(), location: z.string() }).nullable(),
			/** A different file with this name in the folder (B11). */
			sameName: z.object({ id: Id, name: z.string() }).nullable(),
			/** The name it gets when both are kept: "(1)", "(2)" (B14). */
			keepBothName: z.string(),
		}),
	),
});
export type MediaDuplicateAnswer = z.infer<typeof MediaDuplicateAnswer>;

/** `POST /admin/media/files/presign`: a plain file (not processed), stored as it is. */
export const MediaFilePresignRequest = z.object({
	fileName: z.string().min(1).max(255),
	contentType: z
		.string()
		.regex(/^[\w.+-]+\/[\w.+-]+$/)
		.max(127),
	byteSize: z.number().int().nonnegative(),
	sha256: z
		.string()
		.regex(/^[0-9a-f]{64}$/)
		.optional(),
	folderId: Id.nullable().default(null),
	/** The storage approval this upload runs under, when the check asked for one (B18). */
	reservationId: Id.optional(),
	/** A photo (media step 2): its size as the browser decoded it, checked against each profile before upload. */
	width: z.number().int().positive().max(100_000).optional(),
	height: z.number().int().positive().max(100_000).optional(),
	/** A photo: the versions to make, a profile and a fill each (R4-1, B01–B02). Plain files send none. */
	versions: z
		.array(z.object({ profileKey: MediaProfileKey, fill: MediaFill }))
		.min(1)
		.max(12)
		.optional(),
});
export type MediaFilePresignRequest = z.infer<typeof MediaFilePresignRequest>;

// --- Reprocess: add versions (media step 3, C01, C07) ----------------------------------------

/** The versions to add, a profile and a fill each; the storage approval when the check asked for one. */
const VersionAsk = z
	.array(z.object({ profileKey: MediaProfileKey, fill: MediaFill }))
	.min(1)
	.max(12);

/** `POST /admin/media/library/files/:id/versions`: add versions to one photo (C01). */
export const MediaAddVersionsRequest = z.object({ versions: VersionAsk, reservationId: Id.optional() }).strict();
export type MediaAddVersionsRequest = z.infer<typeof MediaAddVersionsRequest>;

/**
 * `POST /admin/media/library/versions`: the same versions for many photos (C07, “Add a version”). A fill becomes
 * “As is” for a photo that already has the profile's shape; a photo that can't take a version is listed, not failed.
 */
export const MediaBulkAddVersionsRequest = z
	.object({ fileIds: z.array(Id).min(1).max(200), versions: VersionAsk, reservationId: Id.optional() })
	.strict();
export type MediaBulkAddVersionsRequest = z.infer<typeof MediaBulkAddVersionsRequest>;

export const MediaAddVersionsResult = z.object({
	/** Photos that got at least one version to make. */
	photos: z.number().int().nonnegative(),
	/** Versions now being made (new ones and failed ones asked again). */
	added: z.number().int().nonnegative(),
	skipped: z.array(z.object({ fileId: z.string(), versionId: z.string(), reason: z.string() })),
});
export type MediaAddVersionsResult = z.infer<typeof MediaAddVersionsResult>;

/** `POST /admin/media/library/versions/status`: how far versions being made have got, for the tray (A48). */
export const MediaVersionsStatusRequest = z.object({ fileIds: z.array(Id).min(1).max(1000) }).strict();
export type MediaVersionsStatusRequest = z.infer<typeof MediaVersionsStatusRequest>;

export const MediaVersionsStatus = z.object({
	photos: z.number().int().nonnegative(),
	/** Photos with a version still being made. */
	making: z.number().int().nonnegative(),
	/** Photos with a version that failed. */
	failed: z.number().int().nonnegative(),
});
export type MediaVersionsStatus = z.infer<typeof MediaVersionsStatus>;

// --- Replace a photo (media step 3b, S7, C05, C08, B12, B13) --------------------------------

/** `POST /admin/media/library/files/:id/replace`: the new photo's facts, checked against every version first. */
export const MediaReplaceRequest = z
	.object({
		fileName: z.string().min(1).max(255),
		contentType: z.string().min(1).max(100),
		byteSize: z.number().int().positive(),
		width: z.number().int().positive().max(100_000),
		height: z.number().int().positive().max(100_000),
		sha256: z
			.string()
			.regex(/^[0-9a-f]{64}$/)
			.optional(),
		reservationId: Id.optional(),
	})
	.strict();
export type MediaReplaceRequest = z.infer<typeof MediaReplaceRequest>;

export const MediaReplaceUpload = z.object({
	uploadUrl: z.string(),
	headers: z.record(z.string(), z.string()),
	expiresAt: IsoDateTime,
});
export type MediaReplaceUpload = z.infer<typeof MediaReplaceUpload>;

/** `GET …/files/:id/replace`: C08's three steps. `done` once the new photo is in place (or nothing is running). */
export const MediaReplaceStatus = z.object({
	phase: z.enum(['uploading', 'queued', 'making', 'failed', 'done']),
	made: z.number().int().nonnegative(),
	total: z.number().int().nonnegative(),
	error: z.string().nullable(),
	/** Places that show the photo: they switch together when the new one is in place. */
	places: z.number().int().nonnegative(),
});
export type MediaReplaceStatus = z.infer<typeof MediaReplaceStatus>;

/**
 * `GET /admin/media/profiles/:key/refresh` — “Bring older versions up to date” (F02): photos whose versions of this
 * profile were made with earlier settings and can be made again with today's, how many versions, about how many
 * bytes, and runs under way or failed.
 */
export const MediaProfileRefresh = z.object({
	photos: z.number().int().nonnegative(),
	versions: z.number().int().nonnegative(),
	bytes: z.number().int().nonnegative(),
	running: z.number().int().nonnegative(),
	failed: z.number().int().nonnegative(),
});
export type MediaProfileRefresh = z.infer<typeof MediaProfileRefresh>;

/** `POST /admin/media/profiles/:key/refresh`: photos sent to the worker, and photos left for now because they were busy. */
export const MediaProfileRefreshStarted = z.object({
	started: z.number().int().nonnegative(),
	busy: z.number().int().nonnegative(),
});
export type MediaProfileRefreshStarted = z.infer<typeof MediaProfileRefreshStarted>;

/** `PUT /admin/media/library/files/:id/focal`: the point every crop keeps (S10, C06); null puts it back on the middle. */
export const MediaFocalRequest = z
	.object({ focal: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable() })
	.strict();
export type MediaFocalRequest = z.infer<typeof MediaFocalRequest>;

// --- Share links (R4-5, decision 13) ---------------------------------------------------------

export const ShareExpiry = z.enum(['1h', '1d', '7d', '30d', 'date', 'never']);
export type ShareExpiry = z.infer<typeof ShareExpiry>;

export const ShareAudience = z.enum(['anyone', 'admins']);
export type ShareAudience = z.infer<typeof ShareAudience>;

export const ShareLink = z.object({
	id: Id,
	assetId: Id,
	/** SHA-256 of the code; the code itself is shown once, when the link is made. */
	codeHash: z.string().regex(/^[0-9a-f]{64}$/),
	/** The last four characters, so a list can tell links apart. */
	codeEnd: z.string().max(8),
	who: ShareAudience,
	expiresAt: IsoDateTime.nullable(),
	passwordHash: z.string().nullable().default(null),
	stoppedAt: IsoDateTime.nullable().default(null),
	/** Why it stopped: by hand, or because the file went to Trash. */
	stoppedBecause: z.enum(['stopped', 'trash']).nullable().default(null),
	opens: z.number().int().nonnegative().default(0),
	lastOpenedAt: IsoDateTime.nullable().default(null),
	createdBy: z.string(),
	createdAt: IsoDateTime,
});
export type ShareLink = z.infer<typeof ShareLink>;

export const ShareLinkCreate = z
	.object({
		expiry: ShareExpiry,
		/** For `expiry: 'date'`. */
		expiresAt: IsoDateTime.optional(),
		who: ShareAudience.default('anyone'),
		password: z.string().min(4).max(128).optional(),
	})
	.refine((value) => value.expiry !== 'date' || !!value.expiresAt, { message: 'a date is needed' })
	// Admins-only links are opened with the admin's own sign-in; a password would add nothing.
	.refine((value) => value.who !== 'admins' || !value.password, { message: 'admins-only links take no password' });
export type ShareLinkCreate = z.infer<typeof ShareLinkCreate>;

export const ShareLinkUpdate = z.object({
	expiry: ShareExpiry.optional(),
	expiresAt: IsoDateTime.optional(),
	stop: z.boolean().optional(),
});
export type ShareLinkUpdate = z.infer<typeof ShareLinkUpdate>;

/** One link as the share popup lists it (never the code, apart from right after creating it). */
export const ShareLinkView = ShareLink.omit({ codeHash: true, passwordHash: true }).extend({
	hasPassword: z.boolean(),
	state: z.enum(['active', 'expired', 'stopped']),
	/** The code, only in the answer to creating it; the admin shows it as `<shop>/s/<code>`. */
	code: z.string().optional(),
	/** Who made it, as the admin is named (A35 “Made by”); null when that admin is gone. */
	createdByName: z.string().nullable().default(null),
});
export type ShareLinkView = z.infer<typeof ShareLinkView>;

export const ShareLinksResponse = z.object({
	visibility: z.enum(['public', 'private']),
	/** The permanent address of a public file, or the picture the website shows for a photo. */
	publicUrl: z.string().nullable(),
	/** For a photo: which size that address is (A35D: “Product page · 1600 px”). */
	publicPicture: z.object({ role: z.string(), width: z.number().int().positive() }).nullable().default(null),
	links: z.array(ShareLinkView),
});
export type ShareLinksResponse = z.infer<typeof ShareLinksResponse>;

/** `POST /share/:code` (the shop's `/s/{code}` page): the password, when the link has one. */
export const ShareOpenRequest = z.object({ password: z.string().max(128).optional() });
export type ShareOpenRequest = z.infer<typeof ShareOpenRequest>;

export const ShareOpenAnswer = z.discriminatedUnion('state', [
	/** Straight from Spaces, valid five minutes. Type and size let the page say what is downloading (S8). */
	z.object({
		state: z.literal('open'),
		url: z.string(),
		fileName: z.string(),
		contentType: z.string(),
		bytes: z.number().int().nonnegative(),
	}),
	/** `wrong`: a password was sent and did not match. */
	z.object({ state: z.literal('password'), wrong: z.boolean().default(false) }),
	z.object({ state: z.literal('admins_only') }),
	z.object({ state: z.literal('expired') }),
]);
export type ShareOpenAnswer = z.infer<typeof ShareOpenAnswer>;

// --- Storage (R4-7) ---------------------------------------------------------------------------

export const StorageColour = z.enum(['green', 'yellow', 'red']);
export type StorageColour = z.infer<typeof StorageColour>;

export const StorageSummary = z.object({
	usedBytes: z.number().int().nonnegative(),
	planBytes: z.number().int().positive(),
	percent: z.number().nonnegative(),
	colour: StorageColour,
	onDemandBytes: z.number().int().nonnegative(),
	/** US dollars a month for the on-demand part. */
	onDemandMonthlyUsd: z.number().nonnegative(),
	breakdown: z.array(z.object({ key: z.string(), bytes: z.number().int().nonnegative() })),
	othersMayUseOnDemand: z.boolean(),
	canChangeOnDemand: z.boolean(),
	/** In-flight work already counted against the plan. */
	reservedBytes: z.number().int().nonnegative(),
});
export type StorageSummary = z.infer<typeof StorageSummary>;

export const StorageOperation = z.enum(['upload', 'upload_anyway', 'replace', 'versions', 'update_versions', 'zip']);
export type StorageOperation = z.infer<typeof StorageOperation>;

/** Asked before any operation that adds stored data. */
export const StorageCheckRequest = z.object({
	operation: StorageOperation,
	bytes: z.number().int().nonnegative(),
	/** A super admin's yes to going past the plan, and whether other admins may too (B18). */
	approve: z.boolean().default(false),
	alsoLetOthers: z.boolean().optional(),
});
export type StorageCheckRequest = z.infer<typeof StorageCheckRequest>;

export const StorageCheckAnswer = z.object({
	decision: z.enum(['go', 'ask', 'refused']),
	/** Held until the work finishes or an hour passes, so two uploads at once cannot both slip past. */
	reservationId: Id.nullable(),
	usedBytes: z.number().int().nonnegative(),
	afterBytes: z.number().int().nonnegative(),
	onDemandBytes: z.number().int().nonnegative(),
	onDemandMonthlyUsd: z.number().nonnegative(),
	canApprove: z.boolean(),
});
export type StorageCheckAnswer = z.infer<typeof StorageCheckAnswer>;

export const StorageSettingsWrite = z.object({ othersMayUseOnDemand: z.boolean() });
export type StorageSettingsWrite = z.infer<typeof StorageSettingsWrite>;

// --- Plain files (R4-5) -------------------------------------------------------------------------

/** The answer to a plain file's presign: where the browser sends the bytes, and its Media name. */
export const MediaFilePresignResponse = z.object({
	assetId: Id,
	/** The name it gets in its folder: “(1)” is added when the name is taken. */
	name: z.string(),
	uploadUrl: z.string().min(1),
	/** Headers the browser must replay verbatim on the PUT (they are signed). */
	headers: z.record(z.string(), z.string()).default({}),
	expiresAt: IsoDateTime,
});
export type MediaFilePresignResponse = z.infer<typeof MediaFilePresignResponse>;

/** Public gives a plain file a permanent CDN address; private stops it (copies already taken stay). */
export const MediaFileVisibilityWrite = z.object({ visibility: z.enum(['public', 'private']) });
export type MediaFileVisibilityWrite = z.infer<typeof MediaFileVisibilityWrite>;

// --- Email pictures (Clean up, R6-1, A50, A51) --------------------------------------------------

/**
 * An email picture whose photo was deleted for good or replaced: kept for good so order emails already sent keep
 * their picture, listed in Clean up › Email pictures, deleted only by an admin.
 */
export const EmailPicture = z.object({
	key: z.string().min(1),
	assetId: z.string().min(1),
	/** The photo's name in Media when the picture left it. */
	photoName: z.string(),
	width: z.number().int().positive(),
	bytes: z.number().int().nonnegative(),
	why: z.enum(['deleted', 'replaced']),
	goneAt: IsoDateTime,
	goneBy: z.string().nullable().default(null),
	/** Order emails that show it, and when one was last sent: filled once order emails are sent (Chunk G). */
	sentCount: z.number().int().nonnegative().default(0),
	lastSentAt: IsoDateTime.nullable().default(null),
});
export type EmailPicture = z.infer<typeof EmailPicture>;

/** Which email pictures Clean up lists: by when one was last sent in an email. */
export const EmailPictureSent = z.enum(['all', 'never', 'over_1y', 'over_2y']);
export type EmailPictureSent = z.infer<typeof EmailPictureSent>;

/** `GET /admin/media/library/email-pictures` */
// --- Clean up (A44; media step 5) ----------------------------------------------------------------

/** The Clean up lists besides Email pictures: never a file the website uses, never a backup. */
export const MediaCleanUpList = z.enum(['unused', 'largest', 'duplicates']);
export type MediaCleanUpList = z.infer<typeof MediaCleanUpList>;

/** `GET /admin/media/library/clean-up`. */
export const MediaCleanUpQuery = z.object({
	list: MediaCleanUpList.default('unused'),
	page: z.coerce.number().int().positive().max(1000).default(1),
});
export type MediaCleanUpQuery = z.infer<typeof MediaCleanUpQuery>;

/** One file a Clean up list offers, with why it is there. */
export const MediaCleanUpRow = z.object({
	file: MediaFileRow,
	/** Unused: when it was uploaded. Same file twice: the copy it repeats (uploaded first). */
	uploadedAt: IsoDateTime.nullable(),
	sameAs: z.object({ id: Id, name: z.string(), location: z.string() }).nullable(),
});
export type MediaCleanUpRow = z.infer<typeof MediaCleanUpRow>;

export const MediaCleanUpResponse = z.object({
	list: MediaCleanUpList,
	rows: z.array(MediaCleanUpRow),
	page: z.number().int().positive(),
	pageSize: z.number().int().positive(),
	total: z.number().int().nonnegative(),
	/** Each list's size, for the tabs. */
	counts: z.object({ unused: z.number().int(), largest: z.number().int(), duplicates: z.number().int() }),
});
export type MediaCleanUpResponse = z.infer<typeof MediaCleanUpResponse>;

export const EmailPictureQuery = z.object({
	sent: EmailPictureSent.default('all'),
	after: z.string().min(1).optional(),
});
export type EmailPictureQuery = z.infer<typeof EmailPictureQuery>;

export const EmailPictureRow = EmailPicture.extend({ url: z.string(), goneByName: z.string().nullable() });
export type EmailPictureRow = z.infer<typeof EmailPictureRow>;

export const EmailPictureList = z.object({
	rows: z.array(EmailPictureRow),
	/** Every email picture kept, whatever the filter: the note's “These N … (X MB in all)”. */
	total: z.object({ count: z.number().int().nonnegative(), bytes: z.number().int().nonnegative() }),
	/** How many the filter matches, for the select's “· 312”. */
	matching: z.number().int().nonnegative(),
	next: z.string().nullable(),
});
export type EmailPictureList = z.infer<typeof EmailPictureList>;

/** `POST /admin/media/library/email-pictures/delete` (A51): only after the warning is accepted. */
export const EmailPictureDelete = z.object({ keys: z.array(z.string().min(1)).min(1).max(1000) }).strict();
export type EmailPictureDelete = z.infer<typeof EmailPictureDelete>;

// --- Folder downloads as .zip (media step 5, A30, A30B, A48; owner approved the zip library on 16 Nov) ----------

/** What goes in a .zip: files and folders picked together, with their folders' contents. */
export const MediaZipRequest = z
	.object({
		fileIds: z.array(Id).max(5000).default([]),
		folderIds: z.array(Id).max(500).default([]),
		/** The hold the storage check gave (R4-7): the .zip is stored for 24 hours. */
		reservationId: Id.optional(),
	})
	.strict()
	.refine((value) => value.fileIds.length + value.folderIds.length > 0, { message: 'nothing chosen' });
export type MediaZipRequest = z.infer<typeof MediaZipRequest>;

/** What a .zip would hold, before the storage check: its name, how many files and their bytes. */
export const MediaZipPlan = z.object({
	name: z.string(),
	files: z.number().int().nonnegative(),
	bytes: z.number().int().nonnegative(),
});
export type MediaZipPlan = z.infer<typeof MediaZipPlan>;

export const MediaZipState = z.enum(['adding', 'ready', 'failed', 'cancelled', 'expired']);
export type MediaZipState = z.infer<typeof MediaZipState>;

/** One .zip being made or ready (A30, A30B): real counts from the worker, a link that works 24 hours once ready. */
export const MediaZip = z.object({
	id: Id,
	/** The file's name, `Product photos.zip`. */
	name: z.string(),
	state: MediaZipState,
	files: z.object({ done: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
	bytes: z.object({ done: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
	createdAt: IsoDateTime,
	readyAt: IsoDateTime.nullable(),
	/** When the stored .zip is deleted: 24 hours after it is ready. */
	expiresAt: IsoDateTime.nullable(),
	error: z.string().nullable(),
});
export type MediaZip = z.infer<typeof MediaZip>;

/** The person's own .zip files of the last 24 hours, newest first (the tray follows them). */
export const MediaZipList = z.object({ zips: z.array(MediaZip) });
export type MediaZipList = z.infer<typeof MediaZipList>;
