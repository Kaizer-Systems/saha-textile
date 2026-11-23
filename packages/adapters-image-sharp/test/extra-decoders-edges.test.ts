import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ImageDecodeError } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { decodeExtra } from '../src/extra-decoders';
import { SharpImageCodec } from '../src/index.js';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));

/**
 * The extra decoders on real files at their edges. gray-signed-8.jp2 was made with OpenJPEG's opj_compress
 * from raw pixels: 4 × 1, one 8-bit signed part holding −128, −64, 0 and 127 (`-F 4,1,1,8,s -n 1`).
 */
describe('the extra decoders at their edges', () => {
	it('refuses a signed 8-bit JPEG 2000, whose values below zero the decoder loses', async () => {
		// The decoder hands back 0, 0, 0, 127: drawn, the three different grays would all look the same.
		await expect(decodeExtra(fixture('gray-signed-8.jp2'), 'jp2')).rejects.toThrow(
			new ImageDecodeError('a signed 8-bit JPEG 2000 file, which this decoder reads wrongly'),
		);
		await expect(new SharpImageCodec().probe(fixture('gray-signed-8.jp2'))).rejects.toBeInstanceOf(
			ImageDecodeError,
		);
	});

	it('stops reading boxes at one too small to be a box, and refuses what is left: no colour parts', async () => {
		// A box that claims 4 bytes, then bytes the decoder reads as a picture with no colour parts at all.
		const bytes = Uint8Array.of(0, 0, 0, 4, 0x6a, 0x50, 0x20, 0x20, 1, 2, 3, 4);
		await expect(decodeExtra(bytes, 'jp2')).rejects.toThrow(
			new ImageDecodeError('a JPEG 2000 file with 0 colour parts'),
		);
	});

	it('names the decoder when a file is not what its name says', async () => {
		const error: unknown = await decodeExtra(Uint8Array.of(1, 2, 3, 4), 'psd').catch((thrown: unknown) => thrown);
		expect(error).toBeInstanceOf(ImageDecodeError);
		expect((error as Error).message).toBe('the psd decoder could not read this file');
		expect((error as Error).cause).toBeInstanceOf(Error);
	});
});
