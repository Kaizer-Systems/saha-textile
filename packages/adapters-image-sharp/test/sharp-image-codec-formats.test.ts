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

describe('SharpImageCodec logos', () => {
	const clear = () =>
		sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png();
	const spec = { width: 32, height: null, fit: 'inside', quality: 90 } as const;

	it('keeps a clear background in a PNG icon', async () => {
		const out = await codec.render(await bytesOf(clear()), { ...spec, format: 'image/png', keepAlpha: true });
		expect(await sharp(out.bytes).metadata()).toMatchObject({ format: 'png', hasAlpha: true });
	});

	it('keeps a clear background in a WebP logo', async () => {
		const out = await codec.render(await bytesOf(clear()), { ...spec, format: 'image/webp', keepAlpha: true });
		expect((await sharp(out.bytes).metadata()).hasAlpha).toBe(true);
	});

	it('still flattens anything else onto white', async () => {
		const out = await codec.render(await bytesOf(clear()), { ...spec, format: 'image/png' });
		const { data } = await sharp(out.bytes).raw().toBuffer({ resolveWithObject: true });
		expect(data[0]).toBe(255);
	});
});

