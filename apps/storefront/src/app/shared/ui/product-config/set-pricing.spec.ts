import { describe, expect, it } from 'vitest';

import { setPricing } from './set-pricing';

describe('setPricing', () => {
	const piece = (code: string, over: Record<string, unknown> = {}) => ({ code, price: 500, quantity: 2, ...over });

	it("follows the set's price setting: a fixed set keeps the page's price, others add their pieces up", () => {
		const fixed = setPricing({
			price_policy: 'fixed-bundle-price',
			bundle_price: 7300,
			groups: [{ code: 'g', label: 'G', min: 1, max: 1 }],
			components: [piece('a', { group: 'g', set_price: 900 }), piece('b', { group: 'g', required: false })],
		} as never);
		expect(fixed).toEqual({
			policy: 'fixed_bundle_price',
			fixedPriceINR: 7300,
			groups: [
				{
					code: 'g',
					maxSelections: 1,
					pieces: [
						{ id: 'a', priceINR: 900, quantity: 1, required: true },
						{ id: 'b', priceINR: 1000, quantity: 1, required: false },
					],
				},
			],
		});
		expect(setPricing({ price_policy: 'sum-components', components: [] } as never).policy).toBe('sum_components');
		expect(setPricing({ price_policy: 'discounted-components', components: [] } as never).fixedPriceINR).toBeNull();
	});

	it('puts pieces without a group into one group that takes them all', () => {
		const pricing = setPricing({
			bundle_price: 10,
			components: [piece('a'), piece('b', { price: undefined })],
		} as never);
		expect(pricing.groups).toEqual([
			{
				code: '',
				maxSelections: 2,
				pieces: [
					{ id: 'a', priceINR: 1000, quantity: 1, required: true },
					{ id: 'b', priceINR: 0, quantity: 1, required: true },
				],
			},
		]);
		expect(setPricing({ bundle_price: 10 } as never).groups[0]?.maxSelections).toBe(1);
	});
});
