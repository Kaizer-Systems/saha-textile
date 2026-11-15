import { randomUUID } from 'node:crypto';

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	AuditLog,
	MediaAsset,
	MediaBrowseQuery,
	MediaBrowseResponse,
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
} from '@saha-textile/contracts';
import {
	type AuditLogRepository,
	type MediaAssetRepository,
	type MediaBrowseFilter,
	type MediaBrowseRepository,
	type MediaFavouriteRepository,
	type MediaFolderRepository,
	type MediaJobQueuePort,
	MEDIA_INGEST_POLICY,
	type ShareLinkRepository,
	type StoragePort,
	ancestorsUnder,
	cleanMediaName,
	deleteMediaForever,
	folderMoveRefusal,
	freeName,
	mediaCategory,
	mediaSlug,
	plainFileStorageKey,
	purgeMediaTrash,
	renameKeepingExtension,
	restoreTarget,
	trashDaysLeft,
} from '@saha-textile/core-domain';

import { domainRefusal } from '../auth/domain-refusal';
import {
	AUDIT_LOG_REPOSITORY,
	MEDIA_ASSET_REPOSITORY,
	MEDIA_BROWSE_REPOSITORY,
	MEDIA_FAVOURITE_REPOSITORY,
	MEDIA_FOLDER_REPOSITORY,
	MEDIA_JOB_QUEUE,
	SHARE_LINK_REPOSITORY,
	STORAGE_PORT,
} from '../infra/tokens';
import { MediaStorageService } from './media-storage.service';

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
};

const refuse = (code: string) => domainRefusal(code, REFUSALS[code] ?? 'Not allowed');

/** The name a file shows: its Media name, else its web file name. */
export const fileName = (asset: MediaAsset): string => asset.displayName ?? asset.slug;

/**
 * The Media page as a file manager (media build step 1, brief revision 6): folders, moves, Trash,
 * restore, stars, the duplicate check, Activity and Undo. Every change is audited under
 * `entityType: 'media'`; Activity (S9) is that trail, and Undo (S1) reverses its last entry.
 */
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
	) {}

	// --- Reading ----------------------------------------------------------------------------------

	async tree(): Promise<MediaFolderTree> {
		const all = await this.folders.listAll();
		return { folders: all.map(({ id, parentId, name, files, bytes }) => ({ id, parentId, name, files, bytes })) };
	}

	async browse(userId: string, query: MediaBrowseQuery, now = new Date()): Promise<MediaBrowseResponse> {
		const extra = await this.filterParts(query, now);
		const filtering = Object.keys(extra).length > 0;
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
			const result = await this.files.browse({ ...page, ...extra, trashed: true, search: query.search });
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
				files: await this.fileRows(result.items, starred, location, now),
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
		const result = await this.files.browse({
			...page,
			...extra,
			trashed: false,
			search: query.search,
			category: query.category,
			...(searching ? (within ? { withinFolders: within } : {}) : { folderId: folder?.id ?? null }),
		});
		const childFolders = searching ? [] : await this.folders.listChildren(folder?.id ?? null, { trashed: false });
		return {
			folder: folder ? this.folderRow(folder, starred, location(folder.parentId), now) : null,
			breadcrumb,
			folders: childFolders.map((row) => this.folderRow(row, starred, location(row.parentId), now)),
			files: await this.fileRows(result.items, starred, location, now),
			total: result.total,
			page: result.page,
			pageSize: result.pageSize,
			starredBy: {},
		};
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
			.map((asset) => ({ id: asset.id, name: fileName(asset), usedOn: used.get(asset.id) ?? [] }));
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

	/** The browser finished its PUT: the file is ready (nothing to process) and its hold ends. */
	async finalizeFile(actor: string, id: string, now = new Date()): Promise<{ assetId: string; state: 'ready' }> {
		const asset = await this.requireFile(id);
		if (asset.kind !== 'file') throw refuse('not_a_plain_file');
		if (asset.processing.state === 'awaiting_upload') {
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
		const same = await this.files.findBySha256(query.files.map((file) => file.sha256));
		const names = await this.files.namesIn(query.folderId);
		const inFolder = await this.files.browse({
			folderId: query.folderId,
			trashed: false,
			sort: 'name',
			direction: 'asc',
			page: 1,
			pageSize: 200,
			search: undefined,
		});
		const all = await this.folders.listAll();
		const lookup = new Map(all.map((row) => [row.id, row]));
		const taken = [...names];
		return {
			files: query.files.map((file) => {
				const identical = same.find((asset) => asset.sha256 === file.sha256) ?? null;
				const named = inFolder.items.find(
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
					sameName: named && named.sha256 !== file.sha256 ? { id: named.id, name: fileName(named) } : null,
					keepBothName,
				};
			}),
		};
	}

	/** S9: who did what on the Media page, newest first. */
	async activity(page: number, pageSize: number) {
		return this.audit.list({ entityType: 'media', page, pageSize } as never);
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

	// --- Helpers ----------------------------------------------------------------------------------

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
	): Promise<MediaFileRow[]> {
		const used = await this.files.whereUsed(assets.map((asset) => asset.id));
		return assets.map((asset) => {
			const thumb = asset.derivatives.find((row) => row.role === 'thumb') ?? asset.derivatives[0];
			return {
				id: asset.id,
				kind: asset.kind,
				name: fileName(asset),
				contentType: asset.originalFormat,
				category: mediaCategory(asset.originalFormat, fileName(asset)),
				bytes: asset.originalByteSize + asset.derivatives.reduce((sum, row) => sum + (row.byteSize ?? 0), 0),
				width: asset.width,
				height: asset.height,
				folderId: asset.folderId ?? null,
				location: location(asset.trashedAt ? asset.trashedFrom : asset.folderId),
				visibility: asset.visibility,
				state: asset.processing.state,
				thumbnailUrl: thumb && asset.visibility === 'public' ? this.storage.getUrl(thumb.storageKey) : null,
				usedOn: (used.get(asset.id) ?? []).length,
				starred: starred.has(`file:${asset.id}`),
				uploadedBy: asset.uploadedBy?.id ?? null,
				createdAt: asset.createdAt ?? null,
				trashedAt: asset.trashedAt ?? null,
				daysLeft: asset.trashedAt ? trashDaysLeft(asset.trashedAt, now) : null,
			};
		});
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
