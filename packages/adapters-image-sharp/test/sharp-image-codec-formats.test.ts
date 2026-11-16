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

	it('names AVIF and GIF, which the worker takes since media step 5, and anything else other', async () => {
		expect((await codec.probe(await bytesOf(solid().avif()))).format).toBe('avif');
		expect((await codec.probe(await bytesOf(solid().gif()))).format).toBe('gif');
		expect((await codec.probe(await bytesOf(solid().tiff()))).format).toBe('other');
	});

	it('makes versions from an animated GIF’s first frame, and from AVIF and WebP', async () => {
		const frames = sharp({ create: { width: 40, height: 90, channels: 4, background: '#c81e28' } });
		const animated = await bytesOf(frames.gif());
		for (const source of [animated, await bytesOf(solid().avif()), await bytesOf(solid().webp())]) {
			const out = await codec.render(source, {
				width: 20,
				height: 20,
				fit: 'cover',
				format: 'image/webp',
				quality: 80,
			} as never);
			expect(out.width).toBe(20);
		}
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

describe('SharpImageCodec share cards', () => {
	const photo = () =>
		bytesOf(
			sharp({ create: { width: 300, height: 400, channels: 3, background: { r: 200, g: 30, b: 40 } } }).jpeg(),
		);
	const pixel = async (bytes: Uint8Array, x: number, y: number) => {
		const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
		const at = (y * info.width + x) * info.channels;
		return [data[at], data[at + 1], data[at + 2]] as number[];
	};

	it('draws the tall card with an empty dark band above the whole photo', async () => {
		const card = await codec.render(await photo(), {
			width: 270,
			height: 480,
			fit: 'story',
			format: 'image/jpeg',
			quality: 90,
		});
		expect([card.width, card.height]).toEqual([270, 480]);
		const band = await pixel(card.bytes, 135, Math.round(480 * 0.18));
		expect(Math.max(...band)).toBeLessThan(80);
		const saree = await pixel(card.bytes, 135, Math.round(480 * 0.65));
		expect(saree[0]).toBeGreaterThan(150);
	});

	it('puts the logo on a white strip along the preview card’s foot', async () => {
		const logo = await bytesOf(
			sharp({
				create: { width: 400, height: 60, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } },
			}).png(),
		);
		const spec = { width: 240, height: 126, fit: 'blur', format: 'image/jpeg', quality: 90 } as const;
		const plain = await codec.render(await photo(), spec);
		const branded = await codec.render(await photo(), { ...spec, stripLogo: logo });
		expect(branded.sha256).not.toBe(plain.sha256);
		expect(Math.min(...(await pixel(branded.bytes, 4, 122)))).toBeGreaterThan(230);
		expect(Math.max(...(await pixel(branded.bytes, 200, 120)))).toBeLessThan(80);
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
