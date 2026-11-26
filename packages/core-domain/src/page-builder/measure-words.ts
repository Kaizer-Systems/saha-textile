import type { ImageAnalysisPort, WordSpotsRepository } from '../ports/image-analysis.port';
import type { MediaAssetRepository } from '../ports/media.repository';
import type { StoragePort } from '../ports/storage.port';
import { SPOT_BINS } from './words';

/**
 * The worker's job for the words check (Page Builder SG-1): one photo version's nine word spots, measured on its
 * widest file and kept on the version. A version already measured, gone or not ready is left alone; the job can run
 * twice with the same result.
 */
export async function measureWordSpots(
	deps: {
		assets: Pick<MediaAssetRepository, 'findById'>;
		storage: Pick<StoragePort, 'download'>;
		analysis: ImageAnalysisPort;
		spots: WordSpotsRepository;
	},
	job: { assetId: string; versionId: string },
): Promise<'measured' | 'skipped'> {
	const asset = await deps.assets.findById(job.assetId);
	const version = asset?.versions?.find((candidate) => candidate.id === job.versionId);
	if (!asset || asset.deletedAt || !version || version.state !== 'ready' || version.wordSpots) return 'skipped';
	const widest = asset.derivatives
		.filter((file) => file.versionId === job.versionId)
		.sort((a, b) => b.width - a.width)[0];
	if (!widest) return 'skipped';
	const bytes = await deps.storage.download(widest.storageKey);
	await deps.spots.setWordSpots(job.assetId, job.versionId, await deps.analysis.wordSpots(bytes, SPOT_BINS));
	return 'measured';
}
