import type { BundleStockSummary } from '@saha-textile/contracts';

import { combinations, quoteBundle, type QuoteBundle } from './price';

/**
 * A bundle's worked-out stock (owner, 22 Nov 2026, V3). A bundle holds no stock of its own: "sets possible" is how
 * many complete sets the pieces in stock can make now. It is out of stock only when "not a single permutation
 * combination of their choices across all their levels satisfying all the conditions" can be made. There is no
 * "partial" status; sold-out choices are named instead. Optional extras and free items never block.
 */

export interface StockLevel {
	code: string;
	take: number;
	/** Each item's capacity: whole sets it can serve (units in stock ÷ units per set); Infinity when made to order. */
	items: readonly { key: string; capacity: number }[];
}

/** How many sets one level can serve: the largest k with Σ min(capacity, k) ≥ take × k (distinct pieces per set). */
export function levelSets(level: StockLevel): number {
	const caps = level.items.map((item) => Math.max(0, item.capacity));
	if (caps.length < level.take) return 0;
	if (caps.some((c) => c === Number.POSITIVE_INFINITY)) {
		const finite = caps.filter((c) => c !== Number.POSITIVE_INFINITY);
		const unlimited = caps.length - finite.length;
		if (unlimited >= level.take) return Number.POSITIVE_INFINITY;
	}
	const fits = (k: number) => caps.reduce((sum, c) => sum + Math.min(c, k), 0) >= level.take * k;
	const finiteTotal = caps.reduce((sum, c) => sum + (c === Number.POSITIVE_INFINITY ? 0 : c), 0);
	let low = 0;
	let high = Math.floor((finiteTotal + caps.filter((c) => c === Number.POSITIVE_INFINITY).length * 1e6) / level.take);
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (fits(mid)) low = mid;
		else high = mid - 1;
	}
	return low;
}

/** Sets possible across levels, ignoring rules: the lowest level's. */
export function setsPossible(levels: readonly StockLevel[]): number {
	if (levels.length === 0) return 0;
	return Math.min(...levels.map(levelSets));
}

/**
 * Whether at least one full combination can be made now, honouring the set's rules (limitLevel, hideItem,
 * requireExtra). Needed only when rules can narrow choices; otherwise `setsPossible > 0` says the same.
 */
export function anyCombinationInStock(
	bundle: QuoteBundle,
	capacity: ReadonlyMap<string, number>,
	now = new Date(),
): boolean {
	for (const picks of combinations(bundle.levels, 5000)) {
		const quote = quoteBundle(bundle, { picks }, now);
		if (quote.problems.some((p) => p.kind !== 'extra_required')) continue;
		// Required extras must be in stock too; optional ones never block.
		const used = new Map<string, number>();
		for (const piece of quote.pieces) used.set(piece.key, (used.get(piece.key) ?? 0) + 1);
		for (const key of quote.requiredExtras) used.set(key, (used.get(key) ?? 0) + 1);
		if ([...used].every(([key, n]) => (capacity.get(key) ?? 0) >= n)) return true;
	}
	return false;
}

export function bundleStockSummary(
	levels: readonly StockLevel[],
	options: { lowStockThreshold: number; hasOfferRules?: boolean; anyCombination?: () => boolean },
): Omit<BundleStockSummary, 'updatedAt'> {
	let possible = setsPossible(levels);
	if (possible > 0 && options.hasOfferRules && options.anyCombination && !options.anyCombination()) possible = 0;
	const soldOutPieces: string[] = [];
	const soldOutChoices: string[] = [];
	let totalPieces = 0;
	let totalChoices = 0;
	for (const level of levels) {
		const choice = level.items.length > level.take;
		for (const item of level.items) {
			if (choice) totalChoices += 1;
			else totalPieces += 1;
			if (item.capacity >= 1) continue;
			(choice ? soldOutChoices : soldOutPieces).push(item.key);
		}
	}
	const finite = possible === Number.POSITIVE_INFINITY ? 9999 : possible;
	return {
		setsPossible: finite,
		state: finite === 0 ? 'out_of_stock' : finite <= options.lowStockThreshold ? 'low_stock' : 'in_stock',
		soldOutPieces,
		soldOutChoices,
		totalPieces,
		totalChoices,
	};
}
