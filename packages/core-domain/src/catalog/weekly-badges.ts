/**
 * Weekly badge assignment from saved order counts.
 *
 * The storefront never calls this. The media worker runs it. The same counts
 * always produce the same ids, so running a week twice does not change the result.
 */
export function weeklyBadges(counts: readonly { productId: string; units: number }[]): {
	bestseller: string[];
	trending: string[];
} {
	const ranked = [...counts]
		.filter((row) => row.units > 0)
		.sort((a, b) => b.units - a.units || a.productId.localeCompare(b.productId));
	return {
		bestseller: ranked.slice(0, 8).map((row) => row.productId),
		trending: ranked.slice(8, 16).map((row) => row.productId),
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
	const counts = new Map<string, number>();
	for (const order of orders) {
		const ids = [...new Set(order.productIds)].sort();
		for (const source of ids) {
			for (const target of ids) {
				if (source === target) continue;
				const key = `${source}>${target}`;
				counts.set(key, (counts.get(key) ?? 0) + 1);
			}
		}
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, 24)
		.map(([key]) => {
			const [sourceProductId, targetId] = key.split('>');
			return { sourceProductId: sourceProductId ?? '', targetId: targetId ?? '' };
		});
}
