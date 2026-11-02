import { describe, expect, it } from 'vitest';

import { ContentBlockInput, contentBlockAssetIds, contentBlockKey, normalizeYouTubeVideoId } from '../src/index';

const block = (overrides: Record<string, unknown> = {}) => ({
	ownerType: 'home',
	position: 'hero',
	slot: 'main',
	images: { desktop: 'med_d' },
	...overrides,
});

describe('ContentBlockInput', () => {
	it('accepts a text-free hero with live text', () => {
		expect(
			ContentBlockInput.safeParse(block({ heading: { en: 'Festive edit', fr: 'Édition festive' } })).success,
		).toBe(true);
	});
	it('requires a phone image when a wide banner bakes text into the art', () => {
		expect(ContentBlockInput.safeParse(block({ containsText: true })).success).toBe(false);
		expect(
			ContentBlockInput.safeParse(block({ containsText: true, images: { desktop: 'd', phone: 'p' } })).success,
		).toBe(true);
		expect(
			ContentBlockInput.safeParse(
				block({
					containsText: true,
					images: { desktop: 'd', phone: 'p' },
					localeImages: { fr: { desktop: 'fd' } },
				}),
			).success,
		).toBe(false);
	});
	it('does not require a phone image on a narrow slot', () => {
		expect(
			ContentBlockInput.safeParse(block({ position: 'promo_cards', slot: 'card_1', containsText: true })).success,
		).toBe(true);
	});
	it('rejects slots the position does not have, and owner mismatches', () => {
		expect(ContentBlockInput.safeParse(block({ position: 'strip', slot: 'side' })).success).toBe(false);
		expect(ContentBlockInput.safeParse(block({ ownerType: 'category', position: 'category_banner' })).success).toBe(
			false,
		);
	});
	it('rejects a schedule that ends before it starts', () => {
		expect(
			ContentBlockInput.safeParse(
				block({ startsAt: '2026-11-10T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z' }),
			).success,
		).toBe(false);
	});
});

describe('content block helpers', () => {
	it('keys by owner, position and slot — never by theme', () => {
		expect(contentBlockKey({ ownerType: 'home', ownerId: null, position: 'hero', slot: 'main' })).toBe(
			'home:-:hero:main',
		);
	});
	it('lists every referenced asset once', () => {
		expect(
			contentBlockAssetIds({
				images: { desktop: 'a', tablet: null, phone: 'b' },
				localeImages: { fr: { desktop: 'c', tablet: null, phone: 'b' } },
			}),
		).toEqual(['a', 'b', 'c']);
	});
});

describe('normalizeYouTubeVideoId', () => {
	it.each([
		['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
		['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'dQw4w9WgXcQ'],
		['https://youtu.be/dQw4w9WgXcQ?si=x', 'dQw4w9WgXcQ'],
		['youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
		['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
	])('normalises %s', (input, expected) => {
		expect(normalizeYouTubeVideoId(input)).toBe(expected);
	});
	it('rejects anything else', () => {
		expect(normalizeYouTubeVideoId('https://vimeo.com/123')).toBeNull();
		expect(normalizeYouTubeVideoId('not a video')).toBeNull();
	});
});
