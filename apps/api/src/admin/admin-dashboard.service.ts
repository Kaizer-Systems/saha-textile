import { Inject, Injectable } from '@nestjs/common';
import {
	DASHBOARD_LIST_LIMITS,
	DashboardCustomersResponse,
	DashboardMonthlyRevenueResponse,
	DashboardOrdersResponse,
	type DashboardPeriodQuery,
	DashboardRecentOrdersResponse,
	DashboardReviewsResponse,
	DashboardRevenueResponse,
	DashboardStockResponse,
	type DashboardStockQuery,
	DashboardTopProductsResponse,
	type MediaAsset,
} from '@saha-textile/contracts';
import {
	type CustomerRepository,
	type DashboardRepository,
	dashboardChartMonths,
	dashboardStockState,
	type MediaAssetRepository,
	type ProductRepository,
	type ProductVariantRepository,
	resolveDashboardPeriod,
	resolveImage,
	type StoragePort,
} from '@saha-textile/core-domain';

import {
	CUSTOMER_REPOSITORY,
	DASHBOARD_REPOSITORY,
	MEDIA_ASSET_REPOSITORY,
	PRODUCT_REPOSITORY,
	PRODUCT_VARIANT_REPOSITORY,
	STORAGE_PORT,
} from '../infra/tokens';

/**
 * Figures for the admin home page (`DEC-ADMIN-HOME-WIDGETS`).
 *
 * One method per widget, so each route can require that widget's own permission. Every read is
 * bounded by a period or a row limit, and each response is parsed by its contract on the way
 * out, so a widget cannot quietly carry more than the permission it sits behind allows.
 */
@Injectable()
export class AdminDashboardService {
	constructor(
		@Inject(DASHBOARD_REPOSITORY) private readonly dashboard: DashboardRepository,
		@Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepository,
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		@Inject(PRODUCT_VARIANT_REPOSITORY) private readonly variants: ProductVariantRepository,
		@Inject(MEDIA_ASSET_REPOSITORY) private readonly media: MediaAssetRepository,
		@Inject(STORAGE_PORT) private readonly storage: StoragePort,
	) {}

	async revenue(query: DashboardPeriodQuery): Promise<DashboardRevenueResponse> {
		const range = resolveDashboardPeriod(query, new Date());
		const { revenueINR } = await this.dashboard.salesTotals(range);
		return DashboardRevenueResponse.parse({ ...range, revenueINR });
	}

	async orders(query: DashboardPeriodQuery): Promise<DashboardOrdersResponse> {
		const range = resolveDashboardPeriod(query, new Date());
		const { orders } = await this.dashboard.salesTotals(range);
		return DashboardOrdersResponse.parse({ ...range, orders });
	}

	async monthlyRevenue(): Promise<DashboardMonthlyRevenueResponse> {
		const now = new Date();
		const sold = await this.dashboard.revenueByMonth(resolveDashboardPeriod({ period: 'last_12_months' }, now));
		const byMonth = new Map(sold.map((row) => [row.month, row.revenueINR]));
		return DashboardMonthlyRevenueResponse.parse({
			months: dashboardChartMonths(now).map((month) => ({ month, revenueINR: byMonth.get(month) ?? 0 })),
		});
	}

	async recentOrders(): Promise<DashboardRecentOrdersResponse> {
		const orders = await this.dashboard.recentOrders(DASHBOARD_LIST_LIMITS.recentOrders);
		const items = await Promise.all(
			orders.map(async (order) => ({
				id: order.id,
				orderNumber: order.orderNumber,
				placedAt: order.createdAt ?? null,
				customerName: order.userId ? await this.customerName(order.userId) : null,
				totalINR: order.totalINR,
				status: order.status,
			})),
		);
		return DashboardRecentOrdersResponse.parse({ items });
	}

	async customerCount(): Promise<DashboardCustomersResponse> {
		return DashboardCustomersResponse.parse({ customers: await this.dashboard.customerCount() });
	}

	async topProducts(query: DashboardPeriodQuery): Promise<DashboardTopProductsResponse> {
		const range = resolveDashboardPeriod(query, new Date());
		const rows = await this.dashboard.topProducts(range, DASHBOARD_LIST_LIMITS.topProducts);
		const productIds = rows.map((row) => row.productId);
		const [products, variants] = await Promise.all([
			Promise.all(productIds.map((id) => this.products.findById(id, 'admin'))),
			this.variants.listForProducts(productIds, 'admin'),
		]);
		const thumbnails = await this.thumbnails(products.map((product) => product?.media.gallery[0] ?? null));
		const items = rows.map((row, index) => ({
			...row,
			thumbnailUrl: thumbnails.get(products[index]?.media.gallery[0] ?? '') ?? null,
			stock: variants
				.filter((variant) => variant.productId === row.productId)
				.reduce((sum, variant) => sum + variant.stock.quantity, 0),
		}));
		return DashboardTopProductsResponse.parse({ items });
	}

	async stock(query: DashboardStockQuery): Promise<DashboardStockResponse> {
		const rows = await this.dashboard.lowestStock({
			limit: DASHBOARD_LIST_LIMITS.stock,
			categoryId: query.categoryId,
		});
		const thumbnails = await this.thumbnails(rows.map((row) => row.galleryAssetId));
		return DashboardStockResponse.parse({
			items: rows.map((row) => ({
				variantId: row.variantId,
				productId: row.productId,
				sku: row.sku,
				title: row.title,
				thumbnailUrl: thumbnails.get(row.galleryAssetId ?? '') ?? null,
				quantity: row.quantity,
				state: dashboardStockState(row),
			})),
		});
	}

	async reviews(): Promise<DashboardReviewsResponse> {
		const reviews = await this.dashboard.latestReviews(DASHBOARD_LIST_LIMITS.reviews);
		const products = await Promise.all(reviews.map((review) => this.products.findById(review.productId, 'admin')));
		const thumbnails = await this.thumbnails(products.map((product) => product?.media.gallery[0] ?? null));
		const items = await Promise.all(
			reviews.map(async (review, index) => ({
				id: review.id,
				productTitle: products[index]?.title ?? null,
				thumbnailUrl: thumbnails.get(products[index]?.media.gallery[0] ?? '') ?? null,
				customerName: await this.customerName(review.userId),
				rating: review.rating,
				status: review.status,
				createdAt: review.createdAt ?? null,
			})),
		);
		return DashboardReviewsResponse.parse({ items });
	}

	private async customerName(customerId: string): Promise<string | null> {
		const customer = await this.customers.findById(customerId);
		return customer?.displayName ?? customer?.email ?? null;
	}

	/** Card-size image URLs by asset id, for the handful of rows on the page. */
	private async thumbnails(assetIds: ReadonlyArray<string | null>): Promise<Map<string, string>> {
		const wanted = [...new Set(assetIds.filter((id): id is string => Boolean(id)))];
		if (wanted.length === 0) return new Map();
		const assets = await this.media.findManyByIds(wanted);
		return new Map(
			assets.flatMap((asset) => {
				const url = this.thumbnail(asset);
				return url ? [[asset.id, url] as const] : [];
			}),
		);
	}

	private thumbnail(asset: MediaAsset): string | null {
		const resolved = resolveImage({
			asset,
			getUrl: (key) => this.storage.getUrl(key),
			locale: 'en',
			fallbackLocale: 'en',
			roles: ['card'],
		});
		return resolved?.roles['card']?.[0]?.url ?? null;
	}
}
