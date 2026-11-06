import { type Order, type OrderStatus, PURCHASED_ORDER_STATUSES } from '@saha-textile/contracts';
import type {
	OrderRepository,
	PageQuery,
	Paginated,
	PurchasedOrder,
	PurchasedProduct,
	TransactionContext,
} from '@saha-textile/core-domain';

import { toOrder } from '../mappers';
import { type OrderDoc, OrderModel } from '../models/index';
import { sessionFrom } from '../transaction-manager';

export class MongoOrderRepository implements OrderRepository {
	async findById(id: string): Promise<Order | null> {
		const doc = await OrderModel.findById(id).lean<OrderDoc>().exec();
		return doc ? toOrder(doc) : null;
	}

	async findByOrderNumber(orderNumber: string): Promise<Order | null> {
		const doc = await OrderModel.findOne({ orderNumber }).lean<OrderDoc>().exec();
		return doc ? toOrder(doc) : null;
	}

	async listByUser(userId: string, query: PageQuery): Promise<Paginated<Order>> {
		const page = query.page && query.page > 0 ? query.page : 1;
		const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : 20;
		const [docs, total] = await Promise.all([
			OrderModel.find({ userId })
				.sort({ createdAt: -1 })
				.skip((page - 1) * pageSize)
				.limit(pageSize)
				.lean<OrderDoc[]>()
				.exec(),
			OrderModel.countDocuments({ userId }).exec(),
		]);
		return { items: docs.map(toOrder), total, page, pageSize };
	}

	async listPurchased(): Promise<PurchasedOrder[]> {
		const docs = await OrderModel.find({ status: { $in: PURCHASED_ORDER_STATUSES } })
			.lean<OrderDoc[]>()
			.exec();
		return docs.map(toOrder).map((order) => ({
			placedAt: order.createdAt ?? new Date(0).toISOString(),
			lines: order.lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
		}));
	}

	async listRecentlyPurchased(since: string, limit: number): Promise<PurchasedProduct[]> {
		const docs = await OrderModel.find({
			status: { $in: PURCHASED_ORDER_STATUSES },
			createdAt: { $gte: new Date(since) },
		})
			.sort({ createdAt: -1 })
			.limit(limit)
			.lean<OrderDoc[]>()
			.exec();
		const newest = new Map<string, string>();
		for (const order of docs.map(toOrder)) {
			const paid = order.statusTimeline.find((event) => event.status === 'paid')?.at ?? order.createdAt;
			if (!paid) continue;
			for (const line of order.lines) {
				if (!newest.has(line.productId)) newest.set(line.productId, paid);
			}
		}
		return [...newest]
			.map(([productId, purchasedAt]) => ({ productId, purchasedAt }))
			.sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));
	}

	async save(order: Order, context?: TransactionContext): Promise<Order> {
		const { id, ...rest } = order;
		const doc = await OrderModel.findByIdAndUpdate(
			id,
			{ $set: rest },
			{ upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, session: sessionFrom(context) },
		)
			.lean<OrderDoc>()
			.exec();
		return toOrder(doc as OrderDoc);
	}

	async updateStatus(id: string, status: OrderStatus, note?: string): Promise<Order> {
		const event = { status, at: new Date().toISOString(), note };
		const doc = await OrderModel.findByIdAndUpdate(
			id,
			{ $set: { status }, $push: { statusTimeline: event } },
			{ returnDocument: 'after' },
		)
			.lean<OrderDoc>()
			.exec();
		if (!doc) throw new Error(`Order not found: ${id}`);
		return toOrder(doc);
	}
}
