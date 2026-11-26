import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type { YearCloseConfirm, YearCloseView } from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const YEAR_CLOSE_KEYS = {
	one: (year: string) => ['accounts', 'year-close', year] as const,
};

/** Closing a financial year (accounts brief T3). */
@Injectable({ providedIn: 'root' })
export class YearCloseGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path: string) => `${runtimeConfig.apiUrl}/admin/accounts/year-close/${path}`;

	view(year: string): Observable<YearCloseView> {
		return this.http.get<YearCloseView>(this.api(year));
	}

	confirm(year: string, write: Partial<YearCloseConfirm>): Observable<YearCloseView> {
		return this.http.post<YearCloseView>(this.api(`${year}/confirm`), write);
	}

	postClosing(year: string): Observable<YearCloseView> {
		return this.http.post<YearCloseView>(this.api(`${year}/closing-entries`), {});
	}

	close(year: string): Observable<YearCloseView> {
		return this.http.post<YearCloseView>(this.api(`${year}/close`), {});
	}
}
