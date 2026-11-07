import { describe, expect, it } from 'vitest';

import { IAttachment } from '@data-access/interfaces/attachment.interface';

import { toGalleryImage } from './gallery-image';

const source = (role: string, width: number) => ({
	url: `https://cdn.test/${role}-${width}w.webp`,
	width,
	height: (width * 4) / 3,
});
const attachment = (image?: IAttachment['image']): IAttachment => ({
	id: 7,
	collection_name: 'attachment',
	name: 'saree',
	file_name: 'saree.png',
	mime_type: 'image/png',
	disk: 'public',
	conversions_disk: 'public',
	size: '1',
	original_url: 'https://cdn.test/card-400w.webp',
	created_by_id: 1,
	image,
});

describe('toGalleryImage', () => {
	it('uses the gallery widths for srcset, the zoom derivative for the lens and the intrinsic size', () => {
		const image = toGalleryImage(
			attachment({
				width: 3072,
				height: 4096,
				dominantColor: '#7a3b2e',
				roles: { gallery: [source('gallery', 600), source('gallery', 1200)], zoom: [source('zoom', 2000)] },
			}),
		);
		expect(image).toEqual({
			id: '7',
			src: 'https://cdn.test/gallery-1200w.webp',
			srcset: 'https://cdn.test/gallery-600w.webp 600w, https://cdn.test/gallery-1200w.webp 1200w',
			zoomSrc: 'https://cdn.test/zoom-2000w.webp',
			width: 3072,
			height: 4096,
		});
	});

	it('still renders an attachment that only has original_url', () => {
		expect(toGalleryImage(attachment())).toMatchObject({
			src: 'https://cdn.test/card-400w.webp',
			srcset: null,
			zoomSrc: 'https://cdn.test/card-400w.webp',
			width: null,
		});
	});
});
