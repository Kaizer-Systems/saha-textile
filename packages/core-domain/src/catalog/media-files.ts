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
 * The photo types the image worker makes versions from today: JPEG and PNG (HEIC is turned into a JPEG in the
 * browser first). Other picture types keep waiting until the extra decoders arrive (build step 5).
 */
export const PROCESSED_PHOTO_TYPES: readonly string[] = ['image/jpeg', 'image/png'];

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
