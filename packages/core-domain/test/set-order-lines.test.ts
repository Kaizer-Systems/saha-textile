import { describe, expect, it } from 'vitest';

import { orderChildMoney } from '../src/orders/set-lines';

describe('a set as order lines (bundle builder brief E05–E08)', () => {
	const children = [
		{ role: 'piece' as const, key: 'a', quantity: 1, priceINR: 33211.16 },
		{ role: 'free' as const, key: 'a>petti', quantity: 1, priceINR: 0 },
		{ role: 'piece' as const, key: 'b', quantity: 1, priceINR: 11688.84 },
		{ role: 'extra' as const, key: 'box', quantity: 2, priceINR: 500 },
	];

	it('multiplies by the number of sets and adds up to the set', () => {
		const rows = orderChildMoney(children, 2);
		expect(rows.map((row) => [row.key, row.quantity, row.lineTotalINR, row.unitPriceINR])).toEqual([
			['a', 2, 66422.32, 33211.16],
			['a>petti', 2, 0, 0],
			['b', 2, 23377.68, 11688.84],
			['box', 4, 1000, 250],
		]);
		expect(rows.reduce((sum, row) => sum + row.lineTotalINR, 0)).toBeCloseTo((44900 + 500) * 2, 2);
	});

	it('spreads a set coupon over the children that cost money, to the paisa', () => {
		const rows = orderChildMoney(children, 1, 1000);
		const coupon = Object.fromEntries(rows.map((row) => [row.key, row.couponINR]));
		expect(coupon['a>petti']).toBe(0);
		expect(Math.round((coupon['a']! + coupon['b']! + coupon['box']!) * 100)).toBe(100000);
		expect(coupon['a']).toBeGreaterThan(coupon['b']!);
	});

	it('keeps a coupon of nothing, and free-only children, at zero', () => {
		expect(orderChildMoney([{ role: 'free', key: 'f', quantity: 1, priceINR: 0 }], 3, 50)).toEqual([
			{ key: 'f', quantity: 3, unitPriceINR: 0, lineTotalINR: 0, couponINR: 0 },
		]);
	});
});
