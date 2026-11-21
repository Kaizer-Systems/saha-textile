import { randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type {
	MediaCutRegion,
	MediaCutResult,
	MediaCutSource,
	AuditLog,
	MediaAsset,
	MediaBrowseQuery,
	MediaBrowseResponse,
	MediaCleanUpQuery,
	MediaCleanUpResponse,
	MediaDuplicateAnswer,
	MediaDuplicateQuery,
	MediaFavouriteWrite,
	MediaFilePresignRequest,
	MediaFilePresignResponse,
	MediaFileRow,
	MediaFolder,
	MediaFolderCreate,
	MediaFolderRow,
	MediaFolderTree,
	MediaMoveRequest,
	MediaOperationResult,
	MediaRestoreRequest,
	MediaSelection,
	MediaFileAddress,
	MediaFileDetails,
	MediaMultipartStart,
	MediaPartUrls,
	MediaPartsRequest,
	MediaTrashCheck,
	MediaUploadedParts,
	MediaVersion,
	MediaAddVersionsResult,
	MediaVersionsStatus,
} from '@saha-textile/contracts';
import { MediaCategory } from '@saha-textile/contracts';
import {
	SWATCH_CUT_PROFILE,
	checkCut,
	planCut,
	sameCutRegion,
	type CutRefusal,
	type MediaCutRepository,
	type EmailPictureRepository,
	type AdminUserRepository,
	type AuditLogRepository,
	type LanguageCoverageRepository,
	type MediaAssetRepository,
	type MediaBrowseFilter,
	type MediaBrowseRepository,
	type MediaFavouriteRepository,
	type MediaFolderRepository,
	type MediaJobQueuePort,
	type MediaProfileRepository,
	MEDIA_INGEST_POLICY,
	MULTIPART_PART_BYTES,
	type ShareLinkRepository,
	type StoragePort,
	ancestorsUnder,
	checkCaps,
	checkProfileMinSize,
	checkVersionRequest,
	cleanMediaName,
	deleteMediaForever,
	downloadName,
	estimateVersionBytes,
	folderMoveRefusal,
	freeName,
	isProcessedPhoto,
	mediaCategory,
	mediaSlug,
	originalStorageKey,
	plainFileStorageKey,
	purgeMediaTrash,
	planAddVersions,
	purposeForProfile,
	renameKeepingExtension,
	shownDerivatives,
	shownVersionIds,
	restoreTarget,
	trashDaysLeft,
	versionIdOf,
	waitsForImageProfiles,
	foldersNamedBy,
	searchWords,
} from '@saha-textile/core-domain';

import { domainRefusal } from '../auth/domain-refusal';
import {
	ADMIN_USER_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	MEDIA_ASSET_REPOSITORY,
	MEDIA_BROWSE_REPOSITORY,
	MEDIA_CUT_REPOSITORY,
	MEDIA_FAVOURITE_REPOSITORY,
	MEDIA_FOLDER_REPOSITORY,
	MEDIA_JOB_QUEUE,
	MEDIA_PROFILE_REPOSITORY,
	EMAIL_PICTURE_REPOSITORY,
	LANGUAGE_COVERAGE_REPOSITORY,
	SHARE_LINK_REPOSITORY,
	STORAGE_PORT,
} from '../infra/tokens';
import { LanguageStore } from '../languages/language-store';
import { missingFilter } from '../languages/missing-filter';
import { mediaRefusal } from './media-refusal';
import { MediaStorageService } from './media-storage.service';

/** Clean up (A44): a list's page size, the days a file must sit unused, the largest files shown, groups read. */
const CLEAN_UP_PAGE = 50;
const CLEAN_UP_UNUSED_DAYS = 90;
const CLEAN_UP_LARGEST = 50;
const CLEAN_UP_GROUPS = 500;

/** English fallbacks; the Media page names each refusal in its own words. */
const REFUSALS: Readonly<Record<string, string>> = {
	empty: 'A name is needed',
	too_long: 'The name is longer than 120 characters',
	bad_character: 'A name cannot hold a slash',
	reserved: 'That name is not allowed',
	into_itself: 'A folder cannot go inside itself',
	target_in_trash: 'That folder is in Trash',
	not_in_trash: 'Only items in Trash can be deleted for good',
	nothing_to_undo: 'This can no longer be undone',
	not_a_plain_file: 'Only files other than photos and videos can be made public or private here',
	photo_needs_profiles: 'Choose at least one image profile for this photo',
	photo_type_waits: 'This picture type is turned into versions in a later step; JPEG and PNG work now',
	type_not_accepted: 'Only JPEG and PNG photos are processed',
	too_large: 'The photo is over 25 MB',
	too_many_pixels: 'The photo is larger than 8192 px on its long edge or 50 megapixels',
	profile_unknown: 'That image profile does not exist',
	profile_off: 'That image profile is switched off',
	profile_not_chosen: 'That image profile is made by itself and cannot be chosen',
	fill_not_offered: 'That fill is not offered for this photo and profile',
	below_minimum: 'The photo is smaller than the profile allows',
	version_twice: 'The same version is asked for twice',
	not_a_photo: 'Only photos have versions',
	version_unknown: 'This photo has no such version',
	version_making: 'This version is still being made',
	version_in_use: 'The website shows this version; choose another on its pages first',
	last_version: 'A photo keeps at least one version',
	replacing: 'This photo is being replaced; add versions when that is done',
};

const refuse = (code: string) => domainRefusal(code, REFUSALS[code] ?? 'Not allowed');
/** How long a Preview or Download address from the Media page works. */
export const FILE_ADDRESS_SECONDS = 300;

/** What a file takes in storage: the original and every version made from it. */
const storedBytes = (asset: MediaAsset): number =>
	asset.originalByteSize + asset.derivatives.reduce((sum, row) => sum + (row.byteSize ?? 0), 0);

/** The name a file shows: its Media name, else its web file name. */
export const fileName = (asset: MediaAsset): string => asset.displayName ?? asset.slug;

/**
 * The Media page as a file manager (media build step 1, brief revision 6): folders, moves, Trash,
 * restore, stars, the duplicate check, Activity and Undo. Every change is audited under
 * `entityType: 'media'`; Activity (S9) is that trail, and Undo (S1) reverses its last entry.
 */
/** Why a square cannot be cut, in the admin's words (brief P11). */
const CUT_REFUSALS: Record<CutRefusal, string> = {
	not_a_photo: 'Only a photo can be cut.',
	no_original: 'This photo has no original to cut from.',
	is_a_cut: 'Cut from the photo itself, not from a cut.',
	outside_photo: 'The square must stay inside the photo.',
	not_square: 'The cut must be square.',
	too_small: 'The square is too small for a swatch.',
};

@Injectable()
export class MediaLibraryService {
	constructor(
		@Inject(MEDIA_FOLDER_REPOSITORY) private readonly folders: MediaFolderRepository,
		@Inject(MEDIA_BROWSE_REPOSITORY) private readonly files: MediaBrowseRepository,
		@Inject(MEDIA_ASSET_REPOSITORY) private readonly assets: MediaAssetRepository,
		@Inject(MEDIA_FAVOURITE_REPOSITORY) private readonly stars: MediaFavouriteRepository,
		@Inject(SHARE_LINK_REPOSITORY) private readonly links: ShareLinkRepository,
		@Inject(STORAGE_PORT) private readonly storage: StoragePort,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
		@Inject(MEDIA_JOB_QUEUE) private readonly queue: MediaJobQueuePort,
		private readonly storageCheck: MediaStorageService,
		@Inject(MEDIA_PROFILE_REPOSITORY) private readonly profiles: Pick<MediaProfileRepository, 'findByKey'>,
		@Inject(ADMIN_USER_REPOSITORY) private readonly admins: Pick<AdminUserRepository, 'findById'>,
		/** Email pictures of photos deleted for good are recorded for Clean up, never deleted (media step 3f). */
		@Optional() @Inject(EMAIL_PICTURE_REPOSITORY) private readonly emailPictures?: EmailPictureRepository,
		/** The shop's languages, for a photo's missing alt text (D14). */
		@Optional() private readonly languages?: LanguageStore,
		/** The photos a language's to-do counts, for `?missing=` from Settings › Languages. */
		@Optional() @Inject(LANGUAGE_COVERAGE_REPOSITORY) private readonly coverage?: LanguageCoverageRepository,
		/** A photo's swatch cuts (brief P11), so the same square is cut once. */
		@Optional() @Inject(MEDIA_CUT_REPOSITORY) private readonly cuts?: MediaCutRepository,
	) {}

	/**
	 * "Save cut" (owner, 21 Nov 2026, brief P11/P12): a swatch picture made from a square of this photo. The photo is
	 * never changed; the image worker cuts the square from its original and makes the swatch sizes. The same square of
	 * the same photo reuses the cut already there.
	 */
	async cut(actor: string, photoId: string, region: MediaCutRegion, now = new Date()): Promise<MediaCutResult> {
		const photo = await this.assets.findById(photoId);
		if (!photo || photo.deletedAt) throw new NotFoundException();
		const check = checkCut(photo, region);
		if (!check.ok) throw mediaRefusal(HttpStatus.BAD_REQUEST, `cut_${check.reason}`, CUT_REFUSALS[check.reason]);
		const versionId = `${SWATCH_CUT_PROFILE}.as_is`;
		const same = (await this.cuts?.findCutsOf(photoId))?.find(
			(cut) => cut.cutFrom && sameCutRegion(cut.cutFrom.region, region),
		);
		if (same) return { id: same.id, versionId, px: check.px, soft: check.soft, created: false };
		const cut = planCut({
			id: `med_${randomUUID()}`,
			photo,
			region,
			profileVersion: (await this.profiles.findByKey(SWATCH_CUT_PROFILE))?.version ?? 1,
			by: actor === 'system' ? null : actor,
			at: now.toISOString(),
		});
		await this.assets.create(cut);
		await this.queue.enqueue({ type: 'cut', assetId: cut.id });
		await this.record(actor, 'media.cut', { photoId, region, px: check.px }, cut.id);
		return { id: cut.id, versionId, px: check.px, soft: check.soft, created: true };
	}

	// --- Reading ----------------------------------------------------------------------------------

	async tree(): Promise<MediaFolderTree> {
		const all = await this.folders.listAll();
		return { folders: all.map(({ id, parentId, name, files, bytes }) => ({ id, parentId, name, files, bytes })) };
	}

	async browse(userId: string, query: MediaBrowseQuery, now = new Date()): Promise<MediaBrowseResponse> {
		const extra = await this.filterParts(query, now);
		const filtering = Object.keys(extra).length > 0;
		// A picker (R4-2) narrows what is listed without turning the view into a search.
		const pick = this.pickParts(query);
		const mine = await this.stars.listForUser(userId);
		const starred = new Set(mine.map((star) => `${star.type}:${star.id}`));
		const page = { sort: query.sort, direction: query.direction, page: query.page, pageSize: query.pageSize };
		const folder = query.folderId ? await this.requireFolder(query.folderId) : null;
		const breadcrumb = folder ? await this.breadcrumb(folder) : [];
		const allFolders = await this.folders.listAll();
		const names = new Map(allFolders.map((row) => [row.id, row]));
		const location = (folderId: string | null | undefined) => this.location(folderId ?? null, names);

		if (query.view === 'trash') {
			const trashedFolders = await this.folders.listTrashed();
			const result = await this.files.browse({
				...page,
				...extra,
				trashed: true,
				search: query.search,
				...this.searchParts(query.search, allFolders),
			});
			return {
				folder: null,
				breadcrumb: [],
				folders: trashedFolders.map((row) => this.folderRow(row, starred, location(row.trashedFrom), now)),
				files: await this.fileRows(result.items, starred, location, now),
				total: result.total,
				page: result.page,
				pageSize: result.pageSize,
				starredBy: {},
			};
		}

		if (query.view === 'favourites') {
			const all =
				query.who === 'everyone' ? await this.stars.listAll() : mine.map((star) => ({ ...star, userId }));
			const fileIds = [...new Set(all.filter((star) => star.type === 'file').map((star) => star.id))];
			const folderIds = new Set(all.filter((star) => star.type === 'folder').map((star) => star.id));
			const ids = extra.ids ? fileIds.filter((id) => extra.ids?.includes(id)) : fileIds;
			const result = await this.files.browse({ ...page, ...extra, trashed: false, ids });
			const starredBy: Record<string, string[]> = {};
			for (const star of all) (starredBy[`${star.type}:${star.id}`] ??= []).push(star.userId);
			return {
				folder: null,
				breadcrumb: [],
				folders: allFolders
					.filter((row) => folderIds.has(row.id))
					.map((row) => this.folderRow(row, starred, location(row.parentId), now)),
				files: await this.fileRows(result.items, starred, location, now),
				total: result.total,
				page: result.page,
				pageSize: result.pageSize,
				starredBy,
			};
		}

		if (query.view === 'recent') {
			const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
			const result = await this.files.browse({
				...page,
				...extra,
				...pick,
				sort: 'created',
				direction: 'desc',
				trashed: false,
				// The later of Recent's 30 days and an “uploaded” filter.
				createdSince: extra.createdSince && extra.createdSince > since ? extra.createdSince : since,
			});
			return {
				folder: null,
				breadcrumb: [],
				folders: [],
				files: await this.fileRows(result.items, starred, location, now, query.profile),
				total: result.total,
				page: result.page,
				pageSize: result.pageSize,
				starredBy: {},
			};
		}

		// A search or a category lists files only: from the top level everything, inside a folder that folder and below.
		const searching = !!query.search || !!query.category || filtering;
		const within =
			folder && searching
				? (await this.folders.listSubtree(folder.id)).filter((row) => !row.trashedAt).map((row) => row.id)
				: undefined;
		const scope = {
			...page,
			...extra,
			trashed: false,
			search: query.search,
			...this.searchParts(query.search, allFolders),
			category: query.category,
			...(searching ? (within ? { withinFolders: within } : {}) : { folderId: folder?.id ?? null }),
		};
		const result = await this.files.browse({ ...scope, ...pick });
		const hidden = await this.hiddenInPicker(scope, query);
		const childFolders = searching ? [] : await this.folders.listChildren(folder?.id ?? null, { trashed: false });
		return {
			folder: folder ? this.folderRow(folder, starred, location(folder.parentId), now) : null,
			breadcrumb,
			folders: childFolders.map((row) => this.folderRow(row, starred, location(row.parentId), now)),
			files: await this.fileRows(result.items, starred, location, now, query.profile),
			total: result.total,
			page: result.page,
			pageSize: result.pageSize,
			starredBy: {},
			...(hidden ? { hidden } : {}),
		};
	}

	/** A picker's own narrowing (R4-2): images only, and only photos with a ready version of the profile asked. */
	private pickParts(query: MediaBrowseQuery): Partial<MediaBrowseFilter> {
		const parts: Partial<MediaBrowseFilter> = {};
		if (query.accept === 'image' || query.profile) parts.kinds = ['image'];
		if (query.profile && !query.showWithout) parts.withVersionOf = query.profile;
		return parts;
	}

	/** D15's heading: what the folder holds that the picker leaves out. Null outside a picker. */
	private async hiddenInPicker(
		scope: Omit<MediaBrowseFilter, 'page' | 'pageSize'> & Partial<MediaBrowseFilter>,
		query: MediaBrowseQuery,
	): Promise<{ noVersion: number; notImage: number } | null> {
		if (query.accept !== 'image' && !query.profile) return null;
		const count = async (more: Partial<MediaBrowseFilter>) =>
			(await this.files.browse({ ...scope, ...more, page: 1, pageSize: 1 })).total;
		const notImage = await count({ kinds: ['file', 'video'] });
		const noVersion =
			query.profile && !query.showWithout
				? await count({ kinds: ['image'], withoutVersionOf: query.profile })
				: 0;
		return { noVersion, notImage };
	}

	// --- Folders and names ----------------------------------------------------------------------

	async createFolder(actor: string, body: MediaFolderCreate): Promise<MediaFolderRow> {
		const name = this.cleanName(body.name);
		const parent = body.parentId ? await this.requireFolder(body.parentId) : null;
		if (parent?.trashedAt) throw refuse('target_in_trash');
		const siblings = await this.folders.listChildren(parent?.id ?? null, { trashed: false });
		const folder = await this.folders.save({
			id: `fld_${randomUUID()}`,
			parentId: parent?.id ?? null,
			name: freeName(
				name,
				siblings.map((row) => row.name),
			),
			ancestors: ancestorsUnder(parent),
			files: 0,
			bytes: 0,
			trashedAt: null,
			trashedFrom: null,
			createdBy: actor,
		});
		await this.record(actor, 'media.folder.create', { folders: [folder.id] }, folder.id);
		return this.folderRow(folder, new Set(), '', new Date());
	}

	async renameFolder(actor: string, id: string, typed: string): Promise<MediaOperationResult> {
		const folder = await this.requireFolder(id);
		const siblings = await this.folders.listChildren(folder.parentId, { trashed: false });
		const name = freeName(
			this.cleanName(typed),
			siblings.filter((row) => row.id !== id).map((row) => row.name),
		);
		await this.folders.save({ ...folder, name });
		const undoId = await this.record(
			actor,
			'media.rename',
			{ renames: [{ type: 'folder', id, from: folder.name }] },
			id,
		);
		return { done: 1, inUse: [], undoId };
	}

	/** A file keeps its extension; its address on the website never changes (A24). */
	async renameFile(actor: string, id: string, typed: string): Promise<MediaOperationResult> {
		const asset = await this.requireFile(id);
		const current = fileName(asset);
		const wanted = renameKeepingExtension(current, this.cleanName(typed));
		const taken = (await this.files.namesIn(asset.folderId ?? null)).filter((name) => name !== current);
		await this.files.rename(id, freeName(wanted, taken));
		const undoId = await this.record(actor, 'media.rename', { renames: [{ type: 'file', id, from: current }] }, id);
		return { done: 1, inUse: [], undoId };
	}

	async move(actor: string, request: MediaMoveRequest): Promise<MediaOperationResult> {
		const target = request.toFolderId ? await this.requireFolder(request.toFolderId) : null;
		const moves: { type: 'file' | 'folder'; id: string; from: string | null }[] = [];
		for (const id of request.folderIds) {
			const folder = await this.requireFolder(id);
			const refusal = folderMoveRefusal(folder, target);
			if (refusal) throw refuse(refusal);
			if (folder.parentId === (target?.id ?? null)) continue;
			await this.folders.move(id, target?.id ?? null, ancestorsUnder(target));
			moves.push({ type: 'folder', id, from: folder.parentId });
		}
		if (target?.trashedAt) throw refuse('target_in_trash');
		const files = await this.assets.findManyByIds(request.fileIds);
		const moving = files.filter((asset) => (asset.folderId ?? null) !== (target?.id ?? null) && !asset.trashedAt);
		// Names stay unique in the folder they arrive in: "(1)", "(2)".
		const taken = await this.files.namesIn(target?.id ?? null);
		for (const asset of moving) {
			const name = freeName(fileName(asset), taken);
			if (name !== fileName(asset)) await this.files.rename(asset.id, name);
			taken.push(name);
			moves.push({ type: 'file', id: asset.id, from: asset.folderId ?? null });
		}
		await this.files.moveTo(
			moving.map((asset) => asset.id),
			target?.id ?? null,
		);
		await this.recount([target?.id ?? null, ...moves.map((move) => move.from)]);
		const undoId = moves.length ? await this.record(actor, 'media.move', { moves, to: target?.id ?? null }) : null;
		return { done: moves.length, inUse: [], undoId };
	}

	// --- Trash --------------------------------------------------------------------------------------

	/**
	 * Images the website uses stay out of Trash until they are swapped out (A26). Everything inside
	 * a trashed folder goes with it; its share links stop and stay stopped after a restore.
	 */
	async trash(actor: string, selection: MediaSelection, now = new Date()): Promise<MediaOperationResult> {
		const at = now.toISOString();
		const { inUse, trashFolders, trashFiles, insideTrashed } = await this.trashPlan(selection);
		await this.folders.setTrashed(
			trashFolders.map((folder) => folder.id),
			at,
			new Map(trashFolders.map((folder) => [folder.id, folder.parentId])),
		);
		const fileIds = [...new Set([...trashFiles, ...insideTrashed].map((asset) => asset.id))];
		const from = new Map([...trashFiles, ...insideTrashed].map((asset) => [asset.id, asset.folderId ?? null]));
		await this.files.setTrashed(fileIds, at, from);
		await this.links.stopForAssets(fileIds, at);
		await this.recount([...from.values(), ...trashFolders.map((folder) => folder.parentId)]);
		const done = trashFolders.length + trashFiles.length;
		const undoId = done
			? await this.record(actor, 'media.trash', {
					files: trashFiles.map((asset) => asset.id),
					folders: trashFolders.map((folder) => folder.id),
					inside: insideTrashed.map((asset) => asset.id),
				})
			: null;
		return { done, inUse, undoId };
	}

	async restore(actor: string, request: MediaRestoreRequest): Promise<MediaOperationResult> {
		let done = 0;
		const restoredFolders = new Set<string>();
		const bringBack = async (folder: MediaFolder) => {
			// A folder comes back with its own old parent, or to My files when that is gone too.
			const parent = folder.trashedFrom ? await this.folders.findById(folder.trashedFrom) : null;
			const target = restoreTarget(folder.trashedFrom, parent, request.whenFolderGone);
			if (target.restoreFolder && parent) await bringBack(parent);
			if (target.folderId !== folder.parentId)
				await this.folders.move(folder.id, target.folderId, ancestorsUnder(target.folderId ? parent : null));
			await this.folders.setTrashed([folder.id], null, new Map());
			const inside = await this.files.listInFolders([folder.id]);
			await this.files.setTrashed(
				inside.filter((asset) => asset.trashedAt).map((asset) => asset.id),
				null,
				new Map(),
			);
			restoredFolders.add(folder.id);
		};
		for (const folder of await this.folders.findManyByIds(request.folderIds)) {
			if (!folder.trashedAt) continue;
			await bringBack(folder);
			done += 1;
		}
		const files = await this.assets.findManyByIds(request.fileIds);
		const restoreTo = new Map<string, string | null>();
		for (const asset of files.filter((row) => row.trashedAt)) {
			const folder = asset.trashedFrom ? await this.folders.findById(asset.trashedFrom) : null;
			const target = restoreTarget(asset.trashedFrom ?? null, folder, request.whenFolderGone);
			if (target.restoreFolder && folder && !restoredFolders.has(folder.id)) await bringBack(folder);
			restoreTo.set(asset.id, target.folderId);
		}
		await this.files.setTrashed([...restoreTo.keys()], null, new Map(), restoreTo);
		done += restoreTo.size;
		await this.recount([...restoreTo.values(), ...restoredFolders]);
		await this.record(actor, 'media.restore', { files: [...restoreTo.keys()], folders: [...restoredFolders] });
		return { done, inUse: [], undoId: null };
	}

	/**
	 * Deletes for good what is in Trash (A20): the records at once, the stored files through a
	 * queued job that also clears the CDN. Cannot be undone. The nightly purge shares this code.
	 */
	async deleteForever(actor: string, selection: MediaSelection): Promise<MediaOperationResult> {
		const result = await deleteMediaForever(this.deleteDeps(actor), selection);
		if (!result.ok) throw refuse(result.reason);
		return { done: result.done, inUse: [], undoId: null };
	}

	/** Items trashed 30 days ago are removed for good (the worker runs the same use case nightly). */
	async purgeTrash(now = new Date()): Promise<number> {
		const purged = await purgeMediaTrash(this.deleteDeps('system'), now);
		return purged.files + purged.folders;
	}

	private deleteDeps(actor: string) {
		return {
			folders: this.folders,
			files: this.files,
			assets: this.assets,
			stars: this.stars,
			links: this.links,
			queue: this.queue,
			publicUrl: (key: string) => this.storage.getUrl(key),
			record: (action: string, metadata: Record<string, unknown>) => this.record(actor, action, metadata),
			...(this.emailPictures ? { emailPictures: this.emailPictures } : {}),
			actor: actor === 'system' ? null : actor,
		};
	}

	/**
	 * The filters (A11) as the repository reads them. Sizes are the uploaded size in MB of 1024 KB;
	 * “processing” covers every state before ready; “used” asks the owner registry once.
	 */
	private async filterParts(query: MediaBrowseQuery, now: Date): Promise<Partial<MediaBrowseFilter>> {
		const MB = 1024 * 1024;
		const parts: Partial<MediaBrowseFilter> = {};
		if (query.categories?.length) parts.categories = query.categories;
		if (query.state) {
			parts.states = query.state === 'processing' ? ['awaiting_upload', 'queued', 'processing'] : [query.state];
		}
		if (query.size === 'under1') parts.maxBytes = MB;
		if (query.size === '1to25') Object.assign(parts, { minBytes: MB, maxBytes: 25 * MB });
		if (query.size === 'over25') parts.minBytes = 25 * MB;
		if (query.uploaded) {
			const days = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 }[query.uploaded];
			parts.createdSince = new Date(now.getTime() - days * 86_400_000).toISOString();
		}
		if (query.used) {
			const used = await this.files.referencedIds();
			if (query.used === 'in') parts.ids = used;
			else parts.excludeIds = used;
		}
		if (query.missing) {
			// The same photos Settings › Languages counts: shown by the website, alt text missing in that language.
			const missing = new Set((await missingFilter(this.coverage ?? null, 'photos', query.missing)).ids ?? []);
			parts.ids = parts.ids ? parts.ids.filter((id) => missing.has(id)) : [...missing];
		}
		return parts;
	}

	// --- Plain files (R4-5): stored as they are, private until made public -----------------------

	/**
	 * Starts a plain-file upload: a private object in Spaces, named in its folder (“(1)” when the
	 * name is taken), held against the storage plan until the upload finishes.
	 */
	async presignFile(
		actor: string,
		request: MediaFilePresignRequest,
		now = new Date(),
	): Promise<MediaFilePresignResponse> {
		if (waitsForImageProfiles(request.contentType, request.fileName)) {
			if (!isProcessedPhoto(request.contentType)) throw refuse('photo_type_waits');
			return this.presignPhoto(actor, request, now);
		}
		if (request.folderId) {
			const folder = await this.requireFolder(request.folderId);
			if (folder.trashedAt) throw refuse('target_in_trash');
		}
		const name = freeName(this.cleanName(request.fileName), await this.files.namesIn(request.folderId));
		const id = `med_${randomUUID()}`;
		await this.storageCheck.admit(actor, request.byteSize, request.reservationId, `res_${id}`, now);
		const key = plainFileStorageKey(id, name);
		const asset: MediaAsset = {
			id,
			kind: 'file',
			purpose: 'product',
			originalStorageKey: key,
			originalFormat: request.contentType,
			originalByteSize: request.byteSize,
			width: null,
			height: null,
			slug: mediaSlug(name),
			derivatives: [],
			dominantColor: null,
			thumbHash: null,
			visibility: 'private',
			processing: { state: 'awaiting_upload', attempts: 0, error: null, processedAt: null },
			warnings: [],
			servesAsPrimary: false,
			maxDisplayWidth: null,
			renditions: [],
			hlsPlaylistKey: null,
			durationSeconds: null,
			text: { alt: {}, title: {}, caption: {} },
			status: 'draft',
			uploadedBy: { type: 'admin', id: actor },
			deletedAt: null,
			folderId: request.folderId,
			displayName: name,
			sha256: request.sha256 ?? null,
			trashedAt: null,
			trashedFrom: null,
		};
		await this.assets.create(asset);
		const ttl = MEDIA_INGEST_POLICY.uploadUrlTtlSeconds;
		const signed = await this.storage.createSignedUploadUrl({
			key,
			contentType: request.contentType,
			expiresInSeconds: ttl,
			visibility: 'private',
		});
		return {
			assetId: id,
			name,
			uploadUrl: signed.url,
			headers: signed.headers ?? {},
			expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
		};
	}

	/**
	 * Starts a photo upload (media step 2b): every version asked for is checked against its profile and the photo's
	 * size as the browser decoded it, before a byte moves; the worker checks again against the real bytes. The
	 * original is private; the versions made from it are public website pictures.
	 */
	private async presignPhoto(
		actor: string,
		request: MediaFilePresignRequest,
		now: Date,
	): Promise<MediaFilePresignResponse> {
		const { width, height, versions: asked } = request;
		if (!asked?.length || !width || !height) throw refuse('photo_needs_profiles');
		const caps = checkCaps({ contentType: request.contentType, byteSize: request.byteSize, width, height });
		if (caps) throw refuse(caps.code);
		const ids = asked.map((row) => versionIdOf(row.profileKey, row.fill));
		if (new Set(ids).size !== ids.length) throw refuse('version_twice');
		const at = now.toISOString();
		const versions: MediaVersion[] = [];
		const warnings: MediaAsset['warnings'] = [];
		for (const row of asked) {
			const profile = await this.profiles.findByKey(row.profileKey);
			const refusal = checkVersionRequest({
				profile,
				fill: row.fill,
				source: { width, height },
				byteSize: request.byteSize,
				contentType: request.contentType,
			});
			if (refusal || !profile) throw refuse(refusal ?? 'profile_unknown');
			if (checkProfileMinSize(profile, { width, height }).result === 'warn' && !warnings.length) {
				warnings.push('below_recommended_size');
			}
			versions.push({
				id: versionIdOf(row.profileKey, row.fill),
				profileKey: row.profileKey,
				profileVersion: profile.version,
				fill: row.fill,
				state: 'making',
				error: null,
				createdAt: at,
			});
		}
		if (request.folderId) {
			const folder = await this.requireFolder(request.folderId);
			if (folder.trashedAt) throw refuse('target_in_trash');
		}
		const name = freeName(this.cleanName(request.fileName), await this.files.namesIn(request.folderId));
		const id = `med_${randomUUID()}`;
		// The storage check counts the versions to be made as well as the original (R4-7).
		const bytes = request.byteSize + estimateVersionBytes(request.byteSize, versions.length);
		await this.storageCheck.admit(actor, bytes, request.reservationId, `res_${id}`, now);
		const key = originalStorageKey(id, request.contentType);
		await this.assets.create({
			id,
			kind: 'image',
			purpose: purposeForProfile(versions[0]?.profileKey ?? ''),
			originalStorageKey: key,
			originalFormat: request.contentType as MediaAsset['originalFormat'],
			originalByteSize: request.byteSize,
			width,
			height,
			slug: mediaSlug(name),
			derivatives: [],
			versions,
			dominantColor: null,
			thumbHash: null,
			visibility: 'public',
			processing: { state: 'awaiting_upload', attempts: 0, error: null, processedAt: null },
			warnings,
			servesAsPrimary: false,
			maxDisplayWidth: null,
			renditions: [],
			hlsPlaylistKey: null,
			durationSeconds: null,
			text: { alt: {}, title: {}, caption: {} },
			status: 'draft',
			uploadedBy: { type: 'admin', id: actor },
			deletedAt: null,
			folderId: request.folderId,
			displayName: name,
			sha256: request.sha256 ?? null,
			trashedAt: null,
			trashedFrom: null,
		});
		const ttl = MEDIA_INGEST_POLICY.uploadUrlTtlSeconds;
		const signed = await this.storage.createSignedUploadUrl({
			key,
			contentType: request.contentType,
			expiresInSeconds: ttl,
			visibility: 'private',
		});
		return {
			assetId: id,
			name,
			uploadUrl: signed.url,
			headers: signed.headers ?? {},
			expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
		};
	}

	/**
	 * An upload this admin started and will not finish (cancelled, or failed for good): the record,
	 * anything that reached Spaces, and its storage hold go. Only an unfinished upload of one's own.
	 */
	async cancelUpload(actor: string, id: string, uploadId?: string): Promise<void> {
		const asset = await this.requireUnfinished(actor, id);
		if (uploadId && asset.originalStorageKey) {
			// Parts already stored would otherwise stay billed until Spaces drops them.
			await this.storage.abortMultipartUpload({ key: asset.originalStorageKey, uploadId }).catch(() => undefined);
		}
		if (asset.originalStorageKey) await this.storage.delete(asset.originalStorageKey);
		await this.assets.hardDelete(id);
		await this.storageCheck.release(`res_${id}`);
	}

	/** S11: starts a big upload in parts; the browser keeps the upload id to carry on after a reload. */
	async startMultipart(actor: string, id: string): Promise<MediaMultipartStart> {
		const asset = await this.requireUnfinished(actor, id);
		const { uploadId } = await this.storage.startMultipartUpload({
			key: asset.originalStorageKey as string,
			contentType: asset.originalFormat,
		});
		return { uploadId, partBytes: MULTIPART_PART_BYTES };
	}

	/** Signed addresses for the parts the browser sends next; an hour each. */
	async partUrls(actor: string, id: string, request: MediaPartsRequest): Promise<MediaPartUrls> {
		const asset = await this.requireUnfinished(actor, id);
		const urls = [];
		for (const partNumber of request.partNumbers)
			urls.push({
				partNumber,
				url: await this.storage.createSignedPartUrl({
					key: asset.originalStorageKey as string,
					uploadId: request.uploadId,
					partNumber,
					expiresInSeconds: 3600,
				}),
			});
		return { urls };
	}

	/** What already reached Spaces, so a cut-off upload sends only the rest (B16). */
	async uploadedParts(actor: string, id: string, uploadId: string): Promise<MediaUploadedParts> {
		const asset = await this.requireUnfinished(actor, id);
		const parts = await this.storage.listUploadedParts({ key: asset.originalStorageKey as string, uploadId });
		return { parts: parts.map(({ partNumber, size }) => ({ partNumber, size })) };
	}

	/** The browser finished its PUT (or every part): the file is ready (nothing to process) and its hold ends. */
	async finalizeFile(
		actor: string,
		id: string,
		now = new Date(),
		uploadId?: string,
	): Promise<{ assetId: string; state: 'ready' }> {
		const asset = await this.requireFile(id);
		if (asset.kind === 'image' && asset.versions?.length) return this.finalizePhoto(actor, asset);
		if (asset.kind !== 'file') throw refuse('not_a_plain_file');
		if (asset.processing.state === 'awaiting_upload') {
			if (uploadId && asset.originalStorageKey) {
				if (asset.uploadedBy?.id !== actor) throw new NotFoundException('Upload not found');
				await this.storage.completeMultipartUpload({ key: asset.originalStorageKey, uploadId });
			}
			await this.assets.update({
				...asset,
				processing: { ...asset.processing, state: 'ready', processedAt: now.toISOString() },
			});
			await this.storageCheck.release(`res_${id}`);
			await this.recount([asset.folderId]);
			await this.record(actor, 'media.upload', { name: fileName(asset), bytes: asset.originalByteSize }, id);
		}
		return { assetId: id, state: 'ready' };
	}

	/** A photo's upload finished: its versions go in line for the image worker; the storage hold ends. */
	private async finalizePhoto(actor: string, asset: MediaAsset): Promise<{ assetId: string; state: 'ready' }> {
		if (asset.processing.state === 'awaiting_upload') {
			if (asset.uploadedBy?.id !== actor) throw new NotFoundException('Upload not found');
			await this.assets.update({ ...asset, processing: { ...asset.processing, state: 'queued' } });
			await this.queue.enqueue({ type: 'process', assetId: asset.id });
			await this.storageCheck.release(`res_${asset.id}`);
			await this.recount([asset.folderId ?? null]);
			await this.record(
				actor,
				'media.upload',
				{
					name: fileName(asset),
					bytes: asset.originalByteSize,
					versions: asset.versions?.map((row) => row.id),
				},
				asset.id,
			);
		}
		// The upload is done; the versions are being made (the Media page shows each one's state).
		return { assetId: asset.id, state: 'ready' };
	}

	/**
	 * Public gives a plain file a permanent CDN address (A35C); private takes it away and asks the
	 * CDN to forget it within a minute. Copies people already downloaded stay with them.
	 */
	async setFileVisibility(
		actor: string,
		id: string,
		visibility: 'public' | 'private',
	): Promise<MediaOperationResult> {
		const asset = await this.requireFile(id);
		if (asset.kind !== 'file' || !asset.originalStorageKey) throw refuse('not_a_plain_file');
		if (asset.visibility !== visibility) {
			await this.storage.setVisibility(asset.originalStorageKey, visibility);
			await this.assets.update({ ...asset, visibility });
			if (visibility === 'private') {
				await this.queue.enqueue({ type: 'purge', urls: [this.storage.getUrl(asset.originalStorageKey)] });
			}
			await this.record(actor, 'media.visibility', { name: fileName(asset), visibility }, id);
		}
		return { done: 1, inUse: [], undoId: null };
	}

	// --- Stars, duplicates, Activity, Undo ------------------------------------------------------

	async star(actor: string, body: MediaFavouriteWrite): Promise<void> {
		if (body.targetType === 'folder') await this.requireFolder(body.targetId);
		else await this.requireFile(body.targetId);
		await this.stars.set(actor, { type: body.targetType, id: body.targetId }, body.starred);
	}

	/** S6: exactly the same bytes somewhere in Media, or the same name in this folder. */
	async duplicates(query: MediaDuplicateQuery): Promise<MediaDuplicateAnswer> {
		const hashes = query.files.flatMap((file) => (file.sha256 ? [file.sha256] : []));
		const same = await this.files.findBySha256(hashes);
		const names = await this.files.namesIn(query.folderId);
		const named = await this.files.findNamedIn(
			query.folderId,
			query.files.map((file) => file.name),
		);
		const all = await this.folders.listAll();
		const lookup = new Map(all.map((row) => [row.id, row]));
		const taken = [...names];
		return {
			files: query.files.map((file) => {
				const identical = file.sha256 ? (same.find((asset) => asset.sha256 === file.sha256) ?? null) : null;
				const sameName = named.find(
					(asset) => fileName(asset).toLocaleLowerCase() === file.name.toLocaleLowerCase(),
				);
				const keepBothName = freeName(file.name, taken);
				taken.push(keepBothName);
				return {
					name: file.name,
					identical: identical
						? {
								id: identical.id,
								name: fileName(identical),
								location: this.location(identical.folderId ?? null, lookup),
							}
						: null,
					sameName:
						sameName && (!file.sha256 || sameName.sha256 !== file.sha256)
							? { id: sameName.id, name: fileName(sameName) }
							: null,
					keepBothName,
				};
			}),
		};
	}

	/**
	 * S9: who did what on the Media page, newest first; with a file or folder id, that item's own trail (A43), the
	 * Media page's entries and the image pipeline's together.
	 */
	async activity(page: number, pageSize: number, entityId?: string) {
		if (!entityId) return this.audit.list({ entityType: 'media', page, pageSize } as never);
		const [media, pipeline] = await Promise.all([
			this.audit.list({ entityType: 'media', entityId, page: 1, pageSize: 200 } as never),
			this.audit.list({ entityType: 'mediaAsset', entityId, page: 1, pageSize: 200 } as never),
		]);
		const items = [...media.items, ...pipeline.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
	}

	/** A31, A31B, A32: what the details popup shows about one file. */
	async details(id: string): Promise<MediaFileDetails> {
		const asset = await this.requireFile(id);
		const folder = asset.folderId ? await this.folders.findById(asset.folderId) : null;
		const folderPath = folder ? (await this.breadcrumb(folder)).map((crumb) => crumb.name) : [];
		const uploader =
			asset.uploadedBy?.type === 'admin'
				? await this.admins.findById(asset.uploadedBy.id).catch(() => null)
				: null;
		const used = (await this.files.whereUsed([asset.id])).get(asset.id) ?? [];
		const familiesOf = (rows: typeof asset.derivatives) => {
			const byRole = new Map<string, typeof asset.derivatives>();
			for (const row of rows) byRole.set(row.role, [...(byRole.get(row.role) ?? []), row]);
			return [...byRole.entries()].map(([role, files]) => ({
				role,
				files: [...files]
					.sort((a, b) => a.width - b.width)
					.map((file) => ({
						width: file.width,
						height: file.height,
						bytes: file.byteSize,
						format: file.format,
						url: this.storage.getUrl(file.storageKey),
					})),
			}));
		};
		const shown = shownVersionIds(asset);
		return {
			id: asset.id,
			name: fileName(asset),
			...(asset.kind === 'image' ? { slug: asset.slug } : {}),
			kind: asset.kind,
			contentType: asset.originalFormat,
			bytes: asset.originalByteSize,
			width: asset.width,
			height: asset.height,
			folderPath,
			uploadedBy: uploader ? (uploader.displayName ?? uploader.username ?? uploader.email ?? null) : null,
			uploadedAt: asset.createdAt ?? null,
			usedOn: used,
			visibility: asset.visibility,
			versions: (asset.versions ?? []).map((version) => {
				const files = asset.derivatives.filter((row) => row.versionId === version.id);
				return {
					id: version.id,
					profileKey: version.profileKey,
					fill: version.fill,
					state: version.state,
					error: version.error ?? null,
					createdAt: version.createdAt,
					bytes: files.reduce((sum, row) => sum + row.byteSize, 0),
					families: familiesOf(files),
					shown: shown.has(version.id),
				};
			}),
			perPhoto: familiesOf(asset.derivatives.filter((row) => !row.versionId)),
			focal: asset.focal ?? null,
			...(asset.kind === 'image'
				? { text: { alt: { ...asset.text.alt }, caption: { ...asset.text.caption } } }
				: {}),
			...(await this.cutDetails(asset)),
		};
	}

	/** A cut's photo ("Cut from …") and a photo's cuts with where they are used (brief P11). */
	private async cutDetails(asset: MediaAsset): Promise<Pick<MediaFileDetails, 'cutFrom' | 'cuts'>> {
		if (asset.cutFrom) {
			const photo = await this.assets.findById(asset.cutFrom.assetId);
			return {
				cutFrom: { photoId: asset.cutFrom.assetId, photoName: photo ? fileName(photo) : asset.cutFrom.assetId },
			};
		}
		if (asset.kind !== 'image' || !this.cuts) return {};
		const cuts = await this.cuts.findCutsOf(asset.id);
		if (!cuts.length) return { cuts: [] };
		const used = await this.files.whereUsed(cuts.map((cut) => cut.id));
		return {
			cuts: cuts.map((cut) => ({
				id: cut.id,
				name: fileName(cut),
				thumbnail: this.thumbnailOf(cut),
				usedOn: (used.get(cut.id) ?? []).length,
			})),
		};
	}

	/**
	 * What the cut pop-up draws (brief P11): the photo (a file about 1200 px wide and the original's size) and, for a
	 * value that already uses a cut, that cut and its square. Open to anyone who may edit products (P12).
	 */
	async cutSource(id: string): Promise<MediaCutSource> {
		const chosen = await this.assets.findById(id);
		if (!chosen || chosen.deletedAt) throw new NotFoundException();
		const photo = chosen.cutFrom ? await this.assets.findById(chosen.cutFrom.assetId) : chosen;
		if (!photo || photo.deletedAt || photo.kind !== 'image' || !photo.width || !photo.height) {
			throw mediaRefusal(HttpStatus.BAD_REQUEST, 'cut_no_photo', 'This picture has no photo to cut from.');
		}
		const files = shownDerivatives(photo).sort((a, b) => a.width - b.width);
		const file =
			files.find((row) => row.role === 'gallery' && row.width >= 900) ??
			files.filter((row) => row.role === 'gallery').at(-1) ??
			files.at(-1);
		if (!file) throw mediaRefusal(HttpStatus.BAD_REQUEST, 'cut_no_photo', 'This picture has no photo to cut from.');
		return {
			photoId: photo.id,
			name: fileName(photo),
			url: this.storage.getUrl(file.storageKey),
			width: photo.width,
			height: photo.height,
			cutId: chosen.cutFrom ? chosen.id : null,
			region: chosen.cutFrom?.region ?? null,
		};
	}

	/**
	 * Search (media step 4e): the words are looked for in the alt text and caption in every added language, and in
	 * the names of folders, so a file is found by the folder it sits in (or any folder above it).
	 */
	private searchParts(
		search: string | undefined,
		folders: readonly MediaFolder[],
	): Pick<MediaBrowseFilter, 'searchLocales' | 'searchFolders'> {
		const words = searchWords(search);
		if (!words.length) return {};
		return {
			searchLocales: this.languages?.content() ?? ['en', 'bn'],
			searchFolders: foldersNamedBy(words, folders),
		};
	}

	// --- Clean up (A44; media step 5) ---------------------------------------------------------------

	/**
	 * Clean up's lists: files not used for 90 days (uploaded before then and on no page), the 50 largest files on no
	 * page, and every copy of a file uploaded twice after the first. Files the website uses and backups never show.
	 */
	async cleanUp(userId: string, query: MediaCleanUpQuery, now = new Date()): Promise<MediaCleanUpResponse> {
		const pageSize = CLEAN_UP_PAGE;
		const used = await this.files.referencedIds();
		const usedSet = new Set(used);
		const base = {
			trashed: false,
			categories: MediaCategory.options.filter((category) => category !== 'backups'),
			excludeIds: used,
		};
		const before = new Date(now.getTime() - CLEAN_UP_UNUSED_DAYS * 86_400_000).toISOString();
		const unusedFilter = { ...base, createdBefore: before, sort: 'created' as const, direction: 'asc' as const };
		const largestFilter = { ...base, sort: 'size' as const, direction: 'desc' as const };
		const [unusedCount, largestCount, groups] = await Promise.all([
			this.files.browse({ ...unusedFilter, page: 1, pageSize: 1 }).then((result) => result.total),
			this.files.browse({ ...largestFilter, page: 1, pageSize: 1 }).then((result) => result.total),
			this.files.sameFileGroups(CLEAN_UP_GROUPS),
		]);
		// Same file twice: the first upload stays; every later copy the website doesn't use is offered.
		const copies = groups.flatMap((group) =>
			group.ids.slice(1).flatMap((id) => (usedSet.has(id) ? [] : [{ id, first: group.ids[0] as string }])),
		);
		const counts = {
			unused: unusedCount,
			largest: Math.min(CLEAN_UP_LARGEST, largestCount),
			duplicates: copies.length,
		};
		const allFolders = await this.folders.listAll();
		const names = new Map(allFolders.map((row) => [row.id, row]));
		const location = (folderId: string | null | undefined) => this.location(folderId ?? null, names);
		const starred = new Set((await this.stars.listForUser(userId)).map((star) => `${star.type}:${star.id}`));

		let assets: MediaAsset[];
		let total: number;
		let firsts = new Map<string, MediaAsset>();
		const sameAs = new Map<string, string>();
		if (query.list === 'duplicates') {
			const pageCopies = copies.slice((query.page - 1) * pageSize, query.page * pageSize);
			const found = await this.assets.findManyByIds([
				...new Set(pageCopies.flatMap((copy) => [copy.id, copy.first])),
			]);
			const byId = new Map(found.map((asset) => [asset.id, asset]));
			assets = pageCopies.flatMap((copy) => byId.get(copy.id) ?? []);
			firsts = new Map(
				pageCopies.flatMap((copy) =>
					byId.get(copy.first) ? [[copy.id, byId.get(copy.first) as MediaAsset]] : [],
				),
			);
			for (const copy of pageCopies) sameAs.set(copy.id, copy.first);
			total = copies.length;
		} else if (query.list === 'largest') {
			const first = (query.page - 1) * pageSize;
			const result =
				first < CLEAN_UP_LARGEST
					? await this.files.browse({ ...largestFilter, page: query.page, pageSize })
					: { items: [] as MediaAsset[] };
			assets = result.items.slice(0, Math.max(0, CLEAN_UP_LARGEST - first));
			total = counts.largest;
		} else {
			const result = await this.files.browse({ ...unusedFilter, page: query.page, pageSize });
			assets = result.items;
			total = result.total;
		}
		const rows = await this.fileRows(assets, starred, location, now);
		return {
			list: query.list,
			rows: rows.map((file, index) => {
				const asset = assets[index] as MediaAsset;
				const first = firsts.get(asset.id);
				return {
					file,
					uploadedAt: asset.createdAt ?? null,
					sameAs: first ? { id: first.id, name: fileName(first), location: location(first.folderId) } : null,
				};
			}),
			page: query.page,
			pageSize,
			total,
			counts,
		};
	}

	/** S1: reverses a move, a rename or a Trash, once, by the person who did it. */
	async undo(actor: string, undoId: string): Promise<MediaOperationResult> {
		const recent = await this.audit.list({ entityType: 'media', page: 1, pageSize: 50 } as never);
		const entry = recent.items.find((row) => row.id === undoId && row.actorUserId === actor);
		if (!entry || recent.items.some((row) => row.metadata?.['undoes'] === undoId)) throw refuse('nothing_to_undo');
		const meta = (entry.metadata ?? {}) as Record<string, unknown>;
		if (entry.action === 'media.move') {
			for (const move of (meta['moves'] as { type: string; id: string; from: string | null }[]) ?? []) {
				if (move.type === 'file') await this.files.moveTo([move.id], move.from);
				else {
					const parent = move.from ? await this.folders.findById(move.from) : null;
					await this.folders.move(move.id, move.from, ancestorsUnder(parent));
				}
			}
			await this.recount([
				(meta['to'] as string | null) ?? null,
				...((meta['moves'] as { from: string | null }[]) ?? []).map((move) => move.from),
			]);
		} else if (entry.action === 'media.rename') {
			for (const rename of (meta['renames'] as { type: string; id: string; from: string }[]) ?? []) {
				if (rename.type === 'file') await this.files.rename(rename.id, rename.from);
				else {
					const folder = await this.requireFolder(rename.id);
					await this.folders.save({ ...folder, name: rename.from });
				}
			}
		} else if (entry.action === 'media.trash') {
			await this.restore(actor, {
				fileIds: [...((meta['files'] as string[]) ?? []), ...((meta['inside'] as string[]) ?? [])],
				folderIds: (meta['folders'] as string[]) ?? [],
				whenFolderGone: 'restore_folder',
			});
		} else throw refuse('nothing_to_undo');
		await this.record(actor, 'media.undo', { undoes: undoId });
		return { done: 1, inUse: [], undoId: null };
	}

	/** A26, before anything moves: which chosen images, folders' contents included, the website uses. */
	async checkTrash(selection: MediaSelection): Promise<MediaTrashCheck> {
		const plan = await this.trashPlan(selection);
		return {
			inUse: plan.inUse,
			total: plan.candidates.length,
			moving: plan.trashFolders.length + plan.trashFiles.length,
			keptFolders: plan.folders.filter((folder) => !folder.trashedAt).length - plan.trashFolders.length,
		};
	}

	/**
	 * Preview or Download from the Media page: the original, straight from Spaces, for five minutes,
	 * under its own name. Nothing is stored, so the storage check is not asked.
	 */
	async fileAddress(id: string, as: 'view' | 'save'): Promise<MediaFileAddress> {
		const asset = await this.requireFile(id);
		if (!asset.originalStorageKey || asset.processing.state === 'awaiting_upload')
			throw new NotFoundException('File not found');
		const url = await this.storage.createSignedDownloadUrl({
			key: asset.originalStorageKey,
			expiresInSeconds: FILE_ADDRESS_SECONDS,
			fileName: downloadName(fileName(asset), asset.originalStorageKey),
			disposition: as === 'view' ? 'inline' : 'attachment',
		});
		return { url };
	}

	// --- Helpers ----------------------------------------------------------------------------------

	/** What Trash would take: the chosen files, everything inside the chosen folders, and what is used. */
	private async trashPlan(selection: MediaSelection) {
		const folders = await this.folders.findManyByIds(selection.folderIds);
		const subtreeIds = new Set<string>();
		for (const folder of folders)
			for (const row of await this.folders.listSubtree(folder.id)) subtreeIds.add(row.id);
		const inFolders = subtreeIds.size ? await this.files.listInFolders([...subtreeIds]) : [];
		const chosen = await this.assets.findManyByIds(selection.fileIds);
		const candidates = [...chosen, ...inFolders].filter(
			(asset, index, all) => !asset.trashedAt && all.findIndex((other) => other.id === asset.id) === index,
		);
		const used = await this.files.whereUsed(candidates.map((asset) => asset.id));
		const inUse = candidates
			.filter((asset) => (used.get(asset.id) ?? []).length > 0)
			.map((asset) => ({
				id: asset.id,
				name: fileName(asset),
				usedOn: used.get(asset.id) ?? [],
				bytes: storedBytes(asset),
				thumbnailUrl: this.thumbnailOf(asset),
			}));
		// A folder holding an image the website uses stays put, with everything in it.
		const blockedFolders = new Set<string>();
		for (const asset of inUse) {
			const owner = inFolders.find((row) => row.id === asset.id);
			if (!owner?.folderId) continue;
			const folder = (await this.folders.findById(owner.folderId)) as MediaFolder;
			for (const id of [folder.id, ...folder.ancestors]) blockedFolders.add(id);
		}
		const trashFolders = folders.filter((folder) => !blockedFolders.has(folder.id) && !folder.trashedAt);
		const blockedIds = new Set(inUse.map((row) => row.id));
		const trashFiles = chosen.filter((asset) => !blockedIds.has(asset.id) && !asset.trashedAt);
		const insideTrashed = inFolders.filter(
			(asset) => !blockedIds.has(asset.id) && !asset.trashedAt && !blockedFolders.has(asset.folderId ?? ''),
		);
		return { folders, candidates, inUse, trashFolders, trashFiles, insideTrashed };
	}

	private cleanName(typed: string): string {
		const cleaned = cleanMediaName(typed);
		if (!cleaned.ok) throw refuse(cleaned.reason);
		return cleaned.name;
	}

	private async requireFolder(id: string): Promise<MediaFolder> {
		const folder = await this.folders.findById(id);
		if (!folder) throw new NotFoundException('Folder not found');
		return folder;
	}

	/** An upload this admin started that has not finished: the only kind its parts may be sent for. */
	private async requireUnfinished(actor: string, id: string): Promise<MediaAsset> {
		const asset = await this.assets.findById(id);
		if (
			!asset ||
			asset.processing.state !== 'awaiting_upload' ||
			asset.uploadedBy?.id !== actor ||
			!asset.originalStorageKey
		)
			throw new NotFoundException('Upload not found');
		return asset;
	}

	private async requireFile(id: string): Promise<MediaAsset> {
		const asset = await this.assets.findById(id);
		if (!asset || asset.deletedAt) throw new NotFoundException('File not found');
		return asset;
	}

	private async breadcrumb(folder: MediaFolder) {
		const parents = await this.folders.findManyByIds(folder.ancestors);
		const byId = new Map(parents.map((row) => [row.id, row.name]));
		return [
			...folder.ancestors.map((id) => ({ id, name: byId.get(id) ?? '' })),
			{ id: folder.id, name: folder.name },
		];
	}

	/** "Product photos › Banarasi"; empty for My files. */
	private location(folderId: string | null, folders: ReadonlyMap<string, MediaFolder>): string {
		if (!folderId) return '';
		const folder = folders.get(folderId);
		if (!folder) return '';
		return [...folder.ancestors.map((id) => folders.get(id)?.name ?? ''), folder.name].filter(Boolean).join(' › ');
	}

	private async recount(ids: readonly (string | null | undefined)[]): Promise<void> {
		const real = [...new Set(ids.filter((id): id is string => !!id))];
		if (real.length) await this.folders.recount(real);
	}

	private folderRow(folder: MediaFolder, starred: ReadonlySet<string>, location: string, now: Date): MediaFolderRow {
		return {
			...folder,
			starred: starred.has(`folder:${folder.id}`),
			location,
			daysLeft: folder.trashedAt ? trashDaysLeft(folder.trashedAt, now) : null,
		};
	}

	private async fileRows(
		assets: readonly MediaAsset[],
		starred: ReadonlySet<string>,
		location: (folderId: string | null | undefined) => string,
		now: Date,
		profile?: string,
	): Promise<MediaFileRow[]> {
		const used = await this.files.whereUsed(assets.map((asset) => asset.id));
		const shop = this.languages?.shop() ?? [];
		return assets.map((asset) => {
			return {
				id: asset.id,
				kind: asset.kind,
				name: fileName(asset),
				contentType: asset.originalFormat ?? 'application/octet-stream',
				category: mediaCategory(asset.originalFormat, fileName(asset)),
				bytes: storedBytes(asset),
				width: asset.width,
				height: asset.height,
				folderId: asset.folderId ?? null,
				location: location(asset.trashedAt ? asset.trashedFrom : asset.folderId),
				visibility: asset.visibility,
				state: asset.processing.state,
				...(asset.kind === 'image'
					? { versionsMaking: (asset.versions ?? []).filter((version) => version.state === 'making').length }
					: {}),
				...(asset.replacing
					? { replacing: asset.replacing.phase, replacingWhy: asset.replacing.reason ?? 'replace' }
					: {}),
				...(profile
					? {
							fitting: (asset.versions ?? [])
								.filter((version) => version.profileKey === profile && version.state === 'ready')
								.map((version) => ({ versionId: version.id, fill: version.fill })),
						}
					: {}),
				...(asset.kind === 'image' && shop.length
					? { altMissing: shop.filter((locale) => !asset.text?.alt?.[locale]?.trim()) }
					: {}),
				thumbnailUrl: this.thumbnailOf(asset),
				usedOn: (used.get(asset.id) ?? []).length,
				starred: starred.has(`file:${asset.id}`),
				uploadedBy: asset.uploadedBy?.id ?? null,
				createdAt: asset.createdAt ?? null,
				trashedAt: asset.trashedAt ?? null,
				daysLeft: asset.trashedAt ? trashDaysLeft(asset.trashedAt, now) : null,
			};
		});
	}

	// --- Reprocess: versions (media step 3) -------------------------------------------------------

	/**
	 * Adds versions to photos (C01 for one, C07 for many). Each is checked against its profile and the original's
	 * size; one already made or being made is skipped, never made twice; one that failed is made again. The storage
	 * check counts every new version before anything is queued. The website keeps showing the versions it shows now
	 * (shownDerivatives), so nothing on a live page moves.
	 */
	async addVersions(
		actor: string,
		input: {
			fileIds: readonly string[];
			versions: readonly { profileKey: string; fill: MediaVersion['fill'] }[];
			reservationId?: string;
			many: boolean;
		},
		now = new Date(),
	): Promise<MediaAddVersionsResult> {
		const profiles = new Map<string, NonNullable<Awaited<ReturnType<MediaProfileRepository['findByKey']>>>>();
		for (const key of new Set(input.versions.map((row) => row.profileKey))) {
			const profile = await this.profiles.findByKey(key);
			if (profile) profiles.set(key, profile);
		}
		const at = now.toISOString();
		const skipped: MediaAddVersionsResult['skipped'] = [];
		const work: { asset: MediaAsset; plan: ReturnType<typeof planAddVersions> }[] = [];
		for (const id of new Set(input.fileIds)) {
			const asset = await this.assets.findById(id);
			if (!asset || asset.trashedAt || asset.deletedAt) {
				if (!input.many) throw new NotFoundException();
				continue;
			}
			// A photo being replaced gets its versions remade by the Replace; new ones wait until it is done (3b).
			if (asset.replacing && asset.replacing.phase !== 'failed') {
				if (!input.many) throw refuse('replacing');
				skipped.push({ fileId: id, versionId: '', reason: 'replacing' });
				continue;
			}
			const plan = planAddVersions({ asset, asked: input.versions, profiles, fitAsIs: input.many, at });
			if (!input.many && plan.skipped.some((row) => row.reason === 'not_a_photo')) throw refuse('not_a_photo');
			skipped.push(...plan.skipped.map((row) => ({ fileId: id, versionId: row.versionId, reason: row.reason })));
			if (plan.add.length || plan.retry.length) work.push({ asset, plan });
		}
		const bytes = work.reduce(
			(sum, row) =>
				sum + estimateVersionBytes(row.asset.originalByteSize, row.plan.add.length + row.plan.retry.length),
			0,
		);
		if (bytes > 0) {
			await this.storageCheck.admit(actor, bytes, input.reservationId, `res_versions_${randomUUID()}`, now);
		}
		let photos = 0;
		let added = 0;
		for (const { asset, plan } of work) {
			const made = await this.writeVersions(asset, plan, input.versions, profiles, at, input.many);
			if (!made) continue;
			photos += 1;
			added += made.length;
			await this.queue.enqueue({ type: 'reprocess', assetId: asset.id, reason: 'versions' });
			await this.record(actor, 'media.versions.add', { name: fileName(asset), versions: made }, asset.id);
		}
		return { photos, added, skipped };
	}

	/**
	 * Writes one photo's new versions; when another admin added some meanwhile, reads the photo again and plans
	 * what is still missing (twice at most). Answers the version ids now being made, or null when none are left.
	 */
	private async writeVersions(
		asset: MediaAsset,
		first: ReturnType<typeof planAddVersions>,
		asked: readonly { profileKey: string; fill: MediaVersion['fill'] }[],
		profiles: ReadonlyMap<string, NonNullable<Awaited<ReturnType<MediaProfileRepository['findByKey']>>>>,
		at: string,
		many: boolean,
	): Promise<string[] | null> {
		let plan = first;
		for (let attempt = 0; attempt < 3; attempt += 1) {
			if (!plan.add.length && !plan.retry.length) return null;
			const saved = await this.assets.addVersions({ assetId: asset.id, add: plan.add, retry: plan.retry });
			if (saved) return [...plan.add, ...plan.retry].map((version) => version.id);
			const again = await this.assets.findById(asset.id);
			if (!again || again.trashedAt || again.deletedAt) return null;
			plan = planAddVersions({ asset: again, asked, profiles, fitAsIs: many, at });
		}
		return null;
	}

	/**
	 * Takes an unused version off a photo (A31 “Remove”) and deletes its files. A version the website shows while the
	 * photo is used somewhere stays; so does one still being made, and a photo's last version.
	 */
	async removeVersion(actor: string, id: string, versionId: string): Promise<void> {
		const asset = await this.assets.findById(id);
		if (!asset || asset.deletedAt) throw new NotFoundException();
		const version = asset.versions?.find((row) => row.id === versionId);
		if (!version) throw refuse('version_unknown');
		if (version.state === 'making') throw refuse('version_making');
		if ((asset.versions?.length ?? 0) <= 1) throw refuse('last_version');
		const used = ((await this.files.whereUsed([id])).get(id) ?? []).length > 0;
		if (used && shownVersionIds(asset).has(versionId)) throw refuse('version_in_use');
		const before = await this.assets.removeVersion(id, versionId);
		if (!before) throw refuse('version_making');
		const files = before.derivatives.filter((row) => row.versionId === versionId);
		if (files.length) {
			const keys = files.map((row) => row.storageKey);
			await this.queue.enqueue({
				type: 'delete-objects',
				keys,
				urls: keys.map((key) => this.storage.getUrl(key)),
			});
		}
		await this.record(
			actor,
			'media.versions.remove',
			{
				name: fileName(asset),
				version: versionId,
				bytes: files.reduce((sum, row) => sum + (row.byteSize ?? 0), 0),
			},
			id,
		);
	}

	/** How far versions being made have got across some photos: the tray's “230 of 612 photos” (A48). */
	async versionsStatus(fileIds: readonly string[]): Promise<MediaVersionsStatus> {
		let photos = 0;
		let making = 0;
		let failed = 0;
		for (const id of new Set(fileIds)) {
			const asset = await this.assets.findById(id);
			if (!asset) continue;
			photos += 1;
			const versions = asset.versions ?? [];
			if (versions.some((version) => version.state === 'making')) making += 1;
			else if (versions.some((version) => version.state === 'failed')) failed += 1;
		}
		return { photos, making, failed };
	}

	/** The small picture a list shows: public photos only; private ones show their type icon. */
	private thumbnailOf(asset: MediaAsset): string | null {
		const shown = shownDerivatives(asset);
		const thumb = shown.find((row) => row.role === 'thumb') ?? shown[0];
		return thumb && asset.visibility === 'public' ? this.storage.getUrl(thumb.storageKey) : null;
	}

	/** Writes the audit row Activity lists; answers its id, which Undo takes. */
	private async record(
		actor: string,
		action: string,
		metadata: Record<string, unknown>,
		entityId: string | null = null,
	): Promise<string> {
		const id = `audit_${randomUUID()}`;
		const entry: AuditLog = {
			id,
			actorUserId: actor === 'system' ? null : actor,
			targetUserId: null,
			audience: actor === 'system' ? 'system' : 'admin',
			action,
			entityType: 'media',
			entityId,
			severity: action === 'media.delete_forever' ? 'warn' : 'info',
			retentionTier: 'catalog_admin',
			diffs: [],
			metadata,
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};
		await this.audit.append(entry);
		return id;
	}
}
