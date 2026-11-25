import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';

import type { WorklistRow } from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const WORKLIST_KEYS = {
	all: ['worklist'] as const,
	rows: ['worklist', 'rows'] as const,
	count: ['worklist', 'count'] as const,
};

/** The worklist (brief 26 WL1): everything waiting on the signed-in person. */
@Injectable({ providedIn: 'root' })
export class WorklistGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path: string) => `${runtimeConfig.apiUrl}/admin/worklist${path}`;

	rows(): Observable<WorklistRow[]> {
		return this.http.get<WorklistRow[]>(this.api(''));
	}

	count(): Observable<{ count: number }> {
		return this.http.get<{ count: number }>(this.api('/count'));
	}

	approve(id: string): Observable<{ done: true }> {
		return this.http.post<{ done: true }>(this.api(`/${encodeURIComponent(id)}/approve`), {});
	}

	reject(id: string, reason: string): Observable<{ done: true }> {
		return this.http.post<{ done: true }>(this.api(`/${encodeURIComponent(id)}/reject`), { reason });
	}
}

/** The bell's worklist count, looked at again every two minutes. */
export function injectWorklistCountQuery() {
	const gateway = inject(WorklistGateway);
	return injectQuery(() => ({
		queryKey: WORKLIST_KEYS.count,
		queryFn: () => firstValueFrom(gateway.count()),
		refetchInterval: 120_000,
	}));
}
