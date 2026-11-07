import { ImageDecodeError } from '@saha-textile/core-domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SharpImageCodec } from '../src/index.js';

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
});
