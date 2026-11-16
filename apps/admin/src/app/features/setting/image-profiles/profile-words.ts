import type { MediaFill, MediaProfile } from '@saha-textile/contracts';

/**
 * How Settings › Image profiles names things (media step 2c). A built-in profile keeps its name, so every screen
 * and language names it the same through its translation; a profile an admin added shows the name they typed.
 */
export const profileNameKey = (profile: Pick<MediaProfile, 'key'>): string => `profile_name_${profile.key}`;

/** “3:4”, “21:9”, a long ratio as “1.91:1”, or null when the profile keeps the photo's own shape. */
export function shapeLabel(shape: MediaProfile['shape']): string | null {
	if (!shape) return null;
	// 1200 × 630 is what every chat app calls 1.91:1.
	if (shape.width === 1200 && shape.height === 630) return '1.91:1';
	if (shape.width > 30 || shape.height > 30) return `${(shape.width / shape.height).toFixed(2)}:1`;
	return `${shape.width}:${shape.height}`;
}

/** The little box drawn beside a shape (F01): 26 px on its long side. */
export function shapeBox(shape: MediaProfile['shape']): { width: number; height: number } {
	const ratio = shape ? shape.width / shape.height : 3;
	return ratio >= 1
		? { width: 26, height: Math.max(8, Math.round(26 / ratio)) }
		: { width: Math.max(8, Math.round(26 * ratio)), height: 26 };
}

/** “150 – 2000 px” across every size family, or one size alone. */
export function sizesLabel(widths: MediaProfile['widths']): string {
	const all = Object.values(widths).flat();
	if (!all.length) return '—';
	const low = Math.min(...all);
	const high = Math.max(...all);
	return low === high ? `${low} px` : `${low} – ${high} px`;
}

/** The translation key of each fill's name. Icons say “White background” rather than “White padding”. */
export function fillKey(fill: MediaFill, icon: boolean): string {
	if (fill === 'white') return icon ? 'profile_fill_white_background' : 'profile_fill_white';
	return `profile_fill_${fill}`;
}

/** Icon profiles: never cropped or blurred, a white or Brand Kit colour background instead. */
export const isIconProfile = (profile: Pick<MediaProfile, 'roles'>): boolean => profile.roles.includes('brand_icon');

/** The picture types a profile can accept (F02); JPEG, PNG, WebP and GIF are made into versions today. */
export const IMAGE_TYPES: readonly { label: string; mime: string; now: boolean }[] = [
	{ label: 'JPEG', mime: 'image/jpeg', now: true },
	{ label: 'PNG', mime: 'image/png', now: true },
	{ label: 'WebP', mime: 'image/webp', now: true },
	{ label: 'AVIF', mime: 'image/avif', now: false },
	{ label: 'HEIC/HEIF', mime: 'image/heic', now: false },
	{ label: 'TIFF', mime: 'image/tiff', now: false },
	{ label: 'GIF', mime: 'image/gif', now: true },
	{ label: 'SVG', mime: 'image/svg+xml', now: false },
	{ label: 'BMP', mime: 'image/bmp', now: false },
	{ label: 'JPEG XL', mime: 'image/jxl', now: false },
	{ label: 'JPEG 2000', mime: 'image/jp2', now: false },
	{ label: 'ICO', mime: 'image/x-icon', now: false },
	{ label: 'PSD', mime: 'image/vnd.adobe.photoshop', now: false },
];

export const MB = 1024 * 1024;
