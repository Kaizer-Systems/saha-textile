/**
 * Every look an option can take, as the contracts list them (`OptionDisplayStyle`; option-looks.spec.ts keeps the
 * two in step). The last four come from the early renders (owner, 21 Nov 2026, product page brief P6). The look is
 * only how the shop draws the values; what an option does comes from its role.
 */
export const OPTION_LOOKS = [
	'rectangle',
	'circle',
	'image_swatch',
	'color_swatch',
	'radio',
	'dropdown',
	'image_tile',
	'radio_bar',
	'picture_row',
	'picture_chip',
	'size_v2',
	'colour_chip',
] as const;
export type OptionLook = (typeof OPTION_LOOKS)[number];

/** Looks drawn from each value's colour. */
const COLOUR_LOOKS: ReadonlySet<string> = new Set(['color_swatch', 'colour_chip']);

/** Looks drawn from each value's picture. */
const PICTURE_LOOKS: ReadonlySet<string> = new Set(['image_swatch', 'image_tile', 'picture_row', 'picture_chip']);

export const usesColour = (look: string | null | undefined): boolean => COLOUR_LOOKS.has(look ?? '');
export const usesPicture = (look: string | null | undefined): boolean => PICTURE_LOOKS.has(look ?? '');
