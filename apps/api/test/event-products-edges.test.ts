import { Product, ProductVariant, ShopEvent } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { EventProductsService } from '../src/events/event-products.service';

const product = (id: string, over: Record<string, unknown> = {}) =>
	Product.parse({
		id,
		type: 'simple',
		sku: `S-${id}`,
		title: { en: `${id} saree` },
		slug: `saree-${id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
		basePriceINR: 1000,
		media: { gallery: [`img-${id}`], compound: [], altOverrides: {} },
		status: 'live',
		...over,
	});
const variant = (id: string, productId: string, selections: Array<[string, string]>) =>
	ProductVariant.parse({
		id,
		productId,
		sku: id,
		status: 'live',
		optionSelections: selections.map(([attributeCode, termCode]) => ({ attributeCode, termCode })),
		optionSelectionHash: id,
		isBaseVariant: false,
		priceINR: 1000,
	});
const axis = {
	attributeCode: 'colour',
	label: { en: 'Colour' },
	semanticRole: 'variation_axis',
	displayStyle: 'rectangle',
	requiredSelection: false,
	terms: [
		{ code: 'red', label: { en: 'Red' } },
		// English is required; an empty one gives no words.
		{ code: 'teal', label: { en: '', bn: 'টিল' } },
	],
};
const line = (productId: string) => ({ productId, rule: { kind: 'percent', value: 10, skuPrices: {} } as never });
const sale = ShopEvent.parse({ id: 'evt_1', type: 'sale', name: 'Puja', status: 'draft' });

function setup(prices: (event: ShopEvent) => unknown[]) {
	const rows = [
		product('p_colours', { optionGroups: [axis] }),
		product('p_plain', { title: { en: '' }, media: { gallery: [], compound: [], altOverrides: {} } }),
	];
	const service = new EventProductsService(
		{ detail: vi.fn(async () => sale), update: vi.fn(), create: vi.fn() } as never,
		{ salePrices: vi.fn(async (event: ShopEvent) => prices(event)), overlaps: async () => [] } as never,
		{ thumbnailsFor: async () => new Map() } as never,
		{ findById: async (id: string) => rows.find((row) => row.id === id) ?? null } as never,
		{
			listForProducts: async () => [
				variant('V-red', 'p_colours', [['colour', 'red']]),
				variant('V-teal', 'p_colours', [['colour', 'teal']]),
				variant('V-odd', 'p_colours', [['size', 'xl']]),
			],
		} as never,
	);
	return service;
}

const price = (productId: string, sku: string, source = 'product') => ({
	productId,
	productTitle: '',
	sku,
	normalINR: 1000,
	saleINR: 900,
	source,
	categoryId: null,
	warning: false,
	refused: false,
});

describe('adding products to a sale: the remaining cases', () => {
	it('labels each option by its English words, blank where they are empty, and a price of no known SKU as blank', async () => {
		const service = setup(() => [
			price('p_colours', 'V-red'),
			price('p_colours', 'V-teal'),
			price('p_colours', 'V-odd'),
			price('p_colours', 'BND-X'),
		]);
		const result = await service.addProducts(
			{ eventId: null, dryRun: true, lines: [line('p_colours')] } as never,
			{
				userId: 'adm_1',
				permissions: ['event.create'],
			} as never,
		);
		expect(result.rows[0]?.prices.map((row) => row.label)).toEqual(['Red', '', '', '']);
	});

	it('marks a product the sale already reached through a category, and names one without English or a photo by its SKU', async () => {
		const service = setup((event) =>
			event.sale.products.length
				? [price('p_plain', 'S-p_plain')]
				: [price('p_plain', 'S-p_plain', 'category'), price('p_other', 'S-x', 'category')],
		);
		const result = await service.addProducts(
			{ eventId: 'evt_1', dryRun: true, lines: [line('p_plain')] } as never,
			{
				userId: 'adm_1',
				permissions: ['event.edit'],
			} as never,
		);
		expect(result.rows[0]).toMatchObject({ title: 'S-p_plain', thumbnailUrl: null, viaCategory: true });
	});
});
