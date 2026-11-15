import type {
	ImageDerivative,
	MediaAsset,
	MediaKeptFiles,
	MediaReplacement,
	MediaVersion,
} from '@saha-textile/contracts';

import type { PageQuery, Paginated } from './pagination';

export interface MediaAssetFilter extends PageQuery {
	kind?: MediaAsset['kind'];
	status?: MediaAsset['status'];
	purpose?: MediaAsset['purpose'];
	/** Matches the SEO slug and alt text. */
	search?: string;
	/** Include soft-deleted assets — admin/GC surfaces only. */
	includeDeleted?: boolean;
}

/**
 * Media asset store (`mediaAssets`).
 *
 * Assets are first-class and REUSABLE: owners hold references, so deleting an owner must
 * never delete an asset another owner still points at. `countReferences` is what makes
 * orphan collection safe, and `listOrphans` drives the GC job — assets are soft-deleted
 * first and only hard-deleted after the grace period (`DEC-DELETE-RETENTION`).
 */
export interface MediaAssetRepository {
	findById(assetId: string): Promise<MediaAsset | null>;
	findManyByIds(assetIds: readonly string[]): Promise<MediaAsset[]>;
	list(filter: MediaAssetFilter): Promise<Paginated<MediaAsset>>;
	create(asset: MediaAsset): Promise<MediaAsset>;
	update(asset: MediaAsset): Promise<MediaAsset>;
	/**
	 * How many owners currently reference this asset; zero means it is an orphan.
	 *
	 * Driven by the adapter's owner registry — every persisted media reference is registered
	 * there, and a schema-walking test fails CI when a new one is not.
	 */
	countReferences(assetId: string): Promise<number>;
	/**
	 * Atomically moves an asset from `queued` (or a retryable `failed`) to `processing` and
	 * returns it, or null when another worker already holds it — so a duplicated job is a no-op.
	 */
	claimForProcessing(assetId: string, options?: { allowReady?: boolean }): Promise<MediaAsset | null>;
	/**
	 * Records a versions run (media step 2b) without overwriting what changed meanwhile: sets the photo's facts and
	 * processing state, adds the new files, and replaces only the versions this run made, so a version asked for
	 * during the run stays asked for. Returns the photo as stored afterwards.
	 */
	settleVersions(input: {
		assetId: string;
		set: Partial<Pick<MediaAsset, 'width' | 'height' | 'dominantColor' | 'thumbHash' | 'warnings'>> &
			Pick<MediaAsset, 'processing'>;
		addDerivatives: readonly ImageDerivative[];
		versions: readonly MediaVersion[];
	}): Promise<MediaAsset | null>;
	/**
	 * Reprocess (media step 3): adds versions to a photo as `making`, and puts failed ones asked again back to
	 * `making`. Atomic: when another admin added one of the same versions meanwhile, nothing is written and null comes
	 * back, so the caller reads the photo again; a version is never made twice.
	 */
	addVersions(input: {
		assetId: string;
		add: readonly MediaVersion[];
		retry: readonly MediaVersion[];
	}): Promise<MediaAsset | null>;
	/**
	 * Takes one version and its files off a photo, only while that version is not being made. Returns the photo as it
	 * was before, so the caller can delete the version's stored files; null when there was nothing to remove.
	 */
	removeVersion(assetId: string, versionId: string): Promise<MediaAsset | null>;
	/**
	 * Replace (media step 3b): records a new original on its way in, only while no other Replace runs and no version
	 * is being made. Null when that isn't so.
	 */
	startReplace(assetId: string, replacing: MediaReplacement): Promise<MediaAsset | null>;
	/**
	 * Moves a Replace on, only from one of the phases given: changes some of its fields, or clears it (null). Answers
	 * the photo afterwards, or null when the Replace wasn't in one of those phases.
	 */
	moveReplace(
		assetId: string,
		from: readonly MediaReplacement['phase'][],
		change: Partial<MediaReplacement> | null,
	): Promise<MediaAsset | null>;
	/**
	 * Puts the new photo in place in one write, only while its Replace is being made: the original and its facts,
	 * every file, the versions, and the old files to keep; the Replace is cleared.
	 */
	finishReplace(input: {
		assetId: string;
		set: Pick<MediaAsset, 'originalStorageKey' | 'originalFormat' | 'originalByteSize' | 'width' | 'height'> &
			Partial<Pick<MediaAsset, 'dominantColor' | 'thumbHash' | 'warnings' | 'sha256'>>;
		derivatives: readonly ImageDerivative[];
		versions: readonly MediaVersion[];
		kept: MediaKeptFiles | null;
	}): Promise<MediaAsset | null>;
	/** Photos holding kept files due for deletion by `before` (the daily sweep). */
	listKeptDue(before: string, limit: number): Promise<MediaAsset[]>;
	/** Forgets the kept files due by `before`, once they have been sent for deletion. */
	dropKept(assetId: string, before: string): Promise<void>;
	/** Assets holding a derivative of `role` older than `version` — the reprocess work list. */ /** Assets holding a derivative of `role` older than `version` — the reprocess work list. */
	listStaleForRole(input: { role: string; version: number; limit: number }): Promise<MediaAsset[]>;
	/** Live (not soft-deleted) assets created before the cutoff — GC soft-delete candidates. */
	listLiveCreatedBefore(input: {
		createdBefore: string;
		afterId: string | null;
		limit: number;
	}): Promise<MediaAsset[]>;
	/** Soft-deleted, unreferenced assets whose grace period has elapsed. */
	listOrphans(input: { deletedBefore: string; limit: number }): Promise<MediaAsset[]>;
	softDelete(assetId: string, at: string): Promise<void>;
	/** Clears a soft delete when an asset gains an owner again inside its grace period. */
	restore(assetId: string): Promise<void>;
	/** Hard delete — only for a GC'd orphan or an explicit privacy/legal purge. */
	hardDelete(assetId: string): Promise<void>;
}
