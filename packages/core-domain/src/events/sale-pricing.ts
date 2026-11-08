import type { SaleRule, SaleSetup } from '@saha-textile/contracts';

/** Above this many percent off, the Review tab warns: it catches typing 90 for 9. */
export const SALE_WARNING_PERCENT = 60;

/** Where a product's sale rule came from. `held` means no sale price at all. */
export type SaleRuleSource = 'product' | 'exception' | 'category' | 'held';

export interface SaleCandidate {
	rule: SaleRule;
	source: Exclude<SaleRuleSource, 'held'>;
	categoryId: string | null;
}

export interface SaleResolution {
	source: SaleRuleSource;
	/** Empty when held back or not in the sale. Several only when categories disagree. */
	candidates: SaleCandidate[];
}

/**
 * The rule a product follows in a sale, or null when the sale doesn't touch it.
 *
 * A product's own rule wins. Then any own rule set inside a category. Then a hold-back in any
 * category, which keeps the product out even if another category would discount it. Then the
 * category rules; when two categories disagree the lower price wins, which only the price can
 * tell, so every candidate is kept and `salePriceINR` picks.
 *
 * `inCategory` says whether the product sits in a category, its child categories included.
 */
export function resolveSaleRule(
	setup: SaleSetup,
	productId: string,
	inCategory: (categoryId: string) => boolean,
): SaleResolution | null {
	const own = setup.products.find((line) => line.productId === productId);
	if (own) return { source: 'product', candidates: [{ rule: own.rule, source: 'product', categoryId: null }] };
	const lines = setup.categories.filter((line) => inCategory(line.categoryId));
	if (!lines.length) return null;
	const exceptions = lines.flatMap((line) =>
		line.exceptions
			.filter((row) => row.productId === productId)
			.map((row) => ({ row, categoryId: line.categoryId })),
	);
	const ownRules = exceptions.filter(({ row }) => row.mode === 'own' && row.rule);
	if (ownRules.length) {
		return {
			source: 'exception',
			candidates: ownRules.map(({ row, categoryId }) => ({
				rule: row.rule as SaleRule,
				source: 'exception',
				categoryId,
			})),
		};
	}
	if (exceptions.some(({ row }) => row.mode === 'held')) return { source: 'held', candidates: [] };
	return {
		source: 'category',
		candidates: lines.map((line) => ({ rule: line.rule, source: 'category', categoryId: line.categoryId })),
	};
}

/**
 * One rule applied to one SKU's normal selling price, in whole rupees rounded down, or null
 * when the rule can't apply: a price of ₹ 0 or less, one above the normal price, or more rupees
 * off than the price. A rule that leaves the price unchanged is no sale either.
 */
export function applySaleRule(rule: SaleRule, normalINR: number, sku: string): number | null {
	if (!Number.isFinite(normalINR) || normalINR <= 0) return null;
	let sale: number;
	if (rule.kind === 'percent') {
		if (rule.value <= 0 || rule.value >= 100) return null;
		sale = Math.floor((normalINR * (100 - rule.value)) / 100);
	} else if (rule.kind === 'amount') {
		if (rule.value <= 0 || rule.value >= normalINR) return null;
		sale = Math.floor(normalINR - rule.value);
	} else {
		sale = Math.floor(rule.skuPrices[sku] ?? rule.value);
	}
	if (sale <= 0 || sale >= normalINR) return null;
	return sale;
}

/** The lowest price any candidate rule gives this SKU, or null when none applies. */
export function salePriceINR(candidates: readonly SaleCandidate[], normalINR: number, sku: string): number | null {
	let best: number | null = null;
	for (const candidate of candidates) {
		const price = applySaleRule(candidate.rule, normalINR, sku);
		if (price !== null && (best === null || price < best)) best = price;
	}
	return best;
}

/** Why a rule is refused on Save, before any price is known. Null when it is fine. */
export function saleRuleProblem(rule: SaleRule): string | null {
	if (rule.kind === 'percent' && (rule.value <= 0 || rule.value >= 100)) return 'percent_out_of_range';
	if (rule.kind === 'amount' && (rule.value <= 0 || !Number.isInteger(rule.value))) return 'amount_not_whole';
	if (rule.kind === 'fixed') {
		const prices = [rule.value, ...Object.values(rule.skuPrices)];
		if (!Object.keys(rule.skuPrices).length && rule.value <= 0) return 'fixed_zero';
		if (prices.some((price) => !Number.isInteger(price) || price < 0)) return 'fixed_not_whole';
	}
	return null;
}

/** More than 60% off: shown as a warning on Review, never refused. */
export function saleWarning(normalINR: number, saleINR: number | null): boolean {
	if (saleINR === null || normalINR <= 0) return false;
	return ((normalINR - saleINR) / normalINR) * 100 > SALE_WARNING_PERCENT;
}

/** Every product a sale names outright, and every category. Used for the overlap check. */
export function saleTargets(setup: SaleSetup): { productIds: string[]; categoryIds: string[] } {
	return {
		productIds: setup.products.map((line) => line.productId),
		categoryIds: setup.categories.map((line) => line.categoryId),
	};
}

/** Two time windows share at least one moment. A null end is open. */
export function windowsOverlap(
	a: { startsAt: string; endsAt: string | null },
	b: { startsAt: string; endsAt: string | null },
): boolean {
	const aStart = Date.parse(a.startsAt);
	const bStart = Date.parse(b.startsAt);
	const aEnd = a.endsAt ? Date.parse(a.endsAt) : Number.POSITIVE_INFINITY;
	const bEnd = b.endsAt ? Date.parse(b.endsAt) : Number.POSITIVE_INFINITY;
	return aStart < bEnd && bStart < aEnd;
}
