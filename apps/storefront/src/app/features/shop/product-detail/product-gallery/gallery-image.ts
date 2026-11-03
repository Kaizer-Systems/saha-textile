import { roleSrcset } from '@core/media/resolved-image';
import { IAttachment } from '@data-access/interfaces/attachment.interface';

/**
 * One gallery image as the gallery renders it: `srcset` carries the `gallery` widths and
 * `zoomSrc` the 2000 px `zoom` derivative when the attachment has the pipeline's `image`;
 * an attachment with only `original_url` still renders, unsized.
 */
export interface GalleryImage {
	id: string;
	src: string;
	srcset: string | null;
	zoomSrc: string;
	width: number | null;
	height: number | null;
}

/** Display width of the PDP main image at each breakpoint (measured 2026-11-01). */
export const GALLERY_SIZES = '(max-width: 767px) 92vw, (max-width: 1199px) 50vw, 585px';

export const toGalleryImage = (attachment: IAttachment): GalleryImage => {
	const resolved = attachment.image;
	const gallery = resolved?.roles['gallery'];
	return {
		id: attachment.id.toString(),
		src: gallery?.at(-1)?.url ?? attachment.original_url,
		srcset: roleSrcset(resolved, 'gallery'),
		zoomSrc: resolved?.roles['zoom']?.at(-1)?.url ?? gallery?.at(-1)?.url ?? attachment.original_url,
		width: resolved?.width ?? null,
		height: resolved?.height ?? null,
	};
};
