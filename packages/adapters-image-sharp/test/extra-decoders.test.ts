import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ImageDecodeError } from '@saha-textile/core-domain';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { SharpImageCodec } from '../src/index.js';

/**
 * Media step 5 (owner, 16 Nov): JPEG XL, JPEG 2000, BMP, ICO and PSD through their decoders, and SVG drawn as a
 * picture. Every sample is a 120 × 80 red picture with a blue box in its top-left corner, so a test can tell the
 * decoded picture is the right way up.
 */
const codec = new SharpImageCodec();
const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));
const RED = { r: 200, g: 30, b: 60 };
const BLUE = { r: 30, g: 100, b: 200 };

/** A small PNG version, then the colours at the blue box and at the far corner. */
async function corners(bytes: Uint8Array) {
	const out = await codec.render(bytes, {
		width: 120,
		height: null,
		fit: 'inside',
		format: 'image/png',
		quality: 90,
	});
	const { data, info } = await sharp(out.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
	const at = (x: number, y: number) => {
		const i = (y * info.width + x) * 3;
		return { r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 };
	};
	return { box: at(8, 8), far: at(info.width - 8, info.height - 8), width: out.width, height: out.height };
}

const near = (colour: { r: number; g: number; b: number }, wanted: typeof RED) =>
	Math.abs(colour.r - wanted.r) < 24 && Math.abs(colour.g - wanted.g) < 24 && Math.abs(colour.b - wanted.b) < 24;

describe('photo types through the extra decoders (media step 5)', () => {
	it.each([
		['photo-120x80.jxl', 'jxl'],
		['photo-120x80.jp2', 'jp2'],
		['photo-120x80.psd', 'psd'],
		['photo-120x80.bmp', 'bmp'],
		['photo-120x80-24bit.bmp', 'bmp'],
	])('%s: named, measured and made into an upright version', async (name, format) => {
		const bytes = fixture(name);
		expect(await codec.probe(bytes)).toMatchObject({ width: 120, height: 80, format });
		const { box, far, width, height } = await corners(bytes);
		expect([width, height]).toEqual([120, 80]);
		expect(near(box, BLUE), `${name} box ${JSON.stringify(box)}`).toBe(true);
		expect(near(far, RED), `${name} corner ${JSON.stringify(far)}`).toBe(true);
	});

	it('a 24-bit BMP is drawn opaque, not as a see-through picture laid on white', async () => {
		const { far } = await corners(fixture('photo-120x80-24bit.bmp'));
		expect(near(far, RED)).toBe(true);
	});

	it('an ICO gives its largest picture, a PNG inside or a BMP inside', async () => {
		const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: { ...BLUE, alpha: 1 } } })
			.png()
			.toBuffer();
		const bmp = new Uint8Array(40 + 16 * 16 * 4 + 16 * 4);
		const dib = new DataView(bmp.buffer);
		dib.setUint32(0, 40, true);
		dib.setInt32(4, 16, true);
		dib.setInt32(8, 32, true);
		dib.setUint16(12, 1, true);
		dib.setUint16(14, 32, true);
		for (let at = 40; at < 40 + 16 * 16 * 4; at += 4) bmp.set([RED.b, RED.g, RED.r, 255], at);
		const header = new Uint8Array(6 + 32);
		const view = new DataView(header.buffer);
		view.setUint16(2, 1, true);
		view.setUint16(4, 2, true);
		const entry = (index: number, size: number, length: number, offset: number) => {
			header[6 + index * 16] = size;
			header[7 + index * 16] = size;
			view.setUint32(6 + index * 16 + 8, length, true);
			view.setUint32(6 + index * 16 + 12, offset, true);
		};
		entry(0, 16, bmp.length, header.length);
		entry(1, 64, png.length, header.length + bmp.length);
		const ico = new Uint8Array([...header, ...bmp, ...png]);
		expect(await codec.probe(ico)).toMatchObject({ width: 64, height: 64, format: 'ico' });
		const { box } = await corners(ico);
		expect(near(box, BLUE)).toBe(true);
	});

	it('an SVG is drawn 4096 px on its long edge, in its own shape, and named svg', async () => {
		const svg = new TextEncoder().encode(
			'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12"><rect width="24" height="12" fill="#c81e3c"/><rect width="6" height="4" fill="#1e64c8"/></svg>',
		);
		expect(await codec.probe(svg)).toMatchObject({ width: 4096, height: 2048, format: 'svg' });
		const { box, far } = await corners(svg);
		expect(near(box, BLUE)).toBe(true);
		expect(near(far, RED)).toBe(true);
	});

	it('refuses a JPEG 2000 the decoder does not take, so the photo is kept as a file', async () => {
		await expect(codec.probe(fixture('photo-120x80-alpha.jp2'))).rejects.toBeInstanceOf(ImageDecodeError);
	});

	it('refuses a file whose header asks for more pixels than the limit, before decoding it', async () => {
		const bomb = new Uint8Array(54);
		bomb.set([0x42, 0x4d]);
		const view = new DataView(bomb.buffer);
		view.setUint32(14, 40, true);
		view.setInt32(18, 20_000, true);
		view.setInt32(22, 20_000, true);
		view.setUint16(26, 1, true);
		view.setUint16(28, 24, true);
		await expect(codec.probe(bomb)).rejects.toBeInstanceOf(ImageDecodeError);
	});
});
