import type { SpotLuminance } from '@saha-textile/contracts';

/**
 * Picture analysis for the words-over-pictures check (Page Builder SG-1): the picture cut into nine spots (three
 * rows of three), each as a luminance histogram of `bins` bins. Implemented by the image adapter; core never decodes.
 */
export interface ImageAnalysisPort {
	wordSpots(bytes: Uint8Array, bins: number): Promise<SpotLuminance[]>;
}

/** Where a version's measured spots are kept (the photo's version record). */
export interface WordSpotsRepository {
	setWordSpots(assetId: string, versionId: string, spots: SpotLuminance[]): Promise<void>;
}
