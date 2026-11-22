import type { OrderStatus } from '@saha-textile/contracts';

/**
 * An order's steps as the shopper sees them, with the theme's tracking icons (used by the order page's step panel and
 * the order progress track). Packed counts as Processing; a cancelled order stops where it was.
 */
export const ORDER_STEPS: ReadonlyArray<{ status: OrderStatus; icon: string }> = [
	{ status: 'placed', icon: 'pending' },
	{ status: 'processing', icon: 'processing' },
	{ status: 'shipped', icon: 'shipped' },
	{ status: 'out_for_delivery', icon: 'out-for-delivery' },
	{ status: 'delivered', icon: 'delivered' },
];

const RANK: Partial<Record<OrderStatus, number>> = {
	placed: 0,
	processing: 1,
	packed: 1,
	shipped: 2,
	out_for_delivery: 3,
	delivered: 4,
};

/** Which step an order has reached (0 = Placed … 4 = Delivered); null before it is placed or once cancelled. */
export function orderStepRank(status: OrderStatus): number | null {
	return RANK[status] ?? null;
}
