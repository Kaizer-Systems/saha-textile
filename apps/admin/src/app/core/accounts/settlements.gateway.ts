import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type {
	Settlement,
	SettlementImportWrite,
	SettlementList,
	SettlementListQuery,
	SettlementPreview,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const SETTLEMENT_KEYS = {
	all: ['settlements'] as const,
	list: (query: SettlementListQuery) => ['settlements', 'list', query] as const,
};

/** Gateway payouts and courier COD remittances (accounts brief Q10). */
@Injectable({ providedIn: 'root' })
export class SettlementsGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path = '') => `${runtimeConfig.apiUrl}/admin/accounts/settlements${path}`;

	list(query: SettlementListQuery): Observable<SettlementList> {
		return this.http.get<SettlementList>(this.api(), { params: { ...query } });
	}

	one(id: string): Observable<Settlement> {
		return this.http.get<Settlement>(this.api(`/${encodeURIComponent(id)}`));
	}

	preview(write: SettlementImportWrite): Observable<SettlementPreview> {
		return this.http.post<SettlementPreview>(this.api('/preview'), write);
	}

	import(write: SettlementImportWrite): Observable<{ saved: Settlement[]; skipped: string[] }> {
		return this.http.post<{ saved: Settlement[]; skipped: string[] }>(this.api(), write);
	}
}
