import { HEIC_QUALITY_STEPS, heicColourProfile, withColourProfile } from '@saha-textile/core-domain/media-files';

/** A photo over this after the last quality step is listed with the other big photos (B04). */
const PHOTO_LIMIT = 25 * 1024 * 1024;

export type HeicConvert = (blob: Blob, quality: number) => Promise<Blob>;

/** The converter is a WebAssembly program; it loads only when a HEIC photo is picked. */
const heicTo: HeicConvert = async (blob, quality) =>
	(await import('heic-to')).heicTo({ blob, type: 'image/jpeg', quality });

/**
 * A HEIC or HEIF photo (iPhone, many Android phones) as a full-size JPEG, made in the browser (decision 6): top
 * quality first, then 95 and 90 until it is 25 MB or less (decision 8), with the photo's own colour profile put
 * back so wide-colour reds and pinks keep their colour (the fix tested on 15 Nov). The image worker then makes
 * its versions like any other JPEG.
 */
export async function heicToJpeg(file: File, convert: HeicConvert = heicTo): Promise<File> {
	const icc = heicColourProfile(new Uint8Array(await file.arrayBuffer()));
	let made: Blob | null = null;
	for (const quality of HEIC_QUALITY_STEPS) {
		const jpeg = await convert(file, quality);
		made = icc
			? new Blob([withColourProfile(new Uint8Array(await jpeg.arrayBuffer()), icc) as Uint8Array<ArrayBuffer>], {
					type: 'image/jpeg',
				})
			: jpeg;
		if (made.size <= PHOTO_LIMIT) break;
	}
	const name = /\.(heic|heif)$/i.test(file.name) ? file.name.replace(/\.(heic|heif)$/i, '.jpg') : `${file.name}.jpg`;
	return new File([made ?? new Blob()], name, { type: 'image/jpeg', lastModified: file.lastModified });
}
