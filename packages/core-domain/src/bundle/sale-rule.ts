import type { SaleRule } from '@saha-textile/contracts';

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
