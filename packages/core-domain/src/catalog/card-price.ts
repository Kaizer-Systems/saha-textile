/**
 * Card and product-page money for a variable garment.
 *
 * Catalog amounts are tax-inclusive whole rupees. A card shows one price only when
 * every counted variant shares both the selling price and the MRP. Otherwise it shows
 * the range and no percent. The percent a shopper sees is rounded down.
 */

export interface PricedVariant {
	/** What the shopper pays, in whole rupees. */
	sellingINR: number;
	/** MRP. Null when the garment has no strike-through price. */
	mrpINR: number | null;
	/** In stock, or a live made-to-order product. */
	buyable: boolean;
	/** Still a live variant. Used only when nothing is buyable. */
	live: boolean;
}

export interface SingleCardPrice {
	kind: 'single';
	sellingINR: number;
	mrpINR: number | null;
	/** Whole percent, rounded down. Null when there is no honest strike-through. */
	percentOff: number | null;
}

export interface RangeCardPrice {
	kind: 'range';
	minINR: number;
	maxINR: number;
}

export type CardPrice = SingleCardPrice | RangeCardPrice;

/** Selling price from the stored pair. `salePriceINR` wins when the admin set it. */
export function sellingPriceINR(priceINR: number, salePriceINR: number | null): number {
	return salePriceINR ?? priceINR;
}

/**
 * MRP for display. A sale below `priceINR` uses `priceINR` as the MRP when no
 * separate compare-at was entered. No MRP means no strike-through.
 */
export function mrpPriceINR(
	priceINR: number,
	compareAtPriceINR: number | null,
	salePriceINR: number | null,
): number | null {
	const selling = sellingPriceINR(priceINR, salePriceINR);
	if (compareAtPriceINR !== null && compareAtPriceINR > selling) return compareAtPriceINR;
	if (salePriceINR !== null && priceINR > selling) return priceINR;
	return null;
}

/** Half-up to a whole rupee. The admin must see this figure before it is saved. */
export function saleFromPercent(mrpINR: number, percent: number): number {
	if (!Number.isInteger(mrpINR) || mrpINR < 0) throw new RangeError('mrpINR must be a whole rupee');
	if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new RangeError('percent must be 0–100');
	return Math.round((mrpINR * (100 - percent)) / 100);
}

/** Displayed discount. Rounded down so the badge never claims more than the price. */
export function percentOff(sellingINR: number, mrpINR: number | null): number | null {
	if (mrpINR === null || mrpINR <= sellingINR || mrpINR <= 0) return null;
	return Math.floor(((mrpINR - sellingINR) / mrpINR) * 100);
}

export function cardPrice(variants: readonly PricedVariant[]): CardPrice | null {
	const buyable = variants.filter((variant) => variant.buyable);
	const counted = buyable.length > 0 ? buyable : variants.filter((variant) => variant.live);
	if (counted.length === 0) return null;

	const first = counted[0];
	if (!first) return null;
	const same = counted.every((variant) => variant.sellingINR === first.sellingINR && variant.mrpINR === first.mrpINR);
	if (same) {
		return {
			kind: 'single',
			sellingINR: first.sellingINR,
			mrpINR: first.mrpINR,
			percentOff: percentOff(first.sellingINR, first.mrpINR),
		};
	}
	const amounts = counted.map((variant) => variant.sellingINR);
	return { kind: 'range', minINR: Math.min(...amounts), maxINR: Math.max(...amounts) };
}

/** Base variant when it can be bought, otherwise the first buyable row. */
export function selectDefaultVariant<T extends { isBase: boolean; buyable: boolean }>(
	variants: readonly T[],
): T | null {
	const base = variants.find((variant) => variant.isBase && variant.buyable);
	if (base) return base;
	return (
		variants.find((variant) => variant.buyable) ?? variants.find((variant) => variant.isBase) ?? variants[0] ?? null
	);
}
