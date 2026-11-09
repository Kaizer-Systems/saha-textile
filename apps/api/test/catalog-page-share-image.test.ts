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
			derivative('gallery', 900, 1200),
			derivative('zoom', 2000, 2667),
			...(withShare ? [derivative('share', 1200, 630)] : []),
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
	it('sends the main photo’s 1200×630 card on its own, keeping gallery photos to gallery and zoom', async () => {
		const page = await service(true).page('red-banarasi-saree');
		expect(page.shareImageUrl).toBe('https://cdn.test/media/share-1200.jpg');
		expect(page.gallery.map((image) => Object.keys(image.roles).sort())).toEqual([
			['gallery', 'zoom'],
			['gallery', 'zoom'],
		]);
	});

	it('sends none before the main-photo sizes are made', async () => {
		const page = await service(false).page('red-banarasi-saree');
		expect(page.shareImageUrl).toBeNull();
		expect(page.gallery).toHaveLength(2);
	});
});
