import { createHash } from 'node:crypto';

import {
	BRAND_STRIP_HEIGHT,
	ImageDecodeError,
	STORY_LAYOUT,
	type ImageCodecPort,
	type ImageProbe,
	type ImageRenderSpec,
	type RenderedImage,
} from '@saha-textile/core-domain';
import sharp, { type Sharp } from 'sharp';
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
		if (spec.fit === 'story') return this.renderStory(bytes, spec);
		if (spec.fit === 'pad' && spec.inset) return this.renderInset(bytes, spec);
		let pipeline = this.base(bytes, spec.keepAlpha);
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
		pipeline = this.encode(pipeline, spec);
		return this.finish(pipeline);
	}

	/** A padded card with a white margin: the image fitted inside the inner box, then centred on white. */
	private async renderInset(bytes: Uint8Array, spec: ImageRenderSpec): Promise<RenderedImage> {
		const width = spec.width;
		const height = spec.height ?? spec.width;
		const inset = Math.min(0.4, Math.max(0, spec.inset ?? 0));
		const inner = await this.base(bytes, spec.keepAlpha)
			.resize({
				width: Math.max(1, Math.round(width * (1 - 2 * inset))),
				height: Math.max(1, Math.round(height * (1 - 2 * inset))),
				fit: 'inside',
				withoutEnlargement: false,
			})
			.png()
			.toBuffer({ resolveWithObject: true });
		const pipeline = sharp({ create: { width, height, channels: 4, background: WHITE } }).composite([
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

	private encode(pipeline: Sharp, spec: ImageRenderSpec): Sharp {
		if (spec.format === 'image/png') return pipeline.png({ compressionLevel: 9, palette: false });
		if (spec.format === 'image/jpeg')
			return pipeline.jpeg({ quality: spec.quality, mozjpeg: true, progressive: true });
		return pipeline.webp({ quality: spec.quality, effort: 5, smartSubsample: true });
	}

	private base(bytes: Uint8Array, keepAlpha = false) {
		const image = sharp(bytes, { limitInputPixels: this.options.maxInputPixels, failOn: 'error' }).rotate();
		return (keepAlpha ? image : image.flatten({ background: WHITE })).toColourspace('srgb');
	}
}
