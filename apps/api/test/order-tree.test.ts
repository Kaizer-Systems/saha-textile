import { describe, expect, it } from 'vitest';

import { keepsStock, parcelUnits } from '../src/orders/order-tree';

const child = (over: Record<string, unknown>) =>
	({
		role: 'piece',
		key: 'k',
		parentKey: null,
		level: null,
		productId: 'p',
		title: 'Piece',
		sku: 'SKU',
		image: null,
		variantId: null,
		variantLabel: null,
		quantity: 1,
		priceINR: 0,
		mrpINR: null,
		...over,
	}) as never;

describe('the order tree shared by the shop and staff orders (bundle builder brief E05–E09)', () => {
	it('weighs a set by its pieces and a product by itself and its free items, naming the cart line', () => {
		const units = parcelUnits([
			{
				id: 's',
				productId: 'set',
				variationId: null,
				quantity: 2,
				unitPriceINR: 44_900,
				mrpINR: 48_400,
				setHeading: 'components',
				children: [child({ productId: 'a' }), child({ productId: 'b', variantId: 'v', quantity: 2 })],
			},
			{
				id: 'p',
				productId: 'saree',
				variationId: null,
				quantity: 1,
				unitPriceINR: 5_600,
				mrpINR: null,
				children: [child({ role: 'free', productId: 'bag' })],
			},
		]);
		expect(units).toEqual([
			{ cartIndex: 0, productId: 'a', variationId: null, quantity: 2 },
			{ cartIndex: 0, productId: 'b', variationId: 'v', quantity: 4 },
			{ cartIndex: 1, productId: 'saree', variationId: null, quantity: 1 },
			{ cartIndex: 1, productId: 'bag', variationId: null, quantity: 1 },
		]);
	});

	it('holds stock for pieces and products, never for a set’s own line or made-to-order work', () => {
		expect(keepsStock({ role: 'bundle' } as never)).toBe(false);
		expect(keepsStock({ role: 'piece' } as never)).toBe(true);
		expect(keepsStock({ role: 'product', madeToOrder: true } as never)).toBe(false);
	});
});
