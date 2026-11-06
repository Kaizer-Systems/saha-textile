import { ImageDecodeError } from '@saha-textile/core-domain';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { SharpImageCodec } from '../src/index.js';

const codec = new SharpImageCodec();

const solid = () => sharp({ create: { width: 40, height: 30, channels: 4, background: '#c81e28' } });
const bytesOf = async (image: sharp.Sharp) => new Uint8Array(await image.toBuffer());

describe('SharpImageCodec formats', () => {
	it('names png with alpha and webp', async () => {
		expect(await codec.probe(await bytesOf(solid().png()))).toMatchObject({ format: 'png', hasAlpha: true });
		expect((await codec.probe(await bytesOf(solid().webp()))).format).toBe('webp');
	});

	it('names anything else other', async () => {
		expect((await codec.probe(await bytesOf(solid().gif()))).format).toBe('other');
	});

	it('refuses an image over the pixel limit', async () => {
		const small = new SharpImageCodec({ maxInputPixels: 10 });
		await expect(small.probe(await bytesOf(solid().png()))).rejects.toBeInstanceOf(ImageDecodeError);
	});

	it('falls back to a square box when no height is given', async () => {
		const source = await bytesOf(solid().jpeg());
		const cover = await codec.render(source, {
			width: 24,
			height: null,
			fit: 'cover',
			format: 'image/webp',
			quality: 80,
		});
		expect([cover.width, cover.height]).toEqual([24, 24]);
		const blur = await codec.render(source, {
			width: 24,
			height: null,
			fit: 'blur',
			format: 'image/webp',
			quality: 80,
		});
		expect([blur.width, blur.height]).toEqual([24, 24]);
		expect((await sharp(blur.bytes).metadata()).format).toBe('webp');
	});
});
