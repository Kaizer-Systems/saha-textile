import {
	type DashboardRange,
	type I18nString,
	type Order,
	PURCHASED_ORDER_STATUSES,
	type Review,
} from '@saha-textile/contracts';
import type {
	DashboardMonthRevenue,
	DashboardProductSales,
	DashboardRepository,
	DashboardSalesTotals,
	DashboardVariantStock,
} from '@saha-textile/core-domain';

import { toOrder } from '../mappers';
import {
	CustomerModel,
	type OrderDoc,
	OrderModel,
	ProductModel,
	ProductVariantModel,
	type ReviewDoc,
	ReviewModel,
} from '../models/index';
import { toReview } from './content.repository';

/** Months on the chart group in India time, not UTC, so a late-night order lands correctly. */
const SHOP_TIME_ZONE = 'Asia/Kolkata';

/** Enough for any real category. Past it, the report reads the first products in the category. */
const CATEGORY_PRODUCT_CAP = 2000;

const purchasedWithin = (range: DashboardRange) => ({
	status: { $in: [...PURCHASED_ORDER_STATUSES] },
	createdAt: { $gte: new Date(range.from), $lt: new Date(range.to) },
});

export class MongoDashboardRepository implements DashboardRepository {
	async salesTotals(range: DashboardRange): Promise<DashboardSalesTotals> {
		const [totals] = await OrderModel.aggregate<DashboardSalesTotals>([
			{ $match: purchasedWithin(range) },
			{ $group: { _id: null, revenueINR: { $sum: '$totalINR' }, orders: { $sum: 1 } } },
		]).exec();
		return { revenueINR: totals?.revenueINR ?? 0, orders: totals?.orders ?? 0 };
	}

	revenueByMonth(range: DashboardRange): Promise<DashboardMonthRevenue[]> {
		return OrderModel.aggregate<DashboardMonthRevenue>([
			{ $match: purchasedWithin(range) },
			{
				$group: {
					_id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: SHOP_TIME_ZONE } },
					revenueINR: { $sum: '$totalINR' },
				},
			},
			{ $project: { _id: 0, month: '$_id', revenueINR: 1 } },
			{ $sort: { month: 1 } },
		]).exec();
	}

	async recentOrders(limit: number): Promise<Order[]> {
		const docs = await OrderModel.find().sort({ createdAt: -1 }).limit(limit).lean<OrderDoc[]>().exec();
		return docs.map(toOrder);
	}

	async topProducts(range: DashboardRange, limit: number): Promise<DashboardProductSales[]> {
		const rows = await OrderModel.aggregate<{
			_id: string;
			title: I18nString;
			lastSoldAt: Date;
			unitPriceINR: number;
			orders: number;
			quantitySold: number;
			revenueINR: number;
		}>([
			{ $match: purchasedWithin(range) },
			{ $sort: { createdAt: 1 } },
			{ $unwind: '$lines' },
			{
				$group: {
					_id: '$lines.productId',
					title: { $last: '$lines.title' },
					lastSoldAt: { $last: '$createdAt' },
					unitPriceINR: { $last: '$lines.unitPriceINR' },
					orders: { $sum: 1 },
					quantitySold: { $sum: '$lines.quantity' },
					revenueINR: { $sum: '$lines.lineTotalINR' },
				},
			},
			{ $sort: { quantitySold: -1, revenueINR: -1, _id: 1 } },
			{ $limit: limit },
		]).exec();
		return rows.map(({ _id, lastSoldAt, ...row }) => ({
			...row,
			productId: _id,
			lastSoldAt: new Date(lastSoldAt).toISOString(),
		}));
	}

	customerCount(): Promise<number> {
		return CustomerModel.countDocuments({ status: { $ne: 'deleted' } }).exec();
	}

	async lowestStock(input: { limit: number; categoryId?: string }): Promise<DashboardVariantStock[]> {
		const inCategory = input.categoryId ? await this.liveProductIds(input.categoryId) : null;
		const rows = await ProductVariantModel.aggregate<{
			_id: string;
			productId: string;
			sku: string;
			stock: { quantity: number; lowStockThreshold?: number | null };
			product: { title: I18nString; lowStockThreshold?: number | null; media?: { gallery?: string[] } };
		}>([
			{
				$match: {
					status: 'live',
					'stock.tracked': true,
					...(inCategory ? { productId: { $in: inCategory } } : {}),
				},
			},
			{ $sort: { 'stock.quantity': 1, _id: 1 } },
			{ $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product' } },
			{ $unwind: '$product' },
			{ $match: { 'product.status': 'live' } },
			{ $limit: input.limit },
			{
				$project: {
					productId: 1,
					sku: 1,
					stock: 1,
					'product.title': 1,
					'product.lowStockThreshold': 1,
					'product.media.gallery': 1,
				},
			},
		]).exec();
		return rows.map((row) => ({
			variantId: row._id,
			productId: row.productId,
			sku: row.sku,
			title: row.product.title,
			galleryAssetId: row.product.media?.gallery?.[0] ?? null,
			quantity: row.stock.quantity,
			variantThreshold: row.stock.lowStockThreshold ?? null,
			productThreshold: row.product.lowStockThreshold ?? null,
		}));
	}

	async latestReviews(limit: number): Promise<Review[]> {
		const docs = await ReviewModel.find().sort({ createdAt: -1 }).limit(limit).lean<ReviewDoc[]>().exec();
		return docs.map(toReview);
	}

	private async liveProductIds(categoryId: string): Promise<string[]> {
		const products = await ProductModel.find({ status: 'live', categoryIds: categoryId })
			.select({ _id: 1 })
			.limit(CATEGORY_PRODUCT_CAP)
			.lean<Array<{ _id: string }>>()
			.exec();
		return products.map((product) => product._id);
	}
}
