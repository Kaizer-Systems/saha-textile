import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo } from '../src/connection';
import { CartModel, OrderModel } from '../src/models/index';
import { MongoCartRepository } from '../src/repositories/cart.repository';
import { MongoOrderRepository } from '../src/repositories/order.repository';
import { MongoTransactionManager } from '../src/transaction-manager';

/**
 * Order save + cart consumption must share one Mongo transaction (rs0).
 *
 *   RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
function hasMongoEnv(): boolean {
	if (process.env.RUN_DB_IT !== '1') return false;
	try {
		buildMongoConfig();
		return true;
	} catch {
		return false;
	}
}

describe.skipIf(!hasMongoEnv())('order + cart transaction (integration, rs0)', () => {
	const transactions = new MongoTransactionManager();
	const orders = new MongoOrderRepository();
	const carts = new MongoCartRepository();

	beforeAll(async () => {
		await connectMongo();
	});

	afterAll(async () => {
		await CartModel.deleteMany({ _id: /^cart_tx_/ }).exec();
		await OrderModel.deleteMany({ _id: /^order_tx_/ }).exec();
		await disconnectMongo();
	});

	it('commits order write and cart deletion together', async () => {
		const cartId = `cart_tx_${randomUUID()}`;
		const orderId = `order_tx_${randomUUID()}`;
		await carts.save({
			id: cartId,
			userId: 'user_tx',
			guestToken: null,
			currency: 'INR',
			lines: [{ id: 'line_1', productId: 'prod_1', variationId: null, quantity: 1, addons: [] }],
		});

		await transactions.withTransaction(async (context) => {
			await orders.save(
				{
					id: orderId,
					orderNumber: `SAHA-TEXTILE-TX-${orderId.slice(-6)}`,
					userId: 'user_tx',
					currency: 'INR',
					lines: [
						{
							productId: 'prod_1',
							variationId: null,
							title: { en: 'Fixture' },
							sku: 'SKU-TX',
							quantity: 1,
							attributes: {},
							addons: [],
							unitPriceINR: 100,
							unitPricePaid: 100,
							lineTotalINR: 100,
							lineTotalPaid: 100,
						},
					],
					subtotalINR: 100,
					subtotalPaid: 100,
					promotionsApplied: [],
					totalINR: 100,
					totalPaid: 100,
					status: 'pending',
					statusTimeline: [{ status: 'pending', at: new Date().toISOString() }],
				},
				context,
			);
			await carts.deleteById(cartId, context);
		});

		expect(await orders.findById(orderId)).toBeTruthy();
		expect(await carts.findById(cartId)).toBeNull();
	});

	it('rolls back the order when cart consumption throws', async () => {
		const cartId = `cart_tx_${randomUUID()}`;
		const orderId = `order_tx_${randomUUID()}`;
		await carts.save({
			id: cartId,
			userId: 'user_tx',
			guestToken: null,
			currency: 'INR',
			lines: [{ id: 'line_1', productId: 'prod_1', variationId: null, quantity: 1, addons: [] }],
		});

		const line = {
			productId: 'prod_1',
			variationId: null,
			title: { en: 'Fixture' },
			sku: 'SKU-TX',
			quantity: 1,
			attributes: {},
			addons: [],
			unitPriceINR: 100,
			unitPricePaid: 100,
			lineTotalINR: 100,
			lineTotalPaid: 100,
		};

		await expect(
			transactions.withTransaction(async (context) => {
				await orders.save(
					{
						id: orderId,
						orderNumber: `SAHA-TEXTILE-TX-${orderId.slice(-6)}`,
						userId: 'user_tx',
						currency: 'INR',
						lines: [line],
						subtotalINR: 100,
						subtotalPaid: 100,
						promotionsApplied: [],
						totalINR: 100,
						totalPaid: 100,
						status: 'pending',
						statusTimeline: [{ status: 'pending', at: new Date().toISOString() }],
					},
					context,
				);
				await carts.deleteById(cartId, context);
				throw new Error('deliberate failure after cart consume');
			}),
		).rejects.toThrow('deliberate failure after cart consume');

		expect(await orders.findById(orderId)).toBeNull();
		expect(await carts.findById(cartId)).toBeTruthy();
	});

	it('rolls back when the order write succeeds but a later step fails before commit', async () => {
		const cartId = `cart_tx_${randomUUID()}`;
		const orderId = `order_tx_${randomUUID()}`;
		await carts.save({
			id: cartId,
			userId: 'user_tx',
			guestToken: null,
			currency: 'INR',
			lines: [{ id: 'line_1', productId: 'prod_1', variationId: null, quantity: 1, addons: [] }],
		});

		await expect(
			transactions.withTransaction(async (context) => {
				await orders.save(
					{
						id: orderId,
						orderNumber: `SAHA-TEXTILE-TX-${orderId.slice(-6)}`,
						userId: 'user_tx',
						currency: 'INR',
						lines: [
							{
								productId: 'prod_1',
								variationId: null,
								title: { en: 'Fixture' },
								sku: 'SKU-TX',
								quantity: 1,
								attributes: {},
								addons: [],
								unitPriceINR: 100,
								unitPricePaid: 100,
								lineTotalINR: 100,
								lineTotalPaid: 100,
							},
						],
						subtotalINR: 100,
						subtotalPaid: 100,
						promotionsApplied: [],
						totalINR: 100,
						totalPaid: 100,
						status: 'pending',
						statusTimeline: [{ status: 'pending', at: new Date().toISOString() }],
					},
					context,
				);
				throw new Error('failure before cart consume');
			}),
		).rejects.toThrow('failure before cart consume');

		expect(await orders.findById(orderId)).toBeNull();
		expect(await carts.findById(cartId)).toBeTruthy();
	});
});
