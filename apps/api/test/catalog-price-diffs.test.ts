import { describe, expect, it } from 'vitest';

import { priceDiffs } from '../src/catalog/catalog.service';

/** Brief 26 AU2: a product save writes each variant's price and sale price changed, before and after. */
describe('price changes on a product save', () => {
	it('lists only the prices that changed, a new variant from nothing, and nothing when none changed', () => {
		const before = new Map([
			['v1', { priceINR: 1_000, salePriceINR: null }],
			['v2', { priceINR: 500, salePriceINR: 450 }],
		]);
		expect(
			priceDiffs(before, [
				{ id: 'v1', sku: 'SAREE-1', priceINR: 1_200, salePriceINR: null },
				{ id: 'v2', sku: 'SAREE-2', priceINR: 500, salePriceINR: 400 },
				{ id: 'v3', sku: 'SAREE-3', priceINR: 800, salePriceINR: null },
			]),
		).toEqual([
			{ field: 'SAREE-1: price', before: 1_000, after: 1_200 },
			{ field: 'SAREE-2: sale price', before: 450, after: 400 },
			{ field: 'SAREE-3: price', before: null, after: 800 },
		]);
		expect(priceDiffs(before, [{ id: 'v1', sku: 'SAREE-1', priceINR: 1_000, salePriceINR: null }])).toEqual([]);
	});
});
