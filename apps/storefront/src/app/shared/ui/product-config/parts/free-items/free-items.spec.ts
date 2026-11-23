import { describe, expect, it } from 'vitest';

import { freePicksValid, givenFreePicks } from './free-items';
import { freeWith } from '../../set-test-data';

describe('free items (P8)', () => {
	const two = (over = {}) =>
		freeWith({
			given: false,
			take: 'exactly',
			count: 1,
			min: 1,
			max: 1,
			items: [
				{
					product_id: 'a',
					name: 'A',
					mrp: null,
					selling: 1,
					quantity: 1,
					in_stock: true,
					variant_id: null,
					variant_label: null,
					variants: [],
				},
				{
					product_id: 'b',
					name: 'B',
					mrp: null,
					selling: 1,
					quantity: 1,
					in_stock: false,
					variant_id: null,
					variant_label: null,
					variants: [],
				},
			],
			...over,
		});

	it('hands given items over without asking, sold-out ones left out', () => {
		expect(givenFreePicks(freeWith())).toEqual([{ productId: 'pc', variantId: null }]);
	});

	it('checks how many, stock and sizes', () => {
		expect(freePicksValid(two(), [{ productId: 'a', variantId: null }])).toBe(true);
		expect(freePicksValid(two(), [])).toBe(false);
		expect(freePicksValid(two(), [{ productId: 'b', variantId: null }])).toBe(false);
		expect(freePicksValid(two({ none_or_exactly: true, min: 0 }), [])).toBe(true);
		const sized = freeWith({
			items: [
				{
					product_id: 'pc',
					name: 'PC',
					mrp: null,
					selling: 1,
					quantity: 1,
					in_stock: true,
					variant_id: null,
					variant_label: null,
					variants: [{ id: 'm', label: 'M', in_stock: true }],
				},
			],
		});
		expect(freePicksValid(sized, [{ productId: 'pc', variantId: null }])).toBe(false);
		expect(freePicksValid(sized, [{ productId: 'pc', variantId: 'm' }])).toBe(true);
	});
});
