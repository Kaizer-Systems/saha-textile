import { createHash } from 'node:crypto';

import {
	ImageDecodeError,
	type ImageCodecPort,
	type ImageProbe,
	type ImageRenderSpec,
	type RenderedImage,
} from '@saha-textile/core-domain';
import sharp from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
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
export class SharpImageCodec implements ImageCodecPort {
	constructor(private readonly options: { maxInputPixels: number } = { maxInputPixels: 50_000_000 }) {}

	async probe(bytes: Uint8Array): Promise<ImageProbe> {
		try {
			const meta = await sharp(bytes, { limitInputPixels: this.options.maxInputPixels }).metadata();
			if (!meta.width || !meta.height) throw new Error('no dimensions');
			// Orientations 5–8 swap the axes once the image is rotated upright.
			const swapped = (meta.orientation ?? 1) >= 5;
			return {
				width: swapped ? meta.height : meta.width,
				height: swapped ? meta.width : meta.height,
				format:
					meta.format === 'jpeg' || meta.format === 'png' || meta.format === 'webp' ? meta.format : 'other',
				hasAlpha: meta.hasAlpha ?? false,
			};
		} catch (error) {
			throw new ImageDecodeError('the upload is not a decodable image', error);
		}
	}

	async render(bytes: Uint8Array, spec: ImageRenderSpec): Promise<RenderedImage> {
		if (spec.fit === 'blur') return this.renderBlurFill(bytes, spec);
		let pipeline = this.base(bytes);
		pipeline =
			spec.fit === 'inside'
				? pipeline.resize({ width: spec.width, withoutEnlargement: true })
				: pipeline.resize({
						width: spec.width,
						height: spec.height ?? spec.width,
						fit: spec.fit === 'cover' ? 'cover' : 'contain',
						position: 'centre',
						background: WHITE,
						withoutEnlargement: false,
					});
		pipeline = pipeline.sharpen({ sigma: 0.5 });
		pipeline =
			spec.format === 'image/jpeg'
				? pipeline.jpeg({ quality: spec.quality, mozjpeg: true, progressive: true })
				: pipeline.webp({ quality: spec.quality, effort: 5, smartSubsample: true });

		const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
		const out = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
		return {
			bytes: out,
			width: info.width,
			height: info.height,
			sha256: createHash('sha256').update(out).digest('hex'),
		};
	}

	/**
	 * Link-preview card: the whole photo, uncropped, centred over a blurred and slightly darkened
	 * enlargement of itself. Richer than white bands in a WhatsApp or social card, and the photo
	 * stays the clear subject.
	 */
	private async renderBlurFill(bytes: Uint8Array, spec: ImageRenderSpec): Promise<RenderedImage> {
		const width = spec.width;
		const height = spec.height ?? spec.width;
		const backdrop = await this.base(bytes)
			.resize({ width, height, fit: 'cover', position: 'centre' })
			.blur(Math.max(12, Math.round(width / 40)))
			.modulate({ brightness: 0.82 })
			.toBuffer();
		const photo = await this.base(bytes).resize({ width, height, fit: 'inside' }).toBuffer();
		let pipeline = sharp(backdrop)
			.composite([{ input: photo, gravity: 'centre' }])
			.sharpen({ sigma: 0.5 });
		pipeline =
			spec.format === 'image/jpeg'
				? pipeline.jpeg({ quality: spec.quality, mozjpeg: true, progressive: true })
				: pipeline.webp({ quality: spec.quality, effort: 5, smartSubsample: true });
		const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
		const out = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
		return {
			bytes: out,
			width: info.width,
			height: info.height,
			sha256: createHash('sha256').update(out).digest('hex'),
		};
	}

	async placeholder(bytes: Uint8Array): Promise<{ thumbHash: string; dominantColor: string }> {
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

	private base(bytes: Uint8Array) {
		return sharp(bytes, { limitInputPixels: this.options.maxInputPixels, failOn: 'error' })
			.rotate()
			.flatten({ background: WHITE })
			.toColourspace('srgb');
	}
}
