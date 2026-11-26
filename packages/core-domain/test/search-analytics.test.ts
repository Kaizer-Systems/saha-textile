import { describe, expect, it } from 'vitest';

import {
	TRENDING_WINDOW_DAYS,
	indiaDay,
	normalizeSearchQuery,
	rankTrending,
	trendingRange,
} from '../src/catalog/search-analytics';

describe('normalizeSearchQuery', () => {
	it('folds case, spacing and look-alike characters into one spelling', () => {
		expect(normalizeSearchQuery('  Red   SILK\tSaree ')).toBe('red silk saree');
		expect(normalizeSearchQuery('ｊａｍｄａｎｉ')).toBe('jamdani');
	});

	it('keeps Bengali as typed and caps the length', () => {
		expect(normalizeSearchQuery(' জামদানি  শাড়ি ')).toBe('জামদানি শাড়ি');
		expect(normalizeSearchQuery('a'.repeat(300))).toHaveLength(100);
	});
});

describe('indiaDay and trendingRange', () => {
	it('uses the shop calendar, which runs 5.5 hours ahead of UTC', () => {
		expect(indiaDay(new Date('2026-11-08T18:29:00Z'))).toBe('2026-11-08');
		expect(indiaDay(new Date('2026-11-08T18:31:00Z'))).toBe('2026-11-09');
	});

	it('covers the window ending today', () => {
		expect(trendingRange(new Date('2026-11-08T06:00:00Z'))).toEqual({
			fromDate: '2026-10-26',
			toDate: '2026-11-08',
		});
		expect(TRENDING_WINDOW_DAYS).toBe(14);
	});
});

describe('rankTrending', () => {
	const now = new Date('2026-11-08T06:00:00Z');

	it('weights recent clicks higher and sums each product across days', () => {
		const ranked = rankTrending(
			[
				{ productId: 'old', date: '2026-11-01', clicks: 3 },
				{ productId: 'new', date: '2026-11-08', clicks: 2 },
				{ productId: 'new', date: '2026-11-07', clicks: 1 },
			],
			now,
		);
		expect(ranked.map((row) => row.productId)).toEqual(['new', 'old']);
		expect(ranked[1]?.score).toBeCloseTo(1.5, 5);
	});

	it('drops rows outside the window or without clicks, and breaks ties by id', () => {
		const ranked = rankTrending(
			[
				{ productId: 'b', date: '2026-11-08', clicks: 1 },
				{ productId: 'a', date: '2026-11-08', clicks: 1 },
				{ productId: 'gone', date: '2026-10-01', clicks: 9 },
				{ productId: 'zero', date: '2026-11-08', clicks: 0 },
			],
			now,
		);
		expect(ranked.map((row) => row.productId)).toEqual(['a', 'b']);
	});
});
