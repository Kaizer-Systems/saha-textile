import { ImageDecodeError } from '@saha-textile/core-domain';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { SharpImageCodec } from '../src/index.js';

const codec = new SharpImageCodec();

describe('the codec at its edges', () => {
	it('refuses a JPEG 2000 whose header ends before its size', async () => {
		// The JPEG 2000 signature box and nothing after it.
		const bytes = Uint8Array.of(0, 0, 0, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a);
		const error: unknown = await codec.probe(bytes).catch((thrown: unknown) => thrown);
		expect(error).toEqual(new ImageDecodeError('the upload is not a decodable image'));
		expect((error as Error).cause).toEqual(new ImageDecodeError('a jp2 file whose size cannot be read'));
	});

	it('draws an SVG with no size of its own at the size the drawing library gives it', async () => {
		const svg = new TextEncoder().encode(
			'<svg xmlns="http://www.w3.org/2000/svg"><rect width="40" height="20" fill="#c81e3c"/></svg>',
		);
		const meta = await sharp(svg).metadata();
		const probed = await codec.probe(svg);
		expect(probed.format).toBe('svg');
		// Drawn in the drawing library's own shape, larger.
		expect(probed.width / probed.height).toBeCloseTo((meta.width ?? 0) / (meta.height ?? 1), 2);
		expect(probed.width).toBeGreaterThan(meta.width ?? 0);
	});
});
