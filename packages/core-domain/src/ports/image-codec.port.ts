/** What decoding an upload revealed. */
export interface ImageProbe {
	width: number;
	height: number;
	/** The format the BYTES actually are, whatever the upload claimed. */
	format: 'jpeg' | 'png' | 'webp' | 'other';
	hasAlpha: boolean;
}

/**
 * One output to render.
 *
 * - `inside` scales to `width`, keeping the source shape (`height` ignored);
 * - `cover` fills `width`×`height` exactly with a centre crop;
 * - `pad` fits inside `width`×`height` and letterboxes on white;
 * - `blur` fits inside `width`×`height` over a blurred, darkened enlargement of the same image;
 * - `story` is the tall Status/Story card: the same blurred fill, an empty dark band near the top
 *   (the shopper's phone writes the name and facts into it, share brief J1), and the whole photo
 *   below it. The band and photo boxes are `STORY_LAYOUT` fractions of the card.
 */
export interface ImageRenderSpec {
	width: number;
	height: number | null;
	fit: 'inside' | 'cover' | 'pad' | 'blur' | 'story';
	format: 'image/webp' | 'image/jpeg' | 'image/png';
	quality: number;
	/** Logos keep their see-through background. Everything else is flattened onto white. */
	keepAlpha?: boolean;
	/** The Brand Kit logo, drawn on a white strip along the bottom of a link-preview card. */
	stripLogo?: Uint8Array;
	/** `pad` only: white margin on every side, as a fraction of the box. */
	inset?: number;
}

/**
 * Where the tall card's parts sit, as fractions of its height (top, height) and width (side).
 * The storefront writes into `band` with the same fractions, so the two must stay in step.
 */
export const STORY_LAYOUT = {
	band: { top: 0.078, height: 0.203 },
	photo: { top: 0.292, bottom: 0.021, side: 0.046 },
} as const;

/** The white strip along a link-preview card's foot, as a fraction of its height. */
export const BRAND_STRIP_HEIGHT = 0.1;

export interface RenderedImage {
	bytes: Uint8Array;
	width: number;
	height: number;
	/** Hex SHA-256 of `bytes`; its first 8 characters make the storage key immutable. */
	sha256: string;
}

/** Raised when bytes do not decode as an image — the upload's real trust boundary. */
export class ImageDecodeError extends Error {
	constructor(message: string, cause?: unknown) {
		super(message, { cause });
		this.name = 'ImageDecodeError';
	}
}

/**
 * Image decoding and encoding (`ImageCodecPort`), implemented by the sharp adapter at the
 * worker edge. Core never imports sharp: it plans WHAT to render, the adapter renders it.
 *
 * Every render converts through the embedded colour profile to sRGB, strips metadata
 * (EXIF location never reaches a public URL), and sharpens lightly after resizing.
 */
export interface ImageCodecPort {
	probe(bytes: Uint8Array): Promise<ImageProbe>;
	render(bytes: Uint8Array, spec: ImageRenderSpec): Promise<RenderedImage>;
	/** ThumbHash (base64) and dominant colour (`#rrggbb`) for the loading placeholder. */
	placeholder(bytes: Uint8Array): Promise<{ thumbHash: string; dominantColor: string }>;
}
