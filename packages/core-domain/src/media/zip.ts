import type { MediaAsset, MediaFolder, MediaZipPlan } from '@saha-textile/contracts';

import type { MediaAssetRepository } from '../ports/media.repository';
import type { MediaBrowseRepository, MediaFolderRepository } from '../ports/media-library.repository';
import type {
	MediaZipRecord,
	MediaZipRepository,
	ZipArchivePort,
	ZipFileEntry,
	ZipFolderEntry,
} from '../ports/media-zip.repository';
import type { StoragePort } from '../ports/storage.port';

/**
 * Folder downloads as .zip (media step 5; brief A30, A30B, A48; settled “Folder downloads are zipped in the
 * background; a toast gives a link that works for 24 hours”). The worker writes the .zip into Spaces file by file, so
 * nothing is held whole in memory, and counts real progress. The stored .zip counts against storage until it is
 * deleted, 24 hours after it is ready.
 */
export const ZIP_KEEP_HOURS = 24;
/** Progress is saved at most this often, so a .zip of many small files does not write for every file. */
export const ZIP_PROGRESS_EVERY_MS = 1000;
/** The hourly sweep deletes at most this many stored .zip files a run. */
export const ZIP_SWEEP_BATCH = 50;

/** One file to put in the .zip: where its bytes are, its path inside, and its size. */
export interface ZipItem {
	assetId: string;
	key: string;
	path: string;
	bytes: number;
}

export interface ZipContents {
	/** The .zip's own name, without `.zip`. */
	name: string;
	items: ZipItem[];
	/** Folders with nothing in them, kept as folders. */
	emptyFolders: string[];
}

export interface ZipSourceDeps {
	folders: Pick<MediaFolderRepository, 'findManyByIds' | 'findById' | 'listSubtree'>;
	browse: Pick<MediaBrowseRepository, 'listInFolders'>;
	assets: Pick<MediaAssetRepository, 'findManyByIds'>;
}

/** A name safe as one part of a path inside a .zip: no slashes, nothing empty. */
const part = (name: string): string => name.replace(/[\\/]+/g, '-').trim() || 'untitled';

/**
 * A file's name inside the .zip: its name in Media, with the stored file's ending added when the name lacks it. A
 * photo's name in Media has no ending (“red-banarasi-front”), and a file without one does not open by double-click.
 */
export function zipEntryName(asset: Pick<MediaAsset, 'displayName' | 'slug' | 'originalStorageKey'>): string {
	const name = part(asset.displayName ?? asset.slug);
	const file = (asset.originalStorageKey ?? '').split('/').pop() ?? '';
	const dot = file.lastIndexOf('.');
	const ending = dot > 0 ? file.slice(dot).toLowerCase() : '';
	return ending && !name.toLowerCase().endsWith(ending) ? `${name}${ending}` : name;
}

/** A file that can go in: not in Trash, and fully uploaded. */
const takes = (asset: MediaAsset): asset is MediaAsset & { originalStorageKey: string } =>
	!asset.trashedAt && !!asset.originalStorageKey && asset.processing?.state !== 'awaiting_upload';

/** `name (1).ext`, `name (2).ext`… for a name already taken in the same folder of the .zip (any case). */
function unique(path: string, taken: Set<string>): string {
	let candidate = path;
	const slash = path.lastIndexOf('/');
	const folder = path.slice(0, slash + 1);
	const file = path.slice(slash + 1);
	const dot = file.lastIndexOf('.');
	const [base, ending] = dot > 0 ? [file.slice(0, dot), file.slice(dot)] : [file, ''];
	for (let count = 1; taken.has(candidate.toLowerCase()); count += 1)
		candidate = `${folder}${base} (${count})${ending}`;
	taken.add(candidate.toLowerCase());
	return candidate;
}

/**
 * What a .zip of these folders and files holds. One folder alone gives `Folder.zip` with that folder at its top;
 * anything else is named after the folder it was picked in (My files at the top level). Folders keep their tree; Trash
 * and unfinished uploads are left out; a name met twice in one folder gets “(1)”.
 */
export async function zipContents(
	deps: ZipSourceDeps,
	pick: { fileIds: readonly string[]; folderIds: readonly string[] },
	topName = 'My files',
): Promise<ZipContents> {
	const chosenFolders = (await deps.folders.findManyByIds(pick.folderIds)).filter((folder) => !folder.trashedAt);
	const chosenFiles = (await deps.assets.findManyByIds(pick.fileIds)).filter(takes);
	const items: ZipItem[] = [];
	const emptyFolders: string[] = [];
	const taken = new Set<string>();

	for (const top of chosenFolders) {
		const subtree = (await deps.folders.listSubtree(top.id)).filter((folder) => !folder.trashedAt);
		const live = new Map<string, MediaFolder>([
			[top.id, top],
			...subtree.map((folder) => [folder.id, folder] as const),
		]);
		// The chosen folder, then the folders down to this one: the path inside the .zip.
		const chainOf = (folder: MediaFolder): string[] =>
			folder.id === top.id ? [top.id] : [...folder.ancestors.slice(folder.ancestors.indexOf(top.id)), folder.id];
		// A folder inside a trashed one is left out with it.
		const inside = [...live.values()].filter((folder) => chainOf(folder).every((id) => live.has(id)));
		const pathOf = (folder: MediaFolder): string =>
			chainOf(folder)
				.map((id) => part(live.get(id)?.name ?? ''))
				.join('/');
		const files = (await deps.browse.listInFolders(inside.map((folder) => folder.id))).filter(takes);
		const holding = new Set<string>();
		for (const asset of files) {
			const folder = live.get(asset.folderId ?? '');
			if (!folder) continue;
			for (const id of [...folder.ancestors, folder.id]) holding.add(id);
			const path = unique(`${pathOf(folder)}/${zipEntryName(asset)}`, taken);
			items.push({ assetId: asset.id, key: asset.originalStorageKey, path, bytes: asset.originalByteSize });
		}
		for (const folder of inside) if (!holding.has(folder.id)) emptyFolders.push(`${pathOf(folder)}/`);
	}
	for (const asset of chosenFiles) {
		items.push({
			assetId: asset.id,
			key: asset.originalStorageKey,
			path: unique(zipEntryName(asset), taken),
			bytes: asset.originalByteSize,
		});
	}

	let name = chosenFolders.length === 1 && !chosenFiles.length ? (chosenFolders[0]?.name ?? topName) : topName;
	if (!(chosenFolders.length === 1 && !chosenFiles.length)) {
		const parentId = chosenFolders[0]?.parentId ?? chosenFiles[0]?.folderId ?? null;
		const parent = parentId ? await deps.folders.findById(parentId) : null;
		if (parent) name = parent.name;
	}
	return { name: part(name), items, emptyFolders };
}

/** The plan the storage check is asked about (R4-7): the .zip's name, files and bytes. */
export const zipPlan = (contents: ZipContents): MediaZipPlan => ({
	name: `${contents.name}.zip`,
	files: contents.items.length,
	bytes: contents.items.reduce((sum, item) => sum + item.bytes, 0),
});

/** Where a .zip is stored: private, under its own id (the name people see is given when it is downloaded). */
export const zipStorageKey = (zipId: string): string => `zips/${zipId}.zip`;

export interface ZipBuildDeps extends ZipSourceDeps {
	zips: MediaZipRepository;
	storage: Pick<StoragePort, 'readStream' | 'uploadStream' | 'delete'>;
	archive: ZipArchivePort;
	now: () => Date;
}

export type ZipBuildOutcome = 'ready' | 'cancelled' | 'failed' | 'not_found';

/**
 * The worker's job: writes the .zip into Spaces, saving real counts as it goes. A .zip cancelled meanwhile stops at
 * the next file and leaves nothing stored; a failure is recorded with its reason. Running it again on a .zip that is
 * no longer being made does nothing.
 */
export async function buildZip(deps: ZipBuildDeps, input: { zipId: string }): Promise<ZipBuildOutcome> {
	const zip = await deps.zips.find(input.zipId);
	if (!zip) return 'not_found';
	if (zip.state !== 'adding') return zip.state === 'cancelled' ? 'cancelled' : 'failed';
	const contents = await zipContents(deps, zip, zip.name.replace(/\.zip$/, ''));
	const total = zipPlan(contents);
	await deps.zips.update(zip.id, {
		files: { done: 0, total: total.files },
		bytes: { done: 0, total: total.bytes },
	});

	const progress = { files: 0, bytes: 0, savedAt: 0 };
	const stop = { aborted: false };
	const save = async (force = false) => {
		const at = deps.now().getTime();
		if (!force && at - progress.savedAt < ZIP_PROGRESS_EVERY_MS) return;
		progress.savedAt = at;
		const saved = await deps.zips.update(zip.id, {
			files: { done: progress.files, total: total.files },
			bytes: { done: progress.bytes, total: total.bytes },
		});
		if (!saved) stop.aborted = true;
	};
	async function* entries(): AsyncIterable<ZipFileEntry | ZipFolderEntry> {
		for (const path of contents.emptyFolders) yield { path, folder: true };
		for (const item of contents.items) {
			if (stop.aborted) return;
			yield {
				path: item.path,
				bytes: item.bytes,
				read: () => counted(deps.storage.readStream(item.key)),
			};
			progress.files += 1;
			await save();
		}
	}
	async function* counted(stream: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
		for await (const chunk of stream) {
			progress.bytes += chunk.byteLength;
			yield chunk;
		}
	}

	try {
		const stored = await deps.storage.uploadStream({
			key: zip.storageKey,
			contentType: 'application/zip',
			body: deps.archive.write(entries()),
			signal: stop,
		});
		if (stop.aborted) {
			await deps.storage.delete(zip.storageKey).catch(() => undefined);
			return 'cancelled';
		}
		const readyAt = deps.now();
		const done = await deps.zips.update(zip.id, {
			state: 'ready',
			files: { done: total.files, total: total.files },
			bytes: { done: stored.bytes, total: stored.bytes },
			readyAt: readyAt.toISOString(),
			expiresAt: new Date(readyAt.getTime() + ZIP_KEEP_HOURS * 3_600_000).toISOString(),
		});
		if (!done) {
			// Cancelled at the very end: nothing is kept.
			await deps.storage.delete(zip.storageKey).catch(() => undefined);
			return 'cancelled';
		}
		return 'ready';
	} catch (error) {
		await deps.storage.delete(zip.storageKey).catch(() => undefined);
		if (stop.aborted) return 'cancelled';
		await deps.zips.update(zip.id, {
			state: 'failed',
			error: error instanceof Error ? error.message : String(error),
		});
		return 'failed';
	}
}

export interface ZipSweepDeps {
	zips: Pick<MediaZipRepository, 'listToSweep' | 'finishSweep'>;
	storage: Pick<StoragePort, 'delete'>;
	/** Ends the storage hold the .zip kept (its id), so the bytes stop counting. */
	releaseHold: (zipId: string) => Promise<void>;
	now: () => Date;
}

/** The hourly sweep: .zip files past their 24 hours, cancelled or failed ones, are deleted and stop counting. */
export async function sweepZips(deps: ZipSweepDeps): Promise<number> {
	const due = await deps.zips.listToSweep(deps.now().toISOString(), ZIP_SWEEP_BATCH);
	for (const zip of due) {
		await deps.storage.delete(zip.storageKey).catch(() => undefined);
		await deps.releaseHold(zip.id);
		await deps.zips.finishSweep(zip.id, zip.state === 'ready' ? 'expired' : zip.state);
	}
	return due.length;
}

/** What the API shows of a record: everything but who asked, the picks and the storage key. */
export const publicZip = ({ userId: _u, fileIds: _f, folderIds: _d, storageKey: _k, ...zip }: MediaZipRecord) => zip;
