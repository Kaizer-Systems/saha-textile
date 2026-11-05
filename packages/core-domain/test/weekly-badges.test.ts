import { describe, expect, it } from 'vitest';

import { boughtTogetherPairs, insightWeekId, weeklyBadges } from '../src/catalog/weekly-badges';

describe('weeklyBadges', () => {
	it('is stable for the same counts and writes nothing when there are no orders', () => {
		const counts = [
			{ productId: 'b', units: 2 },
			{ productId: 'a', units: 5 },
		];
		expect(weeklyBadges(counts)).toEqual(weeklyBadges(counts));
		expect(weeklyBadges([])).toEqual({ bestseller: [], trending: [] });
		expect(weeklyBadges(counts).bestseller[0]).toBe('a');
	});

	it('names the same week twice and pairs products that share an order', () => {
		const now = new Date('2026-11-05T00:00:00.000Z');
		expect(insightWeekId(now)).toBe(insightWeekId(now));
		const orders = [{ productIds: ['a', 'b'] }, { productIds: ['a', 'b', 'a'] }];
		expect(boughtTogetherPairs(orders)).toEqual(boughtTogetherPairs(orders));
		expect(boughtTogetherPairs([])).toEqual([]);
		expect(boughtTogetherPairs(orders).some((pair) => pair.sourceProductId === pair.targetId)).toBe(false);
	});
});
