import { describe, expect, it } from 'vitest';

import { heicColourProfile, looksLikeHeic, sniffPhoto, withColourProfile } from '../src/catalog/media-files';

/** HEIC in the browser (media step 2d): the colour profile a browser drops is put back into the JPEG. */
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const jpeg = (...segments: number[][]) =>
	new Uint8Array([0xff, 0xd8, ...segments.flat(), 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);
const app = (marker: number, body: number[]) => [
	0xff,
	marker,
	(body.length + 2) >> 8,
	(body.length + 2) & 0xff,
	...body,
];
const iccSegments = (bytes: Uint8Array) => {
	const found: number[][] = [];
	for (let i = 0; i < bytes.length - 15; i += 1) {
		if (
			bytes[i] === 0xff &&
			bytes[i + 1] === 0xe2 &&
			String.fromCharCode(...bytes.slice(i + 4, i + 15)) === 'ICC_PROFILE'
		) {
			const length = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
			found.push([...bytes.slice(i + 18, i + 2 + length)]);
		}
	}
	return found;
};

describe('HEIC colour fix', () => {
	it('knows a photo by its bytes and a HEIC by its type or name', () => {
		expect(sniffPhoto(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
		expect(sniffPhoto(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('png');
		expect(sniffPhoto(new Uint8Array([0, 0, 0, 24, ...ascii('ftypheic')]))).toBe('heic');
		expect(sniffPhoto(new Uint8Array(ascii('%PDF-1.7 ....')))).toBeNull();
		expect(looksLikeHeic('', 'IMG_0326.HEIC')).toBe(true);
		expect(looksLikeHeic('image/heif', 'x')).toBe(true);
		expect(looksLikeHeic('image/jpeg', 'x.jpg')).toBe(false);
	});

	it('finds the HEIC’s own colour profile, and none when it has none', () => {
		const profile = ascii('fake Display P3 profile bytes');
		const box = [0, 0, 0, 8 + 4 + profile.length, ...ascii('colrprof'), ...profile];
		const heic = new Uint8Array([0, 0, 0, 24, ...ascii('ftypheic'), 0, 0, 0, 0, ...box, 1, 2, 3]);
		expect([...(heicColourProfile(heic) ?? [])]).toEqual(profile);
		expect(heicColourProfile(new Uint8Array(64))).toBeNull();
	});

	it('puts the profile right after the start, replacing any the browser wrote, and keeps the picture', () => {
		const old = app(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, 9, 9, 9]);
		const exif = app(0xe1, ascii('Exif\0\0x'));
		const fixed = withColourProfile(jpeg(old, exif), new Uint8Array([7, 7, 7]));
		expect(iccSegments(fixed)).toEqual([[7, 7, 7]]);
		expect([...fixed.slice(0, 4)]).toEqual([0xff, 0xd8, 0xff, 0xe2]);
		// The picture itself (from the scan marker on) is untouched.
		expect([...fixed.slice(-8)]).toEqual([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);
		expect(fixed.includes(0xe1)).toBe(true);
		// Not a JPEG, or no profile: unchanged.
		const plain = new Uint8Array([1, 2, 3]);
		expect(withColourProfile(plain, new Uint8Array([1]))).toBe(plain);
	});

	it('splits a profile over 64 KB into numbered segments', () => {
		const big = new Uint8Array(70_000).fill(5);
		const segments = iccSegments(withColourProfile(jpeg(), big));
		expect(segments.map((part) => part.length)).toEqual([65519, 70_000 - 65519]);
	});
});
