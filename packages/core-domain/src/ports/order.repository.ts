import type { Order, OrderStatus } from '@saha-textile/contracts';

import type { PageQuery, Paginated } from './pagination';
import type { TransactionContext } from './transaction-manager.port';

/** One product from a paid order, with the moment it was paid for. */
export interface PurchasedProduct {
	productId: string;
	purchasedAt: string;
}

/** The product lines of one paid order, for the weekly analytics. */
export interface PurchasedOrder {
	placedAt: string;
	lines: Array<{ productId: string; quantity: number }>;
}

export interface OrderRepository {
	findById(id: string): Promise<Order | null>;
	findByOrderNumber(orderNumber: string): Promise<Order | null>;
	listByUser(userId: string, query: PageQuery): Promise<Paginated<Order>>;
	/** Newest first, each product once, from at most `limit` paid orders placed since `since`. */
	listRecentlyPurchased(since: string, limit: number): Promise<PurchasedProduct[]>;
	/** Every paid order. Cancelled, refunded and unpaid orders are not sales. */
	listPurchased(): Promise<PurchasedOrder[]>;
	save(order: Order, context?: TransactionContext): Promise<Order>;
	updateStatus(id: string, status: OrderStatus, note?: string): Promise<Order>;
}
