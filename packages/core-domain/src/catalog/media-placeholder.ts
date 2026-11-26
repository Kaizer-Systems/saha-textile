/**
 * The missing-picture placeholder (Media brief R5-1, R5-5): a grey box with the image icon, one per shape so it is
 * never stretched, light and dark, bundled in each app. When a Media picture fails, the app swaps in the one whose
 * shape is nearest the picture's box, so the box keeps its size and nothing jumps.
 */
export const PLACEHOLDER_SHAPES: readonly { key: string; ratio: number }[] = [
	{ key: '3x4', ratio: 3 / 4 },
	{ key: '4x5', ratio: 4 / 5 },
	{ key: '9x16', ratio: 9 / 16 },
	{ key: '1x1', ratio: 1 },
	{ key: '4x3', ratio: 4 / 3 },
	{ key: '16x9', ratio: 16 / 9 },
	{ key: '1.91x1', ratio: 1.91 },
	{ key: '2x1', ratio: 2 },
	{ key: '21x9', ratio: 21 / 9 },
];

/** The placeholder shape nearest a box (by how much the ratios differ, either way); square when it is unknown. */
export function placeholderShape(width: number | null | undefined, height: number | null | undefined): string {
	if (!width || !height || width <= 0 || height <= 0) return '1x1';
	const ratio = Math.log(width / height);
	let best = PLACEHOLDER_SHAPES[0] as { key: string; ratio: number };
	for (const shape of PLACEHOLDER_SHAPES) {
		if (Math.abs(Math.log(shape.ratio) - ratio) < Math.abs(Math.log(best.ratio) - ratio)) best = shape;
	}
	return best.key;
}

/** The bundled file: `placeholder-light-3x4.svg`. */
export const placeholderFile = (shape: string, dark: boolean): string =>
	`placeholder-${dark ? 'dark' : 'light'}-${shape}.svg`;

/** A Media picture's address: `…/media/med_…/…` (R4-1 storage keys). Other pictures are left alone. */
export const isMediaPictureUrl = (url: string | null | undefined): boolean => !!url && /\/media\/med_[^/]+\//.test(url);
