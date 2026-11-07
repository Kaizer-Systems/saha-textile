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
 * - `blur` fits inside `width`×`height` over a blurred, darkened enlargement of the same image.
 */
export interface ImageRenderSpec {
	width: number;
	height: number | null;
	fit: 'inside' | 'cover' | 'pad' | 'blur';
	format: 'image/webp' | 'image/jpeg' | 'image/png';
	quality: number;
	/** Logos keep their see-through background. Everything else is flattened onto white. */
	keepAlpha?: boolean;
}

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
