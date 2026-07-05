import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { IStatisticsCount, IRevenueChart } from '@data-access/interfaces/dashboard.interface';

@Injectable({
	providedIn: 'root',
})
export class DashboardService {
	private http = inject(HttpClient);

	getStatisticsCount(): Observable<IStatisticsCount> {
		return this.http.get<IStatisticsCount>(`${environment.URL}/count.json`);
	}

	getRevenueChart(): Observable<IRevenueChart> {
		return this.http.get<IRevenueChart>(`${environment.URL}/chart.json`);
	}
}
