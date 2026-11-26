import { inject } from '@angular/core';

import { type DashboardPeriodQuery } from '@saha-textile/contracts';
import { injectQuery, keepPreviousData } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { DashboardService } from '@data-access/services/dashboard.service';

/**
 * Each widget's query takes `enabled` from the caller's permission, so a role without the
 * widget never asks for its data. The API refuses it regardless; this only saves the request.
 *
 * Period queries keep the previous figure on screen while the next one loads, so a tile does
 * not blank out and jump when someone changes the period.
 */

export function injectStatisticsQuery() {
	const dashboardService = inject(DashboardService);
	return injectQuery(() => ({
		queryKey: ['dashboard-statistics'],
		queryFn: () => firstValueFrom(dashboardService.getStatisticsCount()),
	}));
}

export function injectRevenueChartQuery() {
	const dashboardService = inject(DashboardService);
	return injectQuery(() => ({
		queryKey: ['dashboard-revenue-chart'],
		queryFn: () => firstValueFrom(dashboardService.getRevenueChart()),
	}));
}

export function injectDashboardRevenueQuery(period: () => DashboardPeriodQuery, enabled: () => boolean) {
	const dashboardService = inject(DashboardService);
	return injectQuery(() => ({
		queryKey: ['dashboard-revenue', period()],
		queryFn: () => firstValueFrom(dashboardService.getRevenue(period())),
		enabled: enabled(),
		placeholderData: keepPreviousData,
	}));
}

export function injectDashboardMonthlyRevenueQuery(enabled: () => boolean) {
	const dashboardService = inject(DashboardService);
	return injectQuery(() => ({
		queryKey: ['dashboard-monthly-revenue'],
		queryFn: () => firstValueFrom(dashboardService.getMonthlyRevenue()),
		enabled: enabled(),
	}));
}

export function injectDashboardOrdersQuery(period: () => DashboardPeriodQuery, enabled: () => boolean) {
	const dashboardService = inject(DashboardService);
	return injectQuery(() => ({
		queryKey: ['dashboard-orders', period()],
		queryFn: () => firstValueFrom(dashboardService.getOrders(period())),
		enabled: enabled(),
		placeholderData: keepPreviousData,
	}));
}

export function injectDashboardRecentOrdersQuery(enabled: () => boolean) {
	const dashboardService = inject(DashboardService);
	return injectQuery(() => ({
		queryKey: ['dashboard-recent-orders'],
		queryFn: () => firstValueFrom(dashboardService.getRecentOrders()),
		enabled: enabled(),
	}));
}

export function injectDashboardCustomersQuery(enabled: () => boolean) {
	const dashboardService = inject(DashboardService);
	return injectQuery(() => ({
		queryKey: ['dashboard-customers'],
		queryFn: () => firstValueFrom(dashboardService.getCustomers()),
		enabled: enabled(),
	}));
}

export function injectDashboardTopProductsQuery(period: () => DashboardPeriodQuery, enabled: () => boolean) {
	const dashboardService = inject(DashboardService);
	return injectQuery(() => ({
		queryKey: ['dashboard-top-products', period()],
		queryFn: () => firstValueFrom(dashboardService.getTopProducts(period())),
		enabled: enabled(),
		placeholderData: keepPreviousData,
	}));
}

export function injectDashboardStockQuery(categoryId: () => string | undefined, enabled: () => boolean) {
	const dashboardService = inject(DashboardService);
	return injectQuery(() => ({
		queryKey: ['dashboard-stock', categoryId()],
		queryFn: () => firstValueFrom(dashboardService.getStock(categoryId())),
		enabled: enabled(),
		placeholderData: keepPreviousData,
	}));
}

export function injectDashboardReviewsQuery(enabled: () => boolean) {
	const dashboardService = inject(DashboardService);
	return injectQuery(() => ({
		queryKey: ['dashboard-reviews'],
		queryFn: () => firstValueFrom(dashboardService.getReviews()),
		enabled: enabled(),
	}));
}
