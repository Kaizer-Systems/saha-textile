import { readFileSync } from 'node:fs';

import { ImageDecodeError, type PhotoKind } from '@saha-textile/core-domain';
import { initializeCanvas, readPsd } from 'ag-psd';
import { decode as decodeBmp } from 'bmp-ts';
import decodeIco from 'decode-ico';
import sharp from 'sharp';

/**
 * Photo types the image library cannot read itself (media step 5, owner 16 Nov): JPEG XL, JPEG 2000, BMP, ICO and
 * PSD. Each is decoded to pixels here, in the worker only, and handed on as a lossless PNG that the rest of the
 * worker treats like any other photo. A file one of these cannot read fails as `ImageDecodeError`, so the photo is
 * kept as a plain file with a note.
 */
export const EXTRA_KINDS = ['jxl', 'jp2', 'bmp', 'ico', 'psd'] as const;
export type ExtraKind = (typeof EXTRA_KINDS)[number];

export const isExtraKind = (kind: PhotoKind | null): kind is ExtraKind =>
	kind !== null && (EXTRA_KINDS as readonly string[]).includes(kind);

/** Raw pixels: 8 or 16 bits a sample, 1, 3 or 4 samples a pixel. */
interface RawPicture {
	data: Uint8Array | Uint16Array;
	width: number;
	height: number;
	channels: 1 | 3 | 4;
}

/** The file decoded and written as a PNG the image library reads, with nothing lost. */
export async function decodeExtra(bytes: Uint8Array, kind: ExtraKind): Promise<Uint8Array> {
	try {
		const picture = await pixelsOf(bytes, kind);
		if (picture instanceof Uint8Array) return picture;
		const png = await sharp(picture.data, {
			raw: { width: picture.width, height: picture.height, channels: picture.channels },
		})
			.png({ compressionLevel: 1 })
			.toBuffer();
		return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
	} catch (error) {
		if (error instanceof ImageDecodeError) throw error;
		throw new ImageDecodeError(`the ${kind} decoder could not read this file`, error);
	}
}

/** Pixels, or (an ICO's PNG picture) bytes the image library already reads. */
async function pixelsOf(bytes: Uint8Array, kind: ExtraKind): Promise<RawPicture | Uint8Array> {
	switch (kind) {
		case 'jxl':
			return decodeJxl(bytes);
		case 'jp2':
			return decodeJp2(bytes);
		case 'bmp':
			return bmpPixels(bytes);
		case 'ico':
			return icoPicture(bytes);
		case 'psd':
			return psdPixels(bytes);
	}
}

// --- JPEG XL: libjxl built for WebAssembly (@jsquash/jxl) -------------------------------------------------------

/** What the decoder builds its answer with; Node has no ImageData of its own. */
class PlainImageData {
	constructor(
		readonly data: Uint8ClampedArray,
		readonly width: number,
		readonly height: number,
	) {}
}

type JxlDecode = (buffer: ArrayBuffer) => Promise<{ data: Uint8ClampedArray; width: number; height: number }>;
let jxlDecoder: Promise<JxlDecode> | null = null;

async function decodeJxl(bytes: Uint8Array): Promise<RawPicture> {
	jxlDecoder ??= (async () => {
		const scope = globalThis as { ImageData?: unknown };
		scope.ImageData ??= PlainImageData;
		const module = await import('@jsquash/jxl/decode.js');
		await module.init({ wasmBinary: readFileSync(require.resolve('@jsquash/jxl/codec/dec/jxl_dec.wasm')) });
		return module.default as JxlDecode;
	})();
	const decode = await jxlDecoder;
	const copy = bytes.slice().buffer;
	const image = await decode(copy);
	return {
		data: new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength),
		width: image.width,
		height: image.height,
		channels: 4,
	};
}

// --- JPEG 2000: OpenJPEG built for WebAssembly (@cornerstonejs/codec-openjpeg) ----------------------------------

interface J2KDecoder {
	getEncodedBuffer(length: number): Uint8Array;
	decode(): void;
	getFrameInfo(): { width: number; height: number; componentCount: number; bitsPerSample: number; isSigned: boolean };
	getDecodedBuffer(): Uint8Array;
	delete(): void;
}
interface OpenJpeg {
	J2KDecoder: new () => J2KDecoder;
}
type OpenJpegFactory = (options: {
	wasmBinary: Uint8Array;
	print: () => void;
	printErr: () => void;
}) => Promise<OpenJpeg>;
let openJpeg: Promise<OpenJpeg> | null = null;

/** The codestream inside a JP2 file's boxes (jp2c); a bare codestream as it is. */
function codestreamOf(bytes: Uint8Array): Uint8Array {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let at = 0; at + 8 <= bytes.length;) {
		const size = view.getUint32(at);
		const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
		if (type === 'jp2c') return bytes.subarray(at + 8, size ? at + size : bytes.length);
		if (size < 8) break;
		at += size;
	}
	return bytes;
}

async function decodeJp2(bytes: Uint8Array): Promise<RawPicture> {
	openJpeg ??= import('@cornerstonejs/codec-openjpeg/decodewasmjs').then(({ default: factory }) =>
		(factory as OpenJpegFactory)({
			wasmBinary: readFileSync(require.resolve('@cornerstonejs/codec-openjpeg/decodewasm')),
			print: () => undefined,
			printErr: () => undefined,
		}),
	);
	const codec = await openJpeg;
	const decoder = new codec.J2KDecoder();
	try {
		const stream = codestreamOf(bytes);
		decoder.getEncodedBuffer(stream.length).set(stream);
		try {
			decoder.decode();
		} catch (thrown) {
			// The decoder throws a bare number for what it does not take, such as a picture with see-through parts.
			throw new ImageDecodeError('a JPEG 2000 file this decoder does not take', thrown);
		}
		const { width, height, componentCount, bitsPerSample, isSigned } = decoder.getFrameInfo();
		if (componentCount !== 1 && componentCount !== 3) {
			throw new ImageDecodeError(`a JPEG 2000 file with ${componentCount} colour parts`);
		}
		// Copied out before the decoder's memory is freed.
		const decoded = decoder.getDecodedBuffer().slice();
		const channels = componentCount;
		if (bitsPerSample <= 8) {
			if (isSigned)
				for (let index = 0; index < decoded.length; index += 1) decoded[index] = (decoded[index] ?? 0) ^ 0x80;
			return { data: decoded, width, height, channels };
		}
		// 9 to 16 bits a sample, stored in two bytes each: stretched to 16 bits.
		const samples = new Uint16Array(decoded.buffer, decoded.byteOffset, decoded.byteLength / 2).slice();
		const shift = 16 - bitsPerSample;
		const offset = isSigned ? 1 << (bitsPerSample - 1) : 0;
		for (let index = 0; index < samples.length; index += 1) {
			const value = isSigned ? (((samples[index] ?? 0) << 16) >> 16) + offset : (samples[index] ?? 0);
			samples[index] = Math.max(0, Math.min(65535, value << shift));
		}
		return { data: samples, width, height, channels };
	} finally {
		decoder.delete();
	}
}

// --- BMP and ICO -----------------------------------------------------------------------------------------------

/** A BMP's pixels. A file with no see-through parts (24 bits and fewer, or every alpha 0) is drawn opaque. */
function bmpPixels(bytes: Uint8Array): RawPicture {
	const image = decodeBmp(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { toRGBA: true });
	const rgba = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
	return {
		data: opaqueUnlessSeeThrough(rgba, image.bitPP === 32),
		width: image.width,
		height: image.height,
		channels: 4,
	};
}

function opaqueUnlessSeeThrough(rgba: Uint8Array, mayHaveAlpha: boolean): Uint8Array {
	let seeThrough = false;
	if (mayHaveAlpha) for (let at = 3; at < rgba.length && !seeThrough; at += 4) seeThrough = rgba[at] !== 0;
	if (seeThrough) return rgba;
	const opaque = rgba.slice();
	for (let at = 3; at < opaque.length; at += 4) opaque[at] = 255;
	return opaque;
}

/** An ICO's largest picture: a PNG inside goes on as it is; a BMP inside as its pixels. */
function icoPicture(bytes: Uint8Array): RawPicture | Uint8Array {
	const pictures = decodeIco(bytes);
	const largest = [...pictures].sort((a, b) => b.width * b.height - a.width * a.height)[0];
	if (!largest) throw new ImageDecodeError('an ICO with no pictures in it');
	if (largest.type === 'png') return largest.data;
	return {
		data: new Uint8Array(largest.data.buffer, largest.data.byteOffset, largest.data.byteLength),
		width: largest.width,
		height: largest.height,
		channels: 4,
	};
}

// --- PSD: its flattened picture (ag-psd) --------------------------------------------------------------------------

let psdReady = false;
type MakeImageData = NonNullable<Parameters<typeof initializeCanvas>[1]>;

/** A PSD's flattened picture, which Photoshop saves with “Maximise compatibility”; layers are not drawn here. */
function psdPixels(bytes: Uint8Array): RawPicture {
	if (!psdReady) {
		// The worker has no canvas: pictures come back as plain pixel arrays instead.
		initializeCanvas(
			() => {
				throw new ImageDecodeError('this PSD needs drawing, which the worker does not do');
			},
			((width: number, height: number) =>
				new PlainImageData(
					new Uint8ClampedArray(width * height * 4),
					width,
					height,
				)) as unknown as MakeImageData,
		);
		psdReady = true;
	}
	const psd = readPsd(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
		skipLayerImageData: true,
		skipThumbnail: true,
		useImageData: true,
	});
	const image = psd.imageData;
	if (!image) throw new ImageDecodeError('a PSD saved without its flattened picture (Maximise compatibility off)');
	const data: unknown = image.data;
	if (data instanceof Uint16Array) return { data, width: image.width, height: image.height, channels: 4 };
	if (data instanceof Float32Array) {
		// A 32-bit PSD: 0–1 a sample, stretched to 16 bits.
		const samples = new Uint16Array(data.length);
		for (let index = 0; index < data.length; index += 1)
			samples[index] = Math.round(Math.max(0, Math.min(1, data[index] ?? 0)) * 65535);
		return { data: samples, width: image.width, height: image.height, channels: 4 };
	}
	if (!(data instanceof Uint8Array) && !(data instanceof Uint8ClampedArray))
		throw new ImageDecodeError('a PSD in a form this decoder does not give pixels for');
	return {
		data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
		width: image.width,
		height: image.height,
		channels: 4,
	};
}
