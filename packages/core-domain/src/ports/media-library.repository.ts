import type { MediaFolder, ShareLink } from '@saha-textile/contracts';

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
}

/** Storage in use and the work already running against the plan (R4-7). */
export interface StorageLedgerRepository {
	/** Bytes stored, by kind: originals, versions, other files, Trash. */
	usage(): Promise<{ key: string; bytes: number }[]>;
	/** Holds bytes for running work; expires by itself, so a crashed upload frees its share. */
	reserve(input: { id: string; userId: string; bytes: number; expiresAt: string }): Promise<void>;
	release(id: string): Promise<void>;
	reservedBytes(now: string, exceptId?: string): Promise<number>;
	findReservation(id: string): Promise<{ id: string; userId: string; bytes: number; expiresAt: string } | null>;
}
