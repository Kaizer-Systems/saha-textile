import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import type {
	DashboardCustomersResponse,
	DashboardMonthlyRevenueResponse,
	DashboardOrdersResponse,
	DashboardPeriodQuery,
	DashboardRecentOrdersResponse,
	DashboardReviewsResponse,
	DashboardRevenueResponse,
	DashboardStockResponse,
	DashboardTopProductsResponse,
} from '@saha-textile/contracts';
import { Observable } from 'rxjs';

import { IStatisticsCount, IRevenueChart } from '@data-access/interfaces/dashboard.interface';

import { environment } from '../../../../public/environments/environment';

/** Drops the fields a preset does not use, so the query string carries only what was chosen. */
function periodParams(query: DashboardPeriodQuery): Record<string, string> {
	return { period: query.period, ...(query.from ? { from: query.from } : {}), ...(query.to ? { to: query.to } : {}) };
}

@Injectable({
	providedIn: 'root',
})
export class DashboardService {
	private http = inject(HttpClient);

	/** Read on each call: `environment.apiUrl` is filled in from `config.json` at start-up. */
	private get url(): string {
		return `${environment.apiUrl}/admin/dashboard`;
	}

	getRevenue(query: DashboardPeriodQuery): Observable<DashboardRevenueResponse> {
		return this.http.get<DashboardRevenueResponse>(`${this.url}/revenue`, { params: periodParams(query) });
	}

	getMonthlyRevenue(): Observable<DashboardMonthlyRevenueResponse> {
		return this.http.get<DashboardMonthlyRevenueResponse>(`${this.url}/revenue/monthly`);
	}

	getOrders(query: DashboardPeriodQuery): Observable<DashboardOrdersResponse> {
		return this.http.get<DashboardOrdersResponse>(`${this.url}/orders`, { params: periodParams(query) });
	}

	getRecentOrders(): Observable<DashboardRecentOrdersResponse> {
		return this.http.get<DashboardRecentOrdersResponse>(`${this.url}/orders/recent`);
	}

	getCustomers(): Observable<DashboardCustomersResponse> {
		return this.http.get<DashboardCustomersResponse>(`${this.url}/customers`);
	}

	getTopProducts(query: DashboardPeriodQuery): Observable<DashboardTopProductsResponse> {
		return this.http.get<DashboardTopProductsResponse>(`${this.url}/top-products`, {
			params: periodParams(query),
		});
	}

	getStock(categoryId?: string): Observable<DashboardStockResponse> {
		return this.http.get<DashboardStockResponse>(`${this.url}/stock`, {
			params: categoryId ? { categoryId } : {},
		});
	}

	getReviews(): Observable<DashboardReviewsResponse> {
		return this.http.get<DashboardReviewsResponse>(`${this.url}/reviews`);
	}

	/** Demo data, kept by owner decision for the Total Stores tile until it is replaced. */
	getStatisticsCount(): Observable<IStatisticsCount> {
		return this.http.get<IStatisticsCount>(`${environment.URL}/count.json`);
	}

	/** Demo data, kept by owner decision for the commission line until it is replaced. */
	getRevenueChart(): Observable<IRevenueChart> {
		return this.http.get<IRevenueChart>(`${environment.URL}/chart.json`);
	}
}
