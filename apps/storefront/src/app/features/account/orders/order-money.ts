import type { OrderStatus, ShopOrderSummary } from '@saha-textile/contracts';

/**
 * An order's money in the currency it was paid in (never converted again for the reader's chosen currency):
 * "₹ 44,900.00", "£ 412.50".
 */
export function orderMoney(amount: number, currency: string): string {
	if (currency === 'INR') {
		return `₹ ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}
	try {
		return new Intl.NumberFormat('en-GB', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount);
	} catch {
		return `${currency} ${amount.toFixed(2)}`;
	}
}

/** The theme's status pill for each order status. */
export function orderPill(status: OrderStatus): string {
	switch (status) {
		case 'delivered':
			return 'delivered';
		case 'cancelled':
			return 'cancelled';
		case 'processing':
		case 'packed':
		case 'shipped':
		case 'out_for_delivery':
			return 'processing';
		default:
			return 'pending';
	}
}

/** The list's Items words (E06): one line of its own, or how many sets and products, with the pieces. */
export function orderItemsText(
	order: ShopOrderSummary,
	t: (key: string, params?: Record<string, unknown>) => string,
): string {
	const own = order.sets + order.products;
	const pieces = t(order.pieces === 1 ? 'my_orders_pieces_one' : 'my_orders_pieces', { count: order.pieces });
	if (own <= 1) {
		if (order.sets) return `${order.firstTitle} · ${pieces}`;
		if (order.freeItems) {
			return `${order.firstTitle} ${t(order.freeItems === 1 ? 'my_orders_plus_free_one' : 'my_orders_plus_free', { count: order.freeItems })}`;
		}
		return order.firstTitle;
	}
	const sets = order.sets ? t(order.sets === 1 ? 'my_orders_sets_one' : 'my_orders_sets', { count: order.sets }) : '';
	const products = order.products
		? t(order.products === 1 ? 'my_orders_products_one' : 'my_orders_products', { count: order.products })
		: '';
	return `${[sets, products].filter(Boolean).join(', ')} · ${pieces}`;
}
