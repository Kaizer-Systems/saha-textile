import { describe, expect, it } from 'vitest';

import { cartKidRows } from './cart-kids';

import type { CartViewChild } from '@saha-textile/contracts';

const kid = (over: Partial<CartViewChild>): CartViewChild => ({
	role: 'piece',
	key: 'k',
	parentKey: null,
	level: null,
	productId: 'prd_1',
	title: 'Piece',
	sku: 'SKU',
	image: null,
	variantId: null,
	variantLabel: null,
	quantity: 1,
	priceINR: 0,
	mrpINR: null,
	...over,
});

describe('a staff cart line’s children (bundle builder brief E09)', () => {
	it('lists pieces numbered with their free items under them, then extras, then a product’s own free items', () => {
		const rows = cartKidRows([
			kid({ key: 'x', role: 'extra', priceINR: 750 }),
			kid({ key: 'b', title: 'Second' }),
			kid({ key: 'a>f', role: 'free', parentKey: 'a' }),
			kid({ key: 'a', title: 'First' }),
			kid({ key: 'bag', role: 'free' }),
		]);
		expect(rows.map((row) => [row.child.key, row.depth, row.number])).toEqual([
			['b', 1, 1],
			['a', 1, 2],
			['a>f', 2, null],
			['x', 1, null],
			['bag', 1, null],
		]);
	});

	it('takes the card picture, else the gallery one', () => {
		const roles = (role: string) => ({
			[role]: [{ url: `${role}.webp`, width: 300, height: 400, format: 'webp' }],
		});
		const image = (role: string) =>
			({
				assetId: 'a',
				width: 1,
				height: 1,
				alt: '',
				dominantColor: null,
				thumbHash: null,
				roles: roles(role),
			}) as never;
		expect(cartKidRows([kid({ image: image('card') })])[0]?.imageUrl).toBe('card.webp');
		expect(cartKidRows([kid({ image: image('gallery') })])[0]?.imageUrl).toBe('gallery.webp');
		expect(cartKidRows([kid({})])[0]?.imageUrl).toBeNull();
	});
});
