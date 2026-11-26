import { describe, expect, it, vi } from 'vitest';

import { heicToJpeg, type HeicConvert } from './heic';

/** HEIC in the browser (media step 2d): full size, top quality first, colours kept. */
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const heic = (withProfile: boolean) => {
	const profile = ascii('P3 profile');
	const box = withProfile ? [0, 0, 0, 12 + profile.length, ...ascii('colrprof'), ...profile] : [];
	return new File([new Uint8Array([0, 0, 0, 24, ...ascii('ftypheic'), 0, 0, 0, 0, ...box])], 'IMG_0326.HEIC', {
		type: 'image/heic',
	});
};
const jpegOf = (bytes: number) => {
	const body = new Uint8Array(bytes);
	body.set([0xff, 0xd8, 0xff, 0xda, 0, 2]);
	return new Blob([body], { type: 'image/jpeg' });
};

describe('heicToJpeg', () => {
	it('makes a full-quality JPEG named .jpg, with the photo’s colour profile put back', async () => {
		const convert = vi.fn<HeicConvert>(async () => jpegOf(64));
		const made = await heicToJpeg(heic(true), convert);
		expect(convert).toHaveBeenCalledTimes(1);
		expect(convert.mock.calls[0]?.[1]).toBe(1);
		expect(made.name).toBe('IMG_0326.jpg');
		expect(made.type).toBe('image/jpeg');
		const bytes = new Uint8Array(await made.arrayBuffer());
		expect(String.fromCharCode(...bytes.slice(6, 17))).toBe('ICC_PROFILE');
	});

	it('steps the quality down to 95, then 90, while the JPEG is over 25 MB', async () => {
		const sizes = [27 * 1024 * 1024, 26 * 1024 * 1024, 24 * 1024 * 1024];
		const convert = vi.fn<HeicConvert>(async () => jpegOf(sizes.shift() ?? 10));
		const made = await heicToJpeg(heic(false), convert);
		expect(convert.mock.calls.map((call) => call[1])).toEqual([1, 0.95, 0.9]);
		expect(made.size).toBe(24 * 1024 * 1024);
	});
});
