import type { SpotLuminance } from '@saha-textile/contracts';
import type { ImageAnalysisPort } from '@saha-textile/core-domain';
import sharp from 'sharp';

/** Width the picture is measured at: plenty for nine areas, and quick. */
const MEASURE_WIDTH = 360;

const linear = (value: number): number => {
	const c = value / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
/** WCAG relative luminance per 8-bit value, once. */
const LINEAR = Array.from({ length: 256 }, (_, value) => linear(value));

/**
 * The words check's measurement (Page Builder SG-1): the picture, flattened on white and turned upright, cut into
 * three rows of three spots; each spot's pixels counted into a WCAG relative-luminance histogram.
 */
export class SharpImageAnalysis implements ImageAnalysisPort {
	async wordSpots(bytes: Uint8Array, bins: number): Promise<SpotLuminance[]> {
		const { data, info } = await sharp(bytes)
			.rotate()
			.flatten({ background: '#ffffff' })
			.resize({ width: MEASURE_WIDTH, withoutEnlargement: true })
			.removeAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });
		const counts = Array.from({ length: 9 }, () => new Array<number>(bins).fill(0));
		const totals = new Array<number>(9).fill(0);
		const { width, height, channels } = info;
		for (let y = 0; y < height; y += 1) {
			const row = Math.min(2, Math.floor((y * 3) / height));
			for (let x = 0; x < width; x += 1) {
				const column = Math.min(2, Math.floor((x * 3) / width));
				const at = (y * width + x) * channels;
				const lum =
					0.2126 * (LINEAR[data[at] ?? 0] ?? 0) +
					0.7152 * (LINEAR[data[at + 1] ?? 0] ?? 0) +
					0.0722 * (LINEAR[data[at + 2] ?? 0] ?? 0);
				const spot = row * 3 + column;
				const bin = Math.min(bins - 1, Math.floor(lum * bins));
				const spotCounts = counts[spot] as number[];
				spotCounts[bin] = (spotCounts[bin] ?? 0) + 1;
				totals[spot] = (totals[spot] ?? 0) + 1;
			}
		}
		return counts.map((spot, index) => ({
			hist: spot.map((count) => Math.round((count / Math.max(1, totals[index] ?? 1)) * 10_000) / 10_000),
		}));
	}
}
