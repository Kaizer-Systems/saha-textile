import { z } from 'zod';

import { Id, IsoDateTime } from './common';

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
});
export type MediaFilePresignRequest = z.infer<typeof MediaFilePresignRequest>;

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
