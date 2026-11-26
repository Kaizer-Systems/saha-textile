import type { FreePick, FreeWith } from '@saha-textile/contracts';

/**
 * Free with this product (brief P8.0–P8.8, owner 22 Nov 2026). `freeRange` turns the admin's words into how many
 * the shopper must and may take; `checkFreePicks` checks a shopper's picks against it.
 */
export interface FreeRange {
	/** Every item is given; there is nothing to choose (one or more items, "Always gets it"). */
	given: boolean;
	min: number;
	max: number;
	/** "Exactly N, optional": none or exactly N. */
	noneOrExactly: boolean;
}

export function freeRange(rule: Pick<FreeWith, 'items' | 'take' | 'count' | 'from' | 'required'>): FreeRange {
	const n = rule.items.length;
	const count = Math.min(rule.count ?? n, n);
	switch (rule.take) {
		case 'all':
			return rule.required
				? { given: true, min: n, max: n, noneOrExactly: false }
				: { given: false, min: 0, max: n, noneOrExactly: false };
		case 'exactly':
			return { given: false, min: rule.required ? count : 0, max: count, noneOrExactly: !rule.required };
		case 'upto':
			return { given: false, min: rule.required ? 1 : 0, max: count, noneOrExactly: false };
		case 'between':
			return { given: false, min: Math.min(rule.from ?? 0, count), max: count, noneOrExactly: false };
	}
}

export type FreePickProblem = 'too_few' | 'too_many' | 'not_offered' | 'sold_out' | 'size_needed';

/**
 * Checks the shopper's free picks. `inStock(productId, variantId)` says whether one more can be given; `needsSize`
 * says whether the product has sizes the shopper must choose. Given items are filled in here, never sent.
 */
export function checkFreePicks(
	rule: FreeWith,
	picks: readonly FreePick[],
	inStock: (productId: string, variantId: string | null) => boolean,
	needsSize: (productId: string) => boolean,
): { ok: true; picks: FreePick[] } | { ok: false; problem: FreePickProblem } {
	const range = freeRange(rule);
	if (range.given) {
		// Sold-out given items simply drop out; the main product keeps selling (D4).
		const given = rule.items
			.map((item) => ({ productId: item.productId, variantId: item.variantId }))
			.filter((item) => inStock(item.productId, item.variantId));
		for (const item of given) {
			if (item.variantId === null && needsSize(item.productId)) {
				const asked = picks.find((p) => p.productId === item.productId);
				if (!asked?.variantId) return { ok: false, problem: 'size_needed' };
				item.variantId = asked.variantId;
			}
		}
		return { ok: true, picks: given };
	}
	const seen = new Set<string>();
	const chosen: FreePick[] = [];
	for (const pick of picks) {
		const item = rule.items.find((row) => row.productId === pick.productId);
		if (!item || seen.has(pick.productId)) return { ok: false, problem: 'not_offered' };
		seen.add(pick.productId);
		const variantId = item.variantId ?? pick.variantId ?? null;
		if (item.variantId && pick.variantId && pick.variantId !== item.variantId)
			return { ok: false, problem: 'not_offered' };
		if (variantId === null && needsSize(item.productId)) return { ok: false, problem: 'size_needed' };
		if (!inStock(item.productId, variantId)) return { ok: false, problem: 'sold_out' };
		chosen.push({ productId: item.productId, variantId });
	}
	if (range.noneOrExactly && chosen.length !== 0 && chosen.length !== range.max) {
		return { ok: false, problem: chosen.length < range.max ? 'too_few' : 'too_many' };
	}
	if (chosen.length < range.min) return { ok: false, problem: 'too_few' };
	if (chosen.length > range.max) return { ok: false, problem: 'too_many' };
	return { ok: true, picks: chosen };
}

/** The free items a shopper starts with on the page: given ones, or the first `min` in stock for a choice. */
export function startingFreePicks(rule: FreeWith, inStock: (productId: string) => boolean): string[] {
	const range = freeRange(rule);
	const available = rule.items.map((item) => item.productId).filter(inStock);
	if (range.given) return available;
	return available.slice(0, range.min);
}
