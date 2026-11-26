import type { MediaAsset } from '@saha-textile/contracts';

import type { MediaJobQueuePort } from '../ports/media-job-queue.port';
import type {
	MediaBrowseRepository,
	MediaFavouriteRepository,
	MediaFolderRepository,
	ShareLinkRepository,
} from '../ports/media-library.repository';
import type { EmailPictureRepository } from '../ports/email-picture.repository';
import type { MediaAssetRepository } from '../ports/media.repository';
import { TRASH_DAYS } from './library';
import { emailPicturesLeaving } from './email-pictures';
import { isEmailPictureKey } from './storage-keys';

/** What deleting for good needs; the API and the nightly worker both compose it. */
export interface DeleteForeverDeps {
	folders: MediaFolderRepository;
	files: MediaBrowseRepository;
	assets: MediaAssetRepository;
	stars: MediaFavouriteRepository;
	links: Pick<ShareLinkRepository, 'removeForAssets'>;
	queue: MediaJobQueuePort;
	/** A stored object's public address, so the CDN forgets it too. */
	publicUrl: (key: string) => string;
	/** Writes the audit line (Activity) and returns its id. */
	record: (action: string, metadata: Record<string, unknown>) => Promise<unknown>;
	/** Email pictures of deleted photos are recorded for Clean up, never deleted (R6-1); absent in scripts. */
	emailPictures?: Pick<EmailPictureRepository, 'keep'>;
	/** Who is deleting (null for the nightly Trash purge), for Clean up's “Photo deleted … by”. */
	actor?: string | null;
}

export type DeleteForeverResult =
	{ ok: true; done: number; files: string[]; folders: string[] } | { ok: false; reason: 'not_in_trash' };

/** Every stored object of one file: its original, its picture sizes and its video files. */
export function storedKeys(asset: MediaAsset): string[] {
	// Email pictures are kept for good (R6-1): only Clean up › Email pictures deletes them.
	return [
		asset.originalStorageKey,
		...asset.derivatives.map((row) => row.storageKey),
		...asset.renditions.map((row) => row.storageKey),
		asset.hlsPlaylistKey,
		// Files kept after a Replace (decision 11), and a replacement still on its way in (S7).
		...(asset.keptFiles ?? []).flatMap((row) => row.keys),
		asset.replacing?.key,
	].filter((key): key is string => !!key && !isEmailPictureKey(key));
}

/**
 * The addresses the CDN may hold for a file: picture sizes of a public file, and the original of a
 * public plain file. A photo's original is private and never on the CDN.
 */
export function publicKeys(asset: MediaAsset): string[] {
	if (asset.visibility !== 'public') return [];
	const keys = asset.derivatives.map((row) => row.storageKey).filter((key) => !isEmailPictureKey(key));
	if (asset.kind === 'file' && asset.originalStorageKey) keys.push(asset.originalStorageKey);
	// Kept picture sizes from before a Replace are public too (an original is not, and is left out by its name).
	for (const row of asset.keptFiles ?? []) keys.push(...row.keys.filter((key) => !/\/original[.-]/.test(key)));
	return keys;
}

/**
 * Deletes for good what is in Trash: chosen files, and chosen folders with everything inside
 * them. The records go at once; the stored objects go through a queued job that also clears them
 * from the CDN. Anything chosen that is not in Trash refuses the whole request.
 */
export async function deleteMediaForever(
	deps: DeleteForeverDeps,
	selection: { fileIds: readonly string[]; folderIds: readonly string[] },
	action = 'media.delete_forever',
): Promise<DeleteForeverResult> {
	const folders = await deps.folders.findManyByIds(selection.folderIds);
	const files = await deps.assets.findManyByIds(selection.fileIds);
	if ([...folders, ...files].some((item) => !item.trashedAt)) return { ok: false, reason: 'not_in_trash' };

	const folderIds = new Set<string>();
	for (const folder of folders) for (const row of await deps.folders.listSubtree(folder.id)) folderIds.add(row.id);
	// Only what is itself in Trash: a file the website uses never goes there, so it never goes here.
	const inside = folderIds.size
		? (await deps.files.listInFolders([...folderIds])).filter((row) => row.trashedAt)
		: [];
	const doomed = [...new Map([...files, ...inside].map((asset) => [asset.id, asset])).values()];

	const keys = doomed.flatMap(storedKeys);
	const urls = doomed.flatMap(publicKeys).map(deps.publicUrl);
	const leaving = doomed.flatMap((asset) =>
		emailPicturesLeaving(asset, new Set(), 'deleted', new Date(), deps.actor ?? null),
	);
	if (leaving.length) await deps.emailPictures?.keep(leaving);
	for (const asset of doomed) await deps.assets.hardDelete(asset.id);
	await deps.folders.hardDelete([...folderIds]);
	if (keys.length) await deps.queue.enqueue({ type: 'delete-objects', keys, urls });
	await deps.stars.removeTargets(
		'file',
		doomed.map((asset) => asset.id),
	);
	await deps.stars.removeTargets('folder', [...folderIds]);
	await deps.links.removeForAssets(doomed.map((asset) => asset.id));

	const result = { files: doomed.map((asset) => asset.id), folders: [...folderIds] };
	await deps.record(action, result);
	return { ok: true, done: folders.length + files.length, ...result };
}

/** How many Trash items one nightly run removes; the rest wait for the next night. */
export const TRASH_PURGE_BATCH = 500;

/** Removes for good what has been in Trash for 30 days (the worker runs this every night). */
export async function purgeMediaTrash(deps: DeleteForeverDeps, now: Date): Promise<{ files: number; folders: number }> {
	const cutoff = new Date(now.getTime() - TRASH_DAYS * 86_400_000).toISOString();
	const files = await deps.files.listTrashedBefore(cutoff, TRASH_PURGE_BATCH);
	const folders = (await deps.folders.listTrashed()).filter((row) => !!row.trashedAt && row.trashedAt <= cutoff);
	if (!files.length && !folders.length) return { files: 0, folders: 0 };
	const result = await deleteMediaForever(
		deps,
		{ fileIds: files.map((row) => row.id), folderIds: folders.map((row) => row.id) },
		'media.trash_purged',
	);
	return result.ok ? { files: result.files.length, folders: result.folders.length } : { files: 0, folders: 0 };
}

/** An upload not finished a day after it started was abandoned: a closed tab, a lost line. */
export const UNFINISHED_UPLOAD_HOURS = 24;

export interface UnfinishedSweepDeps {
	files: Pick<MediaBrowseRepository, 'listUnfinishedBefore'>;
	assets: Pick<MediaAssetRepository, 'hardDelete'>;
	queue: MediaJobQueuePort;
	/** Ends the upload's storage hold, `res_<assetId>`, if it is still there. */
	release: (holdId: string) => Promise<void>;
	record: (action: string, metadata: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Removes uploads still waiting for their bytes a day after they started (the worker runs this every
 * night): the record, anything that reached Spaces, and the hold. Nothing else is touched.
 */
export async function sweepUnfinishedUploads(deps: UnfinishedSweepDeps, now: Date): Promise<number> {
	const cutoff = new Date(now.getTime() - UNFINISHED_UPLOAD_HOURS * 3_600_000).toISOString();
	const left = await deps.files.listUnfinishedBefore(cutoff, TRASH_PURGE_BATCH);
	if (!left.length) return 0;
	const keys = left.flatMap((asset) => (asset.originalStorageKey ? [asset.originalStorageKey] : []));
	// Private and never public: there is nothing at the CDN to forget.
	if (keys.length) await deps.queue.enqueue({ type: 'delete-objects', keys, urls: [] });
	for (const asset of left) {
		await deps.assets.hardDelete(asset.id);
		await deps.release(`res_${asset.id}`);
	}
	await deps.record('media.unfinished_swept', { files: left.map((asset) => asset.id) });
	return left.length;
}
