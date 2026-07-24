import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { DashboardService } from '@data-access/services/dashboard.service';

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
