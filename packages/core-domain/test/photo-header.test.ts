import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
	PHOTO_FILE_ENDINGS,
	PHOTO_KIND_TYPES,
	SVG_RASTER_LONG_EDGE,
	bytesReader,
	measureFromHeader,
	photoKindOf,
	sniffPhotoKind,
	svgRasterSize,
	svgSize,
	type PhotoKind,
} from '../src/catalog/photo-header';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'photo-header', name)));
const text = (value: string) => new TextEncoder().encode(value);
const measure = (bytes: Uint8Array, kind: PhotoKind) => measureFromHeader(bytesReader(bytes), kind);

/** An ICO header with one directory line per picture: [width byte, height byte, the picture's first bytes]. */
function ico(pictures: [number, number, Uint8Array][]): Uint8Array {
	const header = new Uint8Array(6 + pictures.length * 16);
	const view = new DataView(header.buffer);
	view.setUint16(2, 1, true);
	view.setUint16(4, pictures.length, true);
	let offset = header.length;
	pictures.forEach(([width, height, body], index) => {
		header[6 + index * 16] = width;
		header[7 + index * 16] = height;
		view.setUint32(6 + index * 16 + 8, body.length, true);
		view.setUint32(6 + index * 16 + 12, offset, true);
		offset += body.length;
	});
	const out = new Uint8Array(offset);
	out.set(header);
	let at = header.length;
	for (const [, , body] of pictures) {
		out.set(body, at);
		at += body.length;
	}
	return out;
}

/** The start of a PNG: its signature and IHDR with the size. */
function pngHead(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(24);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
	new DataView(bytes.buffer).setUint32(16, width);
	new DataView(bytes.buffer).setUint32(20, height);
	return bytes;
}

describe('sniffPhotoKind — a photo by its first bytes, whatever its name says (media step 5)', () => {
	it('knows every type the Media page takes, and each one’s type for the API', () => {
		expect(sniffPhotoKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
		expect(sniffPhotoKind(pngHead(1, 1))).toBe('png');
		expect(sniffPhotoKind(text('GIF89a....'))).toBe('gif');
		expect(sniffPhotoKind(text('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
		for (const name of [
			'photo-120x80.jxl',
			'photo-120x80.jp2',
			'photo-120x80.psd',
			'photo-120x80.bmp',
			'photo-120x80.tiff',
		]) {
			const kind = sniffPhotoKind(fixture(name));
			expect(kind, name).toBe(name.split('.').pop() === 'tiff' ? 'tiff' : name.split('.').pop());
		}
		expect(sniffPhotoKind(ico([[16, 16, pngHead(16, 16)]]))).toBe('ico');
		expect(PHOTO_KIND_TYPES.psd).toBe('image/vnd.adobe.photoshop');
		expect(PHOTO_KIND_TYPES.ico).toBe('image/x-icon');
	});

	it('tells AVIF from HEIC by its brands, even when AVIF names itself mif1 first', () => {
		const ftyp = (major: string, ...compatible: string[]) => {
			const body = text(`....ftyp${major}\0\0\0\0${compatible.join('')}`);
			new DataView(body.buffer).setUint32(0, body.length);
			return body;
		};
		expect(sniffPhotoKind(ftyp('avif', 'mif1', 'miaf'))).toBe('avif');
		expect(sniffPhotoKind(ftyp('mif1', 'miaf', 'avif'))).toBe('avif');
		expect(sniffPhotoKind(ftyp('heic', 'mif1'))).toBe('heic');
		expect(sniffPhotoKind(ftyp('mp42', 'isom'))).toBeNull();
	});

	it('finds an SVG after an XML line, a comment or a doctype, and nothing in other text', () => {
		expect(sniffPhotoKind(text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('svg');
		expect(
			sniffPhotoKind(
				text(
					'﻿<?xml version="1.0"?>\n<!-- made by hand -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">\n<svg>',
				),
			),
		).toBe('svg');
		expect(sniffPhotoKind(text('<html><body><svg></svg></body></html>'))).toBeNull();
		expect(sniffPhotoKind(text('%PDF-1.7'))).toBeNull();
		expect(sniffPhotoKind(new Uint8Array(0))).toBeNull();
	});
});

describe('measureFromHeader — the upright size, without opening the picture', () => {
	it('reads JPEG XL in all three ways it stores a size', async () => {
		expect(await measure(fixture('photo-120x80.jxl'), 'jxl')).toEqual({ width: 120, height: 80 });
		expect(await measure(fixture('photo-1201x800.jxl'), 'jxl')).toEqual({ width: 1201, height: 800 });
		expect(await measure(fixture('photo-333x222.jxl'), 'jxl')).toEqual({ width: 333, height: 222 });
	});

	it('reads JPEG 2000, PSD, BMP and TIFF, and turns a TIFF stored on its side upright', async () => {
		expect(await measure(fixture('photo-120x80.jp2'), 'jp2')).toEqual({ width: 120, height: 80 });
		expect(await measure(fixture('photo-120x80.psd'), 'psd')).toEqual({ width: 120, height: 80 });
		expect(await measure(fixture('photo-120x80.bmp'), 'bmp')).toEqual({ width: 120, height: 80 });
		expect(await measure(fixture('photo-120x80.tiff'), 'tiff')).toEqual({ width: 120, height: 80 });
		expect(await measure(fixture('photo-120x80-orientation-6.tiff'), 'tiff')).toEqual({ width: 80, height: 120 });
	});

	it('reads a bare JPEG 2000 codestream from its SIZ marker, less its offset', async () => {
		const stream = new Uint8Array(24);
		stream.set([0xff, 0x4f, 0xff, 0x51]);
		const view = new DataView(stream.buffer);
		view.setUint32(8, 1300);
		view.setUint32(12, 900);
		view.setUint32(16, 100);
		view.setUint32(20, 100);
		expect(await measure(stream, 'jp2')).toEqual({ width: 1200, height: 800 });
	});

	it('takes an ICO’s largest picture, a 256 px line written as 0, and a PNG inside by its own size', async () => {
		expect(
			await measure(
				ico([
					[16, 16, pngHead(16, 16)],
					[0, 0, new Uint8Array(40)],
				]),
				'ico',
			),
		).toEqual({ width: 256, height: 256 });
		expect(
			await measure(
				ico([
					[32, 32, new Uint8Array(40)],
					[0, 0, pngHead(512, 512)],
				]),
				'ico',
			),
		).toEqual({
			width: 512,
			height: 512,
		});
	});

	it('gives null for a broken header, and for a type it does not measure', async () => {
		expect(await measure(new Uint8Array([0xff, 0x0a]), 'jxl')).toBeNull();
		expect(await measure(text('8BPS'), 'psd')).toBeNull();
		expect(await measure(fixture('photo-120x80.bmp'), 'jpeg')).toBeNull();
	});

	it('reads a TIFF through a reader that only hands out slices, as the browser does', async () => {
		const bytes = fixture('photo-120x80.tiff');
		const asked: number[] = [];
		const reader = {
			size: bytes.length,
			read: async (offset: number, length: number) => {
				asked.push(length);
				return bytes.slice(offset, offset + length);
			},
		};
		expect(await measureFromHeader(reader, 'tiff')).toEqual({ width: 120, height: 80 });
		expect(Math.max(...asked)).toBeLessThan(bytes.length);
	});
});

describe('SVG sizes — its own size, then the picture made from it', () => {
	it('reads width and height in any absolute unit, or the viewBox, or one of them with the viewBox', () => {
		expect(svgSize('<svg width="300" height="150">')).toEqual({ width: 300, height: 150 });
		expect(svgSize('<svg width="2in" height="1in">')).toEqual({ width: 192, height: 96 });
		expect(svgSize('<svg width="100%" height="100%" viewBox="0 0 640 480">')).toEqual({ width: 640, height: 480 });
		expect(svgSize(`<svg viewBox='0,0,24,12' width='48'>`)).toEqual({ width: 48, height: 24 });
		expect(svgSize('<svg>')).toBeNull();
		expect(svgSize('<html>')).toBeNull();
	});

	it('is made into a picture with the long edge at 4096 px, small icons included', async () => {
		expect(svgRasterSize({ width: 24, height: 12 })).toEqual({ width: SVG_RASTER_LONG_EDGE, height: 2048 });
		expect(svgRasterSize({ width: 1000, height: 3000 })).toEqual({ width: 1365, height: 4096 });
		expect(await measure(text('<?xml version="1.0"?><svg viewBox="0 0 100 50"></svg>'), 'svg')).toEqual({
			width: 4096,
			height: 2048,
		});
	});
});

describe('photoKindOf — the kind before a byte is read', () => {
	it('goes by the type the computer gave, its other names included, else by the name for a file with no type', () => {
		expect(photoKindOf('image/vnd.microsoft.icon', 'favicon.ico')).toBe('ico');
		expect(photoKindOf('image/x-ms-bmp', 'scan.bmp')).toBe('bmp');
		expect(photoKindOf('application/x-photoshop', 'cover.psd')).toBe('psd');
		expect(photoKindOf('', 'Saree.JXL')).toBe('jxl');
		expect(photoKindOf('application/octet-stream', 'archive.jp2')).toBe('jp2');
		expect(photoKindOf('', 'brief.pdf')).toBeNull();
		// A type that names something else wins over the name.
		expect(photoKindOf('application/pdf', 'brief.jpg')).toBeNull();
		expect(PHOTO_FILE_ENDINGS).toContain('.psd');
	});
});
