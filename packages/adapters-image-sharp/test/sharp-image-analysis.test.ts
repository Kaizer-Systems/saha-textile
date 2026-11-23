import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { SharpImageAnalysis } from '../src/sharp-image-analysis';

/** A 300×300 picture: the top row of spots white, the middle black, the bottom half white and half black. */
async function picture(): Promise<Uint8Array> {
	const width = 300;
	const height = 300;
	const raw = Buffer.alloc(width * height * 3);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const white = y < 100 || (y >= 200 && x % 2 === 0);
			raw.fill(white ? 255 : 0, (y * width + x) * 3, (y * width + x) * 3 + 3);
		}
	}
	return sharp(raw, { raw: { width, height, channels: 3 } })
		.png()
		.toBuffer();
}

describe('the words check measurement (SG-1)', () => {
	it('gives nine spots, row by row, each a luminance histogram summing to one', async () => {
		const spots = await new SharpImageAnalysis().wordSpots(await picture(), 32);
		expect(spots).toHaveLength(9);
		for (const spot of spots) {
			expect(spot.hist).toHaveLength(32);
			expect(spot.hist.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 3);
		}
		// Top row white, middle row black.
		expect(spots[0]?.hist[31]).toBeCloseTo(1, 2);
		expect(spots[4]?.hist[0]).toBeCloseTo(1, 2);
		// Bottom row: about half and half.
		expect(spots[7]?.hist[0]).toBeGreaterThan(0.3);
		expect(spots[7]?.hist[31]).toBeGreaterThan(0.3);
	});

	it('flattens a transparent pixel onto white and leaves unsampled spots empty', async () => {
		const bytes = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#0000' } })
			.png()
			.toBuffer();
		const spots = await new SharpImageAnalysis().wordSpots(bytes, 2);
		expect(spots.map(({ hist }) => hist)).toEqual([[0, 1], ...Array.from({ length: 8 }, () => [0, 0])]);
	});
});
