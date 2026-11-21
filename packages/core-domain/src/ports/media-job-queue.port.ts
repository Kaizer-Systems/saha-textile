/** Background media work. Each job is idempotent: running it twice leaves the same state. */
export type MediaJob =
	/** Decode, validate, and render every role for a freshly uploaded asset. */
	| { type: 'process'; assetId: string }
	/**
	 * Re-render stale roles (ladder edit, slug change, primary-only roles on promotion); for a photo with versions,
	 * make the versions asked for and any missing per-photo pictures (`versions`).
	 */
	| { type: 'reprocess'; assetId: string; reason: 'ladder' | 'slug' | 'primary' | 'manual' | 'versions' }
	/** Replace (media step 3b): remake every version from the new original, then swap it in. */
	| { type: 'replace'; assetId: string }
	/** A swatch cut (brief P11): cut its square from the photo's original, then make its swatch sizes. */
	| { type: 'cut'; assetId: string }
	/** A swatch cut replaced on a value: deleted for good, with its files, once nothing uses it. */
	| { type: 'drop-cut'; assetId: string }
	/** Delete storage objects, then purge their public URLs from the CDN. */
	| { type: 'delete-objects'; keys: string[]; urls: string[] }
	| { type: 'purge'; urls: string[] }
	/** Admin's "Refresh now": the daily YouTube refresh, run at once. */
	| { type: 'youtube-refresh' }
	/** A folder download (media step 5, A30): the .zip is written into Spaces, file by file. */
	| { type: 'zip'; zipId: string }
	/** Page Builder words check (SG-1): measure the nine word spots of one photo version, once. */
	| { type: 'word-spots'; assetId: string; versionId: string }
	/** Page Builder FX-8: just after a switch at `at`, ask the shop for the page in each shop language. */
	| { type: 'page-warm'; pageType: string; at: string };

/**
 * Enqueue port for media jobs (`MediaJobQueuePort`), implemented with BullMQ + Redis at the
 * edge. Core enqueues and returns; the worker process runs the matching use case.
 */
export interface MediaJobQueuePort {
	enqueue(job: MediaJob, options?: { delayMs?: number }): Promise<void>;
}
