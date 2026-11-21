import { OptionDisplayStyle } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { OPTION_LOOKS, usesColour, usesPicture } from './option-looks';

describe('option looks', () => {
	it('offers exactly the looks the contracts accept, in their order', () => {
		expect([...OPTION_LOOKS]).toEqual(OptionDisplayStyle.options);
	});

	it('knows which looks need a colour and which a picture', () => {
		expect(OPTION_LOOKS.filter(usesColour)).toEqual(['color_swatch', 'colour_chip']);
		expect(OPTION_LOOKS.filter(usesPicture)).toEqual(['image_swatch', 'image_tile', 'picture_row', 'picture_chip']);
		expect([usesColour(null), usesPicture(undefined), usesPicture('size_v2')]).toEqual([false, false, false]);
	});
});
