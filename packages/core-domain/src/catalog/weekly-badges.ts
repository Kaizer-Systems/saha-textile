export interface UnitCount {
	productId: string;
	units: number;
}

const ranked = (counts: readonly UnitCount[]): string[] =>
	[...counts]
		.filter((row) => row.units > 0)
		.sort((a, b) => b.units - a.units || a.productId.localeCompare(b.productId))
		.map((row) => row.productId);

/**
 * Weekly badge assignment from saved order counts. Bestsellers lead on all-time units;
 * trending is what is selling now and is not already a bestseller.
 *
 * The storefront never calls this. The media worker runs it. The same counts
 * always produce the same ids, so running a week twice does not change the result.
 */
export function weeklyBadges(
	allTime: readonly UnitCount[],
	recent: readonly UnitCount[] = [],
): { bestseller: string[]; trending: string[] } {
	const bestseller = ranked(allTime).slice(0, 8);
	const taken = new Set(bestseller);
	return {
		bestseller,
		trending: ranked(recent)
			.filter((id) => !taken.has(id))
			.slice(0, 8),
	};
}

/** Stable id for one ISO week, so a second run in that week replaces the same set. */
export function insightWeekId(now = new Date()): string {
	const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	const day = date.getUTCDay() || 7;
	date.setUTCDate(date.getUTCDate() + 4 - day);
	const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
	const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
	return `insight_${date.getUTCFullYear()}_w${String(week).padStart(2, '0')}`;
}

/** Products bought in the same order. A product is never paired with itself. */
export function boughtTogetherPairs(
	orders: readonly { productIds: readonly string[] }[],
): Array<{ sourceProductId: string; targetId: string }> {
	const pairs = new Map<string, { sourceProductId: string; targetId: string; count: number }>();
	for (const order of orders) {
		const ids = [...new Set(order.productIds)].sort();
		for (const sourceProductId of ids) {
			for (const targetId of ids) {
				if (sourceProductId === targetId) continue;
				const key = `${sourceProductId}>${targetId}`;
				const pair = pairs.get(key) ?? { sourceProductId, targetId, count: 0 };
				pairs.set(key, { ...pair, count: pair.count + 1 });
			}
		}
	}
	return [...pairs.entries()]
		.sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
		.slice(0, 24)
		.map(([, { sourceProductId, targetId }]) => ({ sourceProductId, targetId }));
}
