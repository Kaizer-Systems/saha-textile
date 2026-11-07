import { ImageDecodeError } from '@saha-textile/core-domain';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { SharpImageCodec } from '../src/index.js';

const codec = new SharpImageCodec();

/** A real JPEG, generated in memory: a red 3:4 rectangle. */
const jpeg = async (width: number, height: number, orientation?: number) => {
	let image = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 40 } } }).jpeg();
	if (orientation) image = image.withMetadata({ orientation });
	return new Uint8Array(await image.toBuffer());
};

describe('SharpImageCodec', () => {
	it('probes real dimensions and format', async () => {
		expect(await codec.probe(await jpeg(300, 400))).toEqual({
			width: 300,
			height: 400,
			format: 'jpeg',
			hasAlpha: false,
		});
	});

	it('reports upright dimensions for a rotated phone photo', async () => {
		const probe = await codec.probe(await jpeg(400, 300, 6));
		expect([probe.width, probe.height]).toEqual([300, 400]);
	});

	it('refuses bytes that are not an image', async () => {
		await expect(codec.probe(new TextEncoder().encode('%PDF-1.7 not an image'))).rejects.toBeInstanceOf(
			ImageDecodeError,
		);
	});

	it('renders inside, cover and pad to the spec and hashes the output', async () => {
		const source = await jpeg(600, 800);
		const inside = await codec.render(source, {
			width: 200,
			height: null,
			fit: 'inside',
			format: 'image/webp',
			quality: 80,
		});
		expect([inside.width, inside.height]).toEqual([200, 267]);
		expect(inside.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect((await sharp(inside.bytes).metadata()).format).toBe('webp');

		const cover = await codec.render(source, {
			width: 160,
			height: 160,
			fit: 'cover',
			format: 'image/webp',
			quality: 80,
		});
		expect([cover.width, cover.height]).toEqual([160, 160]);

		const pad = await codec.render(source, {
			width: 1200,
			height: 630,
			fit: 'pad',
			format: 'image/jpeg',
			quality: 84,
		});
		expect([pad.width, pad.height]).toEqual([1200, 630]);
		expect((await sharp(pad.bytes).metadata()).format).toBe('jpeg');
	});

	it('renders the blur fill at the exact box size, photo uncropped in the middle', async () => {
		const out = await codec.render(await jpeg(600, 800), {
			width: 1200,
			height: 630,
			fit: 'blur',
			format: 'image/jpeg',
			quality: 84,
		});
		expect([out.width, out.height]).toEqual([1200, 630]);
		// The centre column is the photo (the red source); the far edge is the darkened backdrop.
		const raw = await sharp(out.bytes).raw().toBuffer({ resolveWithObject: true });
		const at = (x: number, y: number) => raw.data[(y * raw.info.width + x) * raw.info.channels] ?? 0;
		expect(at(600, 315)).toBeGreaterThan(at(5, 315));
	});

	it('strips metadata from every output', async () => {
		const out = await codec.render(await jpeg(600, 800, 6), {
			width: 300,
			height: null,
			fit: 'inside',
			format: 'image/jpeg',
			quality: 80,
		});
		const meta = await sharp(out.bytes).metadata();
		expect(meta.exif).toBeUndefined();
		expect(meta.orientation ?? 1).toBe(1);
	});

	it('computes a ThumbHash and the dominant colour', async () => {
		const { thumbHash, dominantColor } = await codec.placeholder(await jpeg(300, 400));
		expect(Buffer.from(thumbHash, 'base64').length).toBeGreaterThan(5);
		expect(dominantColor).toMatch(/^#[0-9a-f]{6}$/);
		expect(parseInt(dominantColor.slice(1, 3), 16)).toBeGreaterThan(150);
	});
});
