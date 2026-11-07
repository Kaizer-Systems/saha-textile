import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { CustomerModel, OrderModel, ProductModel, ProductVariantModel, ReviewModel } from '../src/models/index';
import { MongoDashboardRepository } from '../src/repositories/index';
import { hasMongoEnv, insertRaw, runPrefix } from './mongo-test-env';

const P = runPrefix('dashboard');
const repo = new MongoDashboardRepository();

/** Far in the future, so rows left by other suites never fall inside these ranges. */
const range = { from: '2090-01-01T00:00:00.000Z', to: '2091-01-01T00:00:00.000Z' };
const at = (day: string) => new Date(`${day}T06:00:00.000Z`);
const title = (en: string) => ({ en });

const line = (productId: string, quantity: number, unit: number) => ({
	productId,
	title: title(productId),
	sku: `${productId}_sku`,
	quantity,
	unitPriceINR: unit,
	lineTotalINR: unit * quantity,
});

const order = (id: string, status: string, createdAt: Date, totalINR: number, lines: unknown[] = []) => ({
	_id: `${P}${id}`,
	orderNumber: `${P}${id}`,
	userId: null,
	currency: 'INR',
	lines,
	subtotalINR: totalINR,
	subtotalPaid: totalINR,
	totalINR,
	totalPaid: totalINR,
	status,
	createdAt,
	updatedAt: createdAt,
});

describe.skipIf(!hasMongoEnv())('dashboard repository (integration, rs0)', () => {
	beforeAll(async () => {
		await connectMongo();
		await Promise.all([ProductVariantModel.syncIndexes(), OrderModel.syncIndexes(), ReviewModel.syncIndexes()]);
		for (const doc of [
			order('paid', 'paid', at('2090-03-10'), 1000, [line(`${P}a`, 2, 400), line(`${P}b`, 1, 200)]),
			order('delivered', 'delivered', at('2090-03-20'), 500, [line(`${P}a`, 1, 500)]),
			order('shipped', 'shipped', at('2090-06-01'), 300, [line(`${P}b`, 1, 300)]),
			order('pending', 'pending', at('2090-03-11'), 9999, [line(`${P}c`, 99, 100)]),
			order('refunded', 'refunded', at('2090-03-12'), 9999, [line(`${P}c`, 99, 100)]),
			order('outside', 'paid', at('2091-02-01'), 9999, [line(`${P}c`, 99, 100)]),
			// 19:00 UTC on 31 March is already April in India.
			order('late', 'paid', new Date('2090-03-31T19:00:00.000Z'), 700),
		]) {
			await insertRaw(OrderModel, doc);
		}
	});

	afterAll(async () => {
		const byId = { _id: { $regex: `^${P}` } };
		await Promise.all([
			OrderModel.deleteMany(byId),
			ProductModel.deleteMany(byId),
			ProductVariantModel.deleteMany(byId),
			ReviewModel.deleteMany(byId),
			CustomerModel.deleteMany(byId),
		]);
		await disconnectMongo();
	});

	it('adds up purchased orders inside the range only', async () => {
		await expect(repo.salesTotals(range)).resolves.toEqual({ revenueINR: 2500, orders: 4 });
	});

	it('answers zero for a range with no sales', async () => {
		const empty = { from: '2095-01-01T00:00:00.000Z', to: '2095-02-01T00:00:00.000Z' };
		await expect(repo.salesTotals(empty)).resolves.toEqual({ revenueINR: 0, orders: 0 });
	});

	it('groups revenue by month in India time', async () => {
		await expect(repo.revenueByMonth(range)).resolves.toEqual([
			{ month: '2090-03', revenueINR: 1500 },
			{ month: '2090-04', revenueINR: 700 },
			{ month: '2090-06', revenueINR: 300 },
		]);
	});

	it('ranks products by units sold, keeping the latest price and title', async () => {
		const [first, second] = await repo.topProducts(range, 2);
		expect(first).toEqual({
			productId: `${P}a`,
			title: title(`${P}a`),
			lastSoldAt: at('2090-03-20').toISOString(),
			unitPriceINR: 500,
			orders: 2,
			quantitySold: 3,
			revenueINR: 1300,
		});
		expect(second).toMatchObject({ productId: `${P}b`, orders: 2, quantitySold: 2, revenueINR: 500 });
	});

	it('stops at the limit', async () => {
		await expect(repo.topProducts(range, 1)).resolves.toHaveLength(1);
	});

	it('lists the newest orders in any status', async () => {
		const [newest] = await repo.recentOrders(1);
		expect(newest?.createdAt).toBeDefined();
		const orders = await repo.recentOrders(50);
		const dates = orders.map((row) => row.createdAt ?? '');
		expect(dates).toEqual([...dates].sort().reverse());
	});

	// Other suites write customers at the same time, so this checks the question it asks.
	it('counts every customer but the deleted', async () => {
		const count = vi.spyOn(CustomerModel, 'countDocuments');
		await expect(repo.customerCount()).resolves.toEqual(expect.any(Number));
		expect(count).toHaveBeenCalledWith({ status: { $ne: 'deleted' } });
		count.mockRestore();
	});

	describe('lowestStock', () => {
		const product = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
			_id: `${P}${id}`,
			title: title(id),
			slug: `${P}${id}`,
			sku: `${P}${id}`,
			status,
			categoryIds: [`${P}cat`],
			...extra,
		});
		const variant = (id: string, productId: string, quantity: number, extra: Record<string, unknown> = {}) => ({
			_id: `${P}${id}`,
			productId: `${P}${productId}`,
			sku: `${P}${id}_sku`,
			status: 'live',
			optionSelectionHash: id,
			stock: { tracked: true, quantity, lowStockThreshold: null },
			...extra,
		});

		beforeAll(async () => {
			for (const doc of [
				product('p1', 'live', { lowStockThreshold: 4, media: { gallery: ['asset_1', 'asset_2'] } }),
				product('p2', 'draft'),
				product('p3', 'live', { categoryIds: [`${P}other`] }),
			]) {
				await insertRaw(ProductModel, doc);
			}
			for (const doc of [
				variant('v1', 'p1', -5000),
				variant('v2', 'p1', -4000, { stock: { tracked: true, quantity: -4000, lowStockThreshold: 2 } }),
				variant('hidden', 'p2', -6000),
				variant('other', 'p3', -3000),
				variant('untracked', 'p1', -7000, { stock: { tracked: false, quantity: -7000 } }),
				variant('disabled', 'p1', -8000, { status: 'disabled' }),
			]) {
				await insertRaw(ProductVariantModel, doc);
			}
		});

		it('lists live tracked variants of live products, lowest first', async () => {
			await expect(repo.lowestStock({ limit: 3 })).resolves.toEqual([
				{
					variantId: `${P}v1`,
					productId: `${P}p1`,
					sku: `${P}v1_sku`,
					title: title('p1'),
					galleryAssetId: 'asset_1',
					quantity: -5000,
					variantThreshold: null,
					productThreshold: 4,
				},
				expect.objectContaining({ variantId: `${P}v2`, variantThreshold: 2 }),
				expect.objectContaining({
					variantId: `${P}other`,
					galleryAssetId: null,
					productThreshold: null,
				}),
			]);
		});

		it('narrows to a category', async () => {
			const rows = await repo.lowestStock({ limit: 8, categoryId: `${P}other` });
			expect(rows.map((row) => row.variantId)).toEqual([`${P}other`]);
		});

		it('finds nothing in an empty category', async () => {
			await expect(repo.lowestStock({ limit: 8, categoryId: `${P}none` })).resolves.toEqual([]);
		});
	});

	it('lists the newest reviews in any moderation state', async () => {
		await insertRaw(ReviewModel, {
			_id: `${P}r1`,
			productId: `${P}p1`,
			userId: `${P}c1`,
			orderId: `${P}paid`,
			rating: 5,
			body: 'Lovely',
			status: 'pending',
			createdAt: at('2099-01-01'),
		});
		const [newest] = await repo.latestReviews(1);
		expect(newest).toMatchObject({ id: `${P}r1`, status: 'pending', rating: 5 });
	});
});
