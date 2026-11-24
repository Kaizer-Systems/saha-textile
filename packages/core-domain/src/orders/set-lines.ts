import { splitShares } from '../bundle/shares';

/**
 * A set or a product with free items, as order lines (bundle builder brief E05–E08, approved 2026-11-22). The set's
 * own line holds no money, stock or tax; its pieces (each at its share of the set price), their free items (₹0) and
 * its extras carry them. A coupon taken off a set is spread over its children that cost money, in proportion to
 * what each costs, to the paisa, so the children always add up to the set.
 */
export interface OrderChildInput {
	role: 'piece' | 'free' | 'extra';
	key: string;
	/** Per one set or product. */
	quantity: number;
	/** The child's price for one set or product: a piece's share, an extra's price, 0 for a free item. */
	priceINR: number;
}

export interface OrderChildMoney {
	key: string;
	quantity: number;
	unitPriceINR: number;
	lineTotalINR: number;
	couponINR: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * The children's money for `lineQuantity` sets or products. `spreadCouponINR` is the coupon on a set's line (0 for a
 * product, whose coupon stays on its own line).
 */
export function orderChildMoney(
	children: readonly OrderChildInput[],
	lineQuantity: number,
	spreadCouponINR = 0,
): OrderChildMoney[] {
	const rows = children.map((child) => ({ child, lineTotalINR: round2(child.priceINR * lineQuantity) }));
	const paying = rows
		.map((row) => ({ key: row.child.key, weightINR: row.lineTotalINR }))
		.filter((row) => row.weightINR > 0);
	const coupon =
		paying.length && spreadCouponINR > 0 ? splitShares(spreadCouponINR, paying) : new Map<string, number>();
	return rows.map(({ child, lineTotalINR }) => {
		const quantity = child.quantity * lineQuantity;
		return {
			key: child.key,
			quantity,
			unitPriceINR: quantity > 0 ? round2(lineTotalINR / quantity) : 0,
			lineTotalINR,
			couponINR: coupon.get(child.key) ?? 0,
		};
	});
}
