/** Background media work. Each job is idempotent: running it twice leaves the same state. */
export type MediaJob =
	/** Decode, validate, and render every role for a freshly uploaded asset. */
	| { type: 'process'; assetId: string }
	/** Re-render stale roles (ladder edit, slug change, primary-only roles on promotion). */
	| { type: 'reprocess'; assetId: string; reason: 'ladder' | 'slug' | 'primary' | 'manual' }
	/** Delete storage objects, then purge their public URLs from the CDN. */
	| { type: 'delete-objects'; keys: string[]; urls: string[] }
	| { type: 'purge'; urls: string[] };

/**
 * Enqueue port for media jobs (`MediaJobQueuePort`), implemented with BullMQ + Redis at the
 * edge. Core enqueues and returns; the worker process runs the matching use case.
 */
export interface MediaJobQueuePort {
	enqueue(job: MediaJob, options?: { delayMs?: number }): Promise<void>;
}
