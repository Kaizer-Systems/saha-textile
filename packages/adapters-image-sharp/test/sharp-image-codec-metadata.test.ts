import { ImageDecodeError } from '@saha-textile/core-domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SharpImageCodec, focalWindow } from '../src/sharp-image-codec';

const { metadata } = vi.hoisted(() => ({ metadata: vi.fn() }));

vi.mock('sharp', () => ({ default: () => ({ metadata }) }));

const codec = new SharpImageCodec();
const bytes = new Uint8Array([1]);

beforeEach(() => {
	metadata.mockReset();
});

describe('SharpImageCodec with incomplete metadata', () => {
	it.each([
		['width', { height: 10 }],
		['height', { width: 10 }],
	])('refuses an image with no %s', async (_label, meta) => {
		metadata.mockResolvedValue(meta);
		await expect(codec.probe(bytes)).rejects.toBeInstanceOf(ImageDecodeError);
	});

	it('assumes no alpha and no rotation when they are not reported', async () => {
		metadata.mockResolvedValue({ width: 10, height: 20, format: 'jpeg' });
		expect(await codec.probe(bytes)).toEqual({ width: 10, height: 20, format: 'jpeg', hasAlpha: false });
	});

	it.each([
		['heif', 'av1', 'avif'],
		['heif', 'hevc', 'other'],
		['raw', undefined, 'other'],
	])('reports %s with %s compression as %s', async (format, compression, expected) => {
		metadata.mockResolvedValue({ width: 10, height: 20, format, compression });
		await expect(codec.probe(bytes)).resolves.toMatchObject({ format: expected });
	});

	it('refuses an SVG the drawing library gives no size', async () => {
		metadata.mockResolvedValue({ format: 'svg' });
		const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
		const error: unknown = await codec.probe(svg).catch((thrown: unknown) => thrown);
		expect(error).toEqual(new ImageDecodeError('the upload is not a decodable image'));
		expect((error as Error).cause).toEqual(new ImageDecodeError('an SVG with no size'));
	});

	it('rejects a swatch cut when either source dimension is unknown', async () => {
		metadata.mockResolvedValue({ width: 10 });
		await expect(codec.cut(bytes, { x: 0, y: 0, width: 1, height: 1 })).rejects.toThrow('no size');
	});

	it.each([{ width: 10 }, { height: 20 }])('has no focal window with incomplete dimensions %j', async (meta) => {
		metadata.mockResolvedValue(meta);
		await expect(focalWindow(bytes, { width: 10, height: 10, focal: { x: 0.5, y: 0.5 } })).resolves.toBeNull();
	});
});
