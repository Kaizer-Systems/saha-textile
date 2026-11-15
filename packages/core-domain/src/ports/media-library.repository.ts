import type { MediaAsset, MediaCategory, MediaFolder, ShareLink } from '@saha-textile/contracts';

import type { Paginated } from './pagination';

/** Media folders (`mediaFolders`): the tree people see; a file's Spaces address never depends on it. */
export interface MediaFolderRepository {
	findById(id: string): Promise<MediaFolder | null>;
	findManyByIds(ids: readonly string[]): Promise<MediaFolder[]>;
	/** Folders directly inside `parentId` (null: the top level), in or out of Trash. */
	listChildren(parentId: string | null, options: { trashed: boolean }): Promise<MediaFolder[]>;
	/** Every folder not in Trash: the sidebar tree. */
	listAll(): Promise<MediaFolder[]>;
	/** A folder and everything inside it, at any depth. */
	listSubtree(id: string): Promise<MediaFolder[]>;
	listTrashed(): Promise<MediaFolder[]>;
	save(folder: MediaFolder): Promise<MediaFolder>;
	/** Moves a folder and rewrites the ancestors of everything inside it in one step. */
	move(id: string, parentId: string | null, ancestors: readonly string[]): Promise<void>;
	setTrashed(ids: readonly string[], at: string | null, from: ReadonlyMap<string, string | null>): Promise<void>;
	hardDelete(ids: readonly string[]): Promise<void>;
	/** Recounts files and bytes for these folders and their ancestors. */
	recount(ids: readonly string[]): Promise<void>;
}

/** Stars (`mediaFavourites`): each admin's own, and everyone's together (A17, A17B). */
export interface MediaFavouriteRepository {
	set(userId: string, target: { type: 'folder' | 'file'; id: string }, starred: boolean): Promise<void>;
	listForUser(userId: string): Promise<{ type: 'folder' | 'file'; id: string }[]>;
	/** Every star, with who made it. */
	listAll(): Promise<{ userId: string; type: 'folder' | 'file'; id: string }[]>;
	removeTargets(type: 'folder' | 'file', ids: readonly string[]): Promise<void>;
}

/** Share links (`mediaShareLinks`, R4-5). The code itself is never stored, only its hash. */
export interface ShareLinkRepository {
	create(link: ShareLink): Promise<ShareLink>;
	findById(id: string): Promise<ShareLink | null>;
	findByCodeHash(codeHash: string): Promise<ShareLink | null>;
	listForAsset(assetId: string): Promise<ShareLink[]>;
	save(link: ShareLink): Promise<ShareLink>;
	/** Counts one open (approximate: chat apps and mail scanners open links too). */
	countOpen(id: string, at: string): Promise<void>;
	/** Stops every active link of these files: they went to Trash. */
	stopForAssets(assetIds: readonly string[], at: string): Promise<number>;
	/** Removes every link of these files: they were deleted for good. */
	removeForAssets(assetIds: readonly string[]): Promise<number>;
}

/** Storage in use and the work already running against the plan (R4-7). */
export interface StorageLedgerRepository {
	/** Holds bytes for running work; expires by itself, so a crashed upload frees its share. */
	reserve(input: { id: string; userId: string; bytes: number; expiresAt: string }): Promise<void>;
	release(id: string): Promise<void>;
	reservedBytes(now: string, exceptId?: string): Promise<number>;
	findReservation(id: string): Promise<{ id: string; userId: string; bytes: number; expiresAt: string } | null>;
}

/** What the Media page lists: one folder, a subtree search, a category, Recent or Trash. */
export interface MediaBrowseFilter {
	/** Undefined: anywhere; null: My files (the top level); an id: that folder only. */
	folderId?: string | null;
	/** A search inside a folder covers that folder and below: these folder ids. */
	withinFolders?: readonly string[];
	trashed: boolean;
	search?: string;
	category?: MediaCategory;
	ids?: readonly string[];
	createdSince?: string;
	sort: 'name' | 'created' | 'size';
	direction: 'asc' | 'desc';
	page: number;
	pageSize: number;
}

/** The Media page's queries and changes on stored files (`mediaAssets`). */
export interface MediaBrowseRepository {
	browse(filter: MediaBrowseFilter): Promise<Paginated<MediaAsset>>;
	/** Files with exactly these bytes (S6), not in Trash. */
	findBySha256(hashes: readonly string[]): Promise<MediaAsset[]>;
	/** Names of the files in one folder, not in Trash: for "(1)", "(2)". */
	namesIn(folderId: string | null): Promise<string[]>;
	moveTo(ids: readonly string[], folderId: string | null): Promise<void>;
	rename(id: string, name: string): Promise<void>;
	/** Into Trash (at), or out of it (null) into `restoreTo`. */
	setTrashed(
		ids: readonly string[],
		at: string | null,
		from: ReadonlyMap<string, string | null>,
		restoreTo?: ReadonlyMap<string, string | null>,
	): Promise<void>;
	/** Bytes stored, by what they are. */
	usage(): Promise<{ originals: number; versions: number; files: number; trash: number }>;
	listTrashedBefore(cutoff: string, limit: number): Promise<MediaAsset[]>;
	/** Files and bytes directly in each folder (not in Trash). */
	totalsByFolder(folderIds: readonly string[]): Promise<{ folderId: string; files: number; bytes: number }[]>;
	/** Where each file is used on the website ("Product · Red Banarasi Silk"); absent when unused. */
	whereUsed(ids: readonly string[]): Promise<Map<string, string[]>>;
	/** Every file in these folders, Trash included: what moves to Trash with them. */
	listInFolders(folderIds: readonly string[]): Promise<MediaAsset[]>;
}
