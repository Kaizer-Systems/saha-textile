import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { SharpImageCodec } from '../src/sharp-image-codec';

const codec = new SharpImageCodec();

/** A 3:4 photo, 600 × 800: red on the top half, blue below; optionally stored on its side (EXIF 6). */
const photo = async (sideways = false) => {
	const top = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#ff0000' } })
		.png()
		.toBuffer();
	const upright = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#0000ff' } })
		.composite([{ input: top, left: 0, top: 0 }])
		.png()
		.toBuffer();
	// Stored turned a quarter left with orientation 6, so the viewer turns it back upright.
	return sideways
		? new Uint8Array(await sharp(upright).rotate(-90).jpeg().withMetadata({ orientation: 6 }).toBuffer())
		: new Uint8Array(await sharp(upright).jpeg({ quality: 95 }).toBuffer());
};

const colour = async (bytes: Uint8Array) => {
	const { channels } = await sharp(bytes).stats();
	return (channels[0]?.mean ?? 0) > (channels[2]?.mean ?? 0) ? 'red' : 'blue';
};

describe('a swatch cut (brief P11)', () => {
	it('cuts the square asked for at full resolution, as a JPEG', async () => {
		const bytes = await photo();
		const top = await codec.cut(bytes, { x: 0.25, y: 0.05, width: 300 / 600, height: 300 / 800 });
		expect([top.width, top.height]).toEqual([300, 300]);
		expect((await sharp(top.bytes).metadata()).format).toBe('jpeg');
		expect(await colour(top.bytes)).toBe('red');
		const bottom = await codec.cut(bytes, { x: 0.25, y: 0.6, width: 300 / 600, height: 300 / 800 });
		expect(await colour(bottom.bytes)).toBe('blue');
		expect(top.sha256).toMatch(/^[0-9a-f]{64}$/);
	});

	it('reads the square on the upright photo when it is stored on its side', async () => {
		const top = await codec.cut(await photo(true), { x: 0.25, y: 0.05, width: 300 / 600, height: 300 / 800 });
		expect([top.width, top.height]).toEqual([300, 300]);
		expect(await colour(top.bytes)).toBe('red');
	});

	it('refuses bytes that are not a picture', async () => {
		await expect(codec.cut(new Uint8Array([1, 2, 3]), { x: 0, y: 0, width: 1, height: 1 })).rejects.toThrow();
	});
});
