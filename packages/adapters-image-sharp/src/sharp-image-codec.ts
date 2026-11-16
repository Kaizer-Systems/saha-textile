import { createHash } from 'node:crypto';

import {
	BRAND_STRIP_HEIGHT,
	ImageDecodeError,
	SNIFF_BYTES,
	STORY_LAYOUT,
	bytesReader,
	measureFromHeader,
	sniffPhotoKind,
	svgRasterSize,
	svgSize,
	type ImageCodecPort,
	type ImageProbe,
	type ImageRenderSpec,
	type PhotoKind,
	type RenderedImage,
} from '@saha-textile/core-domain';
import sharp, { type Sharp } from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';

import { decodeExtra, isExtraKind } from './extra-decoders.js';

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

/** `#rrggbb` as sharp's colour; white when absent or not a colour. */
const colourOf = (hex: string | undefined) => {
	const match = hex ? /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) : null;
	return match
		? {
				r: parseInt(match[1] as string, 16),
				g: parseInt(match[2] as string, 16),
				b: parseInt(match[3] as string, 16),
				alpha: 1,
			}
		: WHITE;
};
/** ThumbHash encodes at most 100×100; it only needs a soft preview. */
const THUMBHASH_EDGE = 100;

/**
 * sharp-backed `ImageCodecPort`, used only inside the media worker.
 *
 * Every render:
 * - honours EXIF orientation, then drops all metadata (no GPS on a public URL);
 * - converts through the embedded ICC profile to sRGB, so an AdobeRGB export does not
 *   render dull once its profile is stripped;
 * - flattens transparency onto white (sarees on white, never on black);
 * - sharpens lightly AFTER resizing, which keeps zari and weave detail crisp without the
 *   halos that sharpening-then-downscaling produces.
 *
 * `limitInputPixels` matches the 50 MP ingest cap, so a decompression bomb fails to decode
 * instead of exhausting the worker's memory.
 */
/** The format the bytes are: an AVIF reads as HEIF with AV1 compression; an HEIC (HEVC) is not one the worker takes. */
function probeFormat(format: string | undefined, compression: string | undefined): ImageProbe['format'] {
	if (format === 'jpeg' || format === 'png' || format === 'webp' || format === 'gif' || format === 'tiff')
		return format;
	if (format === 'heif' && compression === 'av1') return 'avif';
	return 'other';
}

/** What the image library is handed for a photo: its own bytes, or a PNG made from a type it cannot read itself. */
interface Readable {
	bytes: Uint8Array;
	kind: PhotoKind | null;
}

export class SharpImageCodec implements ImageCodecPort {
	/** One readable copy per photo for the whole job: a JPEG XL or PSD is decoded once, not once per size. */
	private readonly readables = new WeakMap<Uint8Array, Promise<Readable>>();

	constructor(private readonly options: { maxInputPixels: number } = { maxInputPixels: 50_000_000 }) {}

	async probe(bytes: Uint8Array): Promise<ImageProbe> {
		try {
			const source = await this.readable(bytes);
			const meta = await sharp(source.bytes, { limitInputPixels: this.options.maxInputPixels }).metadata();
			if (!meta.width || !meta.height) throw new Error('no dimensions');
			// Orientations 5–8 swap the axes once the image is rotated upright.
			const swapped = (meta.orientation ?? 1) >= 5;
			return {
				width: swapped ? meta.height : meta.width,
				height: swapped ? meta.width : meta.height,
				format:
					source.kind === 'svg' || isExtraKind(source.kind)
						? source.kind
						: probeFormat(meta.format, meta.compression),
				hasAlpha: meta.hasAlpha ?? false,
			};
		} catch (error) {
			throw new ImageDecodeError('the upload is not a decodable image', error);
		}
	}

	private readable(bytes: Uint8Array): Promise<Readable> {
		let entry = this.readables.get(bytes);
		if (!entry) {
			entry = this.makeReadable(bytes);
			this.readables.set(bytes, entry);
		}
		return entry;
	}

	/**
	 * An SVG becomes a picture `SVG_RASTER_LONG_EDGE` px on its long edge, the size the upload popup showed. JPEG XL,
	 * JPEG 2000, BMP, ICO and PSD are decoded, once their header says the picture is within the pixel limit, so a
	 * decompression bomb is refused before it is opened. Everything else goes on as it is.
	 */
	private async makeReadable(bytes: Uint8Array): Promise<Readable> {
		const kind = sniffPhotoKind(bytes.subarray(0, SNIFF_BYTES));
		if (kind === 'svg') return { bytes: await this.rasterizeSvg(bytes), kind };
		if (!isExtraKind(kind)) return { bytes, kind };
		const size = await measureFromHeader(bytesReader(bytes), kind);
		if (!size) throw new ImageDecodeError(`a ${kind} file whose size cannot be read`);
		if (size.width * size.height > this.options.maxInputPixels) {
			throw new ImageDecodeError(`a ${kind} file with more pixels than the worker reads`);
		}
		return { bytes: await decodeExtra(bytes, kind), kind };
	}

	private async rasterizeSvg(bytes: Uint8Array): Promise<Uint8Array> {
		const meta = await sharp(bytes).metadata();
		if (!meta.width || !meta.height) throw new ImageDecodeError('an SVG with no size');
		const own = svgSize(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1'));
		const target = svgRasterSize(own ?? { width: meta.width, height: meta.height });
		// sharp draws an SVG at 72 dpi by default; the density scales it to the target before the exact resize.
		const density = Math.min(100_000, Math.max(1, (72 * target.width) / meta.width));
		const png = await sharp(bytes, { density, limitInputPixels: this.options.maxInputPixels })
			.resize(target.width, target.height, { fit: 'fill' })
			.png()
			.toBuffer();
		return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
	}

	async render(original: Uint8Array, spec: ImageRenderSpec): Promise<RenderedImage> {
		const { bytes } = await this.readable(original);
		if (spec.fit === 'blur') return this.renderBlurFill(bytes, spec);
		if (spec.fit === 'story') return this.renderStory(bytes, spec);
		if (spec.fit === 'pad' && spec.inset) return this.renderInset(bytes, spec);
		const background = colourOf(spec.background);
		let pipeline = this.base(bytes, spec.keepAlpha, background);
		if (spec.fit === 'cover' && spec.focal) {
			const window = await focalWindow(bytes, spec);
			if (window) pipeline = pipeline.extract(window);
		}
		pipeline =
			spec.fit === 'inside'
				? pipeline.resize({ width: spec.width, withoutEnlargement: true })
				: pipeline.resize({
						width: spec.width,
						height: spec.height ?? spec.width,
						fit: spec.fit === 'cover' ? 'cover' : 'contain',
						position: 'centre',
						background,
						withoutEnlargement: false,
					});
		pipeline = pipeline.sharpen({ sigma: 0.5 });
		pipeline = this.encode(pipeline, spec);
		return this.finish(pipeline);
	}

	/** A padded card with a white margin: the image fitted inside the inner box, then centred on white. */
	private async renderInset(bytes: Uint8Array, spec: ImageRenderSpec): Promise<RenderedImage> {
		const width = spec.width;
		const height = spec.height ?? spec.width;
		const inset = Math.min(0.4, Math.max(0, spec.inset ?? 0));
		const background = colourOf(spec.background);
		const inner = await this.base(bytes, spec.keepAlpha, background)
			.resize({
				width: Math.max(1, Math.round(width * (1 - 2 * inset))),
				height: Math.max(1, Math.round(height * (1 - 2 * inset))),
				fit: 'inside',
				withoutEnlargement: false,
			})
			.png()
			.toBuffer({ resolveWithObject: true });
		const pipeline = sharp({ create: { width, height, channels: 4, background } }).composite([
			{
				input: inner.data,
				left: Math.round((width - inner.info.width) / 2),
				top: Math.round((height - inner.info.height) / 2),
			},
		]);
		return this.finish(this.encode(pipeline, spec));
	}

	/**
	 * Link-preview card: the whole photo, uncropped, centred over a blurred and slightly darkened
	 * enlargement of itself. Richer than white bands in a WhatsApp or social card, and the photo
	 * stays the clear subject. With a logo, a white strip along the foot carries it at the right.
	 */
	private async renderBlurFill(bytes: Uint8Array, spec: ImageRenderSpec): Promise<RenderedImage> {
		const width = spec.width;
		const height = spec.height ?? spec.width;
		const photo = await this.base(bytes).resize({ width, height, fit: 'inside' }).toBuffer();
		const layers: sharp.OverlayOptions[] = [{ input: photo, gravity: 'centre' }];
		if (spec.stripLogo) layers.push(...(await this.brandStrip(spec.stripLogo, width, height)));
		return this.finish(this.encodeCard(sharp(await this.backdrop(bytes, width, height)).composite(layers), spec));
	}

	/**
	 * The tall Status/Story card (1080×1920): the blurred fill, an empty dark band near the top for
	 * the words the shopper's phone writes, and the whole photo below it, uncropped.
	 */
	private async renderStory(bytes: Uint8Array, spec: ImageRenderSpec): Promise<RenderedImage> {
		const width = spec.width;
		const height = spec.height ?? Math.round((width * 16) / 9);
		const bandTop = Math.round(height * STORY_LAYOUT.band.top);
		const bandHeight = Math.round(height * STORY_LAYOUT.band.height);
		const photoTop = Math.round(height * STORY_LAYOUT.photo.top);
		const side = Math.round(width * STORY_LAYOUT.photo.side);
		const box = {
			width: width - side * 2,
			height: height - photoTop - Math.round(height * STORY_LAYOUT.photo.bottom),
		};
		const band = await sharp({
			create: { width, height: bandHeight, channels: 4, background: { r: 30, g: 36, b: 42, alpha: 0.88 } },
		})
			.png()
			.toBuffer();
		const photo = await this.base(bytes)
			.resize({ ...box, fit: 'inside' })
			.toBuffer({ resolveWithObject: true });
		const layers: sharp.OverlayOptions[] = [
			{ input: band, top: bandTop, left: 0 },
			{
				input: photo.data,
				top: photoTop + Math.round((box.height - photo.info.height) / 2),
				left: Math.round((width - photo.info.width) / 2),
			},
		];
		return this.finish(this.encodeCard(sharp(await this.backdrop(bytes, width, height)).composite(layers), spec));
	}

	/** The photo enlarged to fill the card, blurred and slightly darkened. */
	private backdrop(bytes: Uint8Array, width: number, height: number): Promise<Buffer> {
		return this.base(bytes)
			.resize({ width, height, fit: 'cover', position: 'centre' })
			.blur(Math.max(12, Math.round(width / 40)))
			.modulate({ brightness: 0.82 })
			.toBuffer();
	}

	/** A white strip along the card's foot with the logo at its right, inset from the edges. */
	private async brandStrip(logo: Uint8Array, width: number, height: number): Promise<sharp.OverlayOptions[]> {
		const stripHeight = Math.round(height * BRAND_STRIP_HEIGHT);
		const inset = Math.round(stripHeight * 0.14);
		const strip = await sharp({
			create: { width, height: stripHeight, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0.96 } },
		})
			.png()
			.toBuffer();
		const mark = await sharp(logo)
			.resize({ width: Math.round(width * 0.45), height: stripHeight - inset * 2, fit: 'inside' })
			.png()
			.toBuffer({ resolveWithObject: true });
		return [
			{ input: strip, top: height - stripHeight, left: 0 },
			{
				input: mark.data,
				top: height - stripHeight + Math.round((stripHeight - mark.info.height) / 2),
				left: width - inset * 2 - mark.info.width,
			},
		];
	}

	private encodeCard(pipeline: Sharp, spec: ImageRenderSpec): Sharp {
		const sharpened = pipeline.sharpen({ sigma: 0.5 });
		return spec.format === 'image/jpeg'
			? sharpened.jpeg({ quality: spec.quality, mozjpeg: true, progressive: true })
			: sharpened.webp({ quality: spec.quality, effort: 5, smartSubsample: true });
	}

	private async finish(pipeline: Sharp): Promise<RenderedImage> {
		const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
		const out = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
		return {
			bytes: out,
			width: info.width,
			height: info.height,
			sha256: createHash('sha256').update(out).digest('hex'),
		};
	}

	async placeholder(original: Uint8Array): Promise<{ thumbHash: string; dominantColor: string }> {
		const { bytes } = await this.readable(original);
		const small = await this.base(bytes)
			.resize({ width: THUMBHASH_EDGE, height: THUMBHASH_EDGE, fit: 'inside' })
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });
		const hash = rgbaToThumbHash(small.info.width, small.info.height, small.data);
		const { dominant } = await this.base(bytes).resize({ width: 64, height: 64, fit: 'inside' }).stats();
		const hex = (value: number) => Math.round(value).toString(16).padStart(2, '0');
		return {
			thumbHash: Buffer.from(hash).toString('base64'),
			dominantColor: `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`,
		};
	}

	private encode(pipeline: Sharp, spec: ImageRenderSpec): Sharp {
		if (spec.format === 'image/png') return pipeline.png({ compressionLevel: 9, palette: false });
		if (spec.format === 'image/jpeg')
			return pipeline.jpeg({ quality: spec.quality, mozjpeg: true, progressive: true });
		return pipeline.webp({ quality: spec.quality, effort: 5, smartSubsample: true });
	}

	/** Upright, sRGB, and see-through parts laid on `background` (white unless a fill says otherwise). */
	private base(bytes: Uint8Array, keepAlpha = false, background: typeof WHITE = WHITE) {
		const image = sharp(bytes, { limitInputPixels: this.options.maxInputPixels, failOn: 'error' }).rotate();
		return (keepAlpha ? image : image.flatten({ background })).toColourspace('srgb');
	}
}

/**
 * The part of the upright photo a focal-point crop keeps (S10): the largest window of the box's shape, centred on the
 * point as far as the photo allows. Null when the photo can't be read (the plain centred crop then applies).
 */
export async function focalWindow(
	bytes: Uint8Array,
	spec: Pick<ImageRenderSpec, 'width' | 'height' | 'focal'>,
): Promise<{ left: number; top: number; width: number; height: number } | null> {
	const meta = await sharp(bytes).metadata();
	if (!meta.width || !meta.height || !spec.focal) return null;
	// EXIF orientations 5–8 turn the photo on its side: the upright width is the stored height.
	const sideways = (meta.orientation ?? 1) >= 5;
	const width = sideways ? meta.height : meta.width;
	const height = sideways ? meta.width : meta.height;
	const ratio = spec.width / (spec.height ?? spec.width);
	const clamp = (value: number, max: number) => Math.min(Math.max(0, value), max);
	const keepWidth = width / height > ratio ? Math.round(height * ratio) : width;
	const keepHeight = width / height > ratio ? height : Math.round(width / ratio);
	const x = clamp(spec.focal.x, 1);
	const y = clamp(spec.focal.y, 1);
	return {
		left: clamp(Math.round(x * width - keepWidth / 2), width - keepWidth),
		top: clamp(Math.round(y * height - keepHeight / 2), height - keepHeight),
		width: keepWidth,
		height: keepHeight,
	};
}
