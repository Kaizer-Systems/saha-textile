import { describe, expect, it } from 'vitest';

import { MediaAsset, MediaProfile, MediaVersionId } from '../src/index';

/** Image profiles and photo versions (media build step 2a, Media brief R4-1). */
const AT = '2026-11-16T00:00:00.000Z';

const card = (versionId?: string | null) => ({
	role: 'card',
	storageKey: `media/med_1/red-banarasi-card-400w-${versionId ?? 'none'}.webp`,
	width: 400,
	height: 533,
	byteSize: 4000,
	format: 'image/webp',
	roleVersion: 1,
	...(versionId === undefined ? {} : { versionId }),
});

const photo = (fields: Record<string, unknown>) =>
	MediaAsset.safeParse({
		id: 'med_1',
		kind: 'image',
		originalFormat: 'image/jpeg',
		originalByteSize: 1000,
		slug: 'red-banarasi',
		...fields,
	});

const version = (id: string) => {
	const [profileKey, fill] = id.split('.');
	return { id, profileKey, profileVersion: 1, fill, state: 'ready', createdAt: AT };
};

describe('photo versions on the asset', () => {
	it('lets two versions hold the same size, the point of fills side by side', () => {
		const result = photo({
			versions: [version('product_3x4.white'), version('product_3x4.blur')],
			derivatives: [card('product_3x4.white'), card('product_3x4.blur')],
		});
		expect(result.success).toBe(true);
	});

	it('still refuses the same size twice in one version, or outside any version', () => {
		expect(photo({ derivatives: [card(), card()] }).success).toBe(false);
		expect(
			photo({
				versions: [version('product_3x4.white')],
				derivatives: [card('product_3x4.white'), card('product_3x4.white')],
			}).success,
		).toBe(false);
	});

	it('refuses a file naming a version the photo does not have, and a version listed twice', () => {
		expect(photo({ derivatives: [card('hero_21x9.crop')] }).error?.issues[0]?.message).toMatch(
			/version the asset does not have/,
		);
		expect(
			photo({ versions: [version('hero_21x9.crop'), version('hero_21x9.crop')], derivatives: [] }).success,
		).toBe(false);
	});

	it('reads an asset stored before versions existed, and a file made once per photo', () => {
		expect(photo({ derivatives: [card()] }).success).toBe(true);
		expect(photo({ derivatives: [card(null)] }).success).toBe(true);
	});

	it('names a version by its profile and fill, and knows no stretch fill', () => {
		expect(MediaVersionId.safeParse('hero_21x9.crop').success).toBe(true);
		expect(MediaVersionId.safeParse('logo_keep_shape.as_is').success).toBe(true);
		expect(MediaVersionId.safeParse('hero_21x9.stretch').success).toBe(false);
		expect(MediaVersionId.safeParse('Hero.crop').success).toBe(false);
	});
});

describe('image profiles', () => {
	const base = {
		key: 'hero_21x9',
		name: 'Hero 21:9',
		shape: { width: 21, height: 9 },
		roles: ['banner'],
		fills: ['crop', 'blur', 'colour'],
		maxBytes: 25 * 1024 * 1024,
		accepts: ['image/jpeg', 'image/png'],
	};

	it('accepts a profile like the approved Hero 21:9, with sensible defaults', () => {
		expect(MediaProfile.parse(base)).toMatchObject({
			builtIn: false,
			enabled: true,
			version: 1,
			minSize: null,
			mainPhotoOnly: false,
		});
	});

	it('refuses fills on a keep-shape profile, fills or sizes listed twice, “as is” as a choice, and over 25 MB', () => {
		expect(MediaProfile.safeParse({ ...base, shape: null }).success).toBe(false);
		expect(MediaProfile.safeParse({ ...base, fills: ['crop', 'crop'] }).success).toBe(false);
		expect(MediaProfile.safeParse({ ...base, roles: ['banner', 'banner'] }).success).toBe(false);
		expect(MediaProfile.safeParse({ ...base, fills: ['as_is'] }).success).toBe(false);
		expect(MediaProfile.safeParse({ ...base, maxBytes: 26 * 1024 * 1024 }).success).toBe(false);
		expect(MediaProfile.safeParse({ ...base, name: '   ' }).success).toBe(false);
	});
});
