import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type { MoneyLanding, MoneyLandingWrite } from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const MONEY_LANDING_KEY = ['accounts', 'money-landing'] as const;

/** Where money lands (Postings and Convert brief AP1, AP-D1). */
@Injectable({ providedIn: 'root' })
export class MoneyLandingGateway {
	private readonly http = inject(HttpClient);
	private readonly url = () => `${runtimeConfig.apiUrl}/admin/accounts/money-landing`;

	get(): Observable<MoneyLanding> {
		return this.http.get<MoneyLanding>(this.url());
	}
	save(write: MoneyLandingWrite): Observable<MoneyLanding> {
		return this.http.put<MoneyLanding>(this.url(), write);
	}
}
