import { ImageDecodeError } from '@saha-textile/core-domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decodeExtra } from '../src/extra-decoders';

/**
 * The PSD decoder's guards for what ag-psd can hand back but cannot be made to write: a file with no
 * flattened picture, pixels in a form other than 8, 16 or 32 bits, and a request to draw on a canvas.
 * ag-psd is replaced here so each answer can be given directly.
 */
const psd = vi.hoisted(() => ({
	createCanvas: null as null | (() => unknown),
	imageData: undefined as unknown,
}));

vi.mock('ag-psd', () => ({
	initializeCanvas: (createCanvas: () => unknown) => {
		psd.createCanvas = createCanvas;
	},
	readPsd: () => ({ imageData: psd.imageData }),
}));

describe('the PSD decoder’s guards', () => {
	beforeEach(() => {
		psd.imageData = undefined;
	});

	it('refuses a PSD saved without its flattened picture', async () => {
		await expect(decodeExtra(Uint8Array.of(0), 'psd')).rejects.toThrow(
			new ImageDecodeError('a PSD saved without its flattened picture (Maximise compatibility off)'),
		);
	});

	it('refuses pixels in a form it does not give pixels for', async () => {
		psd.imageData = { width: 1, height: 1, data: [0, 0, 0, 255] };
		await expect(decodeExtra(Uint8Array.of(0), 'psd')).rejects.toThrow(
			new ImageDecodeError('a PSD in a form this decoder does not give pixels for'),
		);
	});

	it('refuses to draw, because the worker has no canvas', async () => {
		await decodeExtra(Uint8Array.of(0), 'psd').catch(() => undefined);
		expect(psd.createCanvas).toBeTypeOf('function');
		expect(() => psd.createCanvas?.()).toThrow(
			new ImageDecodeError('this PSD needs drawing, which the worker does not do'),
		);
	});
});
