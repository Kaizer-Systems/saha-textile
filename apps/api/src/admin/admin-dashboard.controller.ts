import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	type DashboardCustomersResponse,
	type DashboardMonthlyRevenueResponse,
	type DashboardOrdersResponse,
	DashboardPeriodQuery,
	type DashboardRecentOrdersResponse,
	type DashboardReviewsResponse,
	type DashboardRevenueResponse,
	type DashboardStockResponse,
	DashboardStockQuery,
	type DashboardTopProductsResponse,
} from '@saha-textile/contracts';

import { Audience, RequirePermissions } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { AdminDashboardService } from './admin-dashboard.service';

/**
 * Data for the widgets on the admin home page.
 *
 * Each route requires that widget's own permission, so a role the owner has not granted a
 * widget gets a `403` here, whatever the screen shows. Hiding the widget is convenience; this
 * is the control. The figures change with every order, so nothing is cached.
 */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/dashboard')
export class AdminDashboardController {
	constructor(private readonly dashboard: AdminDashboardService) {}

	@Get('revenue')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('dashboard.revenue')
	@ApiOperation({ operationId: 'getDashboardRevenue', summary: 'Revenue for one period (Total Revenue tile)' })
	revenue(
		@Query(new ZodValidationPipe(DashboardPeriodQuery)) query: DashboardPeriodQuery,
	): Promise<DashboardRevenueResponse> {
		return this.dashboard.revenue(query);
	}

	@Get('revenue/monthly')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('dashboard.revenue')
	@ApiOperation({ operationId: 'getDashboardMonthlyRevenue', summary: 'Revenue by month for the last 12 months' })
	monthlyRevenue(): Promise<DashboardMonthlyRevenueResponse> {
		return this.dashboard.monthlyRevenue();
	}

	@Get('orders')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('dashboard.orders')
	@ApiOperation({ operationId: 'getDashboardOrders', summary: 'Order count for one period (Total Orders tile)' })
	orders(
		@Query(new ZodValidationPipe(DashboardPeriodQuery)) query: DashboardPeriodQuery,
	): Promise<DashboardOrdersResponse> {
		return this.dashboard.orders(query);
	}

	@Get('orders/recent')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('dashboard.orders')
	@ApiOperation({ operationId: 'getDashboardRecentOrders', summary: 'The newest orders' })
	recentOrders(): Promise<DashboardRecentOrdersResponse> {
		return this.dashboard.recentOrders();
	}

	@Get('customers')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('dashboard.customers')
	@ApiOperation({ operationId: 'getDashboardCustomers', summary: 'Customer count, leaving out deleted accounts' })
	customers(): Promise<DashboardCustomersResponse> {
		return this.dashboard.customerCount();
	}

	@Get('top-products')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('dashboard.top_products')
	@ApiOperation({ operationId: 'getDashboardTopProducts', summary: 'Best sellers for one period' })
	topProducts(
		@Query(new ZodValidationPipe(DashboardPeriodQuery)) query: DashboardPeriodQuery,
	): Promise<DashboardTopProductsResponse> {
		return this.dashboard.topProducts(query);
	}

	@Get('stock')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('dashboard.stock')
	@ApiOperation({ operationId: 'getDashboardStock', summary: 'Live variants with the lowest stock' })
	stock(
		@Query(new ZodValidationPipe(DashboardStockQuery)) query: DashboardStockQuery,
	): Promise<DashboardStockResponse> {
		return this.dashboard.stock(query);
	}

	@Get('reviews')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('dashboard.reviews')
	@ApiOperation({ operationId: 'getDashboardReviews', summary: 'The newest reviews, in any moderation state' })
	reviews(): Promise<DashboardReviewsResponse> {
		return this.dashboard.reviews();
	}
}
