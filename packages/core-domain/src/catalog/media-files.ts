/**
 * Rules about uploaded files that the Media page and the API share. Browser-safe: no imports, so the
 * admin can read it (`@saha-textile/core-domain/media-files`) without the rest of the domain.
 */

/** Camera RAW files: stored as files, labelled, never processed as photos (decision 3). */
export const CAMERA_RAW = /\.(dng|cr2|cr3|nef|nrw|arw|srf|sr2|raf|orf|rw2|pef|srw|x3f|3fr|iiq|erf|kdc|mrw)$/i;

/**
 * A photo the image worker will process: it uploads with an image profile, which the Media page
 * offers from step 2 (owner, 15 Nov). Until then the Media page uploads every other file and lists
 * photos as waiting; camera RAW files are not photos here, so they upload as files.
 */
export function waitsForImageProfiles(contentType: string, name: string): boolean {
	return contentType.toLowerCase().startsWith('image/') && !CAMERA_RAW.test(name);
}

/**
 * The photo types the image worker makes versions from, each with the name the worker gives the bytes: an upload
 * must decode as the type it was sent as. JPEG and PNG; since media step 5 (owner, 16 Nov) WebP, GIF (its first
 * frame), AVIF, TIFF (its first page), SVG (made into a picture 4096 px on its long edge), and with extra decoders
 * JPEG XL, JPEG 2000, BMP, ICO (its largest picture) and PSD (its flattened picture). Versions stay WebP, JPEG and
 * PNG. HEIC is turned into a JPEG in the browser first.
 */
export const PHOTO_FORMATS: Readonly<Record<string, string>> = {
	'image/jpeg': 'jpeg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif',
	'image/avif': 'avif',
	'image/tiff': 'tiff',
	'image/svg+xml': 'svg',
	'image/bmp': 'bmp',
	'image/x-icon': 'ico',
	'image/jxl': 'jxl',
	'image/jp2': 'jp2',
	'image/vnd.adobe.photoshop': 'psd',
};

export const PROCESSED_PHOTO_TYPES: readonly string[] = Object.keys(PHOTO_FORMATS);

export function isProcessedPhoto(contentType: string): boolean {
	return PROCESSED_PHOTO_TYPES.includes(contentType.toLowerCase());
}

/** Uploads this big go in parts, so a cut-off one carries on where it stopped (S11). */
export const MULTIPART_FROM_BYTES = 100 * 1024 * 1024;
/** Each part of a big upload; S3 takes at most 10,000 parts of at least 5 MB (the last may be smaller). */
export const MULTIPART_PART_BYTES = 16 * 1024 * 1024;

// --- Photo shapes against image profiles (media step 2), shared by the upload popup and the API ---------------

/** A box shape, width : height. */
export interface PhotoShape {
	width: number;
	height: number;
}

/** Within this fraction of a profile's shape a photo counts as that shape (the pipeline's 5%). */
export const SHAPE_TOLERANCE = 0.05;

/** How far `width × height` is from a target shape, as a fraction of the target. */
export function shapeDeviation(width: number, height: number, target: PhotoShape): number {
	const actual = width / height;
	const wanted = target.width / target.height;
	return Math.abs(actual - wanted) / wanted;
}

/** True when a photo already has the profile's shape (within 5%), or the profile keeps the photo's own shape. */
export function fitsShape(source: PhotoShape, shape: PhotoShape | null): boolean {
	return !shape || shapeDeviation(source.width, source.height, shape) <= SHAPE_TOLERANCE;
}

/** The fills a photo may get under a profile: “As is” alone when it already fits, otherwise the profile's own. */
export function photoFills<F extends string>(
	profile: { shape: PhotoShape | null; fills: readonly F[] },
	source: PhotoShape,
): (F | 'as_is')[] {
	return fitsShape(source, profile.shape) ? ['as_is'] : [...profile.fills];
}

/** What a profile's smallest-photo rule says about a photo: fine, a note, or a refusal. */
export type MinSizeCheck =
	{ result: 'ok' } | { result: 'warn' | 'refuse'; edge: 'short' | 'width'; px: number; has: number };

export function minSizeCheck(
	rule: { edge: 'short' | 'width'; px: number; mode: 'warn' | 'refuse' } | null,
	source: PhotoShape,
): MinSizeCheck {
	if (!rule) return { result: 'ok' };
	const has = rule.edge === 'short' ? Math.min(source.width, source.height) : source.width;
	return has >= rule.px ? { result: 'ok' } : { result: rule.mode, edge: rule.edge, px: rule.px, has };
}

/** Profiles a photo is suggested for at upload (B01): the first, in this order, that it already fits. */
/** New versions take about this share of the original's bytes each (all their sizes together), for estimates. */
export const VERSION_BYTES_SHARE = 0.35;

/** The rough size of new versions, for the storage check and the Reprocess footer (R4-7, C01). */
export const estimateVersionBytes = (originalBytes: number, versions: number): number =>
	Math.round(originalBytes * VERSION_BYTES_SHARE * versions);

/**
 * How much of a photo a crop into `box` keeps (C01's note, “keeps only the middle 38% of the photo's width”): the
 * share of its width (a wider photo) or height (a taller one), from 0 to 1; 1 when the shapes match.
 */
export function cropKeeps(source: PhotoShape, box: PhotoShape): { side: 'width' | 'height'; share: number } {
	const photo = source.width / source.height;
	const target = box.width / box.height;
	return photo >= target
		? { side: 'width', share: Math.min(1, target / photo) }
		: { side: 'height', share: Math.min(1, photo / target) };
}

export const SUGGESTION_ORDER: readonly string[] = [
	'product_3x4',
	'blog_cover_2x1',
	'store_photo_4x3',
	'hero_21x9',
	'hero_16x9',
	'phone_banner_4x5',
	'square_1x1',
];

export function suggestProfile(
	profiles: readonly { key: string; shape: PhotoShape | null; enabled: boolean; mainPhotoOnly: boolean }[],
	source: PhotoShape,
): string | null {
	const usable = profiles.filter((profile) => profile.enabled && !profile.mainPhotoOnly && profile.shape);
	const fitting = usable.filter((profile) => fitsShape(source, profile.shape));
	const ranked = [...fitting].sort((a, b) => rank(a.key) - rank(b.key));
	return ranked[0]?.key ?? null;
}

const rank = (key: string) => {
	const at = SUGGESTION_ORDER.indexOf(key);
	return at === -1 ? SUGGESTION_ORDER.length : at;
};

// --- HEIC photos (media step 2d): turned into JPEG in the browser, colours kept ----------------------------------

/** What a picked photo's first bytes say it is, whatever its name claims. */
export function sniffPhoto(head: Uint8Array): 'jpeg' | 'png' | 'heic' | null {
	if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
	if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'png';
	const brand = String.fromCharCode(...head.slice(4, 12));
	if (brand.startsWith('ftyp') && /heic|heix|hevc|heim|heis|mif1|msf1/.test(brand.slice(4))) return 'heic';
	return null;
}

/** A HEIC or HEIF by its type or name (some phones send no type). */
export const looksLikeHeic = (contentType: string, name: string): boolean =>
	/^image\/hei[cf]/i.test(contentType) || /\.(heic|heif)$/i.test(name);

/**
 * The quality steps for a converted HEIC (decision 8): top quality first, then 95 and 90 until the JPEG is 25 MB or
 * less. A photo still over after 90 is listed with the other big photos.
 */
export const HEIC_QUALITY_STEPS: readonly number[] = [1, 0.95, 0.9];

/**
 * The HEIC's own colour profile (the ISOBMFF `colr` box of type `prof`), or null. Browsers drop it when they turn a
 * wide-colour (Display P3) photo into JPEG, so reds and pinks come out 10–15% duller; putting it back fixes that.
 */
export function heicColourProfile(bytes: Uint8Array): Uint8Array | null {
	const limit = Math.min(bytes.length - 12, 4 * 1024 * 1024);
	for (let i = 4; i < limit; i += 1) {
		if (
			bytes[i] === 0x63 &&
			bytes[i + 1] === 0x6f &&
			bytes[i + 2] === 0x6c &&
			bytes[i + 3] === 0x72 &&
			bytes[i + 4] === 0x70 &&
			bytes[i + 5] === 0x72 &&
			bytes[i + 6] === 0x6f &&
			bytes[i + 7] === 0x66
		) {
			// i starts at 4, so the four size bytes before the box name are always there.
			const size =
				((bytes[i - 4] as number) << 24) |
				((bytes[i - 3] as number) << 16) |
				((bytes[i - 2] as number) << 8) |
				(bytes[i - 1] as number);
			const end = i - 4 + size;
			if (size > 16 && end <= bytes.length) return bytes.slice(i + 8, end);
			return null;
		}
	}
	return null;
}

/** ICC profile segments: at most this many profile bytes each (64 KB less the segment's own header). */
const ICC_CHUNK = 65519;

/**
 * The JPEG with the given colour profile in its APP2 `ICC_PROFILE` segments (any it had are replaced), right after
 * the start marker. The image worker then converts the colours to sRGB as it does for every photo.
 */
export function withColourProfile(jpeg: Uint8Array, icc: Uint8Array): Uint8Array {
	if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || !icc.length) return jpeg;
	const kept: Uint8Array[] = [];
	let at = 2;
	while (at + 4 <= jpeg.length && jpeg[at] === 0xff && jpeg[at + 1] !== 0xda) {
		// The loop runs only while at + 4 bytes are there.
		const length = ((jpeg[at + 2] as number) << 8) | (jpeg[at + 3] as number);
		const isIcc = jpeg[at + 1] === 0xe2 && String.fromCharCode(...jpeg.slice(at + 4, at + 15)) === 'ICC_PROFILE';
		if (!isIcc) kept.push(jpeg.slice(at, at + 2 + length));
		at += 2 + length;
	}
	const chunks = Math.ceil(icc.length / ICC_CHUNK);
	const segments: Uint8Array[] = [];
	for (let n = 0; n < chunks; n += 1) {
		const part = icc.slice(n * ICC_CHUNK, (n + 1) * ICC_CHUNK);
		const head = new Uint8Array(18);
		const length = 16 + part.length;
		head.set([0xff, 0xe2, length >> 8, length & 0xff]);
		head.set(
			[...'ICC_PROFILE'].map((c) => c.charCodeAt(0)),
			4,
		);
		head.set([0, n + 1, chunks], 15);
		segments.push(head, part);
	}
	const parts = [jpeg.slice(0, 2), ...segments, ...kept, jpeg.slice(at)];
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}
