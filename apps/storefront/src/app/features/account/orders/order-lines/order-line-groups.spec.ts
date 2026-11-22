import { describe, expect, it } from 'vitest';

import { orderLineGroups, orderSaved } from './order-line-groups';

import type { ShopOrderLine } from '@saha-textile/contracts';

const line = (over: Partial<ShopOrderLine>): ShopOrderLine => ({
	lineId: 'x',
	parentLineId: null,
	role: 'product',
	title: 'Piece',
	details: [],
	quantity: 1,
	unitPrice: 0,
	lineTotal: 0,
	mrp: null,
	imageUrl: null,
	set: null,
	...over,
});

const lines = [
	line({ lineId: 's', role: 'bundle', set: { heading: 'components', saved: 3500 } }),
	line({ lineId: 's~a', role: 'piece', parentLineId: 's' }),
	line({ lineId: 's~a>f', role: 'free', parentLineId: 's~a', mrp: 799 }),
	line({ lineId: 's~b', role: 'piece', parentLineId: 's' }),
	line({ lineId: 's~b>f', role: 'free', parentLineId: 's~b', mrp: 350, quantity: 2 }),
	line({ lineId: 'p' }),
	line({ lineId: 'p~bag', role: 'free', parentLineId: 'p', mrp: 350 }),
];

describe('an order’s lines as cards (owner, 22 Nov 2026)', () => {
	it('groups each line of its own with what came with it, pieces numbered, and knows where the rail runs on', () => {
		const groups = orderLineGroups(lines);
		expect(groups.map((group) => group.line.lineId)).toEqual(['s', 'p']);
		expect(groups[0]?.children.map((row) => [row.line.lineId, row.depth, row.number, row.rail])).toEqual([
			['s~a', 1, 1, true],
			['s~a>f', 2, null, true],
			['s~b', 1, 2, false],
			['s~b>f', 2, null, false],
		]);
		expect(groups[0]?.counts).toEqual({ pieces: 2, extras: 0, free: 2 });
		expect(groups[1]?.children.map((row) => [row.line.lineId, row.depth, row.rail])).toEqual([['p~bag', 1, false]]);
		expect(groups[1]?.counts).toEqual({ pieces: 0, extras: 0, free: 1 });
	});

	it('adds up what the order saved: sets, free items at their printed price, and the coupon', () => {
		expect(orderSaved({ lines, coupon: 500 })).toBe(3500 + 799 + 700 + 350 + 500);
		expect(orderSaved({ lines: [line({})], coupon: 0 })).toBe(0);
	});
});
