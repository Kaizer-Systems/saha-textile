import type { MediaZip } from '@saha-textile/contracts';

/** A .zip as stored (media step 5): what people see, plus who asked, what was picked and where the file is. */
export interface MediaZipRecord extends MediaZip {
	userId: string;
	fileIds: string[];
	folderIds: string[];
	storageKey: string;
}

export type MediaZipPatch = Partial<
	Pick<MediaZipRecord, 'state' | 'files' | 'bytes' | 'readyAt' | 'expiresAt' | 'error'>
>;

/** The .zip files people asked for: one record each, kept while the stored file lives and a day after. */
export interface MediaZipRepository {
	create(zip: MediaZipRecord): Promise<void>;
	find(id: string): Promise<MediaZipRecord | null>;
	/**
	 * Saves progress or a new state. Only a .zip still being made moves on: one cancelled, failed or expired is left
	 * as it is, and null is answered.
	 */
	update(id: string, patch: MediaZipPatch): Promise<MediaZipRecord | null>;
	/** Sets a new state whatever the state was (a cancel from the person who asked). */
	setState(id: string, state: MediaZipRecord['state']): Promise<void>;
	/** The person's own .zip files made since `since`, newest first. */
	listForUser(userId: string, since: string): Promise<MediaZipRecord[]>;
	/** Ready .zip files past their hours, and cancelled or failed ones, not swept yet: their stored file goes. */
	listToSweep(now: string, limit: number): Promise<MediaZipRecord[]>;
	/** The sweep is done with it: its last state (`expired` for one that was ready), never swept again. */
	finishSweep(id: string, state: MediaZipRecord['state']): Promise<void>;
	/** Bytes of the .zip files stored now (Storage details, A47). */
	storedBytes(): Promise<number>;
}

/** One file in a .zip: its path inside it, its size, and its bytes read as they are written. */
export interface ZipFileEntry {
	path: string;
	bytes: number;
	read: () => AsyncIterable<Uint8Array>;
}

/** A folder with nothing in it, kept in the .zip as `path/`. */
export interface ZipFolderEntry {
	path: string;
	folder: true;
}

/**
 * Writes a .zip (the zip library at the edge, media step 5). Entries go in one after another and are stored as they
 * are: photos and archives are compressed already. Files and archives past 4 GB use ZIP64.
 */
export interface ZipArchivePort {
	write(entries: AsyncIterable<ZipFileEntry | ZipFolderEntry>): AsyncIterable<Uint8Array>;
}
