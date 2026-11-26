import type { ImageDerivative, MediaAsset, MediaVersion } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { resolveImage, shownDerivatives, shownVersionIds, websitePicture } from '../src/index';

const file = (role: string, width: number, versionId: string | null): ImageDerivative => ({
	role,
	storageKey: `media/med_1/${versionId ?? 'photo'}/${role}-${width}`,
	width,
	height: Math.round((width * 4) / 3),
	byteSize: 10,
	format: 'image/webp',
	roleVersion: 1,
	versionId,
});

const version = (id: string, state: MediaVersion['state'] = 'ready'): MediaVersion => {
	const [profileKey = '', fill = 'as_is'] = id.split('.');
	return {
		id,
		profileKey,
		profileVersion: 1,
		fill: fill as MediaVersion['fill'],
		state,
		error: null,
		createdAt: '2026-11-16T00:00:00.000Z',
	};
};

const photo = (versions: MediaVersion[], derivatives: ImageDerivative[]) =>
	({ visibility: 'public', versions, derivatives }) as Pick<MediaAsset, 'visibility' | 'versions' | 'derivatives'>;

describe('the files the website draws while pages store only the photo', () => {
	it('keeps every file of a photo with no versions (made before step 2)', () => {
		const files = [file('card', 200, null), file('card', 400, null)];
		expect(shownDerivatives(photo([], files))).toEqual(files);
	});

	it('draws one version per role: the first ready one, never two mixed', () => {
		const white = [file('card', 200, 'product_3x4.white'), file('card', 400, 'product_3x4.white')];
		const blur = [file('card', 200, 'product_3x4.blur'), file('card', 400, 'product_3x4.blur')];
		const shown = shownDerivatives(
			photo([version('product_3x4.white'), version('product_3x4.blur')], [...white, ...blur]),
		);
		expect(shown).toEqual(white);
	});

	it('a version added later never changes what a page shows', () => {
		const first = [file('banner', 480, 'banner_keep_shape.as_is')];
		const later = [file('banner', 480, 'hero_21x9.crop'), file('banner', 960, 'hero_21x9.crop')];
		const asset = photo([version('banner_keep_shape.as_is'), version('hero_21x9.crop')], [...first, ...later]);
		expect(shownDerivatives(asset)).toEqual(first);
		expect([...shownVersionIds(asset)]).toEqual(['banner_keep_shape.as_is']);
	});

	it('skips versions still being made or failed, and falls back to the next ready one', () => {
		const making = [file('card', 200, 'product_3x4.white')];
		const ready = [file('card', 200, 'product_3x4.blur')];
		const asset = photo(
			[version('product_3x4.white', 'making'), version('product_3x4.blur')],
			[...making, ...ready],
		);
		expect(shownDerivatives(asset)).toEqual(ready);
		expect([...shownVersionIds(asset)]).toEqual(['product_3x4.blur']);
	});

	it('a version that adds a role of its own is shown for that role', () => {
		const product = [file('card', 200, 'product_3x4.as_is')];
		const blog = [file('blog', 480, 'blog_cover_2x1.crop')];
		const asset = photo([version('product_3x4.as_is'), version('blog_cover_2x1.crop')], [...product, ...blog]);
		expect(shownDerivatives(asset)).toEqual([...product, ...blog]);
		expect([...shownVersionIds(asset)].sort()).toEqual(['blog_cover_2x1.crop', 'product_3x4.as_is']);
	});

	it('pictures made once per photo show only where no version has their role', () => {
		const share = file('share', 1200, null);
		const card = file('card', 200, 'product_3x4.as_is');
		const legacyCard = file('card', 300, null);
		const asset = photo([version('product_3x4.as_is')], [share, card, legacyCard]);
		expect(shownDerivatives(asset)).toEqual([share, card]);
	});

	it('resolveImage and the website picture follow the same rule', () => {
		const white = [file('gallery', 600, 'product_3x4.white'), file('gallery', 1600, 'product_3x4.white')];
		const blur = [file('gallery', 2000, 'product_3x4.blur')];
		const asset = {
			...photo([version('product_3x4.white'), version('product_3x4.blur')], [...white, ...blur]),
			id: 'med_1',
			width: 3000,
			height: 4000,
			text: { alt: {}, title: {}, caption: {} },
			dominantColor: null,
			thumbHash: null,
		} as unknown as MediaAsset;
		const resolved = resolveImage({ asset, getUrl: (key) => key, locale: 'en', fallbackLocale: 'en' });
		expect(resolved?.roles['gallery']?.map((row) => row.width)).toEqual([600, 1600]);
		expect(websitePicture(asset)?.width).toBe(1600);
	});
});
