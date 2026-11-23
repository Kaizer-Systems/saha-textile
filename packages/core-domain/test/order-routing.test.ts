import { describe, expect, it } from 'vitest';

import { routeOrder } from '../src/locations/order-routing';

const row = (variantId: string, locationId: string, onHand: number, held = 0, reserved = 0) => ({
	variantId,
	productId: 'p',
	locationId,
	onHand,
	held,
	reserved,
	updatedAt: null,
});
const input = (stock: ReturnType<typeof row>[]) => ({
	lines: [
		{ variantId: 'saree', quantity: 1 },
		{ variantId: 'petticoat', quantity: 1 },
	],
	stock,
	shippingLocationIds: ['bar', 'salt'],
	defaultLocationId: 'bar',
});

describe('order routing (accounts brief M1, M2, D14)', () => {
	it('assigns by itself when one location has every piece, preferring the default', () => {
		const both = input([
			row('saree', 'bar', 2),
			row('petticoat', 'bar', 5),
			row('saree', 'salt', 1),
			row('petticoat', 'salt', 1),
		]);
		expect(routeOrder(both, { mode: 'auto' })).toMatchObject({ assign: 'bar', suggestion: 'bar' });
		expect(routeOrder(both, { mode: 'suggest' })).toMatchObject({ assign: null, suggestion: 'bar' });
		expect(routeOrder(both, { mode: 'manual' })).toMatchObject({ assign: null, suggestion: null });
	});

	it('leaves the order to a manager when no location has every free piece, and never splits', () => {
		// Barasat has the saree; its petticoat is held, the only free one is at Salt Lake.
		const split = input([row('saree', 'bar', 1), row('petticoat', 'bar', 1, 1), row('petticoat', 'salt', 20)]);
		const result = routeOrder(split, { mode: 'auto' });
		expect(result).toMatchObject({ assign: null, suggestion: null });
		expect(result.candidates).toEqual([
			{ locationId: 'bar', has: 1, of: 2 },
			{ locationId: 'salt', has: 1, of: 2 },
		]);
	});
});
