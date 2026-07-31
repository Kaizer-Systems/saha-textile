import type { VideoRenditionHeight } from '@saha-textile/contracts';

export interface TranscodeJobRequest {
	assetId: string;
	/** Spaces key of the uploaded H.264/AAC MP4 master. */
	sourceStorageKey: string;
	/** Source height, which decides the ladder via `hlsRenditionsFor()`. */
	sourceHeight: number;
	/**
	 * Delete the hot master once every rendition succeeds (owner lock). Left explicit so a
	 * re-run can keep the master while debugging.
	 */
	deleteMasterOnSuccess?: boolean;
}

export type TranscodeJobState = 'queued' | 'running' | 'succeeded' | 'failed';

export interface TranscodeJobStatus {
	jobId: string;
	assetId: string;
	state: TranscodeJobState;
	renditions: VideoRenditionHeight[];
	hlsPlaylistKey: string | null;
	error: string | null;
}

/**
 * HLS encoding boundary (`VideoTranscodePort`).
 *
 * The implementation is a BullMQ queue plus an ffmpeg worker at the adapter edge —
 * core never imports ffmpeg, BullMQ, Vidstack, or the Spaces SDK (owner lock). This is
 * an ENQUEUE port, not a synchronous encoder: `enqueue` returns as soon as the job is
 * accepted, and the worker updates the asset when it finishes.
 *
 * The ladder is not a parameter: it is derived from `sourceHeight` by the locked rule in
 * `hlsRenditionsFor()`, so no caller can request a non-conforming set.
 */
export interface VideoTranscodePort {
	enqueue(request: TranscodeJobRequest): Promise<{ jobId: string }>;
	getStatus(jobId: string): Promise<TranscodeJobStatus | null>;
}
