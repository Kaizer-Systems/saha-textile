import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { SharpImageCodec, focalWindow } from '../src/sharp-image-codec';

const codec = new SharpImageCodec();

/** A 2:1 picture, red on the left half and blue on the right. */
const halves = async () => {
	const left = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#ff0000' } })
		.png()
		.toBuffer();
	return sharp({ create: { width: 800, height: 400, channels: 3, background: '#0000ff' } })
		.composite([{ input: left, left: 0, top: 0 }])
		.jpeg()
		.toBuffer();
};

const meanColour = async (bytes: Uint8Array) => {
	const { channels } = await sharp(bytes).stats();
	return { r: channels[0]?.mean ?? 0, b: channels[2]?.mean ?? 0 };
};

describe('a crop with a focal point (S10, media step 3c)', () => {
	it('keeps the part around the point: left gives red, right gives blue, nothing gives the middle', async () => {
		const bytes = new Uint8Array(await halves());
		const square = { width: 200, height: 200, fit: 'cover' as const, format: 'image/jpeg' as const, quality: 90 };
		const left = await meanColour((await codec.render(bytes, { ...square, focal: { x: 0.1, y: 0.5 } })).bytes);
		const right = await meanColour((await codec.render(bytes, { ...square, focal: { x: 0.9, y: 0.5 } })).bytes);
		const middle = await meanColour((await codec.render(bytes, square)).bytes);
		expect(left.r).toBeGreaterThan(240);
		expect(left.b).toBeLessThan(15);
		expect(right.b).toBeGreaterThan(240);
		expect(right.r).toBeLessThan(15);
		// Centred: half red, half blue.
		expect(middle.r).toBeGreaterThan(90);
		expect(middle.b).toBeGreaterThan(90);
	});

	it('the window is the box’s shape, centred on the point and kept inside the photo', async () => {
		const bytes = new Uint8Array(await halves());
		expect(await focalWindow(bytes, { width: 300, height: 300, focal: { x: 0.5, y: 0.5 } })).toEqual({
			left: 200,
			top: 0,
			width: 400,
			height: 400,
		});
		expect(await focalWindow(bytes, { width: 300, height: 300, focal: { x: 0, y: 0 } })).toMatchObject({ left: 0 });
		expect(await focalWindow(bytes, { width: 300, height: 300, focal: { x: 1, y: 1 } })).toMatchObject({
			left: 400,
		});
		// A wider box than the photo: the full width, the band around the point.
		expect(await focalWindow(bytes, { width: 400, height: 100, focal: { x: 0.5, y: 0.9 } })).toEqual({
			left: 0,
			top: 200,
			width: 800,
			height: 200,
		});
	});
});
