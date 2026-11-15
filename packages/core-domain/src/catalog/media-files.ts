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
