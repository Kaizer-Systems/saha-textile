/**
 * A photo's type and size, read from its first bytes (media step 5, owner 16 Nov). The upload popup measures the types
 * a browser cannot open (TIFF, SVG, JPEG XL, JPEG 2000, BMP, ICO, PSD) so it can suggest profiles and give its notes,
 * and the image worker reads a file's size before it decodes one. Browser-safe: no imports
 * (`@saha-textile/core-domain/photo-header`).
 */

/** Every photo type the Media page knows by its bytes. HEIC is turned into a JPEG in the browser before upload. */
export type PhotoKind =
	'jpeg' | 'png' | 'gif' | 'webp' | 'avif' | 'heic' | 'tiff' | 'svg' | 'bmp' | 'ico' | 'jxl' | 'jp2' | 'psd';

/** Each kind's type as the API takes it, whatever name or type the computer gave the file. */
export const PHOTO_KIND_TYPES: Readonly<Record<PhotoKind, string>> = {
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	heic: 'image/heic',
	tiff: 'image/tiff',
	svg: 'image/svg+xml',
	bmp: 'image/bmp',
	ico: 'image/x-icon',
	jxl: 'image/jxl',
	jp2: 'image/jp2',
	psd: 'image/vnd.adobe.photoshop',
};

/** The types browsers and computers give these photos, each to its kind. */
const TYPE_KINDS: Readonly<Record<string, PhotoKind>> = {
	'image/jpeg': 'jpeg',
	'image/jpg': 'jpeg',
	'image/pjpeg': 'jpeg',
	'image/png': 'png',
	'image/x-png': 'png',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/avif': 'avif',
	'image/heic': 'heic',
	'image/heif': 'heic',
	'image/heic-sequence': 'heic',
	'image/heif-sequence': 'heic',
	'image/tiff': 'tiff',
	'image/tif': 'tiff',
	'image/x-tiff': 'tiff',
	'image/svg+xml': 'svg',
	'image/bmp': 'bmp',
	'image/x-bmp': 'bmp',
	'image/x-ms-bmp': 'bmp',
	'image/x-icon': 'ico',
	'image/vnd.microsoft.icon': 'ico',
	'image/ico': 'ico',
	'image/jxl': 'jxl',
	'image/jp2': 'jp2',
	'image/jpx': 'jp2',
	'image/jpm': 'jp2',
	'image/vnd.adobe.photoshop': 'psd',
	'image/x-photoshop': 'psd',
	'image/photoshop': 'psd',
	'image/psd': 'psd',
	'application/x-photoshop': 'psd',
	'application/photoshop': 'psd',
	'application/psd': 'psd',
};

/** File name endings, for a file the computer gave no type (or only “some bytes”). */
const EXTENSION_KINDS: Readonly<Record<string, PhotoKind>> = {
	jpg: 'jpeg',
	jpeg: 'jpeg',
	jpe: 'jpeg',
	jfif: 'jpeg',
	png: 'png',
	gif: 'gif',
	webp: 'webp',
	avif: 'avif',
	heic: 'heic',
	heif: 'heic',
	tif: 'tiff',
	tiff: 'tiff',
	svg: 'svg',
	bmp: 'bmp',
	dib: 'bmp',
	ico: 'ico',
	jxl: 'jxl',
	jp2: 'jp2',
	j2k: 'jp2',
	j2c: 'jp2',
	jpf: 'jp2',
	jpx: 'jp2',
	jpm: 'jp2',
	psd: 'psd',
};

/**
 * A photo's kind from the type the computer gave it, or from its name when it gave none: what the upload popup knows
 * before reading a byte. The first bytes (`sniffPhotoKind`) have the last word.
 */
export function photoKindOf(type: string, name: string): PhotoKind | null {
	const byType = TYPE_KINDS[type.toLowerCase()];
	if (byType) return byType;
	if (type && type !== 'application/octet-stream') return null;
	const ending = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
	return EXTENSION_KINDS[ending] ?? null;
}

/** File name endings of every photo type, for a file chooser's list of what it takes. */
export const PHOTO_FILE_ENDINGS: readonly string[] = Object.keys(EXTENSION_KINDS).map((ending) => `.${ending}`);

/** Kinds a browser cannot be relied on to open: their size comes from their header. */
export const HEADER_MEASURED_KINDS: readonly PhotoKind[] = ['tiff', 'svg', 'bmp', 'ico', 'jxl', 'jp2', 'psd'];

/** How much of a file `sniffPhotoKind` needs: an SVG may open with a long comment or doctype. */
export const SNIFF_BYTES = 4096;

/** An SVG is made into a picture this long on its long edge, so every version size can be made from it. */
export const SVG_RASTER_LONG_EDGE = 4096;

export interface PhotoSize {
	width: number;
	height: number;
}

const ascii = (bytes: Uint8Array, from: number, length: number): string =>
	String.fromCharCode(...bytes.subarray(from, from + length));

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0): boolean =>
	prefix.every((byte, index) => bytes[at + index] === byte);

const JP2_SIGNATURE = [0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a];
const JXL_CONTAINER = [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a];
const HEIC_BRANDS = /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/;

/** What a picked file's first bytes say it is; null for anything that is not one of these photo types. */
export function sniffPhotoKind(head: Uint8Array): PhotoKind | null {
	if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpeg';
	if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
	if (ascii(head, 0, 4) === 'GIF8') return 'gif';
	if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') return 'webp';
	if (ascii(head, 4, 4) === 'ftyp') {
		// The major brand, then the compatible ones: an AVIF may name itself mif1 first and avif later.
		const size = Math.min(readU32(head, 0, false), head.length);
		const brands = [ascii(head, 8, 4)];
		for (let at = 16; at + 4 <= size; at += 4) brands.push(ascii(head, at, 4));
		if (brands.some((brand) => brand === 'avif' || brand === 'avis')) return 'avif';
		if (brands.some((brand) => HEIC_BRANDS.test(brand))) return 'heic';
		return null;
	}
	if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff';
	if (startsWith(head, [0x49, 0x49, 0x2b, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2b])) return 'tiff';
	if (ascii(head, 0, 2) === 'BM' && [12, 40, 52, 56, 64, 108, 124].includes(readU32(head, 14, true))) return 'bmp';
	if (startsWith(head, [0x00, 0x00, 0x01, 0x00]) && readU16(head, 4, true) > 0) return 'ico';
	if (startsWith(head, [0xff, 0x0a]) || startsWith(head, JXL_CONTAINER)) return 'jxl';
	if (startsWith(head, JP2_SIGNATURE) || startsWith(head, [0xff, 0x4f, 0xff, 0x51])) return 'jp2';
	if (ascii(head, 0, 4) === '8BPS' && (readU16(head, 4, false) === 1 || readU16(head, 4, false) === 2)) return 'psd';
	if (looksLikeSvg(head)) return 'svg';
	return null;
}

/** Bytes as text, one character a byte: enough for tags, attribute names and numbers, which are plain ASCII. */
function latin1(bytes: Uint8Array): string {
	let text = '';
	for (let at = 0; at < bytes.length; at += 8192) text += String.fromCharCode(...bytes.subarray(at, at + 8192));
	return text;
}

/** Text that opens (after a byte-order mark, white space, an XML line, comments or a doctype) with an `<svg` tag. */
function looksLikeSvg(head: Uint8Array): boolean {
	const text = latin1(head.subarray(0, SNIFF_BYTES)).replace(/^\xEF\xBB\xBF/, '');
	const rest = text.replace(/^(\s|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)*/i, '');
	return /^<svg[\s>]/i.test(rest);
}

// --- Reading sizes ------------------------------------------------------------------------------------------------

/** Random access to a file: the browser reads slices of the picked file; the worker reads its buffer. */
export interface ByteReader {
	size: number;
	read(offset: number, length: number): Promise<Uint8Array>;
}

/** A reader over bytes already in memory. */
export const bytesReader = (bytes: Uint8Array): ByteReader => ({
	size: bytes.byteLength,
	read: async (offset, length) => bytes.subarray(offset, Math.min(bytes.byteLength, offset + length)),
});

function readU16(bytes: Uint8Array, at: number, little: boolean): number {
	if (at + 2 > bytes.length) return 0;
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(at, little);
}

function readU32(bytes: Uint8Array, at: number, little: boolean): number {
	if (at + 4 > bytes.length) return 0;
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, little);
}

function readI32(bytes: Uint8Array, at: number, little: boolean): number {
	if (at + 4 > bytes.length) return 0;
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(at, little);
}

const sized = (width: number, height: number): PhotoSize | null =>
	Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
		? { width: Math.round(width), height: Math.round(height) }
		: null;

/**
 * The photo's upright size from its header, for the kinds in `HEADER_MEASURED_KINDS`; an SVG gives the size it is
 * made into (`svgRasterSize`). Null when the header can't be read.
 */
export async function measureFromHeader(reader: ByteReader, kind: PhotoKind): Promise<PhotoSize | null> {
	try {
		switch (kind) {
			case 'tiff':
				return await tiffSize(reader);
			case 'bmp': {
				const head = await reader.read(0, 26);
				if (readU32(head, 14, true) === 12) return sized(readU16(head, 18, true), readU16(head, 20, true));
				return sized(Math.abs(readI32(head, 18, true)), Math.abs(readI32(head, 22, true)));
			}
			case 'ico':
				return await icoSize(reader);
			case 'psd': {
				const head = await reader.read(0, 26);
				return sized(readU32(head, 18, false), readU32(head, 14, false));
			}
			case 'jp2':
				return await jp2Size(reader);
			case 'jxl':
				return jxlSize(await reader.read(0, 4096));
			case 'svg': {
				const text = latin1(await reader.read(0, 65536));
				const own = svgSize(text);
				return own ? svgRasterSize(own) : null;
			}
			default:
				return null;
		}
	} catch {
		return null;
	}
}

/** TIFF (and BigTIFF): the first picture's ImageWidth and ImageLength, turned by its Orientation tag. */
async function tiffSize(reader: ByteReader): Promise<PhotoSize | null> {
	const head = await reader.read(0, 16);
	const little = head[0] === 0x49;
	const big = readU16(head, 2, little) === 43;
	const first = big
		? Number(new DataView(head.buffer, head.byteOffset, 16).getBigUint64(8, little))
		: readU32(head, 4, little);
	const countBytes = big ? 8 : 2;
	const entryBytes = big ? 20 : 12;
	const countRaw = await reader.read(first, countBytes);
	const count = big
		? Number(new DataView(countRaw.buffer, countRaw.byteOffset, 8).getBigUint64(0, little))
		: readU16(countRaw, 0, little);
	const entries = await reader.read(first + countBytes, Math.min(count, 1000) * entryBytes);
	let width = 0;
	let height = 0;
	let orientation = 1;
	for (let at = 0; at + entryBytes <= entries.length; at += entryBytes) {
		const tag = readU16(entries, at, little);
		const type = readU16(entries, at + 2, little);
		const valueAt = at + (big ? 12 : 8);
		const value = type === 3 ? readU16(entries, valueAt, little) : readU32(entries, valueAt, little);
		if (tag === 256) width = value;
		else if (tag === 257) height = value;
		else if (tag === 274) orientation = value;
	}
	return orientation >= 5 ? sized(height, width) : sized(width, height);
}

/** ICO: its largest picture. A PNG inside says its own size (pictures over 256 px are always PNG). */
async function icoSize(reader: ByteReader): Promise<PhotoSize | null> {
	const head = await reader.read(0, 6);
	const count = Math.min(readU16(head, 4, true), 256);
	const directory = await reader.read(6, count * 16);
	let best: PhotoSize | null = null;
	for (let index = 0; index < count; index += 1) {
		const at = index * 16;
		let width = directory[at] || 256;
		let height = directory[at + 1] || 256;
		const offset = readU32(directory, at + 12, true);
		const picture = await reader.read(offset, 24);
		if (startsWith(picture, [0x89, 0x50, 0x4e, 0x47])) {
			width = readU32(picture, 16, false);
			height = readU32(picture, 20, false);
		}
		const size = sized(width, height);
		if (size && (!best || size.width * size.height > best.width * best.height)) best = size;
	}
	return best;
}

/** JPEG 2000: the codestream's SIZ marker, or the JP2 header box (jp2h › ihdr). */
async function jp2Size(reader: ByteReader): Promise<PhotoSize | null> {
	const head = await reader.read(0, 65536);
	if (startsWith(head, [0xff, 0x4f, 0xff, 0x51])) {
		return sized(
			readU32(head, 8, false) - readU32(head, 16, false),
			readU32(head, 12, false) - readU32(head, 20, false),
		);
	}
	const walk = (from: number, to: number): PhotoSize | null => {
		for (let at = from; at + 8 <= to;) {
			let size = readU32(head, at, false);
			const type = ascii(head, at + 4, 4);
			let body = at + 8;
			if (size === 1) {
				size = Number(new DataView(head.buffer, head.byteOffset + at + 8, 8).getBigUint64(0, false));
				body = at + 16;
			} else if (size === 0) size = to - at;
			if (type === 'ihdr') return sized(readU32(head, body + 4, false), readU32(head, body, false));
			if (type === 'jp2h') return walk(body, Math.min(to, at + size));
			if (type === 'jp2c') {
				const stream = head.subarray(body);
				return sized(
					readU32(stream, 8, false) - readU32(stream, 16, false),
					readU32(stream, 12, false) - readU32(stream, 20, false),
				);
			}
			if (size < 8) return null;
			at += size;
		}
		return null;
	};
	return walk(0, head.length);
}

/** JPEG XL: the codestream's SizeHeader (and its orientation), inside the container's jxlc or first jxlp box. */
function jxlSize(head: Uint8Array): PhotoSize | null {
	let stream = head;
	if (startsWith(head, JXL_CONTAINER)) {
		stream = new Uint8Array(0);
		for (let at = 0; at + 8 <= head.length;) {
			const size = readU32(head, at, false);
			const type = ascii(head, at + 4, 4);
			if (type === 'jxlc') {
				stream = head.subarray(at + 8);
				break;
			}
			if (type === 'jxlp') {
				stream = head.subarray(at + 12);
				break;
			}
			if (size < 8) return null;
			at += size;
		}
	}
	if (!startsWith(stream, [0xff, 0x0a])) return null;
	const { bits, past } = bitReader(stream, 2);
	const dimension = (div8: boolean): number => {
		if (div8) return 8 * (1 + bits(5));
		const extra = [9, 13, 18, 30][bits(2)] as number;
		return 1 + bits(extra);
	};
	const div8 = bits(1) === 1;
	const height = dimension(div8);
	const ratio = bits(3);
	const ratios: Record<number, [number, number]> = {
		1: [1, 1],
		2: [12, 10],
		3: [4, 3],
		4: [3, 2],
		5: [16, 9],
		6: [5, 4],
		7: [2, 1],
	};
	const fixed = ratios[ratio];
	const width = fixed ? Math.floor((height * fixed[0]) / fixed[1]) : dimension(div8);
	// ImageMetadata follows: all_default, then extra_fields, then the orientation (1–8).
	let orientation = 1;
	if (bits(1) === 0 && bits(1) === 1) orientation = 1 + bits(3);
	if (past()) return null;
	return orientation >= 5 ? sized(height, width) : sized(width, height);
}

/** Reads bits lowest first, as JPEG XL stores them; `past` says a read ran beyond the bytes there are. */
function bitReader(bytes: Uint8Array, start: number): { bits: (count: number) => number; past: () => boolean } {
	let position = start * 8;
	return {
		bits: (count) => {
			let value = 0;
			for (let index = 0; index < count; index += 1) {
				const byte = bytes[position >> 3] ?? 0;
				value += ((byte >> (position & 7)) & 1) * 2 ** index;
				position += 1;
			}
			return value;
		},
		past: () => position > bytes.length * 8,
	};
}

const SVG_UNITS: Readonly<Record<string, number>> = {
	'': 1,
	px: 1,
	pt: 4 / 3,
	pc: 16,
	mm: 96 / 25.4,
	cm: 96 / 2.54,
	in: 96,
};

/** A length in an SVG's width or height, in CSS pixels; null for percentages and anything unknown. */
function svgLength(value: string | undefined): number | null {
	const match = value ? /^\s*([0-9]*\.?[0-9]+(?:e[+-]?\d+)?)\s*([a-z]*)\s*$/i.exec(value) : null;
	if (!match) return null;
	const unit = SVG_UNITS[(match[2] as string).toLowerCase()];
	return unit ? Number(match[1]) * unit : null;
}

/** The SVG's own size: its width and height, or its viewBox where they are missing or in percent. */
export function svgSize(text: string): PhotoSize | null {
	const tag = /<svg\b([^>]*)>/i.exec(text)?.[1];
	if (tag === undefined) return null;
	const attribute = (name: string) =>
		new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
			.exec(tag)
			?.slice(1)
			.find((v) => v !== undefined);
	const box = (attribute('viewBox') ?? '')
		.trim()
		.split(/[\s,]+/)
		.map(Number);
	const [, , viewWidth = 0, viewHeight = 0] = box;
	const boxWidth = box.length === 4 && viewWidth > 0 ? viewWidth : null;
	const boxHeight = box.length === 4 && viewHeight > 0 ? viewHeight : null;
	let width = svgLength(attribute('width'));
	let height = svgLength(attribute('height'));
	if (width === null && height !== null && boxWidth && boxHeight) width = (height * boxWidth) / boxHeight;
	if (height === null && width !== null && boxWidth && boxHeight) height = (width * boxHeight) / boxWidth;
	if (width === null || height === null) {
		width = boxWidth;
		height = boxHeight;
	}
	return width && height ? sized(width, height) : null;
}

/** The picture an SVG is made into: its own shape, `SVG_RASTER_LONG_EDGE` on the long edge. */
export function svgRasterSize(own: PhotoSize): PhotoSize {
	const scale = SVG_RASTER_LONG_EDGE / Math.max(own.width, own.height);
	return {
		width: Math.max(1, Math.round(own.width * scale)),
		height: Math.max(1, Math.round(own.height * scale)),
	};
}
