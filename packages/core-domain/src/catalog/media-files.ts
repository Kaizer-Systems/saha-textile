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
