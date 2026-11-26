import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { asJpeg, layoutStoryWords, writeStoryWords } from './story-card';

const WORDS = { name: 'Red Banarasi silk saree with zari border', facts: 'Pure silk · 6.3 m', shop: 'Saha Textile' };

const card = new Blob(['card'], { type: 'image/jpeg' });
const drawn = new Blob(['drawn'], { type: 'image/jpeg' });

const context = () => ({
	font: '',
	fillStyle: '',
	drawImage: vi.fn(),
	fillText: vi.fn(),
	measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
});

let ctx: ReturnType<typeof context> | null;
let toBlobGives: Blob | null;

beforeEach(() => {
	ctx = context();
	toBlobGives = drawn;
	vi.stubGlobal(
		'createImageBitmap',
		vi.fn(async () => ({ width: 1080, height: 1920 })),
	);
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never);
	HTMLCanvasElement.prototype.toBlob = function (done: BlobCallback) {
		done(toBlobGives);
	};
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	delete (document as { fonts?: unknown }).fonts;
});

describe('layoutStoryWords', () => {
	it('stops shrinking at half size when even that does not fit the band', () => {
		const lines = layoutStoryWords(WORDS, 1080, 40, (text) => text.length * 1000);
		expect(lines.length).toBeGreaterThan(0);
		expect(lines[0]?.size).toBeLessThan(1080 * 0.0685 * 0.5);
	});
});

describe('writeStoryWords', () => {
	it('draws the card, then writes each line in its own font and colour, once the fonts are ready', async () => {
		Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
		await expect(writeStoryWords(card, WORDS, 'Public Sans')).resolves.toBe(drawn);
		expect(ctx?.drawImage).toHaveBeenCalledWith({ width: 1080, height: 1920 }, 0, 0);
		expect(ctx?.fillText).toHaveBeenCalled();
		expect(ctx?.font).toMatch(/^700 \d+px Public Sans$/);
	});

	it('shares the plain card when the browser has no canvas, cannot make a picture, or draws nothing', async () => {
		ctx = null;
		await expect(writeStoryWords(card, WORDS, 'Public Sans')).resolves.toBe(card);
		ctx = context();
		toBlobGives = null;
		await expect(writeStoryWords(card, WORDS, 'Public Sans')).resolves.toBe(card);
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn(async () => {
				throw new Error('cannot decode');
			}),
		);
		await expect(writeStoryWords(card, WORDS, 'Public Sans')).resolves.toBe(card);
	});
});

describe('asJpeg', () => {
	const webp = new Blob(['photo'], { type: 'image/webp' });

	it('keeps JPEG and PNG as they are', async () => {
		const png = new Blob(['p'], { type: 'image/png' });
		await expect(asJpeg(card)).resolves.toBe(card);
		await expect(asJpeg(png)).resolves.toBe(png);
	});

	it('redraws any other picture as a JPEG', async () => {
		await expect(asJpeg(webp)).resolves.toBe(drawn);
		expect(ctx?.drawImage).toHaveBeenCalled();
	});

	it('shares the picture as it is when the browser cannot redraw it', async () => {
		toBlobGives = null;
		await expect(asJpeg(webp)).resolves.toBe(webp);
		ctx = null;
		await expect(asJpeg(webp)).resolves.toBe(webp);
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn(async () => {
				throw new Error('cannot decode');
			}),
		);
		await expect(asJpeg(webp)).resolves.toBe(webp);
	});
});
