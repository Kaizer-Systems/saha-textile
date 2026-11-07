import type { DashboardRange, I18nString, Order, Review } from '@saha-textile/contracts';

/** Revenue and order count for one range. */
export interface DashboardSalesTotals {
	revenueINR: number;
	orders: number;
}

/** One `YYYY-MM` month in India with its revenue. Months with no sales are absent. */
export interface DashboardMonthRevenue {
	month: string;
	revenueINR: number;
}

/** A product's sales within a range, from the order-line snapshots. */
export interface DashboardProductSales {
	productId: string;
	title: I18nString;
	lastSoldAt: string;
	unitPriceINR: number;
	orders: number;
	quantitySold: number;
	revenueINR: number;
}

/** A live variant with what its report row needs from the product. */
export interface DashboardVariantStock {
	variantId: string;
	productId: string;
	sku: string;
	title: I18nString;
	galleryAssetId: string | null;
	quantity: number;
	variantThreshold: number | null;
	productThreshold: number | null;
}

/**
 * Read-only figures for the admin home page.
 *
 * Every method is bounded: sales reads take a range and listings take a limit, so nothing here
 * can walk a whole collection on a page load. The range comes from `resolveDashboardPeriod`.
 */
export interface DashboardRepository {
	/** Purchased orders only. Pending, cancelled and refunded orders are not sales. */
	salesTotals(range: DashboardRange): Promise<DashboardSalesTotals>;
	revenueByMonth(range: DashboardRange): Promise<DashboardMonthRevenue[]>;
	/** Newest first, in any status. */
	recentOrders(limit: number): Promise<Order[]>;
	topProducts(range: DashboardRange, limit: number): Promise<DashboardProductSales[]>;
	/** Every customer except deleted accounts. */
	customerCount(): Promise<number>;
	/** Live, tracked variants of live products, lowest stock first. */
	lowestStock(input: { limit: number; categoryId?: string }): Promise<DashboardVariantStock[]>;
	/** Newest first, in any moderation state. */
	latestReviews(limit: number): Promise<Review[]>;
}
