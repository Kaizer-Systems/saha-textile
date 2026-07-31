import type { MediaAsset } from '@saha-textile/contracts';

import type { PageQuery, Paginated } from './pagination';

export interface MediaAssetFilter extends PageQuery {
	kind?: MediaAsset['kind'];
	status?: MediaAsset['status'];
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
	/** How many owners currently reference this asset; zero means it is an orphan. */
	countReferences(assetId: string): Promise<number>;
	/** Soft-deleted, unreferenced assets whose grace period has elapsed. */
	listOrphans(input: { deletedBefore: string; limit: number }): Promise<MediaAsset[]>;
	softDelete(assetId: string, at: string): Promise<void>;
	/** Hard delete — only for a GC'd orphan or an explicit privacy/legal purge. */
	hardDelete(assetId: string): Promise<void>;
}
