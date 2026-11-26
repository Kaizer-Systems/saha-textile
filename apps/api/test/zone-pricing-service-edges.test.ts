import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ZonePricingService } from '../src/orders-setup/zone-pricing.service';

const variant = (id: string, productId: string, over: Record<string, unknown> = {}) => ({
	id,
	productId,
	sku: `SKU-${id}`,
	priceINR: 1000,
	salePriceINR: null,
	compareAtPriceINR: null,
	isBaseVariant: false,
	...over,
});

function service(options: { layers?: Record<string, Array<{ quantityRemaining: number; unitCostINR: number }>> } = {}) {
	const products: Record<string, unknown> = {
		p_saree: {
			id: 'p_saree',
			soldBy: 'piece',
			categoryIds: ['cat_silk', 'cat_gone', 'cat_flat'],
			title: { en: 'Saree' },
		},
		p_cloth: { id: 'p_cloth', soldBy: 'metre', categoryIds: [], title: { en: 'Cloth' } },
		p_bare: { id: 'p_bare', soldBy: 'piece', categoryIds: [], title: { en: 'Bare' } },
	};
	const rows = [
		variant('v_sale', 'p_saree', { salePriceINR: 800 }),
		variant('v_plain', 'p_saree'),
		variant('v_cloth', 'p_cloth', { compareAtPriceINR: 600, priceINR: 500 }),
	];
	return new ZonePricingService(
		{ findById: async (id: string) => products[id] ?? null } as never,
		{ listForProduct: async (id: string) => rows.filter((row) => row.productId === id) } as never,
		{
			tree: async () => [
				{ id: 'cat_silk', path: ['cat_sarees', 'cat_silk'], ancestors: ['cat_sarees'] },
				{ id: 'cat_flat', path: [], ancestors: ['cat_sarees'] },
			],
		} as never,
		{ priceFor: () => null } as never,
		{ listOpenLayers: async (id: string) => options.layers?.[id] ?? [] } as never,
	);
}

describe('zone pricing facts: the remaining cases', () => {
	it('refuses a product or variant that does not exist', async () => {
		await expect(
			service().factsFor([{ productId: 'p_none', variantId: null, quantity: 1 }]),
		).rejects.toBeInstanceOf(NotFoundException);
		await expect(
			service().factsFor([{ productId: 'p_saree', variantId: 'v_none', quantity: 1 }]),
		).rejects.toMatchObject({
			response: { issues: [{ code: 'variant_missing' }] },
		});
		await expect(
			service().factsFor([{ productId: 'p_bare', variantId: null, quantity: 1 }]),
		).rejects.toBeInstanceOf(NotFoundException);
	});

	it('reads the variant asked for or the first, its MRP from the sale or the compare price, and no cost without stock', async () => {
		const [named, first] = await service().factsFor([
			{ productId: 'p_saree', variantId: 'v_plain', quantity: 1 },
			{ productId: 'p_saree', variantId: null, quantity: 2 },
		]);
		expect(named?.facts).toMatchObject({ sku: 'SKU-v_plain', mrpINR: null, purchaseCostINR: null });
		expect(first?.facts).toMatchObject({ sku: 'SKU-v_sale', mrpINR: 1000, regularSellingINR: 800 });
		// Categories: the stored path, the parents then itself when no path is stored, and the id of one gone.
		expect(named?.facts.categoryPaths).toEqual([
			['cat_silk', 'cat_sarees'],
			['cat_gone'],
			['cat_flat', 'cat_sarees'],
		]);
	});

	it('works out a metre’s average cost from its open layers, and keeps a compare price as the MRP', async () => {
		const [cloth] = await service({
			layers: {
				v_cloth: [
					{ quantityRemaining: 10, unitCostINR: 30 },
					{ quantityRemaining: 10, unitCostINR: 50 },
				],
			},
		}).factsFor([{ productId: 'p_cloth', variantId: null, quantity: 25 }]);
		expect(cloth?.facts).toMatchObject({ purchaseCostINR: 400, mrpINR: 600, metres: 25 });
	});

	it('prices with today’s date when none is given', () => {
		const result = service().price({ retail: true, live: true, rules: [] }, {
			productId: 'p',
			regularSellingINR: 100,
			currentSaleINR: null,
			quantity: 1,
		} as never);
		expect(result).toHaveProperty('price');
	});
});
