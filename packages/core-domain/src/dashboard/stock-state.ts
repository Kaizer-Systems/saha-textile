import type { DashboardStockState } from '@saha-textile/contracts';

import { SHOP_LOW_STOCK_THRESHOLD } from '../catalog/badges';

/**
 * One variant's stock state, using the rule the storefront's Low stock badge uses: a threshold
 * set on the variant wins, then one set on the product, then the shop default.
 */
export function dashboardStockState(input: {
	quantity: number;
	variantThreshold: number | null;
	productThreshold: number | null;
}): DashboardStockState {
	if (input.quantity <= 0) return 'out_of_stock';
	const threshold = input.variantThreshold ?? input.productThreshold ?? SHOP_LOW_STOCK_THRESHOLD;
	return input.quantity <= threshold ? 'low_stock' : 'in_stock';
}
