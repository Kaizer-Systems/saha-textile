import { randomUUID } from 'node:crypto';

import { Order, type OrderStatus } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo } from '../src/connection';
import { OrderModel } from '../src/models/index';
import { MongoOrderRepository } from '../src/repositories/order.repository';

function hasMongoEnv(): boolean {
	if (process.env.RUN_DB_IT !== '1') return false;
	try {
		buildMongoConfig();
		return true;
	} catch {
		return false;
	}
}

describe.skipIf(!hasMongoEnv())('recently purchased products (integration)', () => {
	const orders = new MongoOrderRepository();
	const run = randomUUID();
	const product = (name: string) => `prd_recent_${run}_${name}`;

	const place = async (name: string, status: OrderStatus, paidAt?: string) => {
		const id = `order_recent_${randomUUID()}`;
		const line = {
			productId: product(name),
			title: { en: name },
			sku: name,
			quantity: 1,
			unitPriceINR: 1000,
			unitPricePaid: 1000,
			lineTotalINR: 1000,
			lineTotalPaid: 1000,
		};
		await orders.save(
			Order.parse({
				id,
				orderNumber: id,
				currency: 'INR',
				lines: [line],
				subtotalINR: 1000,
				subtotalPaid: 1000,
				totalINR: 1000,
				totalPaid: 1000,
				status,
				statusTimeline: paidAt ? [{ status: 'paid', at: paidAt }] : [],
			}),
		);
		return id;
	};

	const mine = async () => {
		const since = new Date(Date.now() - 60_000).toISOString();
		const rows = await orders.listRecentlyPurchased(since, 50);
		return rows.filter((row) => row.productId.includes(run));
	};

	beforeAll(async () => {
		await connectMongo();
	});

	afterAll(async () => {
		await OrderModel.deleteMany({ _id: /^order_recent_/ }).exec();
		await disconnectMongo();
	});

	it('counts paid orders and ignores unpaid, cancelled and refunded ones', async () => {
		await place('delivered', 'delivered');
		await place('pending', 'pending');
		await place('cancelled', 'cancelled');
		await place('refunded', 'refunded');

		expect((await mine()).map((row) => row.productId)).toEqual([product('delivered')]);
	});

	it('uses the moment of payment and lists each product once, newest first', async () => {
		const earlier = new Date(Date.now() - 30_000).toISOString();
		const later = new Date(Date.now() - 10_000).toISOString();
		await place('twice', 'paid', earlier);
		await place('twice', 'paid', later);

		const row = (await mine()).filter((entry) => entry.productId === product('twice'));

		expect(row).toEqual([{ productId: product('twice'), purchasedAt: later }]);
	});

	it('leaves out orders older than the window', async () => {
		const id = await place('old', 'paid');
		await OrderModel.collection.updateOne(
			{ _id: id as never },
			{ $set: { createdAt: new Date(Date.now() - 3_600_000) } },
		);

		expect((await mine()).map((row) => row.productId)).not.toContain(product('old'));
	});

	it('totals paid orders placed in a stretch of time, for sales by schedule (Page Builder SG-23)', async () => {
		// A stretch no other suite writes into: a moment in 2001 picked for this run.
		const start = new Date(Date.UTC(2001, 0, 1) + Math.floor(Math.random() * 1e9));
		const end = new Date(start.getTime() + 60_000);
		const inside = new Date(start.getTime() + 1_000);
		for (const [name, status] of [
			['sold_a', 'delivered'],
			['sold_b', 'paid'],
			['unpaid', 'pending'],
			['cancelled', 'cancelled'],
		] as const) {
			const id = await place(name, status);
			// The raw driver: Mongoose keeps `createdAt` out of updates.
			await OrderModel.collection.updateOne({ _id: id as never }, { $set: { createdAt: inside } });
		}
		const after = await place('after', 'delivered');
		await OrderModel.collection.updateOne({ _id: after as never }, { $set: { createdAt: end } });
		expect(await orders.paidTotalsBetween(start.toISOString(), end.toISOString())).toEqual({
			orders: 2,
			totalINR: 2000,
		});
	});
});
