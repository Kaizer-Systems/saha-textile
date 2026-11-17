import { MediaAsset, Product, ProductVariant } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { CatalogPublicService } from '../src/catalog/catalog-public.service';

const product = Product.parse({
	id: 'prd_saree',
	type: 'simple',
	sku: 'SR-1',
	title: { en: 'Red Banarasi Saree' },
	slug: 'red-banarasi-saree',
	basePriceINR: 9000,
	status: 'live',
	lifecycle: { liveAt: '2026-10-01T00:00:00.000Z' },
	media: { gallery: ['med_main', 'med_back'], compound: [], altOverrides: {} },
});

const variant = ProductVariant.parse({
	id: 'var_1',
	productId: 'prd_saree',
	sku: 'SR-1',
	status: 'live',
	optionSelections: [{ attributeCode: 'size', termCode: 'free' }],
	optionSelectionHash: 'size:free',
	isBaseVariant: true,
	priceINR: 9000,
	stock: { quantity: 2 },
});

const derivative = (role: string, width: number, height: number) => ({
	role,
	storageKey: `media/${role}-${width}.jpg`,
	width,
	height,
	byteSize: 1000,
	format: 'image/jpeg',
	roleVersion: 1,
});

const asset = (id: string, withShare: boolean) =>
	MediaAsset.parse({
		id,
		kind: 'image',
		purpose: 'product',
		originalFormat: 'image/jpeg',
		originalByteSize: 1000,
		width: 1200,
		height: 1600,
		slug: id.replace('_', '-'),
		processing: { state: 'ready' },
		derivatives: [
			derivative('card', 200, 267),
			derivative('gallery', 900, 1200),
			derivative('zoom', 2000, 2667),
			...(withShare ? [derivative('share', 1200, 630), derivative('story', 1080, 1920)] : []),
		],
	});

function service(withShare: boolean) {
	const assets = [asset('med_main', withShare), asset('med_back', withShare)];
	return new CatalogPublicService(
		{ findBySlug: async () => product, findById: async () => null } as never,
		{ listForProduct: async () => [variant], listForProducts: async () => [] } as never,
		null,
		{ findManyByIds: async (ids: string[]) => assets.filter((row) => ids.includes(row.id)) } as never,
		{ getUrl: (key: string) => `https://cdn.test/${key}` } as never,
		null,
		null,
		null,
	);
}

describe('product page link-preview card', () => {
	it('sends the main photo’s 1200×630 card on its own, keeping gallery photos to their gallery, zoom and card sizes', async () => {
		const page = await service(true).page('red-banarasi-saree');
		expect(page.shareImageUrl).toBe('https://cdn.test/media/share-1200.jpg');
		expect(page.shareImageSize).toEqual({ width: 1200, height: 630, type: 'image/jpeg' });
		expect(page.shareStoryUrl).toBe('https://cdn.test/media/story-1080.jpg');
		// The thumbnail strip's card size rides along; the share and story cards stay off the gallery photos.
		expect(page.gallery.map((image) => Object.keys(image.roles).sort())).toEqual([
			['card', 'gallery', 'zoom'],
			['card', 'gallery', 'zoom'],
		]);
	});

	it('sends the product videos in admin order, and none when it has none', async () => {
		expect((await service(false).page('red-banarasi-saree')).videos).toEqual([]);
		const short = { videoId: 'YfNsUapqTqE', title: 'S', thumbnailUrl: 'u', kind: 'short', durationSeconds: 48 };
		const gone = { ...short, videoId: 'QRP0xuczTUo', unavailableSince: '2026-11-16T23:00:00.000Z' };
		product.videos = [short as never, gone as never];
		const page = await service(false).page('red-banarasi-saree');
		product.videos = [];
		// A video the weekly check found gone is left off the page.
		expect(page.videos).toEqual([short]);
	});

	it('sends none before the main-photo sizes are made', async () => {
		const page = await service(false).page('red-banarasi-saree');
		expect(page.shareImageUrl).toBeNull();
		expect(page.shareImageSize).toBeNull();
		expect(page.shareStoryUrl).toBeNull();
		expect(page.gallery).toHaveLength(2);
	});
});

describe('the Meta image: a share picture chosen in the admin (owner, 17 Nov)', () => {
	const sized = (versionId: string, width: number, format = 'image/jpeg') => ({
		role: format === 'image/jpeg' ? 'gallery' : 'zoom',
		storageKey: `media/${versionId}-${width}.${format === 'image/jpeg' ? 'jpg' : 'webp'}`,
		width,
		height: Math.round(width / 1.91),
		byteSize: 1000,
		format,
		roleVersion: 1,
		versionId,
	});
	const version = (id: string) => ({
		id,
		profileKey: id.split('.')[0],
		profileVersion: 1,
		fill: id.split('.')[1],
		createdAt: '2026-11-17T00:00:00.000Z',
	});
	const chosen = (deletedAt: string | null = null) =>
		MediaAsset.parse({
			id: 'med_share',
			kind: 'image',
			purpose: 'product',
			originalFormat: 'image/jpeg',
			originalByteSize: 1000,
			width: 2400,
			height: 1256,
			slug: 'share',
			processing: { state: 'ready' },
			versions: [version('link_preview.crop'), version('square.white')],
			derivatives: [
				sized('link_preview.crop', 600),
				sized('link_preview.crop', 1200, 'image/webp'),
				sized('link_preview.crop', 1200),
				sized('link_preview.crop', 2400),
				sized('square.white', 1200),
			],
			deletedAt,
		});

	function withShare(shareImage: unknown, picture = chosen()) {
		const own = Product.parse({ ...product, media: { ...product.media, shareImage } });
		const assets = [asset('med_main', true), asset('med_back', true), picture];
		return new CatalogPublicService(
			{ findBySlug: async () => own, findById: async () => null } as never,
			{ listForProduct: async () => [variant], listForProducts: async () => [] } as never,
			null,
			{ findManyByIds: async (ids: string[]) => assets.filter((row) => ids.includes(row.id)) } as never,
			{ getUrl: (key: string) => `https://cdn.test/${key}` } as never,
			null,
			null,
			null,
		);
	}

	it('sends the chosen version at the link-preview width, as JPEG, over the main photo', async () => {
		const page = await withShare({ assetId: 'med_share', versionId: 'link_preview.crop' }).page('red-banarasi-saree');
		expect(page.shareImageUrl).toBe('https://cdn.test/media/link_preview.crop-1200.jpg');
		expect(page.shareImageSize).toEqual({ width: 1200, height: 628, type: 'image/jpeg' });
		// The tall Story card stays the main photo's.
		expect(page.shareStoryUrl).toBe('https://cdn.test/media/story-1080.jpg');
	});

	it('keeps to the version stored, never another version of the same photo', async () => {
		const page = await withShare({ assetId: 'med_share', versionId: 'square.white' }).page('red-banarasi-saree');
		expect(page.shareImageUrl).toBe('https://cdn.test/media/square.white-1200.jpg');
	});

	it('falls back to the main photo’s card when the chosen photo is in the bin or unknown', async () => {
		const binned = withShare({ assetId: 'med_share', versionId: 'link_preview.crop' }, chosen('2026-11-17T01:00:00.000Z'));
		expect((await binned.page('red-banarasi-saree')).shareImageUrl).toBe('https://cdn.test/media/share-1200.jpg');
		const unknown = withShare({ assetId: 'med_gone', versionId: null });
		expect((await unknown.page('red-banarasi-saree')).shareImageUrl).toBe('https://cdn.test/media/share-1200.jpg');
	});
});

describe('the Variation image: a variant’s own picture at its version (owner, 17 Nov)', () => {
	const groups = [
		{
			attributeCode: 'colour',
			label: { en: 'Colour' },
			semanticRole: 'variation_axis',
			displayStyle: 'rectangle',
			terms: [
				{ code: 'red', label: { en: 'Red' } },
				{ code: 'blue', label: { en: 'Blue' } },
			],
		},
	];
	const two = Product.parse({ ...product, type: 'variable', optionGroups: groups });
	const row = (id: string, term: string, media?: { primaryAssetId: string; primaryVersionId: string | null }) =>
		ProductVariant.parse({
			...variant,
			id,
			sku: `SR-${term}`,
			isBaseVariant: term === 'red',
			optionSelections: [{ attributeCode: 'colour', termCode: term }],
			optionSelectionHash: `colour:${term}`,
			media,
		});

	function pageWith(rows: ProductVariant[]) {
		const assets = [asset('med_main', true), asset('med_back', true), asset('med_blue', false)];
		return new CatalogPublicService(
			{ findBySlug: async () => two, findById: async () => null } as never,
			{ listForProduct: async () => rows, listForProducts: async () => [] } as never,
			null,
			{ findManyByIds: async (ids: string[]) => assets.filter((each) => ids.includes(each.id)) } as never,
			{ getUrl: (key: string) => `https://cdn.test/${key}` } as never,
			null,
			null,
			null,
		).page('red-banarasi-saree');
	}

	it('points at the gallery photo when the variant’s picture is one of them', async () => {
		const page = await pageWith([row('var_r', 'red'), row('var_b', 'blue', { primaryAssetId: 'med_back', primaryVersionId: null })]);
		expect(page.gallery).toHaveLength(2);
		expect(page.variants.find((each) => each.id === 'var_b')?.galleryIndex).toBe(1);
		expect(page.variants.find((each) => each.id === 'var_r')?.galleryIndex).toBeNull();
	});

	it('adds a picture that is not in the gallery once, after it, so choosing the variant shows it', async () => {
		const blue = { primaryAssetId: 'med_blue', primaryVersionId: null };
		const page = await pageWith([row('var_r', 'red', blue), row('var_b', 'blue', blue)]);
		expect(page.gallery).toHaveLength(3);
		expect(page.variants.map((each) => each.galleryIndex)).toEqual([2, 2]);
	});
});
