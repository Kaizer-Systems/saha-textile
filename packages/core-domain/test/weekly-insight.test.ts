import { describe, expect, it, vi } from 'vitest';

import { insightWeekId, weeklyBadges } from '../src/catalog/weekly-badges';
import { runWeeklyInsight, type WeeklyInsightDeps } from '../src/catalog/weekly-insight';

const now = new Date('2026-11-06T12:00:00.000Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

function run(orders: Array<{ placedAt: string; lines: Array<{ productId: string; quantity: number }> }>) {
	const setInsightBadges = vi.fn(async () => undefined);
	const replaceFromInsightSet = vi.fn(async (input: { relations: readonly unknown[] }) => input.relations.length);
	const save = vi.fn(async (set: unknown) => set);
	const deps = {
		orders: { listPurchased: async () => orders },
		products: { setInsightBadges },
		relations: { replaceFromInsightSet },
		insightSets: { save },
		now: () => now,
	} as unknown as WeeklyInsightDeps;
	return { result: runWeeklyInsight(deps), setInsightBadges, replaceFromInsightSet, save };
}

describe('the weekly insight job', () => {
	it('counts units, not orders, and treats recent sales as trending', async () => {
		const job = run([
			{ placedAt: daysAgo(90), lines: [{ productId: 'old', quantity: 5 }] },
			{ placedAt: daysAgo(2), lines: [{ productId: 'new', quantity: 1 }] },
		]);
		await job.result;

		expect(job.setInsightBadges).toHaveBeenCalledWith({ bestseller: ['old', 'new'], trending: [] });
	});

	it('saves relations for products bought together, and the set behind them', async () => {
		const job = run([
			{
				placedAt: daysAgo(1),
				lines: [
					{ productId: 'a', quantity: 1 },
					{ productId: 'b', quantity: 1 },
				],
			},
		]);
		const result = await job.result;

		expect(result).toEqual({ insightSetId: insightWeekId(now), relations: 4 });
		expect(job.save).toHaveBeenCalledWith(
			expect.objectContaining({ id: insightWeekId(now), generatedAt: now.toISOString(), relations: 4 }),
		);
	});

	it('clears the badges when there are no orders', async () => {
		const job = run([]);
		await job.result;

		expect(job.setInsightBadges).toHaveBeenCalledWith({ bestseller: [], trending: [] });
	});
});

describe('weekly badges', () => {
	it('keeps a bestseller out of trending and caps both', () => {
		const allTime = Array.from({ length: 12 }, (_, index) => ({ productId: `p${index}`, units: 100 - index }));
		const recent = [
			{ productId: 'p0', units: 50 },
			{ productId: 'fresh', units: 9 },
			{ productId: 'cold', units: 0 },
		];

		const badges = weeklyBadges(allTime, recent);

		expect(badges.bestseller).toHaveLength(8);
		expect(badges.trending).toEqual(['fresh']);
	});

	it('breaks ties by id, and needs no recent list', () => {
		expect(
			weeklyBadges([
				{ productId: 'b', units: 1 },
				{ productId: 'a', units: 1 },
			]).bestseller,
		).toEqual(['a', 'b']);
	});
});
