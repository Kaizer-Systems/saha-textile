import { MediaAsset, Product, ProductMerchandisingWrite, ProductVariant } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { CatalogService } from '../src/catalog/catalog.service';

type ProductRow = z.output<typeof Product>;

const product = (gallery: string[]): ProductRow =>
	Product.parse({
		id: 'prd_saree',
		type: 'simple',
		sku: 'SR-1',
		title: { en: 'Red Banarasi Saree' },
		slug: 'red-banarasi-saree',
		basePriceINR: 9000,
		status: 'draft',
		media: { gallery, compound: [], altOverrides: {} },
	});

const asset = (id: string, servesAsPrimary: boolean, state: 'ready' | 'queued' = 'ready') =>
	MediaAsset.parse({
		id,
		kind: 'image',
		purpose: 'product',
		originalFormat: 'image/jpeg',
		originalByteSize: 1000,
		width: 1200,
		height: 1600,
		slug: id.replace('_', '-'),
		servesAsPrimary,
		processing: { state },
	});

function harness(gallery: string[], assets: z.output<typeof MediaAsset>[]) {
	let saved = product(gallery);
	const store = new Map(assets.map((row) => [row.id, row]));
	const jobs: unknown[] = [];
	const variant = ProductVariant.parse({
		id: 'var_1',
		productId: 'prd_saree',
		sku: 'SR-1',
		status: 'live',
		optionSelections: [{ attributeCode: 'size', termCode: 'free' }],
		optionSelectionHash: 'size:free',
		priceINR: 9000,
		stock: { quantity: 1 },
	});
	const none = undefined as never;
	const catalog = new CatalogService(
		{
			findById: async () => saved,
			findBySlug: async () => saved,
			save: async (row: ProductRow) => (saved = row),
		} as never,
		{ findById: async () => null } as never,
		{ listForProduct: async () => [variant], save: async (row: unknown) => row } as never,
		none,
		none,
		none,
		none,
		none,
		none,
		{
			findById: async (id: string) => store.get(id) ?? null,
			findManyByIds: async (ids: string[]) => ids.flatMap((id) => store.get(id) ?? []),
			update: async (row: z.output<typeof MediaAsset>) => (store.set(row.id, row), row),
		} as never,
		none,
		none,
		none,
		none,
		none,
		none,
		{ enqueue: async (job: unknown) => void jobs.push(job) } as never,
	);
	const save = () =>
		catalog.updateMerchandising(
			'prd_saree',
			ProductMerchandisingWrite.parse({
				sku: 'SR-1',
				status: 'disabled',
				featured: false,
				madeToOrder: false,
				estimatedDeliveryText: null,
				lowStockThreshold: null,
				pinnedBadges: [],
				hiddenBadges: [],
				addonPriceINR: null,
				shipping: { weightGrams: 600, lengthCm: null, widthCm: null, heightCm: null },
				hsnCode: '5007',
				variants: [
					{
						id: 'var_1',
						sku: 'SR-1',
						quantity: 1,
						available: true,
						mrpINR: null,
						sellingINR: 9000,
						weightGrams: null,
						lengthCm: null,
						widthCm: null,
						heightCm: null,
						barcode: null,
						hsnCode: null,
					},
				],
			}),
		);
	return { save, store, jobs };
}

describe('main-photo sizes on product save', () => {
	it('marks the first photo as a main photo and queues the extra sizes', async () => {
		const { save, store, jobs } = harness(
			['med_one', 'med_two'],
			[asset('med_one', false), asset('med_two', false)],
		);
		await save();
		expect(store.get('med_one')?.servesAsPrimary).toBe(true);
		expect(store.get('med_two')?.servesAsPrimary).toBe(false);
		expect(jobs).toEqual([{ type: 'reprocess', assetId: 'med_one', reason: 'primary' }]);
	});

	it('leaves a photo already marked alone', async () => {
		const { save, jobs } = harness(['med_one'], [asset('med_one', true)]);
		await save();
		expect(jobs).toEqual([]);
	});

	it('marks a photo still processing without queueing, as its first run makes every size', async () => {
		const { save, store, jobs } = harness(['med_one'], [asset('med_one', false, 'queued')]);
		await save();
		expect(store.get('med_one')?.servesAsPrimary).toBe(true);
		expect(jobs).toEqual([]);
	});

	it('does nothing for a product with no photos', async () => {
		const { save, jobs } = harness([], []);
		await save();
		expect(jobs).toEqual([]);
	});
});
