import type { MediaAsset } from '@saha-textile/contracts';

import type { MediaAssetRepository } from '../ports/media.repository';
import type { MediaJobQueuePort } from '../ports/media-job-queue.port';
import type { StoragePort } from '../ports/storage.port';
import { MEDIA_INGEST_POLICY } from './policy';
import { purgeAsset } from './garbage-collection';

export interface ReviewPhotoDeps {
	assets: MediaAssetRepository;
	storage: StoragePort;
	queue: MediaJobQueuePort;
}

export type ReviewPhotoRefusal = 'too_many' | 'not_found' | 'not_owned' | 'not_ready' | 'wrong_purpose';

/**
 * Checks the photos a customer attaches to a review: at most five, each a review photo
 * that THIS customer uploaded and that finished processing. Ownership is checked here, not
 * trusted from the client — an asset id is not a capability (BOLA).
 */
export const checkReviewPhotos = async (
	deps: Pick<ReviewPhotoDeps, 'assets'>,
	input: { customerId: string; assetIds: readonly string[] },
): Promise<{ refusal: ReviewPhotoRefusal | null; assets: MediaAsset[] }> => {
	if (input.assetIds.length > MEDIA_INGEST_POLICY.maxReviewPhotos) return { refusal: 'too_many', assets: [] };
	const unique = [...new Set(input.assetIds)];
	const assets = await deps.assets.findManyByIds(unique);
	if (assets.length !== unique.length) return { refusal: 'not_found', assets: [] };
	for (const asset of assets) {
		if (asset.purpose !== 'review') return { refusal: 'wrong_purpose', assets: [] };
		if (asset.uploadedBy?.type !== 'customer' || asset.uploadedBy.id !== input.customerId) {
			return { refusal: 'not_owned', assets: [] };
		}
		if (asset.processing.state !== 'ready') return { refusal: 'not_ready', assets: [] };
	}
	return { refusal: null, assets };
};

/**
 * Approval publishes a review's photos: each derivative's ACL flips to public-read and the
 * asset becomes public. They were never served before, so nothing is stale in any cache.
 */
export const publishReviewPhotos = async (deps: ReviewPhotoDeps, assetIds: readonly string[]): Promise<void> => {
	for (const asset of await deps.assets.findManyByIds(assetIds)) {
		if (asset.purpose !== 'review' || asset.visibility === 'public') continue;
		for (const derivative of asset.derivatives) await deps.storage.setVisibility(derivative.storageKey, 'public');
		await deps.assets.update({ ...asset, visibility: 'public', status: 'live' });
	}
};

/**
 * Rejection (or a purged product) removes a review's photos entirely — both derivatives,
 * any original still waiting, and the records. The review text and rating stay.
 */
export const discardReviewPhotos = async (deps: ReviewPhotoDeps, assetIds: readonly string[]): Promise<void> => {
	for (const asset of await deps.assets.findManyByIds(assetIds)) {
		if (asset.purpose !== 'review') continue;
		await purgeAsset(deps, asset);
	}
};
