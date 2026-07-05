import type { Order, OrderStatus } from '@saha-textile/contracts';

import type { PageQuery, Paginated } from './pagination';

export interface OrderRepository {
	findById(id: string): Promise<Order | null>;
	findByOrderNumber(orderNumber: string): Promise<Order | null>;
	listByUser(userId: string, query: PageQuery): Promise<Paginated<Order>>;
	save(order: Order): Promise<Order>;
	updateStatus(id: string, status: OrderStatus, note?: string): Promise<Order>;
}
