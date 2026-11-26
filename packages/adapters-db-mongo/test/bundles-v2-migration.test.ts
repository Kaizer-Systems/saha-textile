import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import {
	convertBundlesToLevels,
	legacyBundleToLevels,
	seedBundlePriceMethods,
	showProductsOnShop,
} from '../src/migrations/bundles-v2';
import { BundlePriceMethodModel, ProductBundleModel, ProductModel } from '../src/models/index';
import { hasMongoEnv, insertRaw, runPrefix } from './mongo-test-env';

describe('old bundles as levels (no database)', () => {
	const price = (id: string) => (id === 'unknown' ? null : 1000);

	it('turns a fixed kit into one level a piece, an unrequired piece into an extra, and keeps a fixed price', () => {
		const converted = legacyBundleToLevels(
			{
				_id: 'b1',
				productId: 'p',
				pricePolicy: 'fixed_bundle_price',
				fixedPriceINR: 2500,
				groups: [
					{
						code: 'kit',
						maxSelections: 2,
						components: [{ productId: 'saree' }, { productId: 'blouse', variantId: 'v1', quantity: 2 }],
					},
					{ code: 'add', components: [{ productId: 'box', required: false }] },
					{ code: 'empty' },
				],
			},
			price,
		);
		expect(converted.levels.map((level) => [level.code, level.label.en, level.items[0]?.productId])).toEqual([
			['piece-1', 'Piece 1', 'saree'],
			['piece-2', 'Piece 2', 'blouse'],
		]);
		expect(converted.levels[1]?.items[0]).toMatchObject({ variantId: 'v1', quantity: 2, priceInSetINR: null });
		expect(converted.extras.map((item) => item.productId)).toEqual(['box']);
		expect(converted.pricing).toMatchObject({ methodId: 'bpm_fixed_price', params: { setPrice: 2500 } });
	});

	it('turns a group with more pieces than it takes into a choice level, priced by adjustments', () => {
		const choice = (group: Record<string, unknown>) =>
			legacyBundleToLevels(
				{
					_id: 'b2',
					productId: 'p',
					pricePolicy: 'discounted_components',
					groups: [
						{
							components: [
								{ productId: 'a', required: false, priceAdjustmentINR: 100 },
								{ productId: 'b', required: false },
								{ productId: 'unknown', required: false, priceAdjustmentINR: 50 },
							],
							...group,
						} as never,
					],
				},
				price,
			);
		const named = choice({ code: 'blouse', label: { en: 'Blouse', bn: 'ব্লাউজ' }, maxSelections: 1 });
		expect(named.levels[0]).toMatchObject({ code: 'blouse', label: { en: 'Blouse' }, take: 1 });
		expect(named.levels[0]?.items.map((item) => item.priceInSetINR)).toEqual([900, null, null]);
		expect(named.pricing).toMatchObject({ methodId: 'bpm_pieces_added_up', params: {} });
		const unnamed = choice({ code: '', label: { bn: 'ব্লাউজ' } });
		expect(unnamed.levels[0]).toMatchObject({ code: 'level-1', label: { en: 'Choose one' } });
		expect(choice({ code: '' }).levels[0]?.label.en).toBe('Choose one');
	});

	it('converts a bundle with no groups to nothing', () => {
		expect(legacyBundleToLevels({ _id: 'b3', productId: 'p' }, price)).toMatchObject({ levels: [], extras: [] });
	});
});

describe.runIf(hasMongoEnv())('bundle migrations on the database (rs0)', () => {
	const P = runPrefix('bv2');

	beforeAll(async () => {
		await connectMongo();
	});

	afterAll(async () => {
		const ours = { $regex: `^${P}` };
		await ProductBundleModel.deleteMany({ _id: ours });
		await ProductModel.deleteMany({ _id: ours });
		await disconnectMongo();
	});

	it('seeds a missing price method, then writes none', async () => {
		await seedBundlePriceMethods();
		await BundlePriceMethodModel.deleteOne({ code: 'fixed_price' }).exec();
		expect(await seedBundlePriceMethods()).toBe('wrote 1 bundle price method');
		expect(await seedBundlePriceMethods()).toBe('wrote 0 bundle price methods');
		expect(await BundlePriceMethodModel.countDocuments({ _id: 'bpm_fixed_price' })).toBe(1);
	});

	it('converts each old-shape bundle with its pieces’ prices, and says when there are none left', async () => {
		await insertRaw(ProductModel as never, {
			_id: `${P}saree`,
			sku: `${P}S`,
			slug: `${P}s`,
			title: { en: 'S' },
			basePriceINR: 1000,
		});
		await insertRaw(ProductModel as never, { _id: `${P}blouse`, sku: `${P}B`, slug: `${P}b`, title: { en: 'B' } });
		await insertRaw(ProductBundleModel as never, {
			_id: `${P}old`,
			productId: `${P}set`,
			pricePolicy: 'discounted_components',
			levels: [],
			groups: [
				{
					code: 'kit',
					components: [
						{ productId: `${P}saree`, priceAdjustmentINR: 100 },
						{ productId: `${P}blouse`, priceAdjustmentINR: 100 },
						{ productId: `${P}ghost` },
					],
				},
			],
		});
		expect(await convertBundlesToLevels()).toMatch(/^converted \d+ bundles? to levels$/);
		const stored = await ProductBundleModel.findById(`${P}old`)
			.lean<{ levels: Array<{ items: Array<{ priceInSetINR: number | null }> }>; memberIds: string[] }>()
			.exec();
		expect(stored?.levels.map((level) => level.items[0]?.priceInSetINR)).toEqual([900, null, null]);
		expect(stored?.memberIds).toEqual([`${P}saree`, `${P}blouse`, `${P}ghost`]);
		for (const key of ['two', 'three'])
			await insertRaw(ProductBundleModel as never, {
				_id: `${P}${key}`,
				productId: `${P}set_${key}`,
				groups: [{ code: 'kit', components: [{ productId: `${P}saree` }] }],
			});
		expect(await convertBundlesToLevels()).toMatch(/^converted \d+ bundles to levels$/);
		expect(await convertBundlesToLevels()).toBe('no bundles to convert');
	});

	it('shows older products on the shop', async () => {
		await insertRaw(ProductModel as never, { _id: `${P}older`, sku: `${P}O`, slug: `${P}o`, title: { en: 'O' } });
		expect(await showProductsOnShop()).toMatch(/^set Show on shop on \d+ products?$/);
		expect((await ProductModel.findById(`${P}older`).lean<{ showOnShop?: boolean }>().exec())?.showOnShop).toBe(
			true,
		);
		expect(await showProductsOnShop()).toBe('set Show on shop on 0 products');
	});
});
