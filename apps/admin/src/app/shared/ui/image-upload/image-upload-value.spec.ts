import { describe, expect, it } from 'vitest';

import { onePicture, pictureAddress, type PickedAttachment } from './image-upload';

describe('what an image field hands back', () => {
	const picture = { id: 'med_1', original_url: 'https://cdn.test/a.webp', versionId: 'ver_1' } as PickedAttachment;

	it('gives the one picture of a single-picture field, and none for a list, an address or an empty field', () => {
		expect(onePicture(picture)).toBe(picture);
		expect(onePicture([picture])).toBeNull();
		expect(onePicture('https://cdn.test/a.webp')).toBeNull();
		expect(onePicture(null)).toBeNull();
	});

	it("gives an address field's address, and none for a picture or an empty field", () => {
		expect(pictureAddress('https://cdn.test/a.webp')).toBe('https://cdn.test/a.webp');
		expect(pictureAddress(picture)).toBeNull();
		expect(pictureAddress(null)).toBeNull();
	});
});
