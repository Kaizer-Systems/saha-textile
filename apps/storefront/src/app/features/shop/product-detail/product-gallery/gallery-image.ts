import { IAttachment } from '@data-access/interfaces/attachment.interface';

/**
 * One gallery image as the gallery renders it. Today the demo catalogue carries a single
 * `original_url` per image; once the catalog chunk serves `ResolvedImage`, `srcset` carries
 * the `gallery` widths and `zoomSrc` the 2000 px `zoom` derivative — the template does not
 * change, only this mapping.
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

export const toGalleryImage = (image: IAttachment): GalleryImage => ({
	id: image.id.toString(),
	src: image.original_url,
	srcset: null,
	zoomSrc: image.original_url,
	width: null,
	height: null,
});
