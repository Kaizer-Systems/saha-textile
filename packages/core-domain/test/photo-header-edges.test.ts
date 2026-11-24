import { describe, expect, it } from 'vitest';

import {
	bytesReader,
	measureFromHeader,
	photoKindOf,
	sniffPhotoKind,
	svgSize,
	type PhotoKind,
} from '../src/catalog/photo-header';

const text = (value: string) => new TextEncoder().encode(value);
const measure = (bytes: Uint8Array, kind: PhotoKind) => measureFromHeader(bytesReader(bytes), kind);
const concat = (...parts: Array<Uint8Array | number[] | string>): Uint8Array => {
	const arrays = parts.map((part) => (typeof part === 'string' ? text(part) : Uint8Array.from(part)));
	const out = new Uint8Array(arrays.reduce((sum, part) => sum + part.length, 0));
	let at = 0;
	for (const part of arrays) {
		out.set(part, at);
		at += part.length;
	}
	return out;
};
const be32 = (value: number) => {
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setUint32(0, value, false);
	return bytes;
};
const be64 = (value: number) => {
	const bytes = new Uint8Array(8);
	new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false);
	return bytes;
};

describe('photo kinds: the remaining cases', () => {
	it('gives no kind to a file with neither a type nor a name ending', () => {
		expect(photoKindOf('', 'photo')).toBeNull();
	});

	it('knows BigTIFF either way round and a large Photoshop file', () => {
		expect(sniffPhotoKind(new Uint8Array([0x49, 0x49, 0x2b, 0x00]))).toBe('tiff');
		expect(sniffPhotoKind(new Uint8Array([0x4d, 0x4d, 0x00, 0x2b]))).toBe('tiff');
		expect(sniffPhotoKind(concat('8BPS', [0, 2]))).toBe('psd');
		expect(sniffPhotoKind(concat('8BPS', [0, 3]))).toBeNull();
	});

	it('reads numbers past the end of a short head as nothing', () => {
		expect(sniffPhotoKind(new Uint8Array([0x00, 0x00, 0x01, 0x00]))).toBeNull();
		expect(sniffPhotoKind(text('BM'))).toBeNull();
	});
});

describe('photo sizes from headers: the remaining cases', () => {
	it('measures an old OS/2 bitmap, and nothing for a kind a browser opens itself', async () => {
		const bmp = new Uint8Array(26);
		bmp.set(text('BM'));
		const view = new DataView(bmp.buffer);
		view.setUint32(14, 12, true);
		view.setUint16(18, 300, true);
		view.setUint16(20, 200, true);
		expect(sniffPhotoKind(bmp)).toBe('bmp');
		expect(await measure(bmp, 'bmp')).toEqual({ width: 300, height: 200 });
		expect(await measure(bmp, 'jpeg')).toBeNull();
	});

	it('measures a turned BigTIFF from its 64-bit directory', async () => {
		const bytes = new Uint8Array(16 + 8 + 3 * 20);
		const view = new DataView(bytes.buffer);
		bytes.set([0x49, 0x49]);
		view.setUint16(2, 43, true);
		view.setUint16(4, 8, true);
		view.setBigUint64(8, 16n, true);
		view.setBigUint64(16, 3n, true);
		const entry = (index: number, tag: number, type: number, value: number) => {
			const at = 24 + index * 20;
			view.setUint16(at, tag, true);
			view.setUint16(at + 2, type, true);
			view.setBigUint64(at + 4, 1n, true);
			if (type === 3) view.setUint16(at + 12, value, true);
			else view.setUint32(at + 12, value, true);
		};
		entry(0, 256, 3, 640);
		entry(1, 257, 4, 480);
		entry(2, 274, 3, 6);
		expect(await measure(bytes, 'tiff')).toEqual({ width: 480, height: 640 });
	});

	it('keeps an icon’s largest picture when a smaller one follows', async () => {
		const header = new Uint8Array(6 + 2 * 16);
		const view = new DataView(header.buffer);
		view.setUint16(2, 1, true);
		view.setUint16(4, 2, true);
		[32, 16].forEach((side, index) => {
			header[6 + index * 16] = side;
			header[7 + index * 16] = side;
			view.setUint32(6 + index * 16 + 12, header.length + index * 24, true);
		});
		expect(await measure(concat(header, new Uint8Array(48)), 'ico')).toEqual({ width: 32, height: 32 });
	});

	it('walks JPEG 2000 boxes with a 64-bit length and a last box that runs to the end', async () => {
		const signature = [0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a];
		const stream = concat([0xff, 0x4f, 0xff, 0x51, 0, 0, 0, 0], be32(800), be32(600), be32(0), be32(0));
		const bytes = concat(signature, be32(1), 'free', be64(24), new Uint8Array(8), be32(0), 'jp2c', stream);
		expect(await measure(bytes, 'jp2')).toEqual({ width: 800, height: 600 });
	});

	it('gives up on a JPEG 2000 box too short to be one, or a file with no picture box', async () => {
		const signature = [0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a];
		expect(await measure(concat(signature, be32(4), 'junk'), 'jp2')).toBeNull();
		expect(await measure(concat(signature), 'jp2')).toBeNull();
	});
});

/** A JPEG XL codestream: its signature, then the fields written lowest bit first. */
function jxlStream(fields: Array<[value: number, count: number]>): Uint8Array {
	const bits = fields.flatMap(([value, count]) => Array.from({ length: count }, (_, index) => (value >> index) & 1));
	const out = new Uint8Array(2 + Math.ceil(bits.length / 8) + 4);
	out.set([0xff, 0x0a]);
	bits.forEach((bit, position) => {
		out[2 + (position >> 3)] = (out[2 + (position >> 3)] as number) | (bit << (position & 7));
	});
	return out;
}

const JXL_CONTAINER = [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a];
// 16 high (divisible by 8), 3:2, then metadata that is not all default.
const turned = jxlStream([
	[1, 1],
	[1, 5],
	[4, 3],
	[0, 1],
	[1, 1],
	[5, 3],
]);
const upright = jxlStream([
	[1, 1],
	[1, 5],
	[4, 3],
	[0, 1],
	[0, 1],
]);

describe('JPEG XL sizes: orientation and the container', () => {
	it('turns a picture whose orientation says so, and leaves one without extra fields upright', async () => {
		expect(await measure(turned, 'jxl')).toEqual({ width: 16, height: 24 });
		expect(await measure(upright, 'jxl')).toEqual({ width: 24, height: 16 });
	});

	it('finds the codestream in a jxlc box or the first jxlp box', async () => {
		const jxlc = concat(JXL_CONTAINER, be32(8 + upright.length), 'jxlc', upright);
		const jxlp = concat(JXL_CONTAINER, be32(12 + upright.length), 'jxlp', be32(0), upright);
		expect(await measure(jxlc, 'jxl')).toEqual({ width: 24, height: 16 });
		expect(await measure(jxlp, 'jxl')).toEqual({ width: 24, height: 16 });
	});

	it('gives up on a container with no codestream or a box too short to be one', async () => {
		expect(await measure(concat(JXL_CONTAINER, be32(20), 'ftyp', 'jxl ', be32(0), 'jxl '), 'jxl')).toBeNull();
		expect(await measure(concat(JXL_CONTAINER, be32(0), 'junk'), 'jxl')).toBeNull();
	});
});

describe('SVG sizes: the remaining cases', () => {
	it('makes nothing of an SVG with no size at all', async () => {
		expect(await measure(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'svg')).toBeNull();
	});

	it('ignores an unknown unit and fills the width from the height and the view box', () => {
		expect(svgSize('<svg width="10em" height="50" viewBox="0 0 100 50">')).toEqual({ width: 100, height: 50 });
		expect(svgSize('<svg width="10em" height="50">')).toBeNull();
		expect(svgSize('<svg width="10em" height="50" viewBox="0 0 100 0">')).toBeNull();
	});
});
