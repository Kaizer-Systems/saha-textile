import { NotFoundException } from '@nestjs/common';
import { Product, ProductVariant } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { CatalogPublicService } from '../src/catalog/catalog-public.service';

type Variant = z.output<typeof ProductVariant>;

const product = Product.parse({
	id: 'prd_kurti',
	type: 'variable',
	sku: 'KPS',
	title: { en: 'Kurti Palazzo Set' },
	slug: 'kurti-palazzo-set',
	basePriceINR: 2400,
	status: 'live',
	lifecycle: { liveAt: '2026-10-01T00:00:00.000Z' },
	addonTemplateCode: 'blouse-measurements',
	optionGroups: [
		{
			attributeCode: 'size',
			label: { en: 'Size' },
			semanticRole: 'variation_axis',
			displayStyle: 'circle',
			requiredSelection: true,
			terms: [
				{ code: 's', label: { en: 'S' } },
				{ code: 'm', label: { en: 'M' } },
			],
		},
		{
			attributeCode: 'blouse-design',
			label: { en: 'Blouse Designs' },
			semanticRole: 'named_add_on',
			displayStyle: 'image_tile',
			requiredSelection: true,
			defaultTermCode: 'no-design',
			terms: [
				{ code: 'no-design', label: { en: 'No Design' }, isBase: true, priceDeltaINR: 0 },
				{ code: 'design-1', label: { en: 'Design 1' }, priceDeltaINR: 750, requiresMeasurements: true },
			],
		},
	],
});

function variant(sku: string, size: string, priceINR: number, salePriceINR: number | null = null): Variant {
	return ProductVariant.parse({
		id: `var_${sku}`,
		productId: product.id,
		sku,
		status: 'live',
		optionSelections: [
			{ attributeCode: 'size', termCode: size },
			{ attributeCode: 'row', termCode: sku },
		],
		optionSelectionHash: `size:${size}`,
		isBaseVariant: size === 's',
		priceINR,
		compareAtPriceINR: salePriceINR === null ? null : priceINR,
		salePriceINR,
		stock: { quantity: 3 },
	});
}

function pageService(status: Product['status'] = 'live') {
	const current = { ...product, status };
	const products = {
		findBySlug: async (slug: string, audience?: string) =>
			slug === current.slug && (audience !== 'public' || current.status === 'live') ? current : null,
		findById: async () => null,
	};
	const variants = {
		listForProduct: async () => [variant('KPS-1', 's', 2400), variant('KPS-2', 'm', 2400, 2000)],
	};
	const addonTemplates = {
		findByCode: async (code: string) =>
			code === 'blouse-measurements'
				? {
						code,
						label: { en: 'Blouse measurements' },
						priceINR: 0,
						fields: [{ code: 'chest', label: 'Chest', unit: 'in', min: 24, max: 50, step: 0.5 }],
					}
				: null,
	};
	return new CatalogPublicService(
		products as never,
		variants as never,
		null,
		null,
		null,
		null,
		null,
		addonTemplates as never,
		null,
	);
}

describe('product page read', () => {
	it('returns every option group, axis-only variant selections, and the measurement form', async () => {
		const page = await pageService().page('kurti-palazzo-set');
		expect(page.optionGroups.map((group) => [group.code, group.role, group.displayStyle])).toEqual([
			['size', 'variation_axis', 'circle'],
			['blouse-design', 'named_add_on', 'image_tile'],
		]);
		expect(page.optionGroups[1]?.defaultTermCode).toBe('no-design');
		expect(page.optionGroups[1]?.terms[1]).toMatchObject({ priceDeltaINR: 750, requiresMeasurements: true });
		expect(page.variants.map((row) => row.selections)).toEqual([{ size: 's' }, { size: 'm' }]);
		expect(page.measurements?.fields.map((field) => field.code)).toEqual(['chest']);
		expect(page.selected?.sku).toBe('KPS-1');
		expect(page.badges.primary).toBe('sale');
	});

	it('selects the requested SKU and flags an unknown one while keeping the default', async () => {
		const service = pageService();
		const chosen = await service.page('kurti-palazzo-set', 'KPS-2');
		expect(chosen.unknownVariant).toBe(false);
		expect(chosen.selected).toMatchObject({ sku: 'KPS-2', sellingINR: 2000, mrpINR: 2400 });
		const unknown = await service.page('kurti-palazzo-set', 'NOPE');
		expect(unknown.unknownVariant).toBe(true);
		expect(unknown.selected?.sku).toBe('KPS-1');
	});

	it('falls back to the product’s own measurement fields when it has no template', async () => {
		const service = new CatalogPublicService(
			{
				findBySlug: async () =>
					Product.parse({
						...product,
						addonTemplateCode: null,
						addons: [
							{ code: 'shoulder', label: { en: 'Shoulder' }, type: 'number', unit: 'in' },
							{ code: 'note', label: { en: 'Note' }, type: 'text' },
						],
					}),
				findById: async () => null,
			} as never,
			{ listForProduct: async () => [variant('KPS-1', 's', 2400)] } as never,
		);
		const page = await service.page('kurti-palazzo-set');
		expect(page.measurements).toEqual({
			templateCode: null,
			priceINR: 0,
			fields: [{ code: 'shoulder', label: 'Shoulder', unit: 'in', min: null, max: null, step: null }],
		});
	});

	it('answers a disabled product as not found', async () => {
		await expect(pageService('disabled').page('kurti-palazzo-set')).rejects.toBeInstanceOf(NotFoundException);
	});
});
