import type { Promotion } from '@saha/contracts';

/**
 * Compute the INR discount for a single price under a promotion's type/value.
 * Percentage promotions take `value` as a percent; fixed promotions take
 * `value` as an INR amount (never discounting below zero). Promotions are
 * always resolved on INR first, then the final total is converted.
 */
export function discountAmountINR(priceINR: number, promo: Pick<Promotion, 'type' | 'value'>): number {
	if (priceINR < 0) throw new RangeError('priceINR must be non-negative');
	if (promo.value < 0) throw new RangeError('promotion value must be non-negative');

	if (promo.type === 'percentage') {
		const pct = Math.min(promo.value, 100);
		return (priceINR * pct) / 100;
	}
	return Math.min(promo.value, priceINR);
}

/** Apply a promotion to a price and return the discounted INR price. */
export function applyDiscountINR(priceINR: number, promo: Pick<Promotion, 'type' | 'value'>): number {
	return priceINR - discountAmountINR(priceINR, promo);
}
